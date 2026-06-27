use base64::Engine;
use chrono::Utc;
use uuid::Uuid;

use crate::db::{
    models::{Draft, DraftPayload, DraftSummary},
    queries::drafts as q,
    AppState,
};

const MAX_ATTACHMENTS: usize = 20;
const MAX_ATTACHMENT_BYTES: usize = 52_428_800; // 50 MB per file
const MAX_TOTAL_BYTES: usize = 209_715_200;     // 200 MB total per draft

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
    if let Some(attachments) = &payload.attachments {
        if attachments.len() > MAX_ATTACHMENTS {
            return Err(format!(
                "Слишком много вложений (максимум {})",
                MAX_ATTACHMENTS
            ));
        }

        let mut total = 0usize;
        for att in attachments {
            // base64 → raw size ≈ len * 3/4
            let approx = att.data_base64.len() * 3 / 4;
            if approx > MAX_ATTACHMENT_BYTES {
                return Err(format!(
                    "Файл «{}» превышает лимит 50 МБ",
                    att.file_name
                ));
            }
            total += approx;
            if total > MAX_TOTAL_BYTES {
                return Err("Суммарный размер вложений превышает 200 МБ".to_string());
            }
        }
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

        let draft = Draft {
            id: id.clone(),
            title: payload.title,
            post_title: payload.post_title.unwrap_or_default(),
            content_json: payload.content_json,
            content_text: payload.content_text,
            parse_mode: payload.parse_mode.unwrap_or_else(|| "HTML".to_string()),
            status: "draft".to_string(),
            media: vec![],
            buttons: vec![],
            attachments: vec![],
            created_at,
            updated_at: now.clone(),
        };

        q::upsert(&db, &draft).map_err(|e| e.to_string())?;

        // Save attachments to disk
        if let Some(attachments) = &payload.attachments {
            let media_dir = state.app_dir.join("draft_media").join(&id);
            std::fs::create_dir_all(&media_dir)
                .map_err(|e| format!("Не удалось создать директорию: {}", e))?;

            for att in attachments {
                let raw = base64::engine::general_purpose::STANDARD
                    .decode(&att.data_base64)
                    .map_err(|_| format!("Ошибка декодирования файла «{}»", att.file_name))?;

                if raw.is_empty() { continue; }

                // Sanitize extension: allow only alphanumeric
                let ext = att.file_name
                    .rsplit('.')
                    .next()
                    .unwrap_or("bin")
                    .chars()
                    .filter(|c| c.is_alphanumeric())
                    .take(10)
                    .collect::<String>();
                let ext = if ext.is_empty() { "bin".to_string() } else { ext };

                let file_path = media_dir.join(format!("{}.{}", att.file_id, ext));
                std::fs::write(&file_path, &raw)
                    .map_err(|e| format!("Ошибка сохранения файла: {}", e))?;

                let path_str = file_path.to_string_lossy().into_owned();
                let now2 = Utc::now().to_rfc3339();
                db.execute(
                    "INSERT INTO draft_media (id, draft_id, file_path, file_name, mime_type,
                                             file_size, sort_order, created_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
                     ON CONFLICT(id) DO UPDATE SET
                       file_path=excluded.file_path,
                       file_name=excluded.file_name,
                       mime_type=excluded.mime_type,
                       file_size=excluded.file_size",
                    rusqlite::params![
                        att.file_id, id, path_str, att.file_name, att.mime_type,
                        raw.len() as i64, 0i64, now2
                    ],
                ).map_err(|e| e.to_string())?;
            }
        }

        // Keep max 20 drafts
        let count: i64 = db
            .query_row("SELECT COUNT(*) FROM drafts", [], |row| row.get(0))
            .unwrap_or(0);
        if count > 20 {
            db.execute(
                "DELETE FROM drafts WHERE id NOT IN (
                    SELECT id FROM drafts ORDER BY updated_at DESC LIMIT 20
                )",
                [],
            ).ok();
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
    q::delete(&db, &draft_id).map_err(|e| e.to_string())
}
