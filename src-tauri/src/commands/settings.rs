use crate::db::{models::AppSettings, queries::settings as settings_q, AppState};

#[tauri::command]
pub async fn get_settings(state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    settings_q::load(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_setting(
    key: String,
    value: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    settings_q::save_key(&db, &key, &value).map_err(|e| e.to_string())
}
