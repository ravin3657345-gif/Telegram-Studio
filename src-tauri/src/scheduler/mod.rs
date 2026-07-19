use chrono::Utc;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tokio::time::{interval, Duration};

use crate::{
    commands::publish::{cleanup_scheduled_media, publish_to_channel, sync_draft_status_on_terminal, PublishPayload},
    db::{queries::{bots as bots_q, settings as settings_q}, AppState},
    telegram::{client::TelegramClient, methods, methods::MediaItem},
};
use tstudio_core::retry::{is_permanent_telegram_error, next_retry_decision, RetryDecision};

// A transient failure (network blip, Telegram 5xx, timeout) leaves the post
// 'pending' so the next tick retries it, instead of failing it permanently.
// After this many transient attempts it's given up on and marked 'failed'.
const MAX_TRANSIENT_RETRIES: i64 = 5;

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(Duration::from_secs(60));
        ticker.tick().await; // пропускаем первый немедленный тик

        loop {
            ticker.tick().await;
            if let Err(e) = process_pending(&app).await {
                log::error!("[scheduler] ошибка: {}", e);
            }
            // Выполняем отложенные удаления опубликованных постов
            let state = app.state::<AppState>();
            crate::commands::history::execute_pending_deletes(&state).await;
        }
    });
}

async fn process_pending(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let now_str = Utc::now().to_rfc3339();

    // Читаем посты к публикации
    let pending = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = db
            .prepare(
                "SELECT id, draft_id, channel_id, bot_id, content_html, retry_count, publish_mode
                 FROM scheduled_posts
                 WHERE status = 'pending' AND scheduled_at <= ?1",
            )
            .map_err(|e| e.to_string())?;

        struct Row {
            id: String,
            draft_id: Option<String>,
            channel_id: String,
            bot_id: String,
            content_html: Option<String>,
            retry_count: i64,
            publish_mode: String,
        }

        let now_ref: &str = &now_str;
        let rows: Vec<Row> = stmt
            .query_map([now_ref], |row| {
                Ok(Row {
                    id: row.get(0)?,
                    draft_id: row.get(1)?,
                    channel_id: row.get(2)?,
                    bot_id: row.get(3)?,
                    content_html: row.get(4)?,
                    retry_count: row.get(5)?,
                    publish_mode: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    for row in pending {
        let is_rich = row.publish_mode == "rich";

        let (ordered_bots, opt_chat_id, channel_title, content, media, rich_parts) = {
            let db = state.db.lock().map_err(|e| e.to_string())?;

            // Load all bots; put the scheduled bot first, then fallback to others
            let default_pref = {
                let pref_from_settings = settings_q::load(&db)
                    .ok()
                    .map(|s| s.default_bot_id)
                    .filter(|s| !s.is_empty());
                // The scheduled bot takes priority over settings default
                Some(row.bot_id.clone())
                    .filter(|s| !s.is_empty())
                    .or(pref_from_settings)
            };

            let mut all_bots = bots_q::find_all(&db).unwrap_or_default();
            if let Some(ref pref_id) = default_pref {
                if let Some(pos) = all_bots.iter().position(|b| &b.id == pref_id) {
                    let bot = all_bots.remove(pos);
                    all_bots.insert(0, bot);
                }
            }

            // Also fetches the channel's display title — not needed for
            // sending, only so the notification below (see `notify` and its
            // call sites) can say *which* channel a post succeeded/failed
            // for instead of a bare "a post" that's meaningless once more
            // than one post is scheduled around the same time.
            let channel_row: Option<(String, String)> = db
                .query_row(
                    "SELECT telegram_id, title FROM channels WHERE id = ?1",
                    [row.channel_id.as_str()],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                )
                .ok();
            let opt_chat_id = channel_row.as_ref().map(|(id, _)| id.clone());
            let channel_title = channel_row.map(|(_, title)| title).unwrap_or_default();

            if is_rich {
                // Rich HTML still has its tg://photo|video|audio?id=… references
                // as stored — load_scheduled_rich_media does the deferred
                // normalize/compress step (same as publish_rich_post) and
                // reports which attach_names failed so their placeholders can
                // be stripped, same graceful single-photo degradation the
                // immediate-publish path already has.
                let raw_html = row.content_html.clone().unwrap_or_default();
                let (parts, failed) = load_scheduled_rich_media(&db, &row.id);
                let mut html = raw_html;
                for attach_name in &failed {
                    html = methods::remove_img_placeholder(&html, attach_name);
                }
                let html = methods::strip_empty_media_groups(html.trim());
                (all_bots, opt_chat_id, channel_title, html, Vec::new(), parts)
            } else {
                let content: String = row.content_html
                    .filter(|s| !s.is_empty())
                    .or_else(|| {
                        row.draft_id.as_deref().and_then(|did| {
                            db.query_row(
                                "SELECT content_text FROM drafts WHERE id = ?1",
                                [did],
                                |r| r.get::<_, Option<String>>(0),
                            )
                            .ok()
                            .flatten()
                        })
                    })
                    .unwrap_or_default();

                // Load persisted media (if any) and re-encode fresh from disk —
                // never held in memory between schedule time and send time.
                let media = load_scheduled_media(&db, &row.id);

                (all_bots, opt_chat_id, channel_title, content, media, Vec::new())
            }
        };

        if ordered_bots.is_empty() {
            update_status(&state, &row.id, "failed", Some("Нет доступных ботов"))?;
            cleanup_media_for(&state, &row.id);
            continue;
        }

        let chat_id = match opt_chat_id {
            Some(id) => id,
            None => {
                update_status(&state, &row.id, "failed", Some("Канал не найден"))?;
                cleanup_media_for(&state, &row.id);
                continue;
            }
        };

        let mut published = false;
        let mut last_err = String::new();
        let mut last_was_transient = false;

        for bot in &ordered_bots {
            let client = TelegramClient::new(&bot.token);

            let send_result = if is_rich {
                methods::send_rich_message(&client, &chat_id, &content, &rich_parts)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            } else if media.is_empty() {
                methods::send_message(&client, &chat_id, &content, "HTML", None)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            } else {
                let payload = PublishPayload {
                    bot_id: None,
                    channel_ids: vec![],
                    content_html: content.clone(),
                    media: media.clone(),
                    buttons: vec![],
                    draft_id: None,
                    schedule_at: None,
                };
                publish_to_channel(&client, &chat_id, &payload).await.map(|_| ())
            };

            match send_result {
                Ok(()) => {
                    published = true;
                    break;
                }
                Err(err_str) => {
                    let is_perm = is_permanent_telegram_error(&err_str);
                    last_err = err_str;
                    last_was_transient = !is_perm;
                    if !is_perm {
                        break; // transient (network/API) — other bots would hit the same issue
                    }
                }
            }
        }

        if published {
            update_status(&state, &row.id, "published", None)?;
            cleanup_media_for(&state, &row.id);
            sync_draft_status(&state, row.draft_id.as_deref(), true);
            notify(app, "Пост опубликован", &channel_title);
        } else if last_was_transient {
            // Don't permafail on a network blip — leave 'pending' so the next
            // tick retries, up to MAX_TRANSIENT_RETRIES. Only notifies once
            // retries are actually exhausted (`gave_up`) — a single transient
            // blip that the next tick recovers from on its own isn't worth
            // surfacing, only the eventual permanent outcome is.
            let gave_up = record_transient_failure(&state, &row.id, row.retry_count, &last_err)?;
            if gave_up {
                notify(app, "Не удалось опубликовать пост", &format!("{channel_title}: {last_err}"));
            }
        } else {
            update_status(&state, &row.id, "failed", Some(last_err.as_str()))?;
            cleanup_media_for(&state, &row.id);
            sync_draft_status(&state, row.draft_id.as_deref(), false);
            notify(app, "Не удалось опубликовать пост", &format!("{channel_title}: {last_err}"));
        }
    }

    Ok(())
}

/// Loads a scheduled post's persisted media, re-encoding each file's bytes
/// fresh from disk as base64. Missing/unreadable files are skipped (logged),
/// not fatal — a post shouldn't fail entirely because one attachment vanished.
fn load_scheduled_media(db: &rusqlite::Connection, post_id: &str) -> Vec<MediaItem> {
    use base64::Engine;

    let mut stmt = match db.prepare(
        "SELECT file_path, file_name, mime_type, media_type
         FROM scheduled_media WHERE scheduled_post_id = ?1 ORDER BY sort_order",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };

    let rows: Vec<(String, String, String, String)> = stmt
        .query_map([post_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .map(|it| it.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    rows.into_iter()
        .filter_map(|(file_path, file_name, mime_type, media_type)| {
            match std::fs::read(&file_path) {
                Ok(bytes) => Some(MediaItem {
                    file_name,
                    mime_type,
                    media_type,
                    data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                }),
                Err(e) => {
                    log::warn!("[scheduler] missing media file {file_path}: {e}");
                    None
                }
            }
        })
        .collect()
}

/// Rich-mode counterpart to `load_scheduled_media` — reads each attachment's
/// bytes fresh from disk (same "never held in memory between schedule time
/// and send time" reasoning), then applies the same deferred normalize/
/// compress step `publish_rich_post` does at actual send time (real
/// processing was skipped at persist time, see `persist_scheduled_rich_media`).
/// Returns the successfully-built parts plus the `attach_name`s that failed
/// (missing file or a decode/normalize error) so the caller can strip those
/// specific `tg://…?id=` references from the HTML instead of failing the
/// whole post over one bad photo.
fn load_scheduled_rich_media(db: &rusqlite::Connection, post_id: &str) -> (Vec<methods::RichMediaPart>, Vec<String>) {
    let mut stmt = match db.prepare(
        "SELECT file_path, file_name, mime_type, attach_name
         FROM scheduled_media WHERE scheduled_post_id = ?1 ORDER BY sort_order",
    ) {
        Ok(s) => s,
        Err(_) => return (vec![], vec![]),
    };

    let rows: Vec<(String, String, String, Option<String>)> = stmt
        .query_map([post_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .map(|it| it.filter_map(|r| r.ok()).collect())
        .unwrap_or_default();

    let mut parts = Vec::new();
    let mut failed = Vec::new();

    for (file_path, file_name, mime_type, attach_name) in rows {
        let Some(attach_name) = attach_name else { continue }; // not a rich row — shouldn't happen

        let bytes = match std::fs::read(&file_path) {
            Ok(b) => b,
            Err(e) => {
                log::warn!("[scheduler] missing rich media file {file_path}: {e}");
                failed.push(attach_name);
                continue;
            }
        };

        let is_video = mime_type.starts_with("video/");
        let is_audio = mime_type.starts_with("audio/");
        let kind = if is_video { methods::RichMediaKind::Video }
            else if is_audio { methods::RichMediaKind::Audio }
            else { methods::RichMediaKind::Photo };

        let processed = if is_video || is_audio {
            Ok((bytes, mime_type.clone(), file_name.clone()))
        } else {
            crate::image_utils::normalize_to_jpeg(bytes, &file_name).map(|(jpeg, _, name)| {
                let jpeg = crate::image_utils::compress_to_limit(jpeg, 5 * 1024 * 1024);
                (jpeg, "image/jpeg".to_string(), name)
            })
        };

        match processed {
            Ok((data, mime, name)) => parts.push(methods::RichMediaPart {
                id: attach_name,
                kind,
                bytes: data,
                mime_type: mime,
                file_name: name,
            }),
            Err(e) => {
                log::warn!("[scheduler] rich media processing failed for {attach_name}: {e}");
                failed.push(attach_name);
            }
        }
    }

    (parts, failed)
}

/// Best-effort: lock failures here are logged, not propagated — this is a
/// side-effect sync, must never block the scheduler's own status update.
fn sync_draft_status(state: &AppState, draft_id: Option<&str>, success: bool) {
    let Some(draft_id) = draft_id else { return };
    match state.db.lock() {
        Ok(db) => sync_draft_status_on_terminal(&db, draft_id, success),
        Err(e) => log::warn!("[scheduler] could not lock db to sync draft status: {e}"),
    }
}

/// Best-effort media cleanup after a scheduled post reaches a terminal state.
/// A lock-acquisition failure here is logged, not propagated — cleanup is
/// housekeeping and must never block the scheduler's own status update.
fn cleanup_media_for(state: &AppState, post_id: &str) {
    match state.db.lock() {
        Ok(db) => cleanup_scheduled_media(&db, &state.app_dir, post_id),
        Err(e) => log::warn!("[scheduler] could not lock db for media cleanup: {e}"),
    }
}

fn update_status(
    state: &AppState,
    id: &str,
    status: &str,
    error: Option<&str>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    db.execute(
        "UPDATE scheduled_posts \
         SET status=?1, error_message=?2, updated_at=?3 WHERE id=?4",
        rusqlite::params![status, error, now.as_str(), id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Records a transient (network/API) failure. Keeps the post 'pending' so the
/// next tick retries it, unless MAX_TRANSIENT_RETRIES has been reached — at
/// which point it's given up on and marked 'failed'. Returns whether this
/// call was the one that gave up (`true`) — the caller uses that to decide
/// whether to notify: a single blip the next tick will retry on its own
/// isn't worth surfacing, only the eventual permanent outcome is.
fn record_transient_failure(
    state: &AppState,
    id: &str,
    prev_retry_count: i64,
    error: &str,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    let gave_up = match next_retry_decision(prev_retry_count, MAX_TRANSIENT_RETRIES) {
        RetryDecision::GiveUp { attempts } => {
            let msg = format!("{error} (не удалось после {attempts} попыток)");
            db.execute(
                "UPDATE scheduled_posts \
                 SET status='failed', error_message=?1, retry_count=?2, updated_at=?3 WHERE id=?4",
                rusqlite::params![msg, attempts, now.as_str(), id],
            )
            .map_err(|e| e.to_string())?;
            true
        }
        RetryDecision::RetryLater { retry_count } => {
            // status stays 'pending' — picked up again on the next tick
            db.execute(
                "UPDATE scheduled_posts \
                 SET error_message=?1, retry_count=?2, updated_at=?3 WHERE id=?4",
                rusqlite::params![error, retry_count, now.as_str(), id],
            )
            .map_err(|e| e.to_string())?;
            false
        }
    };
    Ok(gave_up)
}

/// Best-effort — a failed/unpermitted notification is logged, never
/// propagated. This is a nice-to-have surfaced from a background tick with
/// nothing else watching it; it must never be the reason a scheduler run
/// fails or a status update gets skipped.
fn notify(app: &AppHandle, title: &str, body: &str) {
    if let Err(e) = app.notification().builder().title(title).body(body).show() {
        log::warn!("[scheduler] failed to show notification: {e}");
    }
}
