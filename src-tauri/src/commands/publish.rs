use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::{
        queries::{bots as bots_q, channels as channels_q},
        AppState,
    },
    telegram::{
        client::TelegramClient,
        methods::{self, MediaItem},
        types::InlineKeyboardMarkup,
    },
};

// ─── Input types (from frontend) ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ButtonPayload {
    pub label: String,
    pub url: Option<String>,
    pub callback_data: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishPayload {
    pub bot_id: String,
    pub channel_ids: Vec<String>,
    pub content_html: String,
    pub media: Vec<MediaItem>,
    pub buttons: Vec<Vec<ButtonPayload>>,
    pub draft_id: Option<String>,
    pub schedule_at: Option<String>,
}

// ─── Output types (to frontend) ──────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub channel_id: String,
    pub channel_title: String,
    pub success: bool,
    pub telegram_msg_id: Option<i64>,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledPostInfo {
    pub id: String,
    pub draft_id: Option<String>,
    pub channel_id: String,
    pub bot_id: String,
    pub scheduled_at: String,
    pub status: String,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Retry `f` up to 2 times with 2s + 5s delays. Returns last error if all fail.
async fn with_retry<F, Fut, T>(f: F) -> Result<T, String>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let delays = [2u64, 5];
    let mut last_err = String::new();
    for (attempt, delay) in std::iter::once(0u64).chain(delays.iter().copied()).enumerate() {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
        }
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                eprintln!("[publish] attempt {} failed: {}", attempt + 1, e);
                last_err = e;
            }
        }
    }
    Err(format!("3 попытки не удались: {}", last_err))
}

fn build_keyboard(buttons: &[Vec<ButtonPayload>]) -> Option<InlineKeyboardMarkup> {
    if buttons.is_empty() {
        return None;
    }
    let rows = buttons
        .iter()
        .map(|row| {
            row.iter()
                .map(|b| crate::telegram::types::InlineKeyboardButton {
                    text: b.label.clone(),
                    url: b.url.clone(),
                    callback_data: b.callback_data.clone(),
                })
                .collect()
        })
        .collect();
    Some(InlineKeyboardMarkup { inline_keyboard: rows })
}

async fn publish_to_channel(
    client: &TelegramClient,
    telegram_chat_id: &str,
    payload: &PublishPayload,
) -> Result<i64, String> {
    let keyboard = build_keyboard(&payload.buttons);
    let kb_ref = keyboard.as_ref();

    // Split media into photo/video (can be grouped) vs documents (always individual)
    let photo_video: Vec<&MediaItem> = payload.media.iter()
        .filter(|m| m.media_type == "image" || m.media_type == "video")
        .collect();
    let docs: Vec<&MediaItem> = payload.media.iter()
        .filter(|m| m.media_type != "image" && m.media_type != "video")
        .collect();

    let mut last_msg_id: i64 = 0;

    if photo_video.is_empty() && docs.is_empty() {
        // Text-only
        let msg = methods::send_message(
            client, telegram_chat_id, &payload.content_html, "HTML", kb_ref,
        ).await.map_err(|e| e.to_string())?;
        last_msg_id = msg.message_id;
    } else if photo_video.len() == 1 && docs.is_empty() {
        // Single photo or video
        let item = photo_video[0];
        let msg = if item.media_type == "image" {
            methods::send_photo(client, telegram_chat_id, item, &payload.content_html, "HTML", kb_ref)
                .await.map_err(|e| e.to_string())?
        } else {
            methods::send_video(client, telegram_chat_id, item, &payload.content_html, "HTML", kb_ref)
                .await.map_err(|e| e.to_string())?
        };
        last_msg_id = msg.message_id;
    } else if photo_video.len() > 1 {
        // Photo/video group (album) — max 10
        let group: Vec<MediaItem> = photo_video.iter().map(|&m| m.clone()).take(10).collect();
        let msgs = methods::send_media_group(
            client, telegram_chat_id, &group, &payload.content_html, "HTML",
        ).await.map_err(|e| e.to_string())?;
        last_msg_id = msgs.first().map(|m| m.message_id).unwrap_or(0);
    }

    // Documents always go as individual sendDocument calls.
    // Caption only on first item if no photo/video was sent yet.
    for (i, doc) in docs.iter().enumerate() {
        let caption = if i == 0 && photo_video.is_empty() { &payload.content_html } else { "" };
        let msg = methods::send_document(
            client, telegram_chat_id, doc, caption, "HTML", kb_ref,
        ).await.map_err(|e| e.to_string())?;
        last_msg_id = msg.message_id;
    }

    let msg_id = last_msg_id;

    Ok(msg_id)
}

fn save_history(
    db: &rusqlite::Connection,
    channel_id: &str,
    bot_id: &str,
    draft_id: Option<&str>,
    content_html: &str,
    telegram_msg_id: Option<i64>,
    success: bool,
    error_message: Option<&str>,
) {
    let now = Utc::now().to_rfc3339();
    let status = if success { "published" } else { "failed" };
    let _ = db.execute(
        "INSERT INTO publication_history
         (id, draft_id, channel_id, bot_id, telegram_msg_id, content_json, status, error_message, published_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        rusqlite::params![
            Uuid::new_v4().to_string(),
            draft_id,
            channel_id,
            bot_id,
            telegram_msg_id,
            content_html,
            status,
            error_message,
            now,
        ],
    );
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Опубликовать пост немедленно в один или несколько каналов
#[tauri::command]
pub async fn publish_post(
    payload: PublishPayload,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PublishResult>, String> {
    // Читаем токен бота и telegram_id всех каналов — вне async блока
    let (token, channels) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let token = bots_q::get_token(&db, &payload.bot_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Бот не найден".to_string())?;

        let mut channels = Vec::new();
        for ch_id in &payload.channel_ids {
            let ch = channels_q::find_by_id(&db, ch_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Канал {} не найден", ch_id))?;
            channels.push(ch);
        }
        (token, channels)
    };

    let client = TelegramClient::new(&token);
    let mut results = Vec::new();

    for channel in &channels {
        let result = with_retry(|| publish_to_channel(&client, &channel.telegram_id, &payload)).await;

        let (success, msg_id, err_msg) = match &result {
            Ok(id) => (true, Some(*id), None),
            Err(e) => (false, None, Some(e.clone())),
        };

        {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            save_history(
                &db,
                &channel.id,
                &payload.bot_id,
                payload.draft_id.as_deref(),
                &payload.content_html,
                msg_id,
                success,
                err_msg.as_deref(),
            );
        }

        results.push(PublishResult {
            channel_id: channel.id.clone(),
            channel_title: channel.title.clone(),
            success,
            telegram_msg_id: msg_id,
            error_message: err_msg,
        });
    }

    Ok(results)
}

/// Запланировать публикацию
#[tauri::command]
pub async fn schedule_post(
    payload: PublishPayload,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ScheduledPostInfo>, String> {
    let schedule_at = payload
        .schedule_at
        .as_ref()
        .ok_or_else(|| "Не указано время публикации".to_string())?
        .clone();

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let mut infos = Vec::new();

    // Проверяем, что бот существует
    let _ = bots_q::get_token(&db, &payload.bot_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Бот не найден".to_string())?;

    for ch_id in &payload.channel_ids {
        let _ = channels_q::find_by_id(&db, ch_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Канал {} не найден", ch_id))?;

        let id = Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO scheduled_posts
             (id, draft_id, channel_id, bot_id, content_html, scheduled_at, status, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,'pending',?7,?8)",
            rusqlite::params![
                id,
                payload.draft_id,
                ch_id,
                payload.bot_id,
                payload.content_html,
                schedule_at,
                now,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        infos.push(ScheduledPostInfo {
            id,
            draft_id: payload.draft_id.clone(),
            channel_id: ch_id.clone(),
            bot_id: payload.bot_id.clone(),
            scheduled_at: schedule_at.clone(),
            status: "pending".to_string(),
        });
    }

    Ok(infos)
}

// ─── Rich message helpers ─────────────────────────────────────────────────────

/// Remove a photo/video block from JSON blocks array when upload failed.
fn remove_unresolved_media_block(blocks_json: &str, placeholder: &str) -> String {
    let Ok(mut arr) = serde_json::from_str::<serde_json::Value>(blocks_json) else {
        return blocks_json.to_string();
    };
    if let Some(blocks) = arr.as_array_mut() {
        blocks.retain(|b| {
            let photo = b.get("photo").and_then(|v| v.as_str()).unwrap_or("");
            let video = b.get("video").and_then(|v| v.as_str()).unwrap_or("");
            photo != placeholder && video != placeholder
        });
    }
    serde_json::to_string(&arr).unwrap_or_else(|_| blocks_json.to_string())
}

// ─── Rich message (Bot API 10.1) ─────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RichPhotoPayload {
    pub attach_name: String, // matches photo field in block: "img_0"
    pub data_base64: String,
    pub mime_type: String,
    pub file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishRichPayload {
    pub bot_id: String,
    pub channel_ids: Vec<String>,
    /// JSON array of rich blocks
    pub blocks_json: String,
    pub photos: Vec<RichPhotoPayload>,
    pub draft_id: Option<String>,
}

/// Опубликовать богатое сообщение (Bot API 10.1 sendRichMessage)
#[tauri::command]
pub async fn publish_rich_post(
    payload: PublishRichPayload,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PublishResult>, String> {
    let (token, channels) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let token = bots_q::get_token(&db, &payload.bot_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Бот не найден".to_string())?;
        let mut channels = Vec::new();
        for ch_id in &payload.channel_ids {
            let ch = channels_q::find_by_id(&db, ch_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Канал {} не найден", ch_id))?;
            channels.push(ch);
        }
        (token, channels)
    };

    let client = TelegramClient::new(&token);

    // Telegram media in rich messages accepts only public HTTP/HTTPS URLs (no
    // file_id / attach://), and refuses to fetch from api.telegram.org itself.
    // So each photo is uploaded to an external host (catbox.moe) to get a public
    // URL; Telegram then re-hosts the image on its own CDN when the message is
    // sent (the host URL is not retained in the published post).
    use base64::Engine;
    let mut html = payload.blocks_json.clone();

    for p in &payload.photos {
        let placeholder = format!("attach://{}", p.attach_name);

        // ~67 MB base64 ≈ 50 MB raw — защита от OOM
        if p.data_base64.len() > 67_000_000 {
            return Err(format!("Файл {} слишком большой (лимит 50 МБ)", p.file_name));
        }
        let raw = base64::engine::general_purpose::STANDARD
            .decode(&p.data_base64)
            .map_err(|e| format!("base64 decode: {}", e))?;

        let is_video = p.mime_type.starts_with("video/");
        let (upload_bytes, upload_mime, upload_name) = if is_video {
            (raw, p.mime_type.clone(), p.file_name.clone())
        } else {
            let (jpeg, _, _) = crate::image_utils::normalize_to_jpeg(raw, &p.file_name)
                .map_err(|e| format!("normalize: {}", e))?;
            let jpeg = crate::image_utils::compress_to_limit(jpeg, 5 * 1024 * 1024);
            (jpeg, "image/jpeg".to_string(), p.file_name.replace(|c: char| !c.is_ascii_alphanumeric() && c != '.', "_") + ".jpg")
        };

        match with_retry(|| {
            let bytes = upload_bytes.clone();
            let mime  = upload_mime.clone();
            let name  = upload_name.clone();
            async move { crate::hosting::upload_file(bytes, &mime, &name).await }
        }).await {
            Ok(url) => {
                eprintln!("[rich] {} → {}", p.attach_name, &url[..url.len().min(60)]);
                html = html.replace(&placeholder, &url);
            }
            Err(e) => {
                eprintln!("[rich] photo host failed for {}: {}", p.attach_name, e);
                if html.trim_start().starts_with('[') {
                    // Blocks format: remove the photo/video block with this placeholder
                    html = remove_unresolved_media_block(&html, &placeholder);
                } else {
                    // HTML format: remove broken <img> tag
                    html = methods::remove_img_placeholder(&html, &placeholder);
                }
            }
        }
    }

    let html = html.trim().to_string();
    let mut results = Vec::new();

    for channel in &channels {
        let chat_id = channel.telegram_id.clone();
        let html_clone = html.clone();
        let result: Result<_, String> = with_retry(|| {
            let c = &client;
            let id = chat_id.clone();
            let h  = html_clone.clone();
            async move { methods::send_rich_message(c, &id, &h).await.map_err(|e| e.to_string()) }
        }).await;

        let (success, msg_id, err_msg) = match &result {
            Ok(msg) => (true, Some(msg.message_id), None),
            Err(e) => (false, None, Some(e.clone())),
        };

        {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            save_history(
                &db,
                &channel.id,
                &payload.bot_id,
                payload.draft_id.as_deref(),
                &payload.blocks_json,
                msg_id,
                success,
                err_msg.as_deref(),
            );
        }

        results.push(PublishResult {
            channel_id: channel.id.clone(),
            channel_title: channel.title.clone(),
            success,
            telegram_msg_id: msg_id,
            error_message: err_msg,
        });
    }

    Ok(results)
}

// ─── Poll publish ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollPayload {
    pub bot_id: String,
    pub channel_ids: Vec<String>,
    pub question: String,
    pub options: Vec<String>,
    pub is_anonymous: bool,
    pub allows_multiple_answers: bool,
}

/// Опубликовать опрос в один или несколько каналов
#[tauri::command]
pub async fn send_poll(
    payload: PollPayload,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PublishResult>, String> {
    let (token, channels) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let token = bots_q::get_token(&db, &payload.bot_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Бот не найден".to_string())?;
        let mut channels = Vec::new();
        for ch_id in &payload.channel_ids {
            let ch = channels_q::find_by_id(&db, ch_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Канал {} не найден", ch_id))?;
            channels.push(ch);
        }
        (token, channels)
    };

    let client = TelegramClient::new(&token);
    let mut results = Vec::new();

    for channel in &channels {
        let chat_id = channel.telegram_id.clone();
        let q = payload.question.clone();
        let opts = payload.options.clone();
        let is_anon = payload.is_anonymous;
        let multi = payload.allows_multiple_answers;

        let result: Result<_, String> = with_retry(|| {
            let c = &client;
            let id = chat_id.clone();
            let q2 = q.clone();
            let opts2 = opts.clone();
            async move {
                methods::send_poll(c, &id, &q2, &opts2, is_anon, multi)
                    .await
                    .map_err(|e| e.to_string())
            }
        }).await;

        let (success, msg_id, err_msg) = match &result {
            Ok(msg) => (true, Some(msg.message_id), None),
            Err(e) => (false, None, Some(e.clone())),
        };

        {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            save_history(
                &db,
                &channel.id,
                &payload.bot_id,
                None,
                &format!("[POLL] {}", payload.question),
                msg_id,
                success,
                err_msg.as_deref(),
            );
        }

        results.push(PublishResult {
            channel_id: channel.id.clone(),
            channel_title: channel.title.clone(),
            success,
            telegram_msg_id: msg_id,
            error_message: err_msg,
        });
    }

    Ok(results)
}

/// Получить список запланированных постов
#[tauri::command]
pub async fn get_scheduled_posts(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ScheduledPostInfo>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT id, draft_id, channel_id, bot_id, scheduled_at, status
             FROM scheduled_posts
             WHERE status = 'pending'
             ORDER BY scheduled_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ScheduledPostInfo {
                id: row.get(0)?,
                draft_id: row.get(1)?,
                channel_id: row.get(2)?,
                bot_id: row.get(3)?,
                scheduled_at: row.get(4)?,
                status: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Отменить запланированный пост
#[tauri::command]
pub async fn cancel_scheduled_post(
    post_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    db.execute(
        "UPDATE scheduled_posts SET status='cancelled', updated_at=?1 WHERE id=?2",
        rusqlite::params![now, post_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
