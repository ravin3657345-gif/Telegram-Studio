//! License-key validation, backed by Ed25519 signatures instead of a shared
//! secret. `validate_key` is pure and deterministic — no I/O, no Tauri.
//!
//! Key format: base32 (confusable-free alphabet, no 0/O/1/I) over a 4-byte
//! random nonce followed by its 64-byte Ed25519 signature. Only the matching
//! private key (kept offline, never shipped) can produce a signature this
//! module's embedded public key accepts — unlike a checksum/HMAC scheme,
//! reverse-engineering the verification code and public key does not let
//! anyone forge new valid keys, only bypass the check in their own copy.

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};

// Алфавит без визуально похожих символов: нет 0, O, 1, I
const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const NONCE_LEN: usize = 4;
const SIG_LEN: usize = 64;
const PAYLOAD_LEN: usize = NONCE_LEN + SIG_LEN;

/// Ed25519 public key used to verify license keys. Safe to ship in the
/// binary — it's the public half of a keypair generated once with
/// `generate_signing_keypair()`; the private half lives outside this repo.
const PUBLIC_KEY_BYTES: [u8; 32] = [
    0x91, 0xdc, 0x4f, 0x96, 0xe9, 0x2a, 0x8b, 0x64, 0x69, 0xa6, 0x8c, 0xdb, 0x53, 0x73, 0x7c, 0x62,
    0x52, 0xae, 0x25, 0xe0, 0x17, 0xaa, 0xaf, 0xdc, 0x56, 0xc7, 0xae, 0x76, 0x7f, 0x8a, 0x38, 0x0d,
];

fn base32_encode(data: &[u8]) -> String {
    let mut bits: u32 = 0;
    let mut bit_count: u32 = 0;
    let mut out = String::with_capacity((data.len() * 8).div_ceil(5));
    for &byte in data {
        bits = (bits << 8) | byte as u32;
        bit_count += 8;
        while bit_count >= 5 {
            bit_count -= 5;
            out.push(CHARSET[((bits >> bit_count) & 0x1F) as usize] as char);
        }
    }
    if bit_count > 0 {
        out.push(CHARSET[((bits << (5 - bit_count)) & 0x1F) as usize] as char);
    }
    out
}

fn base32_decode(s: &str) -> Option<Vec<u8>> {
    let mut bits: u32 = 0;
    let mut bit_count: u32 = 0;
    let mut out = Vec::with_capacity(s.len() * 5 / 8);
    for c in s.bytes() {
        let idx = CHARSET.iter().position(|&x| x == c)? as u32;
        bits = (bits << 5) | idx;
        bit_count += 5;
        if bit_count >= 8 {
            bit_count -= 8;
            out.push(((bits >> bit_count) & 0xFF) as u8);
        }
    }
    Some(out)
}

fn clean(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_uppercase()
}

fn verify_with_key(vk: &VerifyingKey, raw: &str) -> bool {
    let Some(bytes) = base32_decode(&clean(raw)) else { return false };
    if bytes.len() != PAYLOAD_LEN {
        return false;
    }
    let (nonce, sig_bytes) = bytes.split_at(NONCE_LEN);
    let Ok(sig) = Signature::from_slice(sig_bytes) else { return false };
    vk.verify(nonce, &sig).is_ok()
}

/// Checks a license key against the embedded public key.
pub fn validate_key(raw: &str) -> bool {
    let Ok(vk) = VerifyingKey::from_bytes(&PUBLIC_KEY_BYTES) else { return false };
    verify_with_key(&vk, raw)
}

/// Signs a fresh random nonce with the given private key, producing a new
/// license key string. Used only by the offline keygen tool — the shipped
/// app never calls this (it has no private key to call it with).
pub fn generate_key(signing_key_bytes: &[u8; 32]) -> String {
    use rand_core::{OsRng, RngCore};

    let signing_key = SigningKey::from_bytes(signing_key_bytes);
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let sig = signing_key.sign(&nonce);

    let mut payload = Vec::with_capacity(PAYLOAD_LEN);
    payload.extend_from_slice(&nonce);
    payload.extend_from_slice(&sig.to_bytes());
    base32_encode(&payload)
}

/// Generates a brand-new Ed25519 keypair. Run once to bootstrap the signing
/// key (via the keygen tool's `genkey` mode) — never called at app runtime.
/// Returns (private_seed_hex, public_key_bytes).
pub fn generate_signing_keypair() -> (String, [u8; 32]) {
    use rand_core::OsRng;

    let signing_key = SigningKey::generate(&mut OsRng);
    let seed_hex = hex::encode(signing_key.to_bytes());
    let vk_bytes = signing_key.verifying_key().to_bytes();
    (seed_hex, vk_bytes)
}

/// Decodes a hex-encoded 32-byte signing key seed (as printed by
/// `generate_signing_keypair`/stored in the offline key file). Kept here so
/// the `hex` dependency stays confined to this Tauri-free crate.
pub fn decode_signing_key_hex(hex_str: &str) -> Option<[u8; 32]> {
    hex::decode(hex_str.trim()).ok()?.try_into().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // A known-good key, produced once with the real production signing key
    // (see D:/tstudio-license-signing-key.txt, outside this repo) against
    // the real PUBLIC_KEY_BYTES above — catches a mismatch if someone edits
    // the constant without re-deriving it from the real private key.
    const SAMPLE_REAL_KEY: &str =
        "CQE8Y-ELV82-YKZTY-74ZG5-FR4WE-QXG3L-PGT8N-9CGHC-HYKW8-C2HTJ-AHLXP-5UQX9-TUX2D-Y3LS5-EJXZ5-58TB2-JA3DJ-8X5N2-AKT2J-7DMZG-TSVH2-8ZSQ";

    #[test]
    fn accepts_a_key_signed_by_its_own_keypair() {
        let (seed_hex, vk_bytes) = generate_signing_keypair();
        let seed: [u8; 32] = hex::decode(&seed_hex).unwrap().try_into().unwrap();
        let key = generate_key(&seed);
        let vk = VerifyingKey::from_bytes(&vk_bytes).unwrap();
        assert!(verify_with_key(&vk, &key), "generated key {key} should verify");
    }

    #[test]
    fn rejects_a_key_signed_by_a_different_keypair() {
        let (seed_hex, _vk_bytes) = generate_signing_keypair();
        let seed: [u8; 32] = hex::decode(&seed_hex).unwrap().try_into().unwrap();
        let key = generate_key(&seed);
        // Verify against a *different* freshly-generated keypair's public key.
        let (_other_seed, other_vk_bytes) = generate_signing_keypair();
        let other_vk = VerifyingKey::from_bytes(&other_vk_bytes).unwrap();
        assert!(!verify_with_key(&other_vk, &key));
    }

    #[test]
    fn is_case_insensitive_and_ignores_dashes_and_whitespace() {
        let (seed_hex, vk_bytes) = generate_signing_keypair();
        let seed: [u8; 32] = hex::decode(&seed_hex).unwrap().try_into().unwrap();
        let key = generate_key(&seed);
        let vk = VerifyingKey::from_bytes(&vk_bytes).unwrap();
        let decorated = format!("  {}  ", key.to_lowercase());
        assert!(verify_with_key(&vk, &decorated));
    }

    #[test]
    fn rejects_tampered_signature() {
        let (seed_hex, vk_bytes) = generate_signing_keypair();
        let seed: [u8; 32] = hex::decode(&seed_hex).unwrap().try_into().unwrap();
        let mut key = generate_key(&seed).into_bytes();
        // Flip a middle character (not the last symbol: its bottom bit is
        // padding, discarded on decode, so tampering it can be a no-op).
        let mid = key.len() / 2;
        let alt = if key[mid] == CHARSET[0] { CHARSET[1] } else { CHARSET[0] };
        key[mid] = alt;
        let tampered = String::from_utf8(key).unwrap();
        let vk = VerifyingKey::from_bytes(&vk_bytes).unwrap();
        assert!(!verify_with_key(&vk, &tampered));
    }

    #[test]
    fn rejects_garbage_and_wrong_length() {
        assert!(!validate_key(""));
        assert!(!validate_key("NOT-A-VALID-KEY"));
        assert!(!validate_key(&"A".repeat(200)));
    }

    #[test]
    fn rejects_forbidden_charset_symbols() {
        // 0, O, 1, I are intentionally excluded from CHARSET
        assert!(!validate_key(&format!("{}0", "A".repeat(108))));
        assert!(!validate_key(&format!("{}I", "A".repeat(108))));
    }

    #[test]
    fn base32_round_trips_arbitrary_bytes() {
        for sample in [
            vec![],
            vec![0u8],
            vec![0xFF; 4],
            (0..68).map(|i| i as u8).collect::<Vec<u8>>(),
        ] {
            let encoded = base32_encode(&sample);
            let decoded = base32_decode(&encoded).unwrap();
            assert_eq!(decoded, sample, "round-trip failed for {sample:?}");
        }
    }

    #[test]
    fn real_public_key_accepts_a_key_from_the_real_signing_key() {
        assert!(validate_key(SAMPLE_REAL_KEY));
    }
}
