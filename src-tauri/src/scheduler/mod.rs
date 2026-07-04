use chrono::Utc;
use tauri::{AppHandle, Manager};
use tokio::time::{interval, Duration};

use crate::{
    db::{queries::{bots as bots_q, settings as settings_q}, AppState},
    telegram::{client::TelegramClient, methods},
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
                eprintln!("[scheduler] ошибка: {}", e);
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
        let (ordered_bots, opt_chat_id, content) = {
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

            (all_bots, opt_chat_id, content)
        };

        if ordered_bots.is_empty() {
            update_status(&state, &row.id, "failed", Some("Нет доступных ботов"))?;
            continue;
        }

        let chat_id = match opt_chat_id {
            Some(id) => id,
            None => {
                update_status(&state, &row.id, "failed", Some("Канал не найден"))?;
                continue;
            }
        };

        let mut published = false;
        let mut last_err = String::new();
        let mut last_was_transient = false;

        for bot in &ordered_bots {
            let client = TelegramClient::new(&bot.token);
            match methods::send_message(&client, &chat_id, &content, "HTML", None).await {
                Ok(_) => {
                    published = true;
                    break;
                }
                Err(e) => {
                    let err_str = e.to_string();
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
        } else if last_was_transient {
            // Don't permafail on a network blip — leave 'pending' so the next
            // tick retries, up to MAX_TRANSIENT_RETRIES.
            record_transient_failure(&state, &row.id, row.retry_count, &last_err)?;
        } else {
            update_status(&state, &row.id, "failed", Some(last_err.as_str()))?;
        }
    }

    Ok(())
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
