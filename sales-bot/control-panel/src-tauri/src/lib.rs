// Панель управления продающим ботом Telegram Studio (sales-bot/bot.mjs).
// Отдельный инструмент только для продавца — не часть основного продукта.
// Все пути ниже должны совпадать с константами в sales-bot/bot.mjs.

use serde::{Deserialize, Serialize};
use std::fs;
use std::os::windows::process::CommandExt;
use std::process::Command;

const RUN_FOREVER_SCRIPT: &str = "D:/TElega POST/sales-bot/run-forever.ps1";
const CONFIG_PATH: &str = "D:/TElega POST/sales-bot/config.json";
const LEDGER_PATH: &str = "D:/tstudio-sales-ledger.csv";
const LOG_PATH: &str = "D:/tstudio-sales-bot.log";
const RELEASE_DIR: &str = "D:/Релиз";
const KEYGEN_PATH: &str = "D:/cargo-tgt/release/keygen.exe";
const TOKEN_PATH: &str = "D:/TElega POST/sales-bot/token.txt";

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

// ── Статус / управление процессом ───────────────────────────────────────

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BotStatus {
    running: bool,
    supervisor_running: bool,
    pid: Option<u32>,
    since: Option<String>,
}

#[tauri::command]
fn get_bot_status() -> Result<BotStatus, String> {
    let script = r#"
$bot = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*bot.mjs*' } | Select-Object ProcessId, CreationDate)
$sup = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*run-forever*' })
$pidVal = if ($bot.Count -gt 0) { $bot[0].ProcessId } else { $null }
$sinceVal = if ($bot.Count -gt 0) { $bot[0].CreationDate.ToString("yyyy-MM-ddTHH:mm:ss") } else { $null }
[PSCustomObject]@{
  running = ($bot.Count -gt 0)
  supervisorRunning = ($sup.Count -gt 0)
  pid = $pidVal
  since = $sinceVal
} | ConvertTo-Json -Compress
"#;
    let out = run_powershell(script)?;
    serde_json::from_str(&out).map_err(|e| format!("Не удалось разобрать статус: {e} ({out})"))
}

#[tauri::command]
fn start_bot() -> Result<(), String> {
    // stdin/stdout/stderr явно на null: без этого дочерний процесс
    // наследует хендлы ВОТ ЭТОГО (панели) процесса — в dev-режиме это
    // безобидно засоряет лог `tauri dev`, но в общем случае, если панель
    // закроется, пока бот пишет в унаследованный хендл, это может уронить
    // бота ошибкой записи. Бот и так пишет всё нужное в свой файл-лог.
    Command::new("powershell")
        .args(["-NoProfile", "-File", RUN_FOREVER_SCRIPT])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn stop_bot() -> Result<(), String> {
    // Останавливаем и supervisor (run-forever.ps1), и сам node-процесс —
    // иначе supervisor просто перезапустит бота через несколько секунд.
    //
    // $_.ProcessId -ne $PID — критично: этот скрипт сам выполняется в
    // powershell.exe, и его СОБСТВЕННАЯ командная строка (переданная через
    // -Command) содержит текст "run-forever" как часть текста фильтра —
    // без исключения $PID процесс находит сам себя и убивает себя же,
    // прежде чем успевает остановить настоящий supervisor. Из-за этого
    // stop_bot падал с ошибкой, а restart_bot никогда не доходил до
    // повторного запуска бота — бот оставался выключенным.
    let script = r#"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*bot.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*run-forever*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
"#;
    run_powershell(script)?;
    Ok(())
}

#[tauri::command]
fn restart_bot() -> Result<(), String> {
    stop_bot()?;
    std::thread::sleep(std::time::Duration::from_millis(1500));
    start_bot()?;
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
fn get_sales() -> Result<Vec<SaleRow>, String> {
    if !std::path::Path::new(LEDGER_PATH).exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(LEDGER_PATH).map_err(|e| e.to_string())?;
    let mut rows: Vec<SaleRow> = content
        .lines()
        .skip(1) // header
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let cols: Vec<&str> = line.split(',').collect();
            SaleRow {
                timestamp: cols.first().copied().unwrap_or("").to_string(),
                user_id: cols.get(1).copied().unwrap_or("").to_string(),
                username: cols.get(2).copied().unwrap_or("").to_string(),
                first_name: cols.get(3).copied().unwrap_or("").to_string(),
                stars: cols.get(4).copied().unwrap_or("").to_string(),
                key: cols.get(5).copied().unwrap_or("").to_string(),
                charge_id: cols.get(6).copied().unwrap_or("").to_string(),
            }
        })
        .collect();
    rows.reverse(); // новые сверху
    Ok(rows)
}

// ── Логи ─────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_log_tail(lines: usize) -> Result<Vec<String>, String> {
    if !std::path::Path::new(LOG_PATH).exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(LOG_PATH).map_err(|e| e.to_string())?;
    let all: Vec<&str> = content.lines().collect();
    let start = all.len().saturating_sub(lines);
    Ok(all[start..].iter().rev().map(|s| s.to_string()).collect())
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
$re = '^Telegram Studio_(\d+)\.(\d+)\.(\d+)_x64_en-US\.msi$'
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

// ── Настройки бота (config.json, читает и bot.mjs) ──────────────────────

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BotConfig {
    stars_price: u32,
    rub_per_star: f64,
    admin_chat_id: String,
    support_contact: String,
}

fn default_config() -> BotConfig {
    BotConfig {
        stars_price: 1500,
        rub_per_star: 2.0,
        admin_chat_id: "984199643".to_string(),
        support_contact: "продавцу".to_string(),
    }
}

#[tauri::command]
fn get_config() -> Result<BotConfig, String> {
    if !std::path::Path::new(CONFIG_PATH).exists() {
        return Ok(default_config());
    }
    let content = fs::read_to_string(CONFIG_PATH).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_config(config: BotConfig) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(CONFIG_PATH, json + "\n").map_err(|e| e.to_string())
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
// колонки stars в LEDGER_PATH, это не локальный подсчёт, а то, что Telegram
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_bot_status,
            start_bot,
            stop_bot,
            restart_bot,
            get_sales,
            get_log_tail,
            get_installers,
            get_config,
            set_config,
            generate_test_key,
            get_star_balance,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
