// Панель управления продающим ботом Telegram Studio (sales-bot/bot.mjs).
// Отдельный инструмент только для продавца — не часть основного продукта.
// Все пути ниже должны совпадать с константами в sales-bot/bot.mjs.

use serde::{Deserialize, Serialize};
use std::fs;
use std::os::windows::process::CommandExt;
use std::process::Command;
use sysinfo::{ProcessesToUpdate, System};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

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

// Plain function (not a #[tauri::command]) so both the frontend-facing
// command below AND the background tray poller can call the exact same
// check — a second copy would inevitably drift (see the $PID self-match bug
// already documented in stop_bot below, which only got caught in one of the
// two places it originally existed).
//
// Native process enumeration (sysinfo) instead of spawning `powershell.exe`
// to run a WMI query — the old approach polled every 5s (see the tray loop
// below) and got noticeably slower on a freshly installed Windows: fresh
// Defender/AMSI re-scanning every new powershell.exe launch, plus a cold
// WMI repository, made "data takes a while to update" the visible symptom.
// This has no process-spawn and no WMI involved at all.
fn get_bot_status_inner() -> Result<BotStatus, String> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let self_pid = std::process::id();
    let mut bot_pid: Option<u32> = None;
    let mut bot_since: Option<String> = None;
    let mut supervisor_running = false;

    for (pid, process) in sys.processes() {
        let name = process.name().to_string_lossy();
        let is_node = name.eq_ignore_ascii_case("node.exe");
        let is_powershell = name.eq_ignore_ascii_case("powershell.exe");
        if !is_node && !is_powershell {
            continue;
        }

        let cmd_line = process
            .cmd()
            .iter()
            .map(|s| s.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(" ");

        if is_node && cmd_line.contains("bot.mjs") {
            bot_pid = Some(pid.as_u32());
            bot_since = chrono::DateTime::from_timestamp(process.start_time() as i64, 0)
                .map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string());
        } else if is_powershell && pid.as_u32() != self_pid && cmd_line.contains("run-forever") {
            supervisor_running = true;
        }
    }

    Ok(BotStatus {
        running: bot_pid.is_some(),
        supervisor_running,
        pid: bot_pid,
        since: bot_since,
    })
}

#[tauri::command]
fn get_bot_status() -> Result<BotStatus, String> {
    get_bot_status_inner()
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

// ── Рассылка о новой версии всем покупателям ────────────────────────────
// Список получателей — уникальные user_id из LEDGER_PATH (та же колонка,
// что /mykey в bot.mjs использует для поиска ключей по покупателю), не
// отдельная база подписчиков. Сама рассылка идёт отсюда, а не из bot.mjs —
// панель уже независимо ходит в Bot API напрямую (см. get_star_balance),
// не нужно городить IPC с отдельным процессом бота ради разовой ручной
// команды продавца.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BroadcastResult {
    total: usize,
    sent: usize,
    failed: usize,
    failed_user_ids: Vec<String>,
}

fn unique_buyer_ids() -> Result<Vec<String>, String> {
    if !std::path::Path::new(LEDGER_PATH).exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(LEDGER_PATH).map_err(|e| e.to_string())?;
    let mut seen = std::collections::HashSet::new();
    let mut ids = vec![];
    for line in content.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        if let Some(user_id) = line.split(',').nth(1) {
            if !user_id.is_empty() && seen.insert(user_id.to_string()) {
                ids.push(user_id.to_string());
            }
        }
    }
    Ok(ids)
}

#[tauri::command]
fn get_buyer_count() -> Result<usize, String> {
    Ok(unique_buyer_ids()?.len())
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

    let ids = unique_buyer_ids()?;
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
/// - running=true → зелёная: всё в порядке.
/// - running=false, supervisorRunning=true → жёлтая: супервизор жив, но бот
///   между перезапусками (например, застрял в цикле падений) — переходное
///   состояние, не обязательно повод для тревоги, но стоит присмотреться.
/// - оба false → красная: бот полностью остановлен.
fn status_to_icon_text<'a>(
    status: &BotStatus,
    icons: &'a TrayIcons,
) -> (&'a Image<'static>, String) {
    if status.running {
        (&icons.green, "Бот работает".to_string())
    } else if status.supervisor_running {
        (&icons.amber, "Бот перезапускается…".to_string())
    } else {
        (&icons.red, "Бот остановлен".to_string())
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
            get_buyer_count,
            broadcast_update,
        ])
        .setup(|app| {
            let icons = load_tray_icons();

            let show_i = MenuItem::with_id(app, "show", "Открыть панель", true, None::<&str>)?;
            let start_i = MenuItem::with_id(app, "start", "Запустить бота", true, None::<&str>)?;
            let stop_i = MenuItem::with_id(app, "stop", "Остановить бота", true, None::<&str>)?;
            let restart_i = MenuItem::with_id(app, "restart", "Перезапустить бота", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &start_i, &stop_i, &restart_i, &quit_i])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(icons.red.clone())
                .tooltip("Проверяю статус бота…")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "start" => { let _ = start_bot(); }
                    "stop" => { let _ = stop_bot(); }
                    "restart" => { let _ = restart_bot(); }
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
            // всегда, а не только пока открыта вкладка "Статус".
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    if let Ok(status) = get_bot_status_inner() {
                        if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                            let (icon, text) = status_to_icon_text(&status, &icons);
                            let _ = tray.set_icon(Some(icon.clone()));
                            let _ = tray.set_tooltip(Some(&text));
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
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
