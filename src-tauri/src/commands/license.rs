use crate::db::AppState;
use tstudio_core::license::validate_key;

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_license_status(
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let stored: rusqlite::Result<String> = db.query_row(
        "SELECT key FROM license LIMIT 1",
        [],
        |r| r.get(0),
    );
    Ok(stored.map(|k| validate_key(&k)).unwrap_or(false))
}

#[tauri::command]
pub async fn activate_license(
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if !validate_key(&key) {
        return Err("Неверный ключ активации".to_string());
    }
    let normalized = key.trim().to_uppercase();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    db.execute(
        "INSERT INTO license (id, key, activated_at) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET key = excluded.key, activated_at = excluded.activated_at",
        rusqlite::params![normalized, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
