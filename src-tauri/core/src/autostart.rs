//! Autostart ("запускать при входе в систему").
//!
//! Scheduled posts only leave the queue while the app is running, so the
//! scheduler has to be alive for the promise "уйдёт в 9:00" to hold. Closing
//! the window already keeps the process — and therefore the scheduler —
//! running in the tray (`on_window_event` in the app's `lib.rs`), but a reboot
//! or a real exit does not. Registering the app in the per-user Run key closes
//! that gap: Windows starts it hidden in the tray on login, the scheduler
//! resumes, and anything that became due while the machine was off goes out.
//!
//! Lives in `tstudio-core` because `winreg` is already a dependency here (see
//! `crypto.rs`) — the app crate would otherwise need one added, and the value
//! we write is pure string formatting that deserves a test.
//!
//! The registry is the source of truth: there is no mirrored flag in SQLite to
//! drift out of sync with it.

/// Flag the Run entry passes so the app starts hidden in the tray instead of
/// opening a window at every login. Read back in the app's setup.
pub const BACKGROUND_FLAG: &str = "--background";

/// Value name inside `HKCU\...\Run`.
#[cfg(windows)]
const VALUE_NAME: &str = "Telegram Studio";

/// The command line Windows will run at login, as it must appear in the Run
/// value: the quoted executable path (the install directory contains spaces)
/// followed by the background flag.
pub fn run_value(exe_path: &str) -> String {
    format!("\"{exe_path}\" {BACKGROUND_FLAG}")
}

/// True when the app is registered to start with Windows.
#[cfg(windows)]
pub fn is_enabled() -> Result<bool, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    // A missing Run key (or a missing value inside it) is a normal "off", not
    // an error worth surfacing.
    let Ok(run) = hkcu.open_subkey_with_flags(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
        winreg::enums::KEY_READ,
    ) else {
        return Ok(false);
    };
    Ok(run.get_value::<String, _>(VALUE_NAME).is_ok())
}

/// Turns startup-with-Windows on or off, returning the state actually in
/// effect so the UI can never show a toggle position the registry disagrees
/// with.
#[cfg(windows)]
pub fn set_enabled(enabled: bool) -> Result<bool, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hkcu
        .create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
        .map_err(|e| format!("Не удалось открыть раздел автозапуска: {e}"))?;

    if enabled {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let value = run_value(&exe.to_string_lossy());
        run.set_value(VALUE_NAME, &value)
            .map_err(|e| format!("Не удалось включить автозапуск: {e}"))?;
    } else {
        // Removing an entry that isn't there is a no-op, not a failure.
        match run.delete_value(VALUE_NAME) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Не удалось выключить автозапуск: {e}")),
        }
    }

    is_enabled()
}

#[cfg(not(windows))]
pub fn is_enabled() -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(windows))]
pub fn set_enabled(_enabled: bool) -> Result<bool, String> {
    Err("Автозапуск доступен только на Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_the_path_and_appends_the_background_flag() {
        // Windows parses the Run value as a command line, so the space in the
        // install directory would otherwise split the executable name in two.
        assert_eq!(
            run_value(r"C:\Program Files\Telegram Studio\Telegram Studio.exe"),
            "\"C:\\Program Files\\Telegram Studio\\Telegram Studio.exe\" --background"
        );
    }

    #[test]
    fn never_writes_a_bare_unquoted_path() {
        let value = run_value(r"D:\TElega POST\Telegram Studio.exe");
        assert!(value.starts_with('"') && value.contains("\" --background"));
    }

    #[test]
    fn the_flag_is_the_one_the_app_reads_back() {
        assert!(run_value("app.exe").ends_with(BACKGROUND_FLAG));
    }
}
