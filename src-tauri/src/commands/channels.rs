use chrono::Utc;
use uuid::Uuid;

use crate::{
    db::{
        models::Channel,
        queries::{bots as bots_q, channels as channels_q},
        AppState,
    },
    telegram::{client::TelegramClient, methods},
};

#[tauri::command]
pub async fn get_channels(
    bot_id: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Channel>, String> {
    let mut channels = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        channels_q::find_all(&db, bot_id.as_deref()).map_err(|e| e.to_string())?
    };

    // Refresh each channel's title/username/description/member count from a
    // fresh getChat call, so a rename in Telegram shows up here without the
    // user having to remove and re-add the channel. Best-effort: a network
    // hiccup or a channel the bot lost access to just keeps the cached data —
    // it must never make the whole list fail to load.
    for ch in &mut channels {
        let token = {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            bots_q::get_token(&db, &ch.bot_id).ok().flatten()
        };
        let Some(token) = token else { continue };

        let client = TelegramClient::new(&token);
        let Ok(chat) = methods::get_chat(&client, &ch.telegram_id).await else { continue };

        let new_title = chat.title.unwrap_or_else(|| ch.title.clone());
        let changed = new_title != ch.title
            || chat.username != ch.username
            || chat.description != ch.description
            || chat.member_count != ch.member_count;

        if changed {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let _ = channels_q::update_info(
                &db, &ch.id, &new_title,
                chat.username.as_deref(), chat.description.as_deref(), chat.member_count,
            );
            ch.title = new_title;
            ch.username = chat.username;
            ch.description = chat.description;
            ch.member_count = chat.member_count;
        }
    }

    Ok(channels)
}

fn normalize_channel_id(input: &str) -> Result<String, String> {
    let s = input.trim();
    if s.is_empty() {
        return Err("Имя канала не может быть пустым".to_string());
    }
    // numeric id: -100123456789
    if s.starts_with('-') && s[1..].chars().all(|c| c.is_ascii_digit()) {
        return Ok(s.to_string());
    }
    // @username
    let name = s.trim_start_matches('@');
    if name.len() < 4 || !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err("Неверный username канала".to_string());
    }
    Ok(format!("@{}", name))
}

#[tauri::command]
pub async fn add_channel(
    bot_id: String,
    channel_username: String,
    state: tauri::State<'_, AppState>,
) -> Result<Channel, String> {
    let channel_username = normalize_channel_id(&channel_username)?;
    // Получаем токен бота из БД
    let token = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        bots_q::get_token(&db, &bot_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Бот не найден".to_string())?
    };

    // API-вызов вне блокировки Mutex
    let client = TelegramClient::new(&token);
    let chat = methods::get_chat(&client, &channel_username)
        .await
        .map_err(|e| e.to_string())?;

    let now = Utc::now().to_rfc3339();
    let channel = Channel {
        id: Uuid::new_v4().to_string(),
        bot_id,
        telegram_id: chat.id.to_string(),
        title: chat.title.unwrap_or_else(|| channel_username.clone()),
        username: chat.username,
        description: chat.description,
        avatar_path: None,
        member_count: chat.member_count,
        is_active: true,
        created_at: now.clone(),
        updated_at: now,
    };

    let db = state.db.lock().map_err(|e| e.to_string())?;
    channels_q::insert(&db, &channel).map_err(|e| e.to_string())?;
    Ok(channel)
}

#[tauri::command]
pub async fn delete_channel(
    channel_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    channels_q::delete(&db, &channel_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_channel_bot(
    channel_id: String,
    bot_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Verify bot exists
    bots_q::get_token(&db, &bot_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Бот не найден".to_string())?;
    channels_q::update_bot_id(&db, &channel_id, &bot_id).map_err(|e| e.to_string())
}
