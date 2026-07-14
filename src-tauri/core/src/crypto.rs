//! Field-level encryption for Telegram Bot tokens stored in SQLite.
//!
//! Format priority (strongest first):
//!   "DPAPI:<hex>"  — Windows DPAPI, bound to current user account (Windows only)
//!   "ENC:<hex>"    — AES-256-GCM with SHA-256(salt||machine-id) key (legacy / non-Windows)
//!   plain text     — very legacy, migrated on first read
//!
//! Existing ENC: tokens are automatically migrated to DPAPI: on Windows on first use.

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use sha2::{Digest, Sha256};

const APP_SALT: &[u8] = b"TelegramStudio-v1-token-key-salt";
const ENC_PREFIX: &str   = "ENC:";
const DPAPI_PREFIX: &str = "DPAPI:";

// ── Windows DPAPI ──────────────────────────────────────────────────────────────

#[cfg(windows)]
fn dpapi_protect(data: &[u8]) -> Result<Vec<u8>, String> {
    use winapi::um::dpapi::CryptProtectData;
    use winapi::um::wincrypt::DATA_BLOB;
    use winapi::um::winbase::LocalFree;
    use std::ptr;

    let mut input = DATA_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = DATA_BLOB { cbData: 0, pbData: ptr::null_mut() };

    let ok = unsafe {
        CryptProtectData(&mut input, ptr::null(), ptr::null_mut(), ptr::null_mut(), ptr::null_mut(), 0, &mut output)
    };
    if ok == 0 {
        return Err("CryptProtectData failed".to_string());
    }
    let result = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as *mut _); }
    Ok(result)
}

#[cfg(windows)]
fn dpapi_unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    use winapi::um::dpapi::CryptUnprotectData;
    use winapi::um::wincrypt::DATA_BLOB;
    use winapi::um::winbase::LocalFree;
    use std::ptr;

    let mut input = DATA_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = DATA_BLOB { cbData: 0, pbData: ptr::null_mut() };

    let ok = unsafe {
        CryptUnprotectData(&mut input, ptr::null_mut(), ptr::null_mut(), ptr::null_mut(), ptr::null_mut(), 0, &mut output)
    };
    if ok == 0 {
        return Err("CryptUnprotectData failed — token may be from a different user or machine".to_string());
    }
    let result = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as *mut _); }
    Ok(result)
}

// ── Legacy AES-256-GCM (non-Windows or DPAPI fallback) ────────────────────────

fn derive_legacy_key() -> Key<Aes256Gcm> {
    let machine_id = legacy_machine_id();
    let mut hasher = Sha256::new();
    hasher.update(APP_SALT);
    hasher.update(machine_id.as_bytes());
    let result = hasher.finalize();
    *Key::<Aes256Gcm>::from_slice(&result)
}

pub(crate) fn legacy_machine_id() -> String {
    #[cfg(windows)]
    {
        windows_machine_guid().unwrap_or_else(|| "fallback-windows-id".to_string())
    }
    #[cfg(not(windows))]
    {
        std::fs::read_to_string("/etc/machine-id")
            .or_else(|_| std::fs::read_to_string("/var/lib/dbus/machine-id"))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| "fallback-unix-id".to_string())
    }
}

#[cfg(windows)]
fn windows_machine_guid() -> Option<String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm.open_subkey(r"SOFTWARE\Microsoft\Cryptography").ok()?;
    key.get_value("MachineGuid").ok()
}

fn encrypt_legacy(plaintext: &str) -> Result<String, String> {
    let key = derive_legacy_key();
    let cipher = Aes256Gcm::new(&key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption error: {}", e))?;
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(format!("{}{}", ENC_PREFIX, hex::encode(combined)))
}

fn decrypt_legacy(stored: &str) -> Result<String, String> {
    let hex_data = &stored[ENC_PREFIX.len()..];
    let combined = hex::decode(hex_data).map_err(|e| format!("Hex decode: {}", e))?;
    if combined.len() < 12 {
        return Err("Invalid encrypted token: too short".to_string());
    }
    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let key = derive_legacy_key();
    let cipher = Aes256Gcm::new(&key);
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Token decryption failed — may be from a different machine".to_string())?;
    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 error: {}", e))
}

// ── Public API ─────────────────────────────────────────────────────────────────

/// Encrypt a token using the best available method:
/// - Windows: DPAPI (bound to current user account) with AES-GCM fallback
/// - Other: AES-256-GCM with machine-derived key
pub fn encrypt_token(plaintext: &str) -> Result<String, String> {
    #[cfg(windows)]
    match dpapi_protect(plaintext.as_bytes()) {
        Ok(protected) => return Ok(format!("{}{}", DPAPI_PREFIX, hex::encode(protected))),
        Err(e) => {
            eprintln!("[crypto] DPAPI unavailable ({}), using AES-GCM fallback", e);
        }
    }
    encrypt_legacy(plaintext)
}

/// Decrypt a token in any supported format.
pub fn decrypt_token(stored: &str) -> Result<String, String> {
    if stored.starts_with(DPAPI_PREFIX) {
        #[cfg(windows)]
        {
            let hex_data = &stored[DPAPI_PREFIX.len()..];
            let data = hex::decode(hex_data).map_err(|e| format!("Hex decode: {}", e))?;
            let plain = dpapi_unprotect(&data)?;
            return String::from_utf8(plain).map_err(|e| format!("UTF-8: {}", e));
        }
        #[cfg(not(windows))]
        return Err("DPAPI tokens are only supported on Windows".to_string());
    }
    if stored.starts_with(ENC_PREFIX) {
        return decrypt_legacy(stored);
    }
    // Plain-text (very legacy) — return as-is
    Ok(stored.to_string())
}

/// True if the stored token should be re-encrypted with the current preferred format.
pub fn needs_migration(stored: &str) -> bool {
    #[cfg(windows)]
    { !stored.starts_with(DPAPI_PREFIX) }
    #[cfg(not(windows))]
    { !stored.starts_with(ENC_PREFIX) }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "123456789:AAeXampleBotTokenABCDEFghijklmnopqrstuv";

    #[test]
    fn encrypt_then_decrypt_roundtrips() {
        let enc = encrypt_token(SAMPLE).expect("encrypt");
        assert_ne!(enc, SAMPLE, "ciphertext must not equal plaintext");
        let dec = decrypt_token(&enc).expect("decrypt");
        assert_eq!(dec, SAMPLE);
    }

    #[test]
    fn encrypt_uses_a_known_prefix() {
        let enc = encrypt_token(SAMPLE).expect("encrypt");
        assert!(
            enc.starts_with(DPAPI_PREFIX) || enc.starts_with(ENC_PREFIX),
            "unexpected format: {enc}"
        );
    }

    #[test]
    fn legacy_aes_roundtrips_on_all_platforms() {
        // encrypt_legacy/decrypt_legacy are exercised directly so the AES path
        // is covered even on Windows (where encrypt_token prefers DPAPI).
        let enc = encrypt_legacy(SAMPLE).expect("encrypt_legacy");
        assert!(enc.starts_with(ENC_PREFIX));
        let dec = decrypt_legacy(&enc).expect("decrypt_legacy");
        assert_eq!(dec, SAMPLE);
    }

    #[test]
    fn two_encryptions_differ_due_to_random_nonce() {
        let a = encrypt_legacy(SAMPLE).unwrap();
        let b = encrypt_legacy(SAMPLE).unwrap();
        assert_ne!(a, b, "nonce reuse — encryptions should differ");
    }

    #[test]
    fn plain_text_passes_through_on_decrypt() {
        assert_eq!(decrypt_token("plain-legacy-token").unwrap(), "plain-legacy-token");
    }

    #[test]
    fn too_short_ciphertext_is_rejected() {
        // "ENC:" + a few hex bytes (< 12-byte nonce) must not panic
        let bad = format!("{}{}", ENC_PREFIX, hex::encode([1u8, 2, 3]));
        assert!(decrypt_legacy(&bad).is_err());
    }

    #[test]
    fn tampered_ciphertext_fails_authentication() {
        let mut enc = encrypt_legacy(SAMPLE).unwrap();
        // Flip the last hex nibble to corrupt the GCM tag
        let last = enc.pop().unwrap();
        enc.push(if last == 'a' { 'b' } else { 'a' });
        assert!(decrypt_legacy(&enc).is_err());
    }

    #[test]
    fn invalid_hex_is_rejected_not_panicked() {
        let bad = format!("{}not-hex!!", ENC_PREFIX);
        assert!(decrypt_legacy(&bad).is_err());
    }

    #[test]
    fn empty_token_roundtrips() {
        let enc = encrypt_legacy("").unwrap();
        assert_eq!(decrypt_legacy(&enc).unwrap(), "");
    }

    #[test]
    fn needs_migration_flags_plain_text() {
        assert!(needs_migration("plain-token"));
    }

    #[cfg(not(windows))]
    #[test]
    fn enc_prefixed_does_not_need_migration_on_unix() {
        let enc = encrypt_legacy(SAMPLE).unwrap();
        assert!(!needs_migration(&enc));
    }

    #[cfg(windows)]
    #[test]
    fn enc_prefixed_needs_migration_to_dpapi_on_windows() {
        let enc = encrypt_legacy(SAMPLE).unwrap();
        assert!(needs_migration(&enc), "ENC tokens should migrate to DPAPI on Windows");
    }
}
