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
    let db = state.db.lock().map_err(|e| e.to_string())?;
    channels_q::find_all(&db, bot_id.as_deref()).map_err(|e| e.to_string())
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
