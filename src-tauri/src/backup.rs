//! Daily SQLite backups via `VACUUM INTO`.
//!
//! `VACUUM INTO` writes a defragmented, transactionally-consistent snapshot
//! of the database to a new file without blocking other connections for the
//! whole operation — safe to run at startup even while the app is in use.
//!
//! Runs at most once per calendar day (checked via a cheap file-existence
//! check) and keeps a rolling window of the most recent backups.

use std::path::Path;

const KEEP_BACKUPS: usize = 7;

/// Creates today's backup if it doesn't already exist, then prunes old ones.
/// Backup/prune failures are logged but never propagated — a backup problem
/// must not block the app from starting.
pub fn maybe_backup(conn: &rusqlite::Connection, app_dir: &Path) {
    let backups_dir = app_dir.join("backups");
    if let Err(e) = std::fs::create_dir_all(&backups_dir) {
        log::warn!("[backup] failed to create backups dir: {e}");
        return;
    }

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let backup_path = backups_dir.join(format!("telegram-studio-{today}.db"));

    if backup_path.exists() {
        return; // already backed up today
    }

    let path_str = backup_path.to_string_lossy().replace('\'', "''");
    match conn.execute_batch(&format!("VACUUM INTO '{path_str}';")) {
        Ok(()) => log::info!("[backup] created {}", backup_path.display()),
        Err(e) => {
            log::warn!("[backup] VACUUM INTO failed: {e}");
            return;
        }
    }

    prune_old_backups(&backups_dir);
}

/// Keeps only the KEEP_BACKUPS most recent `telegram-studio-*.db` files.
/// The prune decision itself is pure (see tstudio_core::backup_retention);
/// this just does the filesystem I/O.
fn prune_old_backups(backups_dir: &Path) {
    let names: Vec<String> = match std::fs::read_dir(backups_dir) {
        Ok(rd) => rd
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with("telegram-studio-"))
            .collect(),
        Err(e) => {
            log::warn!("[backup] failed to read backups dir: {e}");
            return;
        }
    };

    for name in tstudio_core::backup_retention::filenames_to_prune(&names, KEEP_BACKUPS) {
        if let Err(e) = std::fs::remove_file(backups_dir.join(&name)) {
            log::warn!("[backup] failed to remove old backup {name}: {e}");
        }
    }
}
