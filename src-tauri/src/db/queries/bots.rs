use crate::{crypto, db::models::Bot};
use rusqlite::{params, Connection, Result};

// ── Helpers ────────────────────────────────────────────────────────────────────

fn to_rusqlite_err(msg: String) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
        std::io::ErrorKind::Other,
        msg,
    )))
}

/// Map a DB row to Bot, decrypting the token.
fn row_to_bot(row: &rusqlite::Row<'_>) -> rusqlite::Result<Bot> {
    let stored_token: String = row.get(1)?;
    let token = crypto::decrypt_token(&stored_token).map_err(to_rusqlite_err)?;
    Ok(Bot {
        id:         row.get(0)?,
        token,
        name:       row.get(2)?,
        username:   row.get(3)?,
        avatar_url: row.get(4)?,
        is_active:  row.get::<_, i32>(5)? != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

const SELECT_COLS: &str =
    "SELECT id, token, name, username, avatar_url, is_active, created_at, updated_at FROM bots";

// ── Public API ─────────────────────────────────────────────────────────────────

pub fn find_all(conn: &Connection) -> Result<Vec<Bot>> {
    // Migrate tokens that are in an old format to the current preferred format.
    migrate_tokens(conn);

    let mut stmt = conn.prepare(&format!("{} ORDER BY created_at ASC", SELECT_COLS))?;
    let rows = stmt.query_map([], row_to_bot)?;
    rows.collect::<Result<_>>()
}

/// Re-encrypt any tokens not yet in the current preferred format (e.g. ENC: → DPAPI:).
fn migrate_tokens(conn: &Connection) {
    let Ok(mut stmt) = conn.prepare("SELECT id, token FROM bots") else { return; };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) else { return; };

    for row in rows.flatten() {
        let (id, stored) = row;
        if crypto::needs_migration(&stored) {
            if let Ok(plain) = crypto::decrypt_token(&stored) {
                if let Ok(new_enc) = crypto::encrypt_token(&plain) {
                    let _ = conn.execute(
                        "UPDATE bots SET token = ?1 WHERE id = ?2",
                        params![new_enc, id],
                    );
                }
            }
        }
    }
}

pub fn find_by_id(conn: &Connection, id: &str) -> Result<Option<Bot>> {
    let mut stmt = conn.prepare(&format!("{} WHERE id = ?1", SELECT_COLS))?;
    let mut rows = stmt.query_map(params![id], row_to_bot)?;
    Ok(rows.next().transpose()?)
}

pub fn get_token(conn: &Connection, id: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT token FROM bots WHERE id = ?1")?;
    let stored: Option<String> = stmt
        .query_map(params![id], |row| row.get::<_, String>(0))?
        .next()
        .transpose()?;
    match stored {
        None => Ok(None),
        Some(t) => crypto::decrypt_token(&t)
            .map(Some)
            .map_err(to_rusqlite_err),
    }
}

/// Find a bot by its plain-text token (searches all bots after decryption).
pub fn find_by_token(conn: &Connection, plain_token: &str) -> Result<Option<Bot>> {
    Ok(find_all(conn)?.into_iter().find(|b| b.token == plain_token))
}

pub fn insert(conn: &Connection, bot: &Bot) -> Result<()> {
    let encrypted = crypto::encrypt_token(&bot.token).map_err(to_rusqlite_err)?;
    conn.execute(
        "INSERT INTO bots (id, token, name, username, avatar_url, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            bot.id,
            encrypted,
            bot.name,
            bot.username,
            bot.avatar_url,
            if bot.is_active { 1 } else { 0 },
            bot.created_at,
            bot.updated_at,
        ],
    )?;
    Ok(())
}

/// Refreshes the bot's cached display name/username from a fresh getMe
/// response — picks up renames without requiring the user to re-add the bot.
pub fn update_info(conn: &Connection, bot_id: &str, name: &str, username: &str) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE bots SET name = ?1, username = ?2, updated_at = ?3 WHERE id = ?4",
        params![name, username, now, bot_id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    // Remove all data referencing this bot before deleting to satisfy FK constraints
    conn.execute("DELETE FROM scheduled_posts WHERE bot_id = ?1", params![id])?;
    conn.execute("DELETE FROM publication_history WHERE bot_id = ?1", params![id])?;
    // Channels cascade-delete their own FK children via ON DELETE CASCADE
    conn.execute("DELETE FROM channels WHERE bot_id = ?1", params![id])?;
    conn.execute("DELETE FROM bots WHERE id = ?1", params![id])?;
    Ok(())
}
