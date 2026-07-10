use chrono::Utc;
use tauri::{AppHandle, Manager};
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
                "SELECT id, draft_id, channel_id, bot_id, content_html, retry_count
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
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    for row in pending {
        let (ordered_bots, opt_chat_id, content, media) = {
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

            let opt_chat_id: Option<String> = db
                .query_row(
                    "SELECT telegram_id FROM channels WHERE id = ?1",
                    [row.channel_id.as_str()],
                    |r| r.get::<_, String>(0),
                )
                .ok();

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

            (all_bots, opt_chat_id, content, media)
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

            let send_result = if media.is_empty() {
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
        } else if last_was_transient {
            // Don't permafail on a network blip — leave 'pending' so the next
            // tick retries, up to MAX_TRANSIENT_RETRIES.
            record_transient_failure(&state, &row.id, row.retry_count, &last_err)?;
        } else {
            update_status(&state, &row.id, "failed", Some(last_err.as_str()))?;
            cleanup_media_for(&state, &row.id);
            sync_draft_status(&state, row.draft_id.as_deref(), false);
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
/// which point it's given up on and marked 'failed'.
fn record_transient_failure(
    state: &AppState,
    id: &str,
    prev_retry_count: i64,
    error: &str,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    match next_retry_decision(prev_retry_count, MAX_TRANSIENT_RETRIES) {
        RetryDecision::GiveUp { attempts } => {
            let msg = format!("{error} (не удалось после {attempts} попыток)");
            db.execute(
                "UPDATE scheduled_posts \
                 SET status='failed', error_message=?1, retry_count=?2, updated_at=?3 WHERE id=?4",
                rusqlite::params![msg, attempts, now.as_str(), id],
            )
            .map_err(|e| e.to_string())?;
        }
        RetryDecision::RetryLater { retry_count } => {
            // status stays 'pending' — picked up again on the next tick
            db.execute(
                "UPDATE scheduled_posts \
                 SET error_message=?1, retry_count=?2, updated_at=?3 WHERE id=?4",
                rusqlite::params![error, retry_count, now.as_str(), id],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
