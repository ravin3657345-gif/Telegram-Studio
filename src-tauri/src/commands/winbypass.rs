// Thin, always-compiling wrapper around telegram::winbypass — the real
// logic is Windows-only (WinDivert), but this command still needs to exist
// on every target (Android included) since tauri::generate_handler!'s
// entry list isn't itself conditionally compiled per-platform.

const BYPASS_HOSTS: [&str; 2] = ["api.telegram.org:443", "xhjxnyhvfyzyulzzxpsg.supabase.co:443"];

#[tauri::command]
pub async fn enable_windows_bypass() -> Result<(), String> {
    #[cfg(windows)]
    {
        crate::telegram::winbypass::spawn_elevated_helper(&BYPASS_HOSTS)
    }
    #[cfg(not(windows))]
    {
        Err("Доступно только на Windows".to_string())
    }
}

#[tauri::command]
pub async fn windows_bypass_status() -> bool {
    #[cfg(windows)]
    {
        crate::telegram::winbypass::is_running()
    }
    #[cfg(not(windows))]
    {
        false
    }
}
