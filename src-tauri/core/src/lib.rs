//! Pure, dependency-light core logic for Telegram Studio.
//!
//! This crate deliberately has **no Tauri / webview dependencies** so its unit
//! tests build and run in seconds (and in CI) without the Windows WebView2
//! linking issues that plague `cargo test` on the main app crate.

pub mod autostart;
pub mod backup_retention;
pub mod crypto;
pub mod license;
pub mod recurrence;
pub mod retry;
pub mod rich_html;
