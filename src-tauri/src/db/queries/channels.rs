use crate::db::models::Channel;
use rusqlite::{params, Connection, Result};

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Channel> {
    Ok(Channel {
        id: row.get(0)?,
        bot_id: row.get(1)?,
        telegram_id: row.get(2)?,
        title: row.get(3)?,
        username: row.get(4)?,
        description: row.get(5)?,
        avatar_path: row.get(6)?,
        member_count: row.get(7)?,
        is_active: row.get::<_, i32>(8)? != 0,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

pub fn find_all(conn: &Connection, bot_id: Option<&str>) -> Result<Vec<Channel>> {
    match bot_id {
        Some(bid) => {
            let mut stmt = conn.prepare(
                "SELECT id, bot_id, telegram_id, title, username, description,
                        avatar_path, member_count, is_active, created_at, updated_at
                 FROM channels WHERE bot_id = ?1 ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map(params![bid], map_row)?;
            rows.collect()
        }
        None => {
            let mut stmt = conn.prepare(
                "SELECT id, bot_id, telegram_id, title, username, description,
                        avatar_path, member_count, is_active, created_at, updated_at
                 FROM channels ORDER BY created_at ASC",
            )?;
            let rows = stmt.query_map([], map_row)?;
            rows.collect()
        }
    }
}

pub fn find_by_id(conn: &Connection, id: &str) -> Result<Option<Channel>> {
    let mut stmt = conn.prepare(
        "SELECT id, bot_id, telegram_id, title, username, description,
                avatar_path, member_count, is_active, created_at, updated_at
         FROM channels WHERE id = ?1",
    )?;
    let mut rows = stmt.query_map(params![id], map_row)?;
    Ok(rows.next().transpose()?)
}

pub fn get_telegram_id(conn: &Connection, id: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT telegram_id FROM channels WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![id], |row| row.get::<_, String>(0))?;
    Ok(rows.next().transpose()?)
}

pub fn insert(conn: &Connection, ch: &Channel) -> Result<()> {
    conn.execute(
        "INSERT INTO channels (id, bot_id, telegram_id, title, username, description,
                               avatar_path, member_count, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            ch.id,
            ch.bot_id,
            ch.telegram_id,
            ch.title,
            ch.username,
            ch.description,
            ch.avatar_path,
            ch.member_count,
            if ch.is_active { 1 } else { 0 },
            ch.created_at,
            ch.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM channels WHERE id = ?1", params![id])?;
    Ok(())
}
