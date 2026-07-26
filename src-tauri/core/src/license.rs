//! License-key format: a short opaque random code (see `generate_key`).
//! Legitimacy and single-machine redemption are enforced by a Supabase-backed
//! ledger (the `redeem_license` Postgres RPC, called from
//! `src-tauri/src/commands/license.rs`) — this module only knows how to
//! shape/validate the *format* of a key, never whether it's real or already
//! used. A stateless, I/O-free crate has no way to know that on its own:
//! nothing here can tell if some other machine already redeemed the same
//! code, which is exactly why single-use enforcement lives server-side.

// Алфавит без визуально похожих символов: нет 0, O, 1, I
const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const KEY_BYTES: usize = 10;
/// 10 random bytes = 80 bits, base32-encoded at 5 bits/char = exactly 16
/// characters with no padding remainder.
pub const KEY_LEN: usize = 16;

/// Supabase project backing license redemption/lookup (table `licenses` +
/// the `redeem_license`/`check_license_status` RPCs). The anon key is meant
/// to be public — RLS blocks all direct table access, and the anon role is
/// granted EXECUTE on nothing else, so shipping it is no different from
/// shipping the RPC endpoint URLs themselves. Shared here so the app
/// (commands/license.rs) and the offline keygen tool reference one source
/// of truth instead of duplicating the literals.
pub const SUPABASE_URL: &str = "https://xhjxnyhvfyzyulzzxpsg.supabase.co";
pub const SUPABASE_ANON_KEY: &str = "sb_publishable_rA1sW5U6cA5moy2l64Keug_ReygFLhe";

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

/// Normalizes user-entered input: strips whitespace/dashes, uppercases.
/// Used both for the client-side shape check and to canonicalize the key
/// before it's sent to the Supabase redemption call, so `abcd-efgh-jklm-nprq`
/// and `ABCDEFGHJKLMNPRQ` resolve to the same server-side row.
pub fn clean(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect::<String>()
        .to_uppercase()
}

/// True if `raw` has the right shape to even be a license key (right length,
/// right alphabet) once cleaned. This is a cheap pre-check to avoid spending
/// a network round-trip on obviously-malformed input — it says nothing about
/// whether the key is real or already redeemed, only the server knows that.
pub fn looks_like_key(raw: &str) -> bool {
    let cleaned = clean(raw);
    cleaned.len() == KEY_LEN && base32_decode(&cleaned).is_some()
}

/// Generates a brand-new opaque license key. Used only by the offline
/// keygen tool, which then registers it with Supabase before handing it to
/// a buyer — the shipped app never generates keys, only redeems them.
pub fn generate_key() -> String {
    use rand_core::{OsRng, RngCore};

    let mut bytes = [0u8; KEY_BYTES];
    OsRng.fill_bytes(&mut bytes);
    base32_encode(&bytes)
}

/// A stable, opaque per-machine identifier sent to the license server so it
/// can enforce single-machine redemption. The raw hardware id never leaves
/// the machine, only its SHA-256 hash.
pub fn machine_id_hash() -> String {
    use sha2::{Digest, Sha256};

    let raw = hardware_fingerprint();
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

/// What `machine_id_hash()` always returned before the SMBIOS migration
/// (2026-07-16) — every activation used `legacy_machine_id()` unconditionally
/// back then. Exists only so the client can offer the server this as
/// "same-machine" proof when the current hash doesn't match a
/// pre-migration record; see redeem_license's p_legacy_machine_id and
/// get_license_status's self-healing check. Not used for anything else —
/// do not repurpose.
pub fn legacy_machine_id_hash() -> String {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    hasher.update(crate::crypto::legacy_machine_id().as_bytes());
    hex::encode(hasher.finalize())
}

/// Best-effort hardware fingerprint (motherboard SMBIOS UUID) — deliberately
/// NOT `crypto.rs::legacy_machine_id()`, which is Windows' per-*installation*
/// MachineGuid: that value is regenerated by Windows Setup on every OS
/// reinstall, even on the exact same physical machine, so a license bound to
/// it would wrongly read as "used elsewhere" the moment a legitimate owner
/// reinstalls Windows. legacy_machine_id() must also stay exactly as-is
/// regardless — it's what already-encrypted bot tokens are keyed to, and
/// changing it would make existing users' stored tokens undecryptable.
/// Falls back to legacy_machine_id() if the SMBIOS UUID can't be read (e.g.
/// a locked-down VM) — won't survive a reinstall in that fallback case, but
/// better than failing activation outright. On macOS, legacy_machine_id()
/// itself now reads the real IOPlatformUUID (see crypto.rs), so this is a
/// real per-machine identifier there too, not a generic stand-in.
fn hardware_fingerprint() -> String {
    #[cfg(windows)]
    {
        if let Some(uuid) = windows_smbios_uuid() {
            return uuid;
        }
    }
    crate::crypto::legacy_machine_id()
}

#[cfg(windows)]
fn windows_smbios_uuid() -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn run(cmd: &str, args: &[&str]) -> Option<String> {
        let output = std::process::Command::new(cmd)
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let candidate = text
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty() && !l.eq_ignore_ascii_case("UUID"))?
            .to_string();
        // Reject garbage: too short to be a real UUID, or one of the
        // "not implemented"/unset sentinel values some OEM boards and VMs
        // report (all-F or all-0) — using those verbatim would collide
        // every such machine onto the same fingerprint.
        let is_sentinel = candidate.chars().all(|c| c == 'F' || c == '-')
            || candidate.chars().all(|c| c == '0' || c == '-');
        if candidate.len() < 32 || is_sentinel {
            return None;
        }
        Some(candidate)
    }

    run(
        "powershell",
        &["-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID"],
    )
    .or_else(|| run("wmic", &["csproduct", "get", "UUID"]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_keys_of_the_expected_length_and_shape() {
        let key = generate_key();
        assert_eq!(key.len(), KEY_LEN);
        assert!(looks_like_key(&key), "generated key {key} should look valid");
    }

    #[test]
    fn is_case_insensitive_and_ignores_dashes_and_whitespace() {
        let key = generate_key();
        let decorated = format!("  {}  ", key.to_lowercase());
        assert!(looks_like_key(&decorated));
    }

    #[test]
    fn rejects_garbage_and_wrong_length() {
        assert!(!looks_like_key(""));
        assert!(!looks_like_key("NOT-A-VALID-KEY"));
        assert!(!looks_like_key(&"A".repeat(200)));
        // One character short of KEY_LEN.
        assert!(!looks_like_key(&"A".repeat(KEY_LEN - 1)));
    }

    #[test]
    fn rejects_forbidden_charset_symbols() {
        // 0, O, 1, I are intentionally excluded from CHARSET
        assert!(!looks_like_key(&format!("{}0", "A".repeat(KEY_LEN - 1))));
        assert!(!looks_like_key(&format!("{}I", "A".repeat(KEY_LEN - 1))));
    }

    #[test]
    fn machine_id_hash_is_stable_and_looks_like_a_sha256_hex_digest() {
        let a = machine_id_hash();
        let b = machine_id_hash();
        assert_eq!(a, b, "hash should be deterministic for the same machine");
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn base32_round_trips_arbitrary_bytes() {
        for sample in [
            vec![],
            vec![0u8],
            vec![0xFF; 4],
            (0..KEY_BYTES as u8).collect::<Vec<u8>>(),
        ] {
            let encoded = base32_encode(&sample);
            let decoded = base32_decode(&encoded).unwrap();
            assert_eq!(decoded, sample, "round-trip failed for {sample:?}");
        }
    }
}
