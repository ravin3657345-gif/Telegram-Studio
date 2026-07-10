use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::commands::attachments;
use crate::db::{models::DraftAttachment, models::DraftAttachmentPayload, AppState};

// A template is a `drafts` row with kind='template' (see migrations.rs::migrate_v11)
// — same content_json/media storage as a real draft, just filtered differently
// and carrying category/usage_count instead of post_title/template_id.

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    pub content_json: String,
    pub parse_mode: String,
    pub category: String,
    pub usage_count: i64,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub attachments: Vec<DraftAttachment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTemplatePayload {
    pub id: Option<String>,
    pub name: String,
    pub content_json: String,
    pub parse_mode: Option<String>,
    pub category: Option<String>,
    pub attachments: Option<Vec<DraftAttachmentPayload>>,
}

fn row_to_template(row: &rusqlite::Row) -> rusqlite::Result<Template> {
    Ok(Template {
        id:           row.get(0)?,
        name:         row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        content_json: row.get(2)?,
        parse_mode:   row.get(3)?,
        category:     row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "other".to_string()),
        usage_count:  row.get(5)?,
        last_used_at: row.get(6)?,
        created_at:   row.get(7)?,
        updated_at:   row.get(8)?,
        attachments:  vec![],
    })
}

const TEMPLATE_COLUMNS: &str =
    "id, title, content_json, parse_mode, category, usage_count, last_used_at, created_at, updated_at";

#[tauri::command]
pub async fn get_templates(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Template>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(&format!(
            "SELECT {TEMPLATE_COLUMNS} FROM drafts
             WHERE kind = 'template'
             ORDER BY category ASC, updated_at DESC",
        ))
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], row_to_template).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_template(
    template_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Template, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut t = db
        .query_row(
            &format!("SELECT {TEMPLATE_COLUMNS} FROM drafts WHERE id = ?1 AND kind = 'template'"),
            rusqlite::params![template_id],
            row_to_template,
        )
        .map_err(|_| "Шаблон не найден".to_string())?;

    t.attachments = attachments::load_as_attachments(&db, &template_id)?;
    Ok(t)
}

#[tauri::command]
pub async fn save_template(
    payload: SaveTemplatePayload,
    state: tauri::State<'_, AppState>,
) -> Result<Template, String> {
    if let Some(atts) = &payload.attachments {
        attachments::validate(atts)?;
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let id = payload.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let category = payload.category.unwrap_or_else(|| "other".to_string());
    let parse_mode = payload.parse_mode.unwrap_or_else(|| "HTML".to_string());

    db.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;

    let result = (|| -> Result<Template, String> {
        let created_at = db
            .query_row(
                "SELECT created_at FROM drafts WHERE id = ?1",
                rusqlite::params![id],
                |r| r.get::<_, String>(0),
            )
            .unwrap_or_else(|_| now.clone());

        db.execute(
            "INSERT INTO drafts (id, title, content_json, parse_mode, status, kind, category, created_at, updated_at)
             VALUES (?1,?2,?3,?4,'draft','template',?5,?6,?7)
             ON CONFLICT(id) DO UPDATE SET
               title=excluded.title,
               content_json=excluded.content_json,
               parse_mode=excluded.parse_mode,
               category=excluded.category,
               updated_at=excluded.updated_at",
            rusqlite::params![id, payload.name, payload.content_json, parse_mode, category, created_at, now],
        ).map_err(|e| e.to_string())?;

        if let Some(atts) = &payload.attachments {
            attachments::persist(&db, &state.app_dir, &id, atts)?;
        }

        // usage_count/last_used_at aren't touched by the upsert above (renaming
        // or editing a template must not reset how many times it's been used).
        let (usage_count, last_used_at): (i64, Option<String>) = db
            .query_row(
                "SELECT usage_count, last_used_at FROM drafts WHERE id = ?1",
                rusqlite::params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        Ok(Template {
            id: id.clone(),
            name: payload.name.clone(),
            content_json: payload.content_json.clone(),
            parse_mode: parse_mode.clone(),
            category: category.clone(),
            usage_count,
            last_used_at,
            created_at,
            updated_at: now.clone(),
            attachments: vec![],
        })
    })();

    match result {
        Ok(t) => { db.execute_batch("COMMIT").map_err(|e| e.to_string())?; Ok(t) }
        Err(e) => { db.execute_batch("ROLLBACK").ok(); Err(e) }
    }
}

#[tauri::command]
pub async fn record_template_use(
    template_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    db.execute(
        "UPDATE drafts SET usage_count = usage_count + 1, last_used_at = ?1
         WHERE id = ?2 AND kind = 'template'",
        rusqlite::params![now, template_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_template(
    template_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute(
        "DELETE FROM drafts WHERE id = ?1 AND kind = 'template'",
        rusqlite::params![template_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
