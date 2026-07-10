use std::io::{self, Write};
use tstudio_core::license::{decode_signing_key_hex, generate_key, generate_signing_keypair, validate_key};

// Never inside the git repo — the private signing key must never be
// committed. Overridable via TSTUDIO_SIGNING_KEY for a different machine/path.
const DEFAULT_KEY_FILE: &str = "D:/tstudio-license-signing-key.txt";

fn load_signing_key() -> Option<[u8; 32]> {
    let hex_str = std::env::var("TSTUDIO_SIGNING_KEY")
        .ok()
        .or_else(|| std::fs::read_to_string(DEFAULT_KEY_FILE).ok())?;
    decode_signing_key_hex(&hex_str)
}

fn format_for_display(key: &str) -> String {
    key.as_bytes()
        .chunks(5)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect::<Vec<_>>()
        .join("-")
}

fn run_genkey() {
    let (seed_hex, vk_bytes) = generate_signing_keypair();
    println!("Новая пара ключей подписи сгенерирована.\n");
    println!("ПРИВАТНЫЙ КЛЮЧ (секрет, храните вне репозитория, без него нельзя выпускать новые лицензии):");
    println!("{seed_hex}\n");
    println!("ПУБЛИЧНЫЙ КЛЮЧ (вставить в PUBLIC_KEY_BYTES в src-tauri/core/src/license.rs):");
    print!("[");
    for (i, b) in vk_bytes.iter().enumerate() {
        if i > 0 { print!(", "); }
        print!("0x{b:02x}");
    }
    println!("]");
}

fn run_generate(n: usize) {
    let Some(seed) = load_signing_key() else {
        eprintln!("Не найден приватный ключ подписи.");
        eprintln!("Установите переменную окружения TSTUDIO_SIGNING_KEY (hex, 64 символа)");
        eprintln!("или положите его в файл {DEFAULT_KEY_FILE}");
        eprintln!("Чтобы сгенерировать новую пару ключей: keygen.exe genkey");
        std::process::exit(1);
    };
    for _ in 0..n {
        println!("{}", format_for_display(&generate_key(&seed)));
    }
}

fn run_validate(key: &str) {
    if validate_key(key) {
        println!("ДЕЙСТВИТЕЛЕН — ключ прошёл проверку подписи.");
    } else {
        println!("НЕДЕЙСТВИТЕЛЕН — не проходит проверку (не тот формат, чужая подпись или опечатка).");
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.get(1).map(String::as_str) == Some("genkey") {
        run_genkey();
        return;
    }

    if args.get(1).map(String::as_str) == Some("validate") {
        match args.get(2) {
            Some(key) => run_validate(key),
            None => eprintln!("Использование: keygen.exe validate <КЛЮЧ>"),
        }
        return;
    }

    // Если передан аргумент-число — тихий режим (только ключи, без интерактива)
    if let Some(n_str) = args.get(1) {
        if let Ok(n) = n_str.parse::<usize>() {
            run_generate(n);
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
                run_generate(n);
                println!();
            }
            Err(_) => println!("Введите целое число.\n"),
        }
    }

    println!("Готово. Нажмите Enter чтобы закрыть...");
    let mut _buf = String::new();
    io::stdin().read_line(&mut _buf).unwrap();
}
