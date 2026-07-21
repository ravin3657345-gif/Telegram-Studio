#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Hidden entrypoint for the elevated WinDivert helper process (see
    // telegram::winbypass) — re-invokes this same executable with
    // `--winbypass-helper <parent_pid> <host1,host2,...>` via a UAC
    // prompt, so only this narrow helper runs elevated, never the whole
    // GUI. Checked before any Tauri/GUI initialization: this path never
    // shows a window.
    #[cfg(windows)]
    {
        let args: Vec<String> = std::env::args().collect();
        if args.get(1).map(String::as_str) == Some("--winbypass-helper") {
            let parent_pid: u32 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
            let hosts: Vec<String> = args
                .get(3)
                .map(|s| s.split(',').map(String::from).collect())
                .unwrap_or_default();
            if let Err(e) = telegram_studio_lib::telegram::winbypass::run_as_helper(parent_pid, &hosts) {
                eprintln!("[winbypass-helper] {e}");
                std::process::exit(1);
            }
            return;
        }
    }

    telegram_studio_lib::run();
}
