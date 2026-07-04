//! Pure, dependency-light core logic for TElega Studio.
//!
//! This crate deliberately has **no Tauri / webview dependencies** so its unit
//! tests build and run in seconds (and in CI) without the Windows WebView2
//! linking issues that plague `cargo test` on the main app crate.

pub mod backup_retention;
pub mod crypto;
pub mod license;
pub mod retry;
