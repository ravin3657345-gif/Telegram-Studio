use crate::db::AppState;
use reqwest::Client;
use tstudio_core::license::{clean, looks_like_key, machine_id_hash, SUPABASE_ANON_KEY, SUPABASE_URL};

fn client() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("failed to build HTTP client")
}

/// Calls the `redeem_license` RPC. Returns one of:
/// "activated" | "already_this_machine" | "used_elsewhere" | "not_found".
async fn redeem_on_server(key: &str, machine_id: &str) -> Result<String, String> {
    let resp = client()
        .post(format!("{SUPABASE_URL}/rest/v1/rpc/redeem_license"))
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {SUPABASE_ANON_KEY}"))
        .json(&serde_json::json!({ "p_key": key, "p_machine_id": machine_id }))
        .send()
        .await
        .map_err(|_| "Нет соединения с сервером лицензий — проверьте интернет".to_string())?;

    if !resp.status().is_success() {
        return Err("Сервер лицензий вернул ошибку".to_string());
    }

    resp.json::<String>()
        .await
        .map_err(|_| "Некорректный ответ сервера лицензий".to_string())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Fully offline — re-checks the locally-cached activation against the
/// current machine's hash, so normal app launches never need the network.
/// Only `activate_license` ever talks to Supabase.
#[tauri::command]
pub async fn get_license_status(
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let stored: rusqlite::Result<(String, String)> = db.query_row(
        "SELECT key, machine_hash FROM license LIMIT 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    );
    match stored {
        Ok((key, machine_hash)) => Ok(looks_like_key(&key) && machine_hash == machine_id_hash()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
pub async fn activate_license(
    key: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    if !looks_like_key(&key) {
        return Err("Неверный формат ключа активации".to_string());
    }
    let normalized = clean(&key);
    let machine_hash = machine_id_hash();

    let result = redeem_on_server(&normalized, &machine_hash).await?;
    match result.as_str() {
        "activated" | "already_this_machine" => {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            let now = chrono::Utc::now().to_rfc3339();
            db.execute(
                "INSERT INTO license (id, key, activated_at, machine_hash) VALUES (1, ?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET key = excluded.key, activated_at = excluded.activated_at, machine_hash = excluded.machine_hash",
                rusqlite::params![normalized, now, machine_hash],
            ).map_err(|e| e.to_string())?;
            Ok(())
        }
        "used_elsewhere" => Err("Этот ключ уже активирован на другом устройстве".to_string()),
        "not_found" => Err("Ключ не найден — проверьте правильность ввода".to_string()),
        _ => Err("Неизвестный ответ сервера лицензий".to_string()),
    }
}
