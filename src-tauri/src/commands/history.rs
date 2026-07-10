use base64::Engine;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use crate::{
    db::{models::DraftAttachment, queries::bots as bots_q, queries::channels as channels_q, AppState},
    telegram::{client::TelegramClient, methods},
};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub channel_id: String,
    pub channel_title: String,
    /// The post's own title (drafts.post_title), not the channel name — this
    /// is what should be shown as the item's primary label.
    pub post_title: String,
    pub bot_id: String,
    pub telegram_msg_id: Option<i64>,
    pub telegram_chat_id: Option<String>,
    pub status: String,
    pub error_message: Option<String>,
    pub published_at: String,
    pub delete_at: Option<String>,
    pub content_preview: Option<String>,
}

pub(crate) fn strip_html_preview(html: &str, max_len: usize) -> Option<String> {
    let mut result = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => {
                if c != '\n' && c != '\r' { result.push(c); }
                if result.len() >= max_len { break; }
            }
            _ => {}
        }
    }
    let text = result.trim().to_string();
    if text.is_empty() { None } else { Some(text) }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleDeletePayload {
    pub history_id: String,
    /// ISO 8601 datetime when to delete; null = cancel
    pub delete_at: Option<String>,
}

#[tauri::command]
pub async fn get_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<HistoryItem>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let mut stmt = db
        .prepare(
            "SELECT h.id, h.channel_id, c.title, h.bot_id,
                    h.telegram_msg_id, c.telegram_id,
                    h.status, h.error_message, h.published_at, h.delete_at,
                    COALESCE(h.content_json, '') as raw_html,
                    COALESCE(d.post_title, '') as post_title
             FROM publication_history h
             LEFT JOIN channels c ON c.id = h.channel_id
             LEFT JOIN drafts d ON d.id = h.draft_id
             ORDER BY h.published_at DESC
             LIMIT 100",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let raw_html: String = row.get(10)?;
            let preview = strip_html_preview(&raw_html, 120);
            Ok(HistoryItem {
                id:               row.get(0)?,
                channel_id:       row.get(1)?,
                channel_title:    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                post_title:       row.get(11)?,
                bot_id:           row.get(3)?,
                telegram_msg_id:  row.get(4)?,
                telegram_chat_id: row.get(5)?,
                status:           row.get(6)?,
                error_message:    row.get(7)?,
                published_at:     row.get(8)?,
                delete_at:        row.get(9)?,
                content_preview:  preview,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Set (or clear) the scheduled deletion time for a published post.
#[tauri::command]
pub async fn schedule_post_delete(
    payload: ScheduleDeletePayload,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "UPDATE publication_history SET delete_at = ?1 WHERE id = ?2",
        rusqlite::params![payload.delete_at, payload.history_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Edit the text of a published post directly via Bot API.
#[tauri::command]
pub async fn edit_published_post(
    history_id: String,
    new_text: String,
    content_json: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let (token, chat_id, msg_id) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;

        let (channel_id, bot_id, telegram_msg_id): (String, String, i64) = db
            .query_row(
                "SELECT channel_id, bot_id, telegram_msg_id
                 FROM publication_history WHERE id = ?1",
                [&history_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|_| "Запись истории не найдена".to_string())?;

        let tok = bots_q::get_token(&db, &bot_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Бот не найден".to_string())?;

        let ch = channels_q::find_by_id(&db, &channel_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Канал не найден".to_string())?;

        (tok, ch.telegram_id, telegram_msg_id)
    };

    let client = TelegramClient::new(&token);
    let edit_result = methods::edit_message_text(&client, &chat_id, msg_id, &new_text, "HTML").await;
    match edit_result {
        Ok(_) => {}
        Err(e) => {
            let msg = e.to_string().to_lowercase();
            if msg.contains("message is not modified") {
                // Content unchanged — treat as success
            } else if msg.contains("there is no text in the message to edit") {
                // Media message — update caption instead
                let cap_result = methods::edit_message_caption(&client, &chat_id, msg_id, &new_text, "HTML").await;
                match cap_result {
                    Ok(_) => {}
                    Err(e2) => {
                        let msg2 = e2.to_string().to_lowercase();
                        if msg2.contains("message is not modified") {
                            // Caption unchanged — treat as success
                        } else {
                            return Err(e2.to_string());
                        }
                    }
                }
            } else {
                return Err(e.to_string());
            }
        }
    }

    // Update stored content
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let _ = db.execute(
            "UPDATE publication_history SET content_json = ?1 WHERE id = ?2",
            rusqlite::params![new_text, history_id],
        );
        // Also update the linked draft with the full TipTap JSON (preserves image nodes)
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

/// Full content of a history item for editing: content_json + post_title + attachments from the draft.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryForEdit {
    pub history_id:       String,
    pub content_json:     String,
    pub post_title:       String,
    pub telegram_msg_id:  Option<i64>,
    pub telegram_chat_id: Option<String>,
    pub bot_id:           String,
    pub attachments:      Vec<DraftAttachment>,
    pub publish_mode:     String,
}

#[tauri::command]
pub async fn get_history_for_edit(
    history_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<HistoryForEdit, String> {
    // Step 1: query history row
    // NOTE: publication_history.content_json actually stores HTML (not TipTap JSON).
    // The real TipTap JSON lives in the linked draft (draft_id → drafts.content_json).
    let (draft_id, bot_id, telegram_msg_id, telegram_chat_id, content_json, post_title, publish_mode) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;

        let (draft_id, bot_id, telegram_msg_id, telegram_chat_id, publish_mode):
            (Option<String>, String, Option<i64>, Option<String>, String) = db
            .query_row(
                "SELECT h.draft_id, h.bot_id, h.telegram_msg_id, c.telegram_id,
                        COALESCE(h.publish_mode, 'normal')
                 FROM publication_history h
                 LEFT JOIN channels c ON c.id = h.channel_id
                 WHERE h.id = ?1",
                [&history_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .map_err(|_| "Запись истории не найдена".to_string())?;

        // Prefer the draft's TipTap JSON (has image nodes). Fall back to
        // publication_history.content_json if the draft is absent or empty.
        let (mut content_json, post_title) = if let Some(ref did) = draft_id {
            let row = db.query_row(
                "SELECT COALESCE(content_json,''), COALESCE(post_title,'') FROM drafts WHERE id = ?1",
                [did],
                |r| Ok((r.get::<_,String>(0)?, r.get::<_,String>(1)?)),
            );
            row.unwrap_or_default()
        } else {
            (String::new(), String::new())
        };

        // Fall back to HTML stored in publication_history if draft content is empty
        if content_json.is_empty() {
            content_json = db.query_row(
                "SELECT COALESCE(content_json,'') FROM publication_history WHERE id = ?1",
                [&history_id],
                |r| r.get::<_, String>(0),
            ).unwrap_or_default();
        }

        (draft_id, bot_id, telegram_msg_id, telegram_chat_id, content_json, post_title, publish_mode)
    };

    // Step 2: load media attachments from disk (via draft_media)
    let mut attachments: Vec<DraftAttachment> = Vec::new();
    if let Some(ref did) = draft_id {
        struct MediaRow { id: String, file_path: String, file_name: String, mime_type: String }

        let rows: Vec<MediaRow> = {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let mut stmt = db
                .prepare(
                    "SELECT id, file_path, file_name, mime_type
                     FROM draft_media WHERE draft_id = ?1 ORDER BY sort_order",
                )
                .map_err(|e| e.to_string())?;

            let mapped = stmt.query_map([did], |r| {
                Ok(MediaRow {
                    id:        r.get(0)?,
                    file_path: r.get(1)?,
                    file_name: r.get(2)?,
                    mime_type: r.get(3)?,
                })
            }).map_err(|e| e.to_string())?;

            let mut collected = Vec::new();
            for row in mapped { if let Ok(r) = row { collected.push(r); } }
            collected
        };

        for row in rows {
            if let Ok(raw) = std::fs::read(&row.file_path) {
                let data_base64 = base64::engine::general_purpose::STANDARD.encode(&raw);
                attachments.push(DraftAttachment {
                    file_id:     row.id,
                    data_base64,
                    mime_type:   row.mime_type,
                    file_name:   row.file_name,
                });
            }
        }
    }

    Ok(HistoryForEdit {
        history_id,
        content_json,
        post_title,
        telegram_msg_id,
        telegram_chat_id,
        bot_id,
        attachments,
        publish_mode,
    })
}

/// Called by the background worker — deletes message via Bot API and marks row as deleted.
pub async fn execute_pending_deletes(state: &AppState) {
    let now = Utc::now().to_rfc3339();

    let pending: Vec<(String, String, i64, String)> = {
        let Ok(db) = state.db.lock() else { return };
        let Ok(mut stmt) = db.prepare(
            "SELECT h.id, c.telegram_id, h.telegram_msg_id, b.token
             FROM publication_history h
             JOIN channels c ON c.id = h.channel_id
             JOIN bots b ON b.id = h.bot_id
             WHERE h.delete_at IS NOT NULL
               AND h.delete_at <= ?1
               AND h.status = 'published'",
        ) else { return };

        stmt.query_map(rusqlite::params![now], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .ok()
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    };

    for (id, chat_id, msg_id, token) in pending {
        let client = crate::telegram::client::TelegramClient::new(&token);
        match crate::telegram::methods::delete_message(&client, &chat_id, msg_id).await {
            Ok(_) => {
                if let Ok(db) = state.db.lock() {
                    let _ = db.execute(
                        "UPDATE publication_history SET status='deleted', delete_at=NULL WHERE id=?1",
                        rusqlite::params![id],
                    );
                }
                log::info!("[delete] deleted msg {} in {}", msg_id, chat_id);
            }
            Err(e) => {
                log::warn!("[delete] failed to delete msg {} in {}: {}", msg_id, chat_id, e);
            }
        }
    }
}
