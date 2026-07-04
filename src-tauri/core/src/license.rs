//! License-key validation. Pure and deterministic — no I/O, no Tauri.
//!
//! Key format: `TELEGA-XXXXX-XXXXX-XXXXX`, where the third group is an FNV-1a
//! checksum of the first two groups, encoded in a confusable-free alphabet.

// Алфавит без визуально похожих символов: нет 0, O, 1, I
const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Секретный seed — вшит в бинарник
const FNV_OFFSET: u32 = 0x811c9dc5;
const FNV_PRIME: u32 = 0x01000193;
const SECRET_XOR: u32 = 0x4B455953; // "KEYS" — дополнительный сдвиг

pub fn fnv1a(data: &str) -> u32 {
    let mut h = FNV_OFFSET;
    for b in data.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(FNV_PRIME);
    }
    h ^ SECRET_XOR
}

pub fn encode_check(hash: u32) -> String {
    let base = CHARSET.len() as u32;
    let mut n = hash;
    let mut out = [0u8; 5];
    for ch in out.iter_mut() {
        *ch = CHARSET[(n % base) as usize];
        n /= base;
    }
    // CHARSET is ASCII, so the bytes are always valid UTF-8.
    String::from_utf8_lossy(&out).into_owned()
}

/// Проверяет ключ формата TELEGA-XXXXX-XXXXX-XXXXX
pub fn validate_key(raw: &str) -> bool {
    let key = raw.trim().to_uppercase();
    let parts: Vec<&str> = key.split('-').collect();
    if parts.len() != 4 || parts[0] != "TELEGA" {
        return false;
    }

    let (g1, g2, g3) = (parts[1], parts[2], parts[3]);
    if g1.len() != 5 || g2.len() != 5 || g3.len() != 5 {
        return false;
    }

    // CHARSET is guaranteed valid ASCII/UTF-8 (const literal).
    let charset_str = match std::str::from_utf8(CHARSET) {
        Ok(s) => s,
        Err(_) => return false,
    };
    for c in format!("{}{}{}", g1, g2, g3).chars() {
        if !charset_str.contains(c) {
            return false;
        }
    }

    encode_check(fnv1a(&format!("{}{}", g1, g2))) == g3
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a valid key for arbitrary first two groups using the real algorithm.
    fn make_key(g1: &str, g2: &str) -> String {
        let g3 = encode_check(fnv1a(&format!("{}{}", g1, g2)));
        format!("TELEGA-{}-{}-{}", g1, g2, g3)
    }

    #[test]
    fn accepts_a_correctly_checksummed_key() {
        let key = make_key("ABCDE", "FGHJK");
        assert!(validate_key(&key), "generated key {key} should be valid");
    }

    #[test]
    fn is_case_insensitive_and_trims() {
        let key = make_key("ABCDE", "FGHJK");
        assert!(validate_key(&format!("  {}  ", key.to_lowercase())));
    }

    #[test]
    fn rejects_wrong_prefix() {
        let key = make_key("ABCDE", "FGHJK").replace("TELEGA", "WRONGX");
        assert!(!validate_key(&key));
    }

    #[test]
    fn rejects_bad_checksum() {
        assert!(!validate_key("TELEGA-ABCDE-FGHJK-22222"));
    }

    #[test]
    fn rejects_wrong_group_count_and_length() {
        assert!(!validate_key("TELEGA-ABCDE-FGHJK"));
        assert!(!validate_key("TELEGA-ABC-FGHJK-22222"));
        assert!(!validate_key(""));
    }

    #[test]
    fn rejects_forbidden_charset_symbols() {
        // 0, O, 1, I are intentionally excluded from CHARSET
        assert!(!validate_key("TELEGA-ABCD0-FGHJK-22222"));
    }

    #[test]
    fn encode_check_is_always_five_charset_chars() {
        let charset = std::str::from_utf8(CHARSET).unwrap();
        for seed in ["", "A", "hello world", "ABCDEFGHJK"] {
            let c = encode_check(fnv1a(seed));
            assert_eq!(c.len(), 5);
            assert!(c.chars().all(|ch| charset.contains(ch)));
        }
    }
}
