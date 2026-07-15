// Панель управления продающим ботом Telegram Studio — бот теперь Supabase
// Edge Function (sales-bot/supabase/functions/sales-bot/index.ts, webhook),
// не локальный процесс. Отдельный инструмент только для продавца — не часть
// основного продукта. RELEASE_DIR/KEYGEN_PATH/TOKEN_PATH ниже — единственное,
// что всё ещё живёт на этом ПК; всё остальное — в Supabase.

use serde::{Deserialize, Serialize};
use std::fs;
use std::os::windows::process::CommandExt;
use std::process::Command;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

const RELEASE_DIR: &str = "D:/Релиз";
const KEYGEN_PATH: &str = "D:/cargo-tgt/release/keygen.exe";
const TOKEN_PATH: &str = "D:/TElega POST/sales-bot/token.txt";
const WEBHOOK_SECRET_PATH: &str = "D:/tstudio-sales-webhook-secret.txt";

// Бот теперь живёт как Supabase Edge Function (webhook), не локальный
// процесс — см. sales-bot/supabase/functions/sales-bot/index.ts. Панель
// говорит с той же Postgres-схемой (sales_ledger/bot_config/bot_log) и тем
// же Storage bucket напрямую через service_role, тем же паттерном, что
// keygen.exe уже использует для licenses (load_service_key ниже — копия
// keygen/src/main.rs::load_service_key).
use tstudio_core::license::SUPABASE_URL;
const SUPABASE_SERVICE_KEY_FILE: &str = "D:/tstudio-supabase-service-key.txt";
const SALES_BOT_FUNCTION_URL: &str = "https://xhjxnyhvfyzyulzzxpsg.supabase.co/functions/v1/sales-bot";

fn load_service_key() -> Option<String> {
    std::env::var("TSTUDIO_SUPABASE_SERVICE_KEY")
        .ok()
        .or_else(|| std::fs::read_to_string(SUPABASE_SERVICE_KEY_FILE).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn supabase_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())
}

// PostgREST numeric columns (e.g. rub_per_star) round-trip as JSON strings,
// not JSON numbers, to avoid float-precision surprises — accept both.
fn json_f64(v: &serde_json::Value) -> f64 {
    v.as_f64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0)
}

async fn sb_get(path: &str) -> Result<serde_json::Value, String> {
    let key = load_service_key().ok_or_else(|| {
        format!("Не найден service_role ключ Supabase — создайте файл {SUPABASE_SERVICE_KEY_FILE}")
    })?;
    let resp = supabase_client()?
        .get(format!("{SUPABASE_URL}/rest/v1/{path}"))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("Supabase REST {path} -> {status}: {}", resp.text().await.unwrap_or_default()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

async fn sb_patch(path: &str, body: serde_json::Value) -> Result<(), String> {
    let key = load_service_key().ok_or_else(|| {
        format!("Не найден service_role ключ Supabase — создайте файл {SUPABASE_SERVICE_KEY_FILE}")
    })?;
    let resp = supabase_client()?
        .patch(format!("{SUPABASE_URL}/rest/v1/{path}"))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("Supabase REST PATCH {path} -> {status}: {}", resp.text().await.unwrap_or_default()));
    }
    Ok(())
}

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn run_powershell(script: &str) -> Result<String, String> {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            match output.status.code() {
                Some(code) => format!("powershell завершился с кодом {code}"),
                None => "powershell завершился без кода (прерван сигналом)".to_string(),
            }
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// ── Статус ────────────────────────────────────────────────────────────────
// Бот — Supabase Edge Function (webhook), не локальный процесс: нет PID,
// нечего "запускать/останавливать". "Статус" теперь означает: (a) сама
// функция отвечает на HTTP, (b) Telegram считает вебхук рабочим (без
// last_error), (c) когда бот последний раз реально что-то обработал —
// см. sales-bot/supabase/functions/sales-bot/index.ts.

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BotStatus {
    function_reachable: bool,
    webhook_url: Option<String>,
    pending_update_count: i64,
    last_error_message: Option<String>,
    last_error_date: Option<String>,
    last_log_at: Option<String>,
    last_log_message: Option<String>,
}

// Plain function (not a #[tauri::command]) so both the frontend-facing
// command below AND the background tray poller call the exact same check.
async fn get_bot_status_inner() -> Result<BotStatus, String> {
    let token = fs::read_to_string(TOKEN_PATH)
        .map_err(|_| format!("Не найден {TOKEN_PATH} — создайте файл с токеном бота"))?
        .trim()
        .to_string();

    let client = supabase_client()?;

    // Наша функция отвечает 200 на любой не-POST запрос ДО проверки секрета
    // (см. index.ts) — безобидный способ проверить "функция вообще жива",
    // не подделывая Telegram-апдейт.
    let function_reachable = client
        .get(SALES_BOT_FUNCTION_URL)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    let webhook = client
        .get(format!("https://api.telegram.org/bot{token}/getWebhookInfo"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<TelegramApiResponse<serde_json::Value>>()
        .await
        .map_err(|e| e.to_string())?;
    let info = webhook.result.unwrap_or(serde_json::Value::Null);

    let last_log = sb_get("bot_log?select=created_at,message&order=id.desc&limit=1")
        .await
        .unwrap_or(serde_json::Value::Array(vec![]));
    let last_log_row = last_log.as_array().and_then(|a| a.first());

    Ok(BotStatus {
        function_reachable,
        webhook_url: info["url"].as_str().filter(|s| !s.is_empty()).map(String::from),
        pending_update_count: info["pending_update_count"].as_i64().unwrap_or(0),
        last_error_message: info["last_error_message"].as_str().map(String::from),
        last_error_date: info["last_error_date"].as_i64().and_then(|ts| {
            chrono::DateTime::from_timestamp(ts, 0).map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string())
        }),
        last_log_at: last_log_row.and_then(|r| r["created_at"].as_str()).map(String::from),
        last_log_message: last_log_row.and_then(|r| r["message"].as_str()).map(String::from),
    })
}

#[tauri::command]
async fn get_bot_status() -> Result<BotStatus, String> {
    get_bot_status_inner().await
}

// ── Пауза / возобновление ────────────────────────────────────────────────
// Нет процесса, который можно было бы остановить — "остановить бота" теперь
// означает снять вебхук у Telegram (deleteWebhook), тогда никакие апдейты
// вообще не доставляются. "Запустить" — выставить его обратно тем же
// secret_token, что уже сохранён в секретах Edge Function; без повторной
// передачи secret_token Telegram может сбросить требование заголовка, так
// что resume_bot держит его в отдельном локальном файле, а не гадает.

#[tauri::command]
async fn pause_bot() -> Result<(), String> {
    let token = fs::read_to_string(TOKEN_PATH)
        .map_err(|_| format!("Не найден {TOKEN_PATH}"))?
        .trim()
        .to_string();
    let resp = supabase_client()?
        .post(format!("https://api.telegram.org/bot{token}/deleteWebhook"))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<TelegramApiResponse<bool>>()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.ok {
        return Err(resp.description.unwrap_or_else(|| "Telegram отклонил deleteWebhook".to_string()));
    }
    Ok(())
}

#[tauri::command]
async fn resume_bot() -> Result<(), String> {
    let token = fs::read_to_string(TOKEN_PATH)
        .map_err(|_| format!("Не найден {TOKEN_PATH}"))?
        .trim()
        .to_string();
    let secret = fs::read_to_string(WEBHOOK_SECRET_PATH)
        .map_err(|_| format!("Не найден {WEBHOOK_SECRET_PATH} — тот же секрет, что в Edge Function → Secrets → TELEGRAM_WEBHOOK_SECRET"))?
        .trim()
        .to_string();
    let resp = supabase_client()?
        .post(format!("https://api.telegram.org/bot{token}/setWebhook"))
        .query(&[("url", SALES_BOT_FUNCTION_URL), ("secret_token", &secret)])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<TelegramApiResponse<bool>>()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.ok {
        return Err(resp.description.unwrap_or_else(|| "Telegram отклонил setWebhook".to_string()));
    }
    Ok(())
}

// ── Продажи ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaleRow {
    timestamp: String,
    user_id: String,
    username: String,
    first_name: String,
    stars: String,
    key: String,
    charge_id: String,
}

#[tauri::command]
async fn get_sales() -> Result<Vec<SaleRow>, String> {
    let rows = sb_get("sales_ledger?select=created_at,user_id,username,first_name,stars,key,charge_id&order=id.desc").await?;
    let rows = rows.as_array().ok_or("Неожиданный ответ Supabase")?;
    Ok(rows
        .iter()
        .map(|r| SaleRow {
            timestamp: r["created_at"].as_str().unwrap_or("").to_string(),
            user_id: r["user_id"].as_i64().map(|n| n.to_string()).unwrap_or_default(),
            username: r["username"].as_str().unwrap_or("").to_string(),
            first_name: r["first_name"].as_str().unwrap_or("").to_string(),
            stars: r["stars"].as_i64().map(|n| n.to_string()).unwrap_or_default(),
            key: r["key"].as_str().unwrap_or("").to_string(),
            charge_id: r["charge_id"].as_str().unwrap_or("").to_string(),
        })
        .collect())
}

// ── Логи ─────────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_log_tail(lines: usize) -> Result<Vec<String>, String> {
    let rows = sb_get(&format!("bot_log?select=created_at,message&order=id.desc&limit={lines}")).await?;
    let rows = rows.as_array().ok_or("Неожиданный ответ Supabase")?;
    Ok(rows
        .iter()
        .map(|r| {
            let ts = r["created_at"].as_str().unwrap_or("");
            let msg = r["message"].as_str().unwrap_or("");
            format!("{ts} {msg}")
        })
        .collect())
}

// ── Установщики в D:\Релиз ───────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallerInfo {
    name: String,
    version: String,
    size_bytes: u64,
    modified: String,
    is_latest: bool,
}

#[tauri::command]
fn get_installers() -> Result<Vec<InstallerInfo>, String> {
    let script = format!("$dir = \"{RELEASE_DIR}\"\n")
        + r#"
$re = '^Telegram Studio_(\d+)\.(\d+)\.(\d+)_x64(_en-US)?\.msi$'
$items = @(Get-ChildItem -Path $dir -Filter "*.msi" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.Name -match $re) {
    [PSCustomObject]@{
      name = $_.Name
      v1 = [int]$matches[1]; v2 = [int]$matches[2]; v3 = [int]$matches[3]
      sizeBytes = $_.Length
      modified = $_.LastWriteTime.ToString("dd.MM.yyyy HH:mm")
    }
  }
})
$sorted = @($items | Sort-Object -Property v1,v2,v3 -Descending)
$result = @()
for ($i = 0; $i -lt $sorted.Count; $i++) {
  $it = $sorted[$i]
  $result += [PSCustomObject]@{
    name = $it.name
    version = "$($it.v1).$($it.v2).$($it.v3)"
    sizeBytes = $it.sizeBytes
    modified = $it.modified
    isLatest = ($i -eq 0)
  }
}
@($result) | ConvertTo-Json -Compress -Depth 4
"#;
    let out = run_powershell(&script)?;
    if out.is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(&out).map_err(|e| format!("Не удалось разобрать список установщиков: {e} ({out})"))
}

// Публикует конкретный локальный установщик (из D:\Релиз) в Storage bucket
// sales-assets/installers/, затем переключает bot_config.latest_installer_version
// на него — именно это поле читает Edge Function, чтобы решить, какой файл
// слать покупателю (см. index.ts::sendInstallerDocument). D:\Релиз остаётся
// мастер-копией сборок, ничего в процессе релиза не меняется — просто
// появляется явный шаг "сделать эту версию видимой боту".
#[tauri::command]
async fn upload_installer_to_storage(name: String, version: String) -> Result<(), String> {
    let key = load_service_key().ok_or_else(|| {
        format!("Не найден service_role ключ Supabase — создайте файл {SUPABASE_SERVICE_KEY_FILE}")
    })?;
    let path = std::path::Path::new(RELEASE_DIR).join(&name);
    let bytes = fs::read(&path).map_err(|e| format!("Не удалось прочитать {name}: {e}"))?;
    let object_name = format!("Telegram-Studio-{version}-x64.msi");

    let resp = supabase_client()?
        .post(format!("{SUPABASE_URL}/storage/v1/object/sales-assets/installers/{object_name}"))
        .header("apikey", &key)
        .header("Authorization", format!("Bearer {key}"))
        .header("Content-Type", "application/octet-stream")
        .header("x-upsert", "true") // допускает перезалив той же версии
        .body(bytes)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("Не удалось загрузить в Storage: {status} {}", resp.text().await.unwrap_or_default()));
    }

    sb_patch(
        "bot_config?id=eq.true",
        serde_json::json!({ "latest_installer_version": version }),
    )
    .await
}

#[tauri::command]
async fn get_published_installer_version() -> Result<Option<String>, String> {
    let rows = sb_get("bot_config?select=latest_installer_version&id=eq.true").await?;
    let row = rows.as_array().and_then(|a| a.first());
    Ok(row.and_then(|r| r["latest_installer_version"].as_str()).map(String::from))
}

// ── Настройки бота (public.bot_config, читает и Edge Function) ──────────

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BotConfig {
    stars_price: u32,
    rub_per_star: f64,
    admin_chat_id: String,
    support_contact: String,
}

#[tauri::command]
async fn get_config() -> Result<BotConfig, String> {
    let rows = sb_get("bot_config?select=stars_price,rub_per_star,admin_chat_id,support_contact&id=eq.true").await?;
    let row = rows.as_array().and_then(|a| a.first()).ok_or("bot_config пуст")?;
    Ok(BotConfig {
        stars_price: row["stars_price"].as_u64().unwrap_or(1100) as u32,
        rub_per_star: json_f64(&row["rub_per_star"]),
        admin_chat_id: row["admin_chat_id"].as_str().unwrap_or("").to_string(),
        support_contact: row["support_contact"].as_str().unwrap_or("").to_string(),
    })
}

#[tauri::command]
async fn set_config(config: BotConfig) -> Result<(), String> {
    sb_patch(
        "bot_config?id=eq.true",
        serde_json::json!({
            "stars_price": config.stars_price,
            "rub_per_star": config.rub_per_star,
            "admin_chat_id": config.admin_chat_id,
            "support_contact": config.support_contact,
        }),
    )
    .await
}

// ── Ручная генерация ключа (для поддержки/ручных случаев) ───────────────

#[tauri::command]
fn generate_test_key() -> Result<String, String> {
    let output = Command::new(KEYGEN_PATH)
        .arg("1")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// ── Баланс Stars бота (getMyStarBalance, Bot API 9.1+) ──────────────────
// Показывает реальный баланс на счету бота в Telegram — в отличие от суммы
// колонки stars в sales_ledger, это не локальный подсчёт, а то, что Telegram
// реально готов выплатить (учитывает возвраты и комиссию площадки).

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StarBalance {
    amount: i64,
    nanostar_amount: i64,
}

#[derive(Deserialize)]
struct TelegramApiResponse<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct StarAmount {
    amount: i64,
    #[serde(default)]
    nanostar_amount: i64,
}

#[tauri::command]
async fn get_star_balance() -> Result<StarBalance, String> {
    let token = fs::read_to_string(TOKEN_PATH)
        .map_err(|_| format!("Не найден {TOKEN_PATH} — создайте файл с токеном бота"))?
        .trim()
        .to_string();
    if token.is_empty() {
        return Err(format!("{TOKEN_PATH} пустой"));
    }

    let url = format!("https://api.telegram.org/bot{token}/getMyStarBalance");
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Не удалось связаться с Telegram: {e}"))?
        .json::<TelegramApiResponse<StarAmount>>()
        .await
        .map_err(|e| format!("Не удалось разобрать ответ Telegram: {e}"))?;

    if !resp.ok {
        return Err(resp.description.unwrap_or_else(|| "Telegram API вернул ошибку".to_string()));
    }
    let star_amount = resp.result.ok_or("Telegram не вернул баланс")?;
    Ok(StarBalance {
        amount: star_amount.amount,
        nanostar_amount: star_amount.nanostar_amount,
    })
}

// ── Рассылка о новой версии всем покупателям ────────────────────────────
// Список получателей — уникальные user_id из sales_ledger (та же колонка,
// что Edge Function использует для /mykey), не отдельная база подписчиков.
// Сама рассылка идёт отсюда, а не из Edge Function — панель уже независимо
// ходит в Bot API напрямую (см. get_star_balance), не нужно городить лишний
// вызов функции ради разовой ручной команды продавца.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BroadcastResult {
    total: usize,
    sent: usize,
    failed: usize,
    failed_user_ids: Vec<String>,
}

async fn unique_buyer_ids() -> Result<Vec<String>, String> {
    let rows = sb_get("sales_ledger?select=user_id").await?;
    let rows = rows.as_array().ok_or("Неожиданный ответ Supabase")?;
    let mut seen = std::collections::HashSet::new();
    let mut ids = vec![];
    for row in rows {
        if let Some(user_id) = row["user_id"].as_i64() {
            let id = user_id.to_string();
            if seen.insert(id.clone()) {
                ids.push(id);
            }
        }
    }
    Ok(ids)
}

#[tauri::command]
async fn get_buyer_count() -> Result<usize, String> {
    Ok(unique_buyer_ids().await?.len())
}

#[tauri::command]
async fn broadcast_update(message: String) -> Result<BroadcastResult, String> {
    let token = fs::read_to_string(TOKEN_PATH)
        .map_err(|_| format!("Не найден {TOKEN_PATH} — создайте файл с токеном бота"))?
        .trim()
        .to_string();
    if token.is_empty() {
        return Err(format!("{TOKEN_PATH} пустой"));
    }
    let message = message.trim();
    if message.is_empty() {
        return Err("Текст рассылки пустой".to_string());
    }

    let ids = unique_buyer_ids().await?;
    let client = reqwest::Client::new();
    let mut sent = 0usize;
    let mut failed_user_ids = vec![];

    for (i, user_id) in ids.iter().enumerate() {
        // Небольшая пауза между сообщениями — Telegram лимитирует примерно
        // 30 сообщений в секунду глобально для бота, для рассылки нет
        // смысла упираться в этот потолок.
        if i > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        // Telegram отвечает {"ok":false,...} на некоторые ошибки (например,
        // "Forbidden: bot was blocked by the user") при HTTP 200 — статус-код
        // один не показатель, нужно смотреть именно на поле "ok" в теле ответа.
        let ok = match client
            .post(format!("https://api.telegram.org/bot{token}/sendMessage"))
            .json(&serde_json::json!({
                "chat_id": user_id,
                "text": message,
                // Тот же callback_data "update", что кнопка в главном меню
                // bot.mjs — сразу присылает актуальный установщик по клику,
                // без необходимости печатать /update руками. Рассылка и так
                // идёт только покупателям, так что проверку в handleGetUpdate
                // это не нарушает.
                "reply_markup": { "inline_keyboard": [[{ "text": "📥 Скачать обновление", "callback_data": "update" }]] },
            }))
            .send()
            .await
        {
            Ok(r) => r
                .json::<TelegramApiResponse<serde_json::Value>>()
                .await
                .map(|body| body.ok)
                .unwrap_or(false),
            Err(_) => false,
        };
        if ok {
            sent += 1;
        } else {
            failed_user_ids.push(user_id.clone());
        }
    }

    Ok(BroadcastResult {
        total: ids.len(),
        sent,
        failed: failed_user_ids.len(),
        failed_user_ids,
    })
}

// ── Трей: всегда видимый индикатор статуса бота ─────────────────────────
// Раньше единственный способ узнать, жив ли бот, — открыть панель и
// посмотреть вкладку "Статус" (опрашивает раз в 5с, только пока панель
// открыта). Трей-иконка живёт постоянно, даже если окно панели закрыто —
// закрытие окна теперь сворачивает панель в трей вместо выхода (см.
// on_window_event ниже), а не убивает процесс.

const TRAY_ID: &str = "bot-status-tray";

/// (иконка, текст подсказки) для текущего статуса.
/// - функция недоступна или вебхук не указывает на неё → красная: бот
///   реально не может отвечать покупателям.
/// - функция доступна, вебхук в порядке, но у Telegram есть last_error →
///   жёлтая: были сбои доставки, стоит присмотреться (last_error не всегда
///   означает "сейчас сломано" — Telegram не чистит это поле само).
/// - иначе → зелёная: всё в порядке.
fn status_to_icon_text<'a>(
    status: &BotStatus,
    icons: &'a TrayIcons,
) -> (&'a Image<'static>, String) {
    if !status.function_reachable || status.webhook_url.is_none() {
        (&icons.red, "Бот не отвечает".to_string())
    } else if status.last_error_message.is_some() {
        (&icons.amber, "Были сбои доставки — проверьте панель".to_string())
    } else {
        (&icons.green, "Бот работает".to_string())
    }
}

struct TrayIcons {
    green: Image<'static>,
    amber: Image<'static>,
    red: Image<'static>,
}

fn load_tray_icons() -> TrayIcons {
    TrayIcons {
        green: Image::from_bytes(include_bytes!("../icons/tray/green.png")).expect("tray icon green.png"),
        amber: Image::from_bytes(include_bytes!("../icons/tray/amber.png")).expect("tray icon amber.png"),
        red: Image::from_bytes(include_bytes!("../icons/tray/red.png")).expect("tray icon red.png"),
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_bot_status,
            pause_bot,
            resume_bot,
            get_sales,
            get_log_tail,
            get_installers,
            upload_installer_to_storage,
            get_published_installer_version,
            get_config,
            set_config,
            generate_test_key,
            get_star_balance,
            get_buyer_count,
            broadcast_update,
        ])
        .setup(|app| {
            let icons = load_tray_icons();

            let show_i = MenuItem::with_id(app, "show", "Открыть панель", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(icons.red.clone())
                .tooltip("Проверяю статус бота…")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Фоновый поллинг статуса — работает независимо от того, открыта
            // ли панель, так что иконка в трее остаётся живым индикатором
            // всегда, а не только пока открыта вкладка "Статус". Раз в 60с,
            // не 5с — это теперь реальные сетевые запросы (к нашей функции и
            // к Bot API), не локальная проверка процесса, незачем дёргать чаще.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    if let Ok(status) = get_bot_status_inner().await {
                        if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                            let (icon, text) = status_to_icon_text(&status, &icons);
                            let _ = tray.set_icon(Some(icon.clone()));
                            let _ = tray.set_tooltip(Some(&text));
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Закрытие окна сворачивает панель в трей вместо завершения
            // процесса — иначе фоновый поллинг (и сама трей-иконка) умирали
            // бы вместе с окном, и статус снова был бы виден только пока
            // панель открыта, что и есть та проблема, ради которой всё это
            // затевалось. Выйти по-настоящему можно только через "Выход" в
            // меню трея.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
