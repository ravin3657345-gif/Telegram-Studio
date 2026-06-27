use crate::{crypto, db::models::Bot};
use rusqlite::{params, Connection, Result};

// ── Internal helpers ───────────────────────────────────────────────────────────

/// Map a DB row to Bot, decrypting the token on the fly.
fn row_to_bot(row: &rusqlite::Row<'_>) -> rusqlite::Result<Bot> {
    let stored_token: String = row.get(1)?;
    let token = crypto::decrypt_token(&stored_token)
        .unwrap_or(stored_token); // Fallback: return as-is if decryption fails
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
    let mut stmt = conn.prepare(&format!("{} ORDER BY created_at ASC", SELECT_COLS))?;
    let rows = stmt.query_map([], row_to_bot)?;
    // Lazy migration: encrypt any plaintext tokens found
    let mut bots: Vec<Bot> = rows.collect::<Result<_>>()?;
    for bot in &mut bots {
        if !bot.token.starts_with("ENC:") {
            if let Ok(enc) = crypto::encrypt_token(&bot.token) {
                let _ = conn.execute(
                    "UPDATE bots SET token = ?1 WHERE id = ?2",
                    params![enc, bot.id],
                );
            }
        }
    }
    Ok(bots)
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
    Ok(stored.map(|t| crypto::decrypt_token(&t).unwrap_or(t)))
}

/// Find a bot by its plain-text token (searches all bots after decryption).
pub fn find_by_token(conn: &Connection, plain_token: &str) -> Result<Option<Bot>> {
    let all = find_all(conn)?;
    Ok(all.into_iter().find(|b| b.token == plain_token))
}

pub fn insert(conn: &Connection, bot: &Bot) -> Result<()> {
    let encrypted = crypto::encrypt_token(&bot.token)
        .unwrap_or_else(|_| bot.token.clone());
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

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM bots WHERE id = ?1", params![id])?;
    Ok(())
}
