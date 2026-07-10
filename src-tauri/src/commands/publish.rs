use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::{
        models::Bot,
        queries::{bots as bots_q, channels as channels_q, settings as settings_q},
        AppState,
    },
    telegram::{
        client::TelegramClient,
        methods::{self, MediaItem},
        types::InlineKeyboardMarkup,
    },
};

// ─── Input types (from frontend) ─────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ButtonPayload {
    pub label: String,
    pub url: Option<String>,
    pub callback_data: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PublishPayload {
    pub bot_id: Option<String>,
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
    pub bot_username: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledPostInfo {
    pub id: String,
    pub draft_id: Option<String>,
    pub channel_id: String,
    pub channel_title: String,
    pub bot_id: String,
    pub scheduled_at: String,
    pub status: String,
    pub content_preview: Option<String>,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

use tstudio_core::retry::{is_permanent_telegram_error as is_permanent_error, parse_retry_after_secs};

/// Cap on how long a single retry wait is allowed to block a publish action,
/// even if Telegram asks for longer via `retry_after`.
const MAX_RETRY_AFTER_WAIT: u64 = 30;

/// Retry `f` up to 2 times with 2s + 5s delays. Returns last error if all fail.
/// Permanent errors (auth, access denied) are returned immediately without retry.
/// If Telegram responds 429 with a `retry_after` hint, that wait is honored
/// (capped at MAX_RETRY_AFTER_WAIT) instead of the fixed delay — retrying
/// sooner than Telegram asked just extends the flood-control window.
async fn with_retry<F, Fut, T>(f: F) -> Result<T, String>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let delays = [2u64, 5];
    let mut last_err = String::new();
    for (attempt, delay) in std::iter::once(0u64).chain(delays.iter().copied()).enumerate() {
        if attempt > 0 {
            let wait = parse_retry_after_secs(&last_err)
                .map(|s| s.min(MAX_RETRY_AFTER_WAIT))
                .unwrap_or(delay);
            tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
        }
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                log::debug!("[publish] attempt {} failed: {}", attempt + 1, e);
                if is_permanent_error(&e) {
                    return Err(e);
                }
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

// pub(crate) — also called from scheduler::process_pending to send scheduled
// posts that carry persisted media, reusing the same photo/video/document
// branching logic as immediate publish instead of duplicating it.
pub(crate) async fn publish_to_channel(
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
    // Caption and keyboard only on first doc when no photo/video group was sent.
    for (i, doc) in docs.iter().enumerate() {
        let is_first_no_photos = i == 0 && photo_video.is_empty();
        let caption = if is_first_no_photos { &payload.content_html } else { "" };
        let kb_for_doc = if is_first_no_photos { kb_ref } else { None };
        let msg = methods::send_document(
            client, telegram_chat_id, doc, caption, "HTML", kb_for_doc,
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
    publish_mode: &str,
) {
    let now = Utc::now().to_rfc3339();
    let status = if success { "published" } else { "failed" };
    let _ = db.execute(
        "INSERT INTO publication_history
         (id, draft_id, channel_id, bot_id, telegram_msg_id, content_json, status, error_message, published_at, publish_mode)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
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
            publish_mode,
        ],
    );
}

/// Advances a draft's status to 'published' once at least one channel got it.
/// A no-op for kind='template' rows or missing ids — WHERE clause just matches nothing.
fn mark_draft_published(db: &rusqlite::Connection, draft_id: &str) {
    let _ = db.execute(
        "UPDATE drafts SET status = 'published' WHERE id = ?1 AND kind = 'draft'",
        rusqlite::params![draft_id],
    );
}

/// Called once a scheduled post (see scheduler::process_pending) reaches a
/// terminal state for one of a draft's channels.
/// - `success = true` → the draft counts as published (unconditional).
/// - `success = false` (cancelled or permanently failed) → falls back to
///   'draft' only if no other channel for this draft is still pending, and
///   only if it hasn't already been published via a different channel.
pub fn sync_draft_status_on_terminal(db: &rusqlite::Connection, draft_id: &str, success: bool) {
    if success {
        mark_draft_published(db, draft_id);
        return;
    }
    let remaining: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM scheduled_posts WHERE draft_id = ?1 AND status = 'pending'",
            rusqlite::params![draft_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if remaining == 0 {
        let _ = db.execute(
            "UPDATE drafts SET status = 'draft' WHERE id = ?1 AND kind = 'draft' AND status = 'scheduled'",
            rusqlite::params![draft_id],
        );
    }
}

// ─── Bot ordering helper ──────────────────────────────────────────────────────

/// Load all bots ordered: preferred bot (or settings.default_bot_id) first.
fn ordered_bots_from_db(
    db: &rusqlite::Connection,
    preferred_bot_id: Option<&str>,
) -> Result<Vec<Bot>, String> {
    let mut bots = bots_q::find_all(db).map_err(|e| e.to_string())?;
    if bots.is_empty() {
        return Err("Нет доступных ботов".to_string());
    }

    let pref_id = preferred_bot_id
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(|| {
            settings_q::load(db)
                .ok()
                .map(|s| s.default_bot_id)
                .filter(|s| !s.is_empty())
        });

    if let Some(ref pid) = pref_id {
        if let Some(pos) = bots.iter().position(|b| &b.id == pid) {
            let bot = bots.remove(pos);
            bots.insert(0, bot);
        }
    }

    Ok(bots)
}

/// Inline bot-iteration result for a channel.
struct BotTryResult {
    bot_id:       Option<String>,
    bot_username: Option<String>,
    msg_id:       Option<i64>,
    err_msg:      Option<String>,
}

fn bot_try_error(last_errs: Vec<String>) -> BotTryResult {
    let err_msg = if last_errs.len() > 1 {
        format!("Ни один из {} ботов не смог отправить в канал", last_errs.len())
    } else {
        last_errs.into_iter().next().unwrap_or_else(|| "Нет доступных ботов".to_string())
    };
    BotTryResult { bot_id: None, bot_username: None, msg_id: None, err_msg: Some(err_msg) }
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Опубликовать пост немедленно в один или несколько каналов
#[tauri::command]
pub async fn publish_post(
    payload: PublishPayload,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PublishResult>, String> {
    let (ordered_bots, channels) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let bots = ordered_bots_from_db(&db, payload.bot_id.as_deref())?;
        let mut channels = Vec::new();
        for ch_id in &payload.channel_ids {
            let ch = channels_q::find_by_id(&db, ch_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Канал {} не найден", ch_id))?;
            channels.push(ch);
        }
        (bots, channels)
    };

    let mut results = Vec::new();

    for channel in &channels {
        let mut last_errs: Vec<String> = Vec::new();
        let mut r = BotTryResult { bot_id: None, bot_username: None, msg_id: None, err_msg: None };

        'bots: for bot in &ordered_bots {
            let client = TelegramClient::new(&bot.token);
            match with_retry(|| publish_to_channel(&client, &channel.telegram_id, &payload)).await {
                Ok(msg_id) => {
                    r = BotTryResult {
                        bot_id:       Some(bot.id.clone()),
                        bot_username: Some(bot.username.clone()),
                        msg_id:       Some(msg_id),
                        err_msg:      None,
                    };
                    break 'bots;
                }
                Err(e) => {
                    let perm = is_permanent_error(&e);
                    last_errs.push(format!("@{}: {}", bot.username, e));
                    if !perm { break 'bots; }
                }
            }
        }
        if r.bot_id.is_none() { r = bot_try_error(last_errs); }

        let success = r.bot_id.is_some();
        if let Ok(db) = state.db.lock() {
            save_history(
                &db, &channel.id,
                r.bot_id.as_deref().unwrap_or(""),
                payload.draft_id.as_deref(),
                &payload.content_html,
                r.msg_id, success, r.err_msg.as_deref(),
                "normal",
            );
            if success {
                if let Some(draft_id) = &payload.draft_id { mark_draft_published(&db, draft_id); }
            }
        }
        results.push(PublishResult {
            channel_id:      channel.id.clone(),
            channel_title:   channel.title.clone(),
            success,
            telegram_msg_id: r.msg_id,
            error_message:   r.err_msg,
            bot_username:    r.bot_username,
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

    // Resolve bot_id: use provided, else default from settings, else first available
    let bot_id = match &payload.bot_id {
        Some(id) if !id.is_empty() => id.clone(),
        _ => {
            let bots = ordered_bots_from_db(&db, None)?;
            bots.into_iter().next()
                .map(|b| b.id)
                .ok_or_else(|| "Нет доступных ботов".to_string())?
        }
    };

    // Re-scheduling an already-scheduled draft (edit a scheduled post, change
    // the time/content, hit "Schedule" again) must REPLACE its existing
    // pending schedule, not add a second one next to it — otherwise both the
    // old and the new entries fire, and the calendar shows what looks like a
    // duplicate "new" post instead of the edited one.
    if let Some(draft_id) = &payload.draft_id {
        let mut stmt = db
            .prepare("SELECT id FROM scheduled_posts WHERE draft_id = ?1 AND status = 'pending'")
            .map_err(|e| e.to_string())?;
        let superseded_ids: Vec<String> = stmt
            .query_map(rusqlite::params![draft_id], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        for old_id in &superseded_ids {
            cleanup_scheduled_media(&db, &state.app_dir, old_id);
        }

        db.execute(
            "UPDATE scheduled_posts SET status='cancelled', updated_at=?1 WHERE draft_id=?2 AND status='pending'",
            rusqlite::params![now, draft_id],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut infos = Vec::new();

    for ch_id in &payload.channel_ids {
        let channel = channels_q::find_by_id(&db, ch_id)
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
                bot_id,
                payload.content_html,
                schedule_at,
                now,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        // Persist media to disk so it survives until the scheduler sends it —
        // each channel gets its own copy (simpler and safer than sharing a
        // ref-counted file across multiple scheduled_posts rows).
        if !payload.media.is_empty() {
            use base64::Engine;
            let media_dir = state.app_dir.join("scheduled_media").join(&id);
            std::fs::create_dir_all(&media_dir)
                .map_err(|e| format!("Не удалось создать директорию: {}", e))?;

            for (i, item) in payload.media.iter().enumerate() {
                let raw = base64::engine::general_purpose::STANDARD
                    .decode(&item.data_base64)
                    .map_err(|_| format!("Ошибка декодирования файла «{}»", item.file_name))?;
                if raw.is_empty() { continue; }

                let ext = item.file_name
                    .rsplit('.')
                    .next()
                    .unwrap_or("bin")
                    .chars()
                    .filter(|c| c.is_alphanumeric())
                    .take(10)
                    .collect::<String>();
                let ext = if ext.is_empty() { "bin".to_string() } else { ext };

                let file_path = media_dir.join(format!("{}.{}", i, ext));
                std::fs::write(&file_path, &raw)
                    .map_err(|e| format!("Ошибка сохранения файла: {}", e))?;

                let media_id = Uuid::new_v4().to_string();
                let path_str = file_path.to_string_lossy().into_owned();
                db.execute(
                    "INSERT INTO scheduled_media
                     (id, scheduled_post_id, file_path, file_name, mime_type, media_type, file_size, sort_order, created_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                    rusqlite::params![
                        media_id, id, path_str, item.file_name, item.mime_type,
                        item.media_type, raw.len() as i64, i as i64, now,
                    ],
                ).map_err(|e| e.to_string())?;
            }
        }

        infos.push(ScheduledPostInfo {
            id,
            draft_id: payload.draft_id.clone(),
            channel_id: ch_id.clone(),
            channel_title: channel.title.clone(),
            bot_id: bot_id.clone(),
            scheduled_at: schedule_at.clone(),
            status: "pending".to_string(),
            content_preview: crate::commands::history::strip_html_preview(&payload.content_html, 60),
        });
    }

    if let Some(draft_id) = &payload.draft_id {
        let _ = db.execute(
            "UPDATE drafts SET status = 'scheduled' WHERE id = ?1 AND kind = 'draft'",
            rusqlite::params![draft_id],
        );
    }

    Ok(infos)
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
    pub bot_id: Option<String>,
    pub channel_ids: Vec<String>,
    pub rich_html: String,
    pub photos: Vec<RichPhotoPayload>,
    pub draft_id: Option<String>,
}

/// Опубликовать богатое сообщение (Bot API 10.1 sendRichMessage)
#[tauri::command]
pub async fn publish_rich_post(
    payload: PublishRichPayload,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PublishResult>, String> {
    let (ordered_bots, channels) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let bots = ordered_bots_from_db(&db, payload.bot_id.as_deref())?;
        let mut channels = Vec::new();
        for ch_id in &payload.channel_ids {
            let ch = channels_q::find_by_id(&db, ch_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Канал {} не найден", ch_id))?;
            channels.push(ch);
        }
        (bots, channels)
    };

    // Photos are uploaded to an external host (catbox.moe) — no Telegram token needed.
    use base64::Engine;
    let mut html = payload.rich_html.clone();
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
        let is_audio = p.mime_type.starts_with("audio/");
        let (upload_bytes, upload_mime, upload_name) = if is_video || is_audio {
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
                log::debug!("[rich] {} → {}", p.attach_name, &url[..url.len().min(60)]);
                html = html.replace(&placeholder, &url);
            }
            Err(e) => {
                log::warn!("[rich] photo host failed for {}: {}", p.attach_name, e);
                html = methods::remove_img_placeholder(&html, &placeholder);
            }
        }
    }

    // A group can lose every photo in it (host down for the whole batch)
    // while other groups/text uploaded fine — an empty <tg-collage>/
    // <tg-slideshow> makes Telegram reject the whole message, so drop it.
    let html = methods::strip_empty_media_groups(html.trim());
    let mut results = Vec::new();

    for channel in &channels {
        let mut last_errs: Vec<String> = Vec::new();
        let mut r = BotTryResult { bot_id: None, bot_username: None, msg_id: None, err_msg: None };

        'bots: for bot in &ordered_bots {
            let client = TelegramClient::new(&bot.token);
            let cid   = channel.telegram_id.clone();
            let h     = html.clone();
            let result = with_retry(|| {
                let c  = &client;
                let id = cid.clone();
                let h2 = h.clone();
                async move {
                    methods::send_rich_message(c, &id, &h2)
                        .await
                        .map(|m| m.message_id)
                        .map_err(|e| e.to_string())
                }
            }).await;
            match result {
                Ok(msg_id) => {
                    r = BotTryResult {
                        bot_id:       Some(bot.id.clone()),
                        bot_username: Some(bot.username.clone()),
                        msg_id:       Some(msg_id),
                        err_msg:      None,
                    };
                    break 'bots;
                }
                Err(e) => {
                    let perm = is_permanent_error(&e);
                    last_errs.push(format!("@{}: {}", bot.username, e));
                    if !perm { break 'bots; }
                }
            }
        }
        if r.bot_id.is_none() { r = bot_try_error(last_errs); }

        let success = r.bot_id.is_some();
        if let Ok(db) = state.db.lock() {
            save_history(
                &db, &channel.id,
                r.bot_id.as_deref().unwrap_or(""),
                payload.draft_id.as_deref(),
                &payload.rich_html,
                r.msg_id, success, r.err_msg.as_deref(),
                "rich",
            );
            if success {
                if let Some(draft_id) = &payload.draft_id { mark_draft_published(&db, draft_id); }
            }
        }
        results.push(PublishResult {
            channel_id:      channel.id.clone(),
            channel_title:   channel.title.clone(),
            success,
            telegram_msg_id: r.msg_id,
            error_message:   r.err_msg,
            bot_username:    r.bot_username,
        });
    }

    Ok(results)
}

// ─── Poll publish ─────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PollPayload {
    pub bot_id: Option<String>,
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
    let (ordered_bots, channels) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let bots = ordered_bots_from_db(&db, payload.bot_id.as_deref())?;
        let mut channels = Vec::new();
        for ch_id in &payload.channel_ids {
            let ch = channels_q::find_by_id(&db, ch_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("Канал {} не найден", ch_id))?;
            channels.push(ch);
        }
        (bots, channels)
    };

    let is_anon = payload.is_anonymous;
    let multi   = payload.allows_multiple_answers;
    let poll_label = format!("[POLL] {}", payload.question);
    let mut results = Vec::new();

    for channel in &channels {
        let mut last_errs: Vec<String> = Vec::new();
        let mut r = BotTryResult { bot_id: None, bot_username: None, msg_id: None, err_msg: None };

        'bots: for bot in &ordered_bots {
            let client = TelegramClient::new(&bot.token);
            let cid   = channel.telegram_id.clone();
            let q     = payload.question.clone();
            let opts  = payload.options.clone();
            let result = with_retry(|| {
                let c    = &client;
                let id   = cid.clone();
                let q2   = q.clone();
                let opts2 = opts.clone();
                async move {
                    methods::send_poll(c, &id, &q2, &opts2, is_anon, multi)
                        .await
                        .map(|m| m.message_id)
                        .map_err(|e| e.to_string())
                }
            }).await;
            match result {
                Ok(msg_id) => {
                    r = BotTryResult {
                        bot_id:       Some(bot.id.clone()),
                        bot_username: Some(bot.username.clone()),
                        msg_id:       Some(msg_id),
                        err_msg:      None,
                    };
                    break 'bots;
                }
                Err(e) => {
                    let perm = is_permanent_error(&e);
                    last_errs.push(format!("@{}: {}", bot.username, e));
                    if !perm { break 'bots; }
                }
            }
        }
        if r.bot_id.is_none() { r = bot_try_error(last_errs); }

        let success = r.bot_id.is_some();
        if let Ok(db) = state.db.lock() {
            save_history(
                &db, &channel.id,
                r.bot_id.as_deref().unwrap_or(""),
                None,
                &poll_label,
                r.msg_id, success, r.err_msg.as_deref(),
                "normal",
            );
        }
        results.push(PublishResult {
            channel_id:      channel.id.clone(),
            channel_title:   channel.title.clone(),
            success,
            telegram_msg_id: r.msg_id,
            error_message:   r.err_msg,
            bot_username:    r.bot_username,
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
            "SELECT sp.id, sp.draft_id, sp.channel_id, COALESCE(c.title, ''), sp.bot_id,
                    sp.scheduled_at, sp.status, COALESCE(sp.content_html, '')
             FROM scheduled_posts sp
             LEFT JOIN channels c ON c.id = sp.channel_id
             WHERE sp.status = 'pending'
             ORDER BY sp.scheduled_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let html: String = row.get(7)?;
            Ok(ScheduledPostInfo {
                id: row.get(0)?,
                draft_id: row.get(1)?,
                channel_id: row.get(2)?,
                channel_title: row.get(3)?,
                bot_id: row.get(4)?,
                scheduled_at: row.get(5)?,
                status: row.get(6)?,
                content_preview: crate::commands::history::strip_html_preview(&html, 60),
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Removes a scheduled post's persisted media (disk files + DB rows).
/// Safe to call for posts with no media (no-op). Used when a scheduled post
/// reaches a terminal state (cancelled, published, or permanently failed) —
/// the files are no longer needed after that point.
pub fn cleanup_scheduled_media(db: &rusqlite::Connection, app_dir: &std::path::Path, post_id: &str) {
    let _ = std::fs::remove_dir_all(app_dir.join("scheduled_media").join(post_id));
    let _ = db.execute("DELETE FROM scheduled_media WHERE scheduled_post_id = ?1", [post_id]);
}

/// Отменить запланированный пост
#[tauri::command]
pub async fn cancel_scheduled_post(
    post_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    let draft_id: Option<String> = db
        .query_row(
            "SELECT draft_id FROM scheduled_posts WHERE id = ?1",
            rusqlite::params![post_id],
            |r| r.get(0),
        )
        .ok()
        .flatten();

    db.execute(
        "UPDATE scheduled_posts SET status='cancelled', updated_at=?1 WHERE id=?2",
        rusqlite::params![now, post_id],
    )
    .map_err(|e| e.to_string())?;
    cleanup_scheduled_media(&db, &state.app_dir, &post_id);

    if let Some(draft_id) = draft_id {
        sync_draft_status_on_terminal(&db, &draft_id, false);
    }

    Ok(())
}

/// Republish a rich post: upload new photos, send a new sendRichMessage, delete old one.
/// Used when editing a published rich post (Telegram doesn't support editRichMessage).
#[tauri::command]
pub async fn republish_rich_post(
    history_id: String,
    rich_html: String,
    photos: Vec<RichPhotoPayload>,
    content_json: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    use base64::Engine;

    // Look up bot, channel, and old message id from history
    let (bot_id, channel_telegram_id, old_msg_id) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT h.bot_id, c.telegram_id, h.telegram_msg_id
             FROM publication_history h
             LEFT JOIN channels c ON c.id = h.channel_id
             WHERE h.id = ?1",
            [&history_id],
            |r| Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<i64>>(2)?,
            )),
        ).map_err(|_| "Запись истории не найдена".to_string())?
    };

    let chat_id = channel_telegram_id
        .ok_or_else(|| "Канал не найден в истории".to_string())?;

    let token = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        bots_q::get_token(&db, &bot_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Бот не найден".to_string())?
    };

    // Upload photos and replace placeholders
    let mut html = rich_html.clone();
    for p in &photos {
        let placeholder = format!("attach://{}", p.attach_name);

        if p.data_base64.len() > 67_000_000 {
            return Err(format!("Файл {} слишком большой (лимит 50 МБ)", p.file_name));
        }
        let raw = base64::engine::general_purpose::STANDARD
            .decode(&p.data_base64)
            .map_err(|e| format!("base64 decode: {}", e))?;

        let is_video = p.mime_type.starts_with("video/");
        let is_audio = p.mime_type.starts_with("audio/");
        let (upload_bytes, upload_mime, upload_name) = if is_video || is_audio {
            (raw, p.mime_type.clone(), p.file_name.clone())
        } else {
            let (jpeg, _, _) = crate::image_utils::normalize_to_jpeg(raw, &p.file_name)
                .map_err(|e| format!("normalize: {}", e))?;
            let jpeg = crate::image_utils::compress_to_limit(jpeg, 5 * 1024 * 1024);
            (jpeg, "image/jpeg".to_string(),
             p.file_name.replace(|c: char| !c.is_ascii_alphanumeric() && c != '.', "_") + ".jpg")
        };

        match with_retry(|| {
            let bytes = upload_bytes.clone();
            let mime  = upload_mime.clone();
            let name  = upload_name.clone();
            async move { crate::hosting::upload_file(bytes, &mime, &name).await }
        }).await {
            Ok(url) => {
                log::debug!("[republish_rich] {} → {}", p.attach_name, &url[..url.len().min(60)]);
                html = html.replace(&placeholder, &url);
            }
            Err(e) => {
                log::warn!("[republish_rich] photo host failed for {}: {}", p.attach_name, e);
                html = methods::remove_img_placeholder(&html, &placeholder);
            }
        }
    }

    let html = methods::strip_empty_media_groups(html.trim());
    let client = TelegramClient::new(&token);

    // Send new rich message
    let new_msg = methods::send_rich_message(&client, &chat_id, &html)
        .await
        .map_err(|e| e.to_string())?;
    let new_msg_id = new_msg.message_id;

    // Try to delete old message — ignore error (bot may not have delete permission)
    if let Some(old_id) = old_msg_id {
        let _ = methods::delete_message(&client, &chat_id, old_id).await;
    }

    // Update history record with new msg_id and content
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let _ = db.execute(
            "UPDATE publication_history SET telegram_msg_id = ?1, content_json = ?2 WHERE id = ?3",
            rusqlite::params![new_msg_id, html, history_id],
        );
        // Also update the linked draft TipTap JSON
        if let Some(ref json) = content_json {
            if !json.is_empty() {
                let _ = db.execute(
                    "UPDATE drafts SET content_json = ?1 \
                     WHERE id = (SELECT draft_id FROM publication_history WHERE id = ?2)",
                    rusqlite::params![json, history_id],
                );
            }
        }
    }

    Ok(())
}
