//! Autostart commands.
//!
//! The logic lives in `tstudio-core` (`core/src/autostart.rs`): `winreg` is
//! already a dependency there and the Run value is pure formatting that
//! deserves a unit test. These are just the IPC wrappers.

/// True when the app is registered to start with Windows.
#[tauri::command]
pub async fn get_autostart_enabled() -> Result<bool, String> {
    tstudio_core::autostart::is_enabled()
}

/// Turns startup-with-Windows on or off. Returns the state actually in effect.
#[tauri::command]
pub async fn set_autostart(enabled: bool) -> Result<bool, String> {
    tstudio_core::autostart::set_enabled(enabled)
}
