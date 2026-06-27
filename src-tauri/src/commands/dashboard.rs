use serde::Serialize;
use crate::{
    db::{queries::bots as bots_q, queries::channels as channels_q, AppState},
    telegram::{client::TelegramClient, methods},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStats {
    pub channel_id:    String,
    pub channel_title: String,
    pub telegram_id:   String,
    pub member_count:  Option<i64>,
    pub posts_total:   i64,
    pub posts_success: i64,
    pub posts_failed:  i64,
    pub last_post_at:  Option<String>,
}

#[tauri::command]
pub async fn get_channel_dashboard(
    channel_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<ChannelStats, String> {
    let (token, channel) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let ch = channels_q::find_by_id(&db, &channel_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Канал не найден".to_string())?;
        let tok = bots_q::get_token(&db, &ch.bot_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Бот не найден".to_string())?;
        (tok, ch)
    };

    // Fetch live member count from Telegram
    let client = TelegramClient::new(&token);
    let member_count = methods::get_chat_member_count(&client, &channel.telegram_id)
        .await
        .ok();

    // Aggregate publication stats from local history
    let (posts_total, posts_success, posts_failed, last_post_at) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let total: i64 = db.query_row(
            "SELECT COUNT(*) FROM publication_history WHERE channel_id=?1",
            [&channel_id], |r| r.get(0),
        ).unwrap_or(0);
        let success: i64 = db.query_row(
            "SELECT COUNT(*) FROM publication_history WHERE channel_id=?1 AND status='published'",
            [&channel_id], |r| r.get(0),
        ).unwrap_or(0);
        let failed: i64 = db.query_row(
            "SELECT COUNT(*) FROM publication_history WHERE channel_id=?1 AND status='failed'",
            [&channel_id], |r| r.get(0),
        ).unwrap_or(0);
        let last: Option<String> = db.query_row(
            "SELECT published_at FROM publication_history WHERE channel_id=?1 ORDER BY published_at DESC LIMIT 1",
            [&channel_id], |r| r.get(0),
        ).ok();
        (total, success, failed, last)
    };

    Ok(ChannelStats {
        channel_id:    channel.id,
        channel_title: channel.title,
        telegram_id:   channel.telegram_id,
        member_count,
        posts_total,
        posts_success,
        posts_failed,
        last_post_at,
    })
}
