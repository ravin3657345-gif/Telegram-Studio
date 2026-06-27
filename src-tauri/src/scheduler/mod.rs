use chrono::Utc;
use tauri::{AppHandle, Manager};
use tokio::time::{interval, Duration};

use crate::{
    db::{queries::bots as bots_q, AppState},
    telegram::{client::TelegramClient, methods},
};

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
                "SELECT id, draft_id, channel_id, bot_id, content_html
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
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    for row in pending {
        let (opt_token, opt_chat_id, content) = {
            let db = state.db.lock().map_err(|e| e.to_string())?;

            let opt_token = bots_q::get_token(&db, row.bot_id.as_str())
                .map_err(|e| e.to_string())?;

            let opt_chat_id: Option<String> = db
                .query_row(
                    "SELECT telegram_id FROM channels WHERE id = ?1",
                    [row.channel_id.as_str()],
                    |r| r.get::<_, String>(0),
                )
                .ok();

            // Use content_html stored at scheduling time; fall back to draft's content_text
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

            (opt_token, opt_chat_id, content)
        };

        let token = match opt_token {
            Some(t) => t,
            None => {
                update_status(&state, &row.id, "failed", Some("Бот не найден"))?;
                continue;
            }
        };

        let chat_id = match opt_chat_id {
            Some(id) => id,
            None => {
                update_status(&state, &row.id, "failed", Some("Канал не найден"))?;
                continue;
            }
        };

        let client = TelegramClient::new(&token);

        match methods::send_message(&client, &chat_id, &content, "HTML", None).await {
            Ok(_) => {
                update_status(&state, &row.id, "published", None)?;
            }
            Err(e) => {
                let err_str = e.to_string();
                update_status(&state, &row.id, "failed", Some(err_str.as_str()))?;
            }
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
