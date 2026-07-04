//! Field-level encryption for Telegram Bot tokens.
//!
//! The implementation lives in the dependency-light `tstudio-core` crate so it
//! can be unit-tested without Tauri/WebView2 linkage. This module re-exports it
//! to preserve existing `crate::crypto::*` call sites.

pub use tstudio_core::crypto::{decrypt_token, encrypt_token, needs_migration};
