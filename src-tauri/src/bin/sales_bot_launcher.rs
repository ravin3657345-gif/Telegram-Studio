// Понятный запускатор продающего бота для не-программиста: читает токен из
// token.txt рядом с собой и запускает sales-bot/bot.mjs через node, показывая
// его логи прямо в этом же окне консоли.

use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::Command;

const PLACEHOLDER: &str = "ВСТАВЬТЕ_СЮДА_ТОКЕН_ОТ_BOTFATHER";

fn pause() {
    println!("\nНажмите Enter, чтобы закрыть...");
    io::stdout().flush().ok();
    let mut buf = String::new();
    let _ = io::stdin().read_line(&mut buf);
}

fn main() {
    println!("╔══════════════════════════════════════════╗");
    println!("║   Telegram Studio — Продающий бот         ║");
    println!("╚══════════════════════════════════════════╝\n");

    let exe_dir = env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    let token_path = exe_dir.join("token.txt");
    let bot_path = exe_dir.join("bot.mjs");

    let token = match fs::read_to_string(&token_path) {
        Ok(s) => s.trim().to_string(),
        Err(_) => {
            eprintln!("Не найден файл token.txt рядом с этим exe ({}).", token_path.display());
            eprintln!("Создайте его и вставьте туда токен, который выдал @BotFather.");
            pause();
            return;
        }
    };

    if token.is_empty() || token == PLACEHOLDER {
        eprintln!("Откройте файл token.txt рядом с этим exe и вставьте туда токен от @BotFather");
        eprintln!("(вместо текущего содержимого) — одной строкой, без кавычек.");
        pause();
        return;
    }

    if !bot_path.exists() {
        eprintln!("Не найден bot.mjs рядом с этим exe: {}", bot_path.display());
        pause();
        return;
    }

    println!("Запускаю бота... Чтобы остановить — закройте это окно (или Ctrl+C).\n");

    let status = Command::new("node")
        .arg(&bot_path)
        .env("SALES_BOT_TOKEN", token)
        .status();

    match status {
        Ok(s) if !s.success() => {
            eprintln!("\nБот завершился с ошибкой (код {:?}).", s.code());
        }
        Ok(_) => {}
        Err(e) => {
            eprintln!("\nНе удалось запустить node: {e}");
            eprintln!("Убедитесь, что Node.js установлен (node.org) и доступен в PATH.");
        }
    }
    pause();
}
