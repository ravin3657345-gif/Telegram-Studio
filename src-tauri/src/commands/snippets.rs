use chrono::Utc;
use serde::Deserialize;
use uuid::Uuid;

use crate::db::{models::Snippet, queries::snippets as snippets_q, AppState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSnippetPayload {
    pub id: Option<String>,
    pub name: String,
    pub content: String,
}

#[tauri::command]
pub async fn get_snippets(state: tauri::State<'_, AppState>) -> Result<Vec<Snippet>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    snippets_q::find_all(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_snippet(
    payload: SaveSnippetPayload,
    state: tauri::State<'_, AppState>,
) -> Result<Snippet, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;

    if let Some(id) = payload.id {
        snippets_q::update(&db, &id, &payload.name, &payload.content).map_err(|e| e.to_string())?;
        let all = snippets_q::find_all(&db).map_err(|e| e.to_string())?;
        return all.into_iter().find(|s| s.id == id).ok_or_else(|| "Сниппет не найден".to_string());
    }

    let now = Utc::now().to_rfc3339();
    let existing_count = snippets_q::find_all(&db).map_err(|e| e.to_string())?.len() as i64;
    let snippet = Snippet {
        id: Uuid::new_v4().to_string(),
        name: payload.name,
        content: payload.content,
        sort_order: existing_count,
        created_at: now.clone(),
        updated_at: now,
    };
    snippets_q::insert(&db, &snippet).map_err(|e| e.to_string())?;
    Ok(snippet)
}

#[tauri::command]
pub async fn delete_snippet(
    snippet_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    snippets_q::delete(&db, &snippet_id).map_err(|e| e.to_string())
}
