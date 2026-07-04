use std::io::{self, Write};
// Checksum logic is shared with the validator so keys always round-trip.
use tstudio_core::license::{encode_check, fnv1a};

const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

fn random_group() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // Простой LCG-генератор на основе времени + адреса стека
    static mut STATE: u64 = 0;
    unsafe {
        if STATE == 0 {
            STATE = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .subsec_nanos() as u64;
            STATE ^= &STATE as *const _ as u64;
        }
        let mut s = String::new();
        for _ in 0..5 {
            STATE = STATE.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let idx = ((STATE >> 33) as usize) % CHARSET.len();
            s.push(CHARSET[idx] as char);
        }
        s
    }
}

fn generate_key() -> String {
    let g1 = random_group();
    let g2 = random_group();
    let g3 = encode_check(fnv1a(&format!("{}{}", g1, g2)));
    format!("TELEGA-{}-{}-{}", g1, g2, g3)
}

fn main() {
    // Если передан аргумент — тихий режим (только ключи, без интерактива)
    let args: Vec<String> = std::env::args().collect();
    if let Some(n_str) = args.get(1) {
        if let Ok(n) = n_str.parse::<usize>() {
            for _ in 0..n {
                println!("{}", generate_key());
            }
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
                for i in 1..=n {
                    println!("  {:>4}. {}", i, generate_key());
                }
                println!();
            }
            Err(_) => println!("Введите целое число.\n"),
        }
    }

    println!("Готово. Нажмите Enter чтобы закрыть...");
    let mut _buf = String::new();
    io::stdin().read_line(&mut _buf).unwrap();
}
