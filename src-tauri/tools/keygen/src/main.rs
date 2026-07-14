use std::io::{self, Write};
use tstudio_core::license::{generate_key, SUPABASE_ANON_KEY, SUPABASE_URL};

// Full-access Supabase secret (service_role), never inside the git repo and
// never shipped in the app — same "outside the repo" pattern as the old
// Ed25519 signing key file. It bypasses RLS entirely, which is exactly why
// only this offline tool (run on the seller's own machine) ever holds it.
// Grab it from the Supabase dashboard → Project Settings → API → service_role
// secret, and save it to this file (or set TSTUDIO_SUPABASE_SERVICE_KEY).
const DEFAULT_SERVICE_KEY_FILE: &str = "D:/tstudio-supabase-service-key.txt";

fn load_service_key() -> Option<String> {
    std::env::var("TSTUDIO_SUPABASE_SERVICE_KEY")
        .ok()
        .or_else(|| std::fs::read_to_string(DEFAULT_SERVICE_KEY_FILE).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn format_for_display(key: &str) -> String {
    key.as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect::<Vec<_>>()
        .join("-")
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("failed to build HTTP client")
}

/// Registers a freshly generated key with Supabase — a plain INSERT via the
/// PostgREST table endpoint, authenticated with the service_role secret
/// (bypasses RLS, unlike the anon key the shipped app uses).
async fn register_key(service_key: &str, key: &str, buyer_telegram_id: Option<i64>) -> Result<(), String> {
    let resp = http_client()
        .post(format!("{SUPABASE_URL}/rest/v1/licenses"))
        .header("apikey", service_key)
        .header("Authorization", format!("Bearer {service_key}"))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "key": key, "buyer_telegram_id": buyer_telegram_id }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Supabase вернул {status}: {text}"));
    }
    Ok(())
}

/// Read-only status lookup — does NOT redeem the key (unlike the app's
/// `redeem_license`, which would burn it against whatever machine calls it).
async fn check_status(key: &str) -> Result<String, String> {
    let resp = http_client()
        .post(format!("{SUPABASE_URL}/rest/v1/rpc/check_license_status"))
        .header("apikey", SUPABASE_ANON_KEY)
        .header("Authorization", format!("Bearer {SUPABASE_ANON_KEY}"))
        .json(&serde_json::json!({ "p_key": key }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Supabase вернул {}", resp.status()));
    }
    resp.json::<String>().await.map_err(|e| e.to_string())
}

async fn run_sell(telegram_id: i64) {
    let Some(service_key) = load_service_key() else {
        eprintln!("Не найден service_role ключ Supabase.");
        eprintln!("Установите TSTUDIO_SUPABASE_SERVICE_KEY или положите его в файл {DEFAULT_SERVICE_KEY_FILE}");
        eprintln!("(Supabase Dashboard → Project Settings → API → service_role secret)");
        std::process::exit(1);
    };
    let key = generate_key();
    if let Err(e) = register_key(&service_key, &key, Some(telegram_id)).await {
        eprintln!("Не удалось зарегистрировать ключ в Supabase: {e}");
        std::process::exit(1);
    }
    // Only the formatted key on stdout — sales-bot captures this verbatim.
    println!("{}", format_for_display(&key));
}

async fn run_generate(n: usize) {
    let Some(service_key) = load_service_key() else {
        eprintln!("Не найден service_role ключ Supabase.");
        eprintln!("Установите TSTUDIO_SUPABASE_SERVICE_KEY или положите его в файл {DEFAULT_SERVICE_KEY_FILE}");
        eprintln!("(Supabase Dashboard → Project Settings → API → service_role secret)");
        std::process::exit(1);
    };
    for _ in 0..n {
        let key = generate_key();
        match register_key(&service_key, &key, None).await {
            Ok(()) => println!("{}", format_for_display(&key)),
            Err(e) => eprintln!("Ошибка регистрации ключа в Supabase: {e}"),
        }
    }
}

async fn run_validate(key: &str) {
    match check_status(key).await {
        Ok(status) => match status.as_str() {
            "unredeemed" => println!("ДЕЙСТВИТЕЛЕН — ещё не активирован ни на одном устройстве."),
            "redeemed" => println!("УЖЕ ИСПОЛЬЗОВАН — ключ активирован на каком-то устройстве."),
            "not_found" => println!("НЕ НАЙДЕН — такого ключа нет в базе."),
            other => println!("Неизвестный статус от сервера: {other}"),
        },
        Err(e) => eprintln!("Не удалось проверить ключ: {e}"),
    }
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.get(1).map(String::as_str) == Some("validate") {
        match args.get(2) {
            Some(key) => run_validate(key).await,
            None => eprintln!("Использование: keygen.exe validate <КЛЮЧ>"),
        }
        return;
    }

    if args.get(1).map(String::as_str) == Some("sell") {
        match args.get(2).and_then(|s| s.parse::<i64>().ok()) {
            Some(telegram_id) => run_sell(telegram_id).await,
            None => eprintln!("Использование: keygen.exe sell <TELEGRAM_ID>"),
        }
        return;
    }

    // Если передан аргумент-число — тихий режим (только ключи, без интерактива)
    if let Some(n_str) = args.get(1) {
        if let Ok(n) = n_str.parse::<usize>() {
            run_generate(n).await;
            return;
        }
    }

    // Интерактивный режим — для двойного клика
    println!("╔══════════════════════════════════════╗");
    println!("║   Telegram Studio — Генератор ключей ║");
    println!("╚══════════════════════════════════════╝");
    println!();

    loop {
        print!("Сколько ключей сгенерировать? (Enter для выхода): ");
        io::stdout().flush().unwrap();

        let mut input = String::new();
        io::stdin().read_line(&mut input).unwrap();
        let trimmed = input.trim();

        if trimmed.is_empty() { break; }

        match trimmed.parse::<usize>() {
            Ok(0) => println!("Введите число больше 0.\n"),
            Ok(n) => {
                println!();
                run_generate(n).await;
                println!();
            }
            Err(_) => println!("Введите целое число.\n"),
        }
    }

    println!("Готово. Нажмите Enter чтобы закрыть...");
    let mut _buf = String::new();
    io::stdin().read_line(&mut _buf).unwrap();
}
