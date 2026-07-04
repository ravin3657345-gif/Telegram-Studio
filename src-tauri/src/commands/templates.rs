use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::db::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub name: String,
    pub content_json: String,
    pub parse_mode: String,
    pub category: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTemplatePayload {
    pub id: Option<String>,
    pub name: String,
    pub content_json: String,
    pub parse_mode: Option<String>,
    pub category: Option<String>,
}

#[tauri::command]
pub async fn get_templates(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Template>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare(
            "SELECT id, name, content_json, parse_mode, category, created_at, updated_at
             FROM templates ORDER BY category ASC, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Template {
                id:           row.get(0)?,
                name:         row.get(1)?,
                content_json: row.get(2)?,
                parse_mode:   row.get(3)?,
                category:     row.get(4)?,
                created_at:   row.get(5)?,
                updated_at:   row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_template(
    payload: SaveTemplatePayload,
    state: tauri::State<'_, AppState>,
) -> Result<Template, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let id = payload.id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let t = Template {
        id: id.clone(),
        name: payload.name,
        content_json: payload.content_json,
        parse_mode: payload.parse_mode.unwrap_or_else(|| "HTML".to_string()),
        category: payload.category.unwrap_or_else(|| "other".to_string()),
        created_at: now.clone(),
        updated_at: now,
    };

    db.execute(
        "INSERT INTO templates (id, name, content_json, parse_mode, category, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name,
           content_json=excluded.content_json,
           parse_mode=excluded.parse_mode,
           category=excluded.category,
           updated_at=excluded.updated_at",
        rusqlite::params![t.id, t.name, t.content_json, t.parse_mode, t.category, t.created_at, t.updated_at],
    )
    .map_err(|e| e.to_string())?;

    Ok(t)
}

#[tauri::command]
pub async fn delete_template(
    template_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM templates WHERE id = ?1", rusqlite::params![template_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
