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
    for bot in &mut bots {
        let client = TelegramClient::new(&bot.token);
        let Ok(user) = methods::get_me(&client).await else { continue };

        let new_username = user.username.unwrap_or_else(|| user.first_name.clone());
        if user.first_name != bot.name || new_username != bot.username {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let _ = bots_q::update_info(&db, &bot.id, &user.first_name, &new_username);
            bot.name = user.first_name;
            bot.username = new_username;
        }
    }

    Ok(bots)
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
    if let Ok(Some(existing)) = bots_q::find_by_token(&db, &bot.token) {
        return Ok(existing);
    }

    bots_q::insert(&db, &bot).map_err(|e| e.to_string())?;
    Ok(bot)
}

#[tauri::command]
pub async fn delete_bot(
    bot_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    bots_q::delete(&db, &bot_id).map_err(|e| e.to_string())
}
