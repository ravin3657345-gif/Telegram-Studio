use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use crate::db::AppState;
use crate::db::queries::settings as settings_q;

// ─── WebView upload state ─────────────────────────────────────────────────────

pub struct TelegraphWebviewState {
    pub sender: tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<Result<String, String>>>>,
}

impl Default for TelegraphWebviewState {
    fn default() -> Self {
        Self { sender: tokio::sync::Mutex::new(None) }
    }
}

/// Called from JS inside the `telegraph_worker` WebView2 window when upload finishes.
#[tauri::command]
pub async fn telegraph_webview_result(
    url: Option<String>,
    error: Option<String>,
    state: tauri::State<'_, TelegraphWebviewState>,
) -> Result<(), String> {
    let mut lock = state.sender.lock().await;
    if let Some(tx) = lock.take() {
        let result = url
            .filter(|u| u.starts_with("https://telegra.ph"))
            .ok_or_else(|| error.unwrap_or_else(|| "Telegraph upload failed".to_string()));
        let _ = tx.send(result);
    }
    Ok(())
}

/// Open a visible window for the user to log in to Telegraph (one-time setup).
#[tauri::command]
pub async fn telegraph_open_login(app: AppHandle) -> Result<(), String> {
    let resp = reqwest::Client::new()
        .post("https://api.telegra.ph/createAccount")
        .json(&serde_json::json!({ "short_name": "TElega", "author_name": "TElega POST" }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let auth_url = resp["result"]["auth_url"]
        .as_str()
        .ok_or_else(|| "Telegraph не вернул auth_url".to_string())?
        .to_string();

    if let Some(w) = app.get_webview_window("telegraph_login") {
        let _ = w.close();
    }

    WebviewWindowBuilder::new(
        &app,
        "telegraph_login",
        WebviewUrl::External(auth_url.parse::<url::Url>().map_err(|e| e.to_string())?),
    )
    .title("Войти в Telegraph")
    .inner_size(480.0, 380.0)
    .center()
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Upload a JPEG to Telegraph via a hidden WebView2 window at https://telegra.ph/.
///
/// Why this works when reqwest doesn't:
/// - Loads real telegra.ph → Telegraph JS auto-creates session + cookies
/// - fetch('/upload') is same-origin → no CORS, no TLS fingerprint check
/// - Capability `telegraph.json` with `remote.urls: ["https://telegra.ph/*"]` enables IPC
/// - JS calls window.__TAURI_INTERNALS__.invoke('telegraph_webview_result', ...)
pub async fn upload_via_webview(
    app: &AppHandle,
    state: &TelegraphWebviewState,
    jpeg_base64: &str,
) -> Result<String, String> {
    let is_new = app.get_webview_window("telegraph_worker").is_none();

    let webview = match app.get_webview_window("telegraph_worker") {
        Some(w) => w,
        None => {
            let w = WebviewWindowBuilder::new(
                app,
                "telegraph_worker",
                WebviewUrl::External("https://telegra.ph/".parse::<url::Url>().unwrap()),
            )
            .title("Telegraph (отладка)")
            .inner_size(700.0, 600.0)
            .visible(true)
            .build()
            .map_err(|e| e.to_string())?;
            #[cfg(debug_assertions)]
            let _ = w.open_devtools();
            w
        }
    };

    if is_new {
        // Wait for page load + Telegraph session cookie initialization
        tokio::time::sleep(std::time::Duration::from_secs(6)).await;
    }

    // DIAGNOSTIC: result reported via document.title, polled from Rust.
    // Sets title at each stage so we can see exactly where it stops.
    let js = format!(
        r#"(async function() {{
            try {{
                document.title = '__TG_STAGE__:start ipc=' + (typeof window.__TAURI_INTERNALS__);
                const b64 = '{b64}';
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                const blob = new Blob([bytes], {{ type: 'image/jpeg' }});
                const fd = new FormData();
                fd.append('file', blob, 'photo.jpg');
                document.title = '__TG_STAGE__:fetching url=' + location.href;
                const resp = await fetch('/upload', {{ method: 'POST', body: fd }});
                document.title = '__TG_STAGE__:status ' + resp.status;
                const txt = await resp.text();
                let json; try {{ json = JSON.parse(txt); }} catch(_) {{}}
                if (Array.isArray(json) && json[0] && json[0].src) {{
                    document.title = '__TGUP_OK__:https://telegra.ph' + json[0].src;
                }} else {{
                    document.title = '__TGUP_ERR__:' + txt.slice(0,120);
                }}
            }} catch(e) {{
                document.title = '__TGUP_ERR__:JS ' + (e && e.message ? e.message : e);
            }}
        }})();"#,
        b64 = jpeg_base64
    );

    let _ = state; // unused in diagnostic mode
    webview.eval(&js).map_err(|e| e.to_string())?;

    // Poll document.title
    let mut last_stage = String::new();
    for _ in 0..50 {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        if let Ok(title) = webview.title() {
            if title != last_stage && (title.starts_with("__TG") ) {
                eprintln!("[telegraph-wv] title = {}", title);
                last_stage = title.clone();
            }
            if let Some(url) = title.strip_prefix("__TGUP_OK__:") {
                return Ok(url.to_string());
            } else if let Some(err) = title.strip_prefix("__TGUP_ERR__:") {
                return Err(err.to_string());
            }
        }
    }

    Err("Telegraph: timeout 20с — нет результата в title".to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegraphImagePayload {
    pub file_id: String,
    pub data_base64: String,
    pub mime_type: String,
    pub file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegraphPublishPayload {
    pub title: String,
    pub nodes_json: String,
    pub images: Vec<TelegraphImagePayload>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegraphPublishResult {
    pub url: String,
    pub path: String,
}

/// Create a Telegraph page and return its URL.
#[tauri::command]
pub async fn telegraph_publish(
    payload: TelegraphPublishPayload,
    state: tauri::State<'_, AppState>,
) -> Result<TelegraphPublishResult, String> {
    // ── Get or create access token ───────────────────────────────────────────
    let cached_token: Option<String> = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT value FROM settings WHERE key = 'telegraph_access_token'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .filter(|t| !t.is_empty())
    };

    let access_token = if let Some(t) = cached_token {
        t
    } else {
        let account = crate::telegraph::create_account("TElega POST").await?;
        let token = account.access_token.clone();
        {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            settings_q::save_key(&db, "telegraph_access_token", &token)
                .map_err(|e| e.to_string())?;
        }
        token
    };

    // ── Parse nodes first ────────────────────────────────────────────────────
    let mut nodes: serde_json::Value = serde_json::from_str(&payload.nodes_json)
        .map_err(|e| format!("nodes parse error: {}", e))?;

    // ── Upload images ────────────────────────────────────────────────────────
    // Telegraph: max ~5 MB, supported types: jpg/png/gif (no webp/bmp)
    const MAX_BYTES: usize = 5 * 1024 * 1024;

    let mut url_map: HashMap<String, String> = HashMap::new();
    for img in &payload.images {
        use base64::Engine;
        if img.data_base64.len() > 8_000_000 {
            eprintln!(
                "Telegraph: пропуск {} — base64 слишком большой",
                img.file_name
            );
            continue;
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&img.data_base64)
            .map_err(|e| format!("base64 decode: {}", e))?;

        let supported = matches!(
            img.mime_type.as_str(),
            "image/jpeg" | "image/jpg" | "image/png" | "image/gif"
        );

        if !supported || bytes.len() > MAX_BYTES {
            eprintln!(
                "Telegraph: пропуск {} — формат {} или размер {} > 5MB",
                img.file_name, img.mime_type, bytes.len()
            );
            continue;
        }

        match crate::telegraph::upload_image(bytes, &img.mime_type, &img.file_name).await {
            Ok(url) => { url_map.insert(img.file_id.clone(), url); }
            Err(e) => {
                eprintln!("Telegraph: ошибка загрузки {} — {}", img.file_name, e);
                // не прерываем — пропускаем это изображение
            }
        }
    }

    // ── Replace placeholders, remove unresolved figure nodes ─────────────────
    replace_file_placeholders(&mut nodes, &url_map);
    remove_unresolved_figures(&mut nodes);

    // ── Create page ──────────────────────────────────────────────────────────
    let title = payload.title.trim().to_string();
    let title = if title.is_empty() { "Публикация".to_string() } else { title };

    let page = crate::telegraph::create_page(&access_token, &title, nodes).await?;

    Ok(TelegraphPublishResult { url: page.url, path: page.path })
}

/// Replace "file:<fileId>" src values with uploaded Telegraph URLs.
fn replace_file_placeholders(node: &mut serde_json::Value, map: &HashMap<String, String>) {
    match node {
        serde_json::Value::Object(obj) => {
            if let Some(attrs) = obj.get_mut("attrs") {
                if let Some(src_val) = attrs.get("src") {
                    if let Some(src) = src_val.as_str() {
                        if let Some(file_id) = src.strip_prefix("file:") {
                            if let Some(url) = map.get(file_id) {
                                attrs["src"] = serde_json::Value::String(url.clone());
                            }
                        }
                    }
                }
            }
            for val in obj.values_mut() {
                replace_file_placeholders(val, map);
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                replace_file_placeholders(item, map);
            }
        }
        _ => {}
    }
}

/// Remove figure nodes that still have unresolved "file:..." src (upload was skipped).
fn remove_unresolved_figures(nodes: &mut serde_json::Value) {
    if let serde_json::Value::Array(arr) = nodes {
        arr.retain(|node| {
            if let serde_json::Value::Object(obj) = node {
                if obj.get("tag").and_then(|v| v.as_str()) == Some("figure") {
                    // Check if any child img still has a "file:" src
                    if let Some(serde_json::Value::Array(children)) = obj.get("children") {
                        return !children.iter().any(|child| {
                            child.get("attrs")
                                .and_then(|a| a.get("src"))
                                .and_then(|s| s.as_str())
                                .map(|s| s.starts_with("file:"))
                                .unwrap_or(false)
                        });
                    }
                }
            }
            true
        });
        // Recurse into remaining nodes
        for node in arr.iter_mut() {
            if let Some(children) = node.get_mut("children") {
                remove_unresolved_figures(children);
            }
        }
    }
}
