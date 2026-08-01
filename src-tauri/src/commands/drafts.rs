use base64::Engine;
use chrono::Utc;
use uuid::Uuid;

use crate::commands::attachments;
use crate::db::{
    models::{Draft, DraftPayload, DraftSummary},
    queries::drafts as q,
    AppState,
};

const DRAFT_MAX_COUNT: i64 = 100;

#[tauri::command]
pub async fn get_drafts(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DraftSummary>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    q::find_all_summaries(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_draft(
    draft_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Draft, String> {
    let (mut draft, _app_dir) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let d = q::find_by_id(&db, &draft_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Черновик не найден".to_string())?;
        (d, state.app_dir.clone())
    };

    for media in &draft.media {
        let path = std::path::Path::new(&media.file_path);
        if let Ok(raw) = std::fs::read(path) {
            let data_base64 = base64::engine::general_purpose::STANDARD.encode(&raw);
            draft.attachments.push(crate::db::models::DraftAttachment {
                file_id:     media.id.clone(),
                data_base64,
                mime_type:   media.mime_type.clone(),
                file_name:   media.file_name.clone(),
            });
        }
    }

    Ok(draft)
}

#[tauri::command]
pub async fn upsert_draft(
    payload: DraftPayload,
    state: tauri::State<'_, AppState>,
) -> Result<Draft, String> {
    // Validate attachments before acquiring DB lock
    if let Some(atts) = &payload.attachments {
        attachments::validate(atts)?;
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let id = payload.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());

    // Wrap everything in a transaction to avoid partial writes
    db.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;

    let result = (|| -> Result<Draft, String> {
        let existing = q::find_by_id(&db, &id).map_err(|e| e.to_string())?;
        let created_at = existing
            .as_ref()
            .map(|d| d.created_at.clone())
            .unwrap_or_else(|| now.clone());

        // template_id is only ever sent by the frontend when a draft is first
        // created from a template — every later autosave omits it, so fall
        // back to whatever the existing row already has instead of clearing it.
        let template_id = payload
            .template_id
            .clone()
            .or_else(|| existing.as_ref().and_then(|d| d.template_id.clone()));

        // Same fallback pattern as template_id: only an explicit payload value
        // (the frontend sends this whenever the Обычный/Rich toggle changes)
        // overrides it, otherwise keep whatever the existing row already has.
        // New drafts with no existing row default to "normal".
        let publish_mode = payload
            .publish_mode
            .clone()
            .or_else(|| existing.as_ref().map(|d| d.publish_mode.clone()))
            .unwrap_or_else(|| "normal".to_string());

        let draft = Draft {
            id: id.clone(),
            title: payload.title,
            post_title: payload.post_title.unwrap_or_default(),
            content_json: payload.content_json,
            content_text: payload.content_text,
            parse_mode: payload.parse_mode.unwrap_or_else(|| "HTML".to_string()),
            // Intentionally NOT taken from payload — status is a state machine
            // (draft/scheduled/published) moved forward only by explicit
            // transitions in commands::publish/scheduler. q::upsert's SQL
            // excludes `status` from its ON CONFLICT UPDATE SET, so this value
            // only ever takes effect for a brand-new row; editing an existing
            // scheduled/published draft leaves its real status untouched.
            status: "draft".to_string(),
            publish_mode,
            template_id,
            template_name: None,
            media: vec![],
            buttons: vec![],
            attachments: vec![],
            created_at,
            updated_at: now.clone(),
        };

        q::upsert(&db, &draft).map_err(|e| e.to_string())?;

        // Save attachments to disk
        if let Some(atts) = &payload.attachments {
            attachments::persist(&db, &state.app_dir, &id, atts)?;
        }

        // Keep max DRAFT_MAX_COUNT *active* drafts. Templates (kind='template')
        // never counted against this cap; scheduled/published rows are also
        // excluded now — once a post is scheduled or published it's no longer
        // a freeform scratch draft, and silently deleting it here would orphan
        // the corresponding scheduled_posts/History record while giving the
        // user no warning (published posts have History as their real archive,
        // see project_drafts_templates_model memory).
        let count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM drafts WHERE kind = 'draft' AND status = 'draft'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if count > DRAFT_MAX_COUNT {
            // Collect the doomed ids first so their media directories can be
            // removed too — the draft_media ROWS cascade away with the draft,
            // but the files on disk don't, and this prune runs unattended on
            // autosave, so leaked media here accumulates invisibly.
            let doomed: Vec<String> = db
                .prepare(
                    "SELECT id FROM drafts WHERE kind = 'draft' AND status = 'draft' AND id NOT IN (
                        SELECT id FROM drafts WHERE kind = 'draft' AND status = 'draft'
                        ORDER BY updated_at DESC LIMIT ?1
                    )",
                )
                .and_then(|mut s| {
                    s.query_map(rusqlite::params![DRAFT_MAX_COUNT], |r| r.get(0))
                        .map(|rows| rows.filter_map(|r| r.ok()).collect())
                })
                .unwrap_or_default();

            for id in &doomed {
                db.execute("DELETE FROM drafts WHERE id = ?1", rusqlite::params![id]).ok();
                attachments::remove_media_dir(&state.app_dir, id);
            }
        }

        Ok(draft)
    })();

    match result {
        Ok(draft) => {
            db.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(draft)
        }
        Err(e) => {
            db.execute_batch("ROLLBACK").ok();
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn delete_draft(
    draft_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    q::delete(&db, &draft_id).map_err(|e| e.to_string())?;
    // draft_media rows cascade off the drafts row; the files they point at
    // do not, and used to be left behind on disk permanently.
    attachments::remove_media_dir(&state.app_dir, &draft_id);
    Ok(())
}
