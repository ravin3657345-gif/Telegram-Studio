use chrono::Utc;
use serde::Serialize;
use uuid::Uuid;

use crate::{
    db::{models::Bot, queries::bots as bots_q, AppState},
    rate_limit::RateLimiter,
    telegram::{client::TelegramClient, methods},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BotInfo {
    pub id: i64,
    pub first_name: String,
    pub username: Option<String>,
}

/// Bot tokens are only ever needed in full on the Rust side (to call the
/// Telegram API) — the frontend only displays a masked form and copies the
/// real value on explicit user action (`reveal_bot_token`). Sending the full
/// token on every passive `get_bots()`/`add_bot()` load put it in JS memory
/// unnecessarily, reachable by anything that can run script in the WebView.
/// Fixed-length mask (not proportional to the real token length) so the
/// token's length isn't leaked either.
fn mask_token(token: &str) -> String {
    match token.split_once(':') {
        Some((id, _)) => format!("{id}:••••••••••••••••••••"),
        None => "••••••••••••••••••••".to_string(),
    }
}

fn check_token_format(token: &str) -> Result<(), String> {
    let parts: Vec<&str> = token.splitn(2, ':').collect();
    let valid = parts.len() == 2
        && !parts[0].is_empty()
        && parts[0].chars().all(|c| c.is_ascii_digit())
        && parts[1].len() >= 10;
    if valid { Ok(()) } else { Err("Неверный формат токена (ожидается 123456:ABC...)".to_string()) }
}

/// Проверить токен без сохранения
#[tauri::command]
pub async fn validate_bot_token(
    token: String,
    limiter: tauri::State<'_, RateLimiter>,
) -> Result<BotInfo, String> {
    if !limiter.allow() {
        return Err("Слишком много попыток. Подождите минуту.".to_string());
    }
    check_token_format(&token)?;
    let client = TelegramClient::new(&token);
    let user = methods::get_me(&client).await.map_err(|e| e.to_string())?;
    Ok(BotInfo {
        id: user.id,
        first_name: user.first_name,
        username: user.username,
    })
}

#[tauri::command]
pub async fn get_bots(state: tauri::State<'_, AppState>) -> Result<Vec<Bot>, String> {
    let mut bots = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        bots_q::find_all(&db).map_err(|e| e.to_string())?
    };

    // Refresh each bot's display name/username from a fresh getMe call, so a
    // rename in @BotFather shows up without re-adding the bot. Best-effort —
    // an unreachable/revoked bot just keeps its cached name.
    //
    // Fired concurrently, not in a `for` loop: an unreachable Telegram costs
    // ~15s direct plus ~15s on the Supabase relay fallback PER CALL, so a
    // sequential loop made this command block for 30s × bot count with the
    // Bots page showing nothing the whole time. Concurrently the worst case is
    // one call's latency regardless of how many bots there are.
    let refreshed: Vec<(String, crate::telegram::types::TgUser)> = {
        let mut set = tokio::task::JoinSet::new();
        for bot in &bots {
            let (id, token) = (bot.id.clone(), bot.token.clone());
            set.spawn(async move {
                let client = TelegramClient::new(&token);
                methods::get_me(&client).await.ok().map(|u| (id, u))
            });
        }
        let mut out = Vec::new();
        while let Some(res) = set.join_next().await {
            if let Ok(Some(pair)) = res { out.push(pair); }
        }
        out
    };

    if !refreshed.is_empty() {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        for (id, user) in refreshed {
            let Some(bot) = bots.iter_mut().find(|b| b.id == id) else { continue };
            let new_username = user.username.unwrap_or_else(|| user.first_name.clone());
            if user.first_name != bot.name || new_username != bot.username {
                let _ = bots_q::update_info(&db, &bot.id, &user.first_name, &new_username);
                bot.name = user.first_name;
                bot.username = new_username;
            }
        }
    }

    for bot in &mut bots {
        bot.token = mask_token(&bot.token);
    }

    Ok(bots)
}

/// Real token, fetched only on an explicit user action (show/copy in
/// BotsPage) — never as part of a passive list load.
#[tauri::command]
pub async fn reveal_bot_token(
    bot_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    bots_q::get_token(&db, &bot_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Бот не найден".to_string())
}

#[tauri::command]
pub async fn add_bot(
    token: String,
    state: tauri::State<'_, AppState>,
) -> Result<Bot, String> {
    check_token_format(&token)?;
    let client = TelegramClient::new(&token);
    let user = methods::get_me(&client).await.map_err(|e| e.to_string())?;

    let now = Utc::now().to_rfc3339();
    let bot = Bot {
        id: Uuid::new_v4().to_string(),
        token,
        name: user.first_name.clone(),
        username: user.username.unwrap_or_else(|| user.first_name),
        avatar_url: None,
        is_active: true,
        created_at: now.clone(),
        updated_at: now,
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Если бот с таким токеном уже есть — вернуть его без ошибки
    if let Ok(Some(mut existing)) = bots_q::find_by_token(&db, &bot.token) {
        existing.token = mask_token(&existing.token);
        return Ok(existing);
    }

    bots_q::insert(&db, &bot).map_err(|e| e.to_string())?;
    let mut masked_bot = bot;
    masked_bot.token = mask_token(&masked_bot.token);
    Ok(masked_bot)
}

#[tauri::command]
pub async fn delete_bot(
    bot_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    bots_q::delete(&db, &bot_id).map_err(|e| e.to_string())
}
