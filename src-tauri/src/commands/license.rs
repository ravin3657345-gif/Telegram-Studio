use crate::db::AppState;
use reqwest::Client;
use tstudio_core::license::{clean, legacy_machine_id_hash, looks_like_key, machine_id_hash, SUPABASE_ANON_KEY, SUPABASE_URL};

fn client() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("failed to build HTTP client")
}

/// Calls the `redeem_license` RPC. Returns one of:
/// "activated" | "already_this_machine" | "used_elsewhere" | "not_found".
///
/// Always sends the legacy-algorithm hash alongside the current one —
/// the server treats a match against either as proof of "same machine" and
/// migrates its stored value forward (see the redeem_license migration
/// dated 2026-07-16), so a user who activated before the SMBIOS switch
/// doesn't get bounced as "used_elsewhere" on the very machine they
/// legitimately activated on.
async fn redeem_on_server(key: &str, machine_id: &str) -> Result<String, String> {
    let resp = client()
        .post(format!("{SUPABASE_URL}/rest/v1/rpc/redeem_license"))
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {SUPABASE_ANON_KEY}"))
        .json(&serde_json::json!({
            "p_key": key,
            "p_machine_id": machine_id,
            "p_legacy_machine_id": legacy_machine_id_hash(),
        }))
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

/// Usually fully offline — re-checks the locally-cached activation against
/// the current machine's hash, so normal app launches never need the
/// network. The one exception: if the stored hash doesn't match but DOES
/// match what the pre-2026-07-16 (legacy Windows MachineGuid) algorithm
/// would have produced, this is still the same physical machine that just
/// updated past the SMBIOS migration — silently re-sync with the server
/// and update the local record instead of bouncing the user back to the
/// activation screen for a migration that isn't their fault (see
/// redeem_on_server's doc comment and the redeem_license migration).
#[tauri::command]
pub async fn get_license_status(
    state: tauri::State<'_, AppState>,
) -> Result<bool, String> {
    let stored = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT key, machine_hash FROM license LIMIT 1",
            [],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        ).ok()
    };
    let Some((key, machine_hash)) = stored else { return Ok(false) };
    if !looks_like_key(&key) {
        return Ok(false);
    }

    let current_hash = machine_id_hash();
    if machine_hash == current_hash {
        return Ok(true);
    }
    if machine_hash != legacy_machine_id_hash() {
        return Ok(false);
    }

    let normalized = clean(&key);
    match redeem_on_server(&normalized, &current_hash).await {
        Ok(result) if result == "activated" || result == "already_this_machine" => {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            db.execute(
                "UPDATE license SET machine_hash = ?1 WHERE id = 1",
                rusqlite::params![current_hash],
            ).map_err(|e| e.to_string())?;
            Ok(true)
        }
        // Server unreachable or genuinely rejected it — fall back to
        // "not activated" rather than erroring the whole status check;
        // the user lands on the activation screen and can retry.
        _ => Ok(false),
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
