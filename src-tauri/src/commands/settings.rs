use crate::db::{models::AppSettings, queries::settings as settings_q, AppState};

const ALLOWED_SETTING_KEYS: &[&str] = &[
    "theme", "language", "autosave_interval", "default_parse_mode",
    "default_bot_id", "default_channel_id", "show_char_counter",
    "confirm_before_publish", "telegraph_access_token",
    "accent_color", "large_font_editor", "show_telegram_preview",
];

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
    if !ALLOWED_SETTING_KEYS.contains(&key.as_str()) {
        return Err(format!("Unknown setting key: {}", key));
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    settings_q::save_key(&db, &key, &value).map_err(|e| e.to_string())
}
