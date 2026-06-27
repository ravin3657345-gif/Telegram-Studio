/// Field-level encryption for Telegram Bot tokens stored in SQLite.
///
/// Key derivation: SHA-256(APP_SALT || machine_id)
/// Encryption:     AES-256-GCM with a random 12-byte nonce
/// Storage format: "ENC:" + hex(nonce || ciphertext)
///
/// Provides protection against casual database copying.
/// Does NOT protect against an attacker with full OS access (who can run the
/// app themselves and call get_bots). For that, OS keychain integration is needed.

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use sha2::{Digest, Sha256};

const APP_SALT: &[u8] = b"TelegramStudio-v1-token-key-salt";
const ENC_PREFIX: &str = "ENC:";

// ── Key derivation ─────────────────────────────────────────────────────────────

fn derive_key() -> Key<Aes256Gcm> {
    let machine_id = machine_identifier();
    let mut hasher = Sha256::new();
    hasher.update(APP_SALT);
    hasher.update(machine_id.as_bytes());
    let result = hasher.finalize();
    *Key::<Aes256Gcm>::from_slice(&result)
}

/// Platform-specific machine identifier used to bind the key to this device.
fn machine_identifier() -> String {
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
    // Read HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid
    use std::process::Command;
    let output = Command::new("reg")
        .args(["query", r"HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Output: "    MachineGuid    REG_SZ    {guid}"
    for line in stdout.lines() {
        if line.contains("MachineGuid") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(guid) = parts.last() {
                return Some(guid.to_string());
            }
        }
    }
    None
}

// ── Public API ─────────────────────────────────────────────────────────────────

/// Encrypt a token. Returns "ENC:" + hex(nonce || ciphertext).
pub fn encrypt_token(plaintext: &str) -> Result<String, String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new(&key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption error: {}", e))?;

    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(format!("{}{}", ENC_PREFIX, hex::encode(combined)))
}

/// Decrypt a token. If the value doesn't start with "ENC:" it's returned as-is
/// (backwards compatibility for tokens stored before encryption was added).
pub fn decrypt_token(stored: &str) -> Result<String, String> {
    if !stored.starts_with(ENC_PREFIX) {
        // Plain-text token (legacy) — return unchanged
        return Ok(stored.to_string());
    }

    let hex_data = &stored[ENC_PREFIX.len()..];
    let combined = hex::decode(hex_data).map_err(|e| format!("Hex decode error: {}", e))?;

    if combined.len() < 12 {
        return Err("Invalid encrypted token: too short".to_string());
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let key = derive_key();
    let cipher = Aes256Gcm::new(&key);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Token decryption failed — token may be from a different machine".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("UTF-8 error: {}", e))
}
