//! Pure backup-retention logic: given a set of existing backup filenames and
//! how many to keep, decide which ones to delete. Kept separate from the
//! actual filesystem I/O so the decision itself is unit-testable.

/// Returns the filenames that should be deleted so only `keep` remain.
///
/// Assumes filenames sort lexicographically in chronological order (true for
/// the `telegram-studio-YYYY-MM-DD.db` naming scheme, since ISO dates sort
/// the same way as strings and as dates). Returns an empty vec if there's
/// nothing to prune.
pub fn filenames_to_prune(existing: &[String], keep: usize) -> Vec<String> {
    if existing.len() <= keep {
        return Vec::new();
    }
    let mut sorted = existing.to_vec();
    sorted.sort();
    let cut = sorted.len() - keep;
    sorted.into_iter().take(cut).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_everything_under_the_limit() {
        let files = vec!["telegram-studio-2026-07-01.db".to_string()];
        assert_eq!(filenames_to_prune(&files, 7), Vec::<String>::new());
    }

    #[test]
    fn prunes_the_oldest_first() {
        let files = vec![
            "telegram-studio-2026-07-03.db".to_string(),
            "telegram-studio-2026-07-01.db".to_string(),
            "telegram-studio-2026-07-02.db".to_string(),
        ];
        assert_eq!(
            filenames_to_prune(&files, 2),
            vec!["telegram-studio-2026-07-01.db".to_string()]
        );
    }

    #[test]
    fn prunes_down_to_exactly_keep_count() {
        let files: Vec<String> = (1..=10)
            .map(|d| format!("telegram-studio-2026-07-{:02}.db", d))
            .collect();
        let pruned = filenames_to_prune(&files, 7);
        assert_eq!(pruned.len(), 3);
        // The 3 oldest (01, 02, 03) should be the ones pruned.
        assert_eq!(
            pruned,
            vec![
                "telegram-studio-2026-07-01.db".to_string(),
                "telegram-studio-2026-07-02.db".to_string(),
                "telegram-studio-2026-07-03.db".to_string(),
            ]
        );
    }

    #[test]
    fn empty_input_prunes_nothing() {
        assert_eq!(filenames_to_prune(&[], 7), Vec::<String>::new());
    }

    #[test]
    fn keep_of_zero_prunes_everything() {
        let files = vec!["telegram-studio-2026-07-01.db".to_string()];
        assert_eq!(filenames_to_prune(&files, 0), files);
    }
}
