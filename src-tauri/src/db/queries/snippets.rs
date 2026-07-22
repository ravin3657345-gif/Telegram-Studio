use crate::db::models::Snippet;
use rusqlite::{params, Connection, Result};

const SELECT_COLS: &str =
    "SELECT id, name, content, sort_order, created_at, updated_at FROM snippets";

fn row_to_snippet(row: &rusqlite::Row<'_>) -> rusqlite::Result<Snippet> {
    Ok(Snippet {
        id:         row.get(0)?,
        name:       row.get(1)?,
        content:    row.get(2)?,
        sort_order: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

pub fn find_all(conn: &Connection) -> Result<Vec<Snippet>> {
    let mut stmt = conn.prepare(&format!("{} ORDER BY sort_order ASC, created_at ASC", SELECT_COLS))?;
    let rows = stmt.query_map([], row_to_snippet)?;
    rows.collect::<Result<_>>()
}

pub fn insert(conn: &Connection, snippet: &Snippet) -> Result<()> {
    conn.execute(
        "INSERT INTO snippets (id, name, content, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            snippet.id,
            snippet.name,
            snippet.content,
            snippet.sort_order,
            snippet.created_at,
            snippet.updated_at,
        ],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, id: &str, name: &str, content: &str) -> Result<()> {
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE snippets SET name = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
        params![name, content, now, id],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM snippets WHERE id = ?1", params![id])?;
    Ok(())
}
