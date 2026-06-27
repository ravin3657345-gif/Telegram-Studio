use crate::db::models::{Draft, DraftButton, DraftMedia, DraftSummary};
use rusqlite::{Connection, Result};

pub fn find_all_summaries(conn: &Connection) -> Result<Vec<DraftSummary>> {
    let mut stmt = conn.prepare(
        "SELECT
            d.id, d.title, d.post_title, d.content_text,
            (SELECT COUNT(*) FROM draft_media  WHERE draft_id = d.id) AS media_count,
            (SELECT COUNT(*) FROM draft_buttons WHERE draft_id = d.id) AS button_count,
            d.status, d.updated_at
         FROM drafts d
         ORDER BY d.updated_at DESC",
    )?;

    let rows = stmt.query_map([], |r| {
        Ok(DraftSummary {
            id:           r.get(0)?,
            title:        r.get(1)?,
            post_title:   r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            content_text: r.get(3)?,
            media_count:  r.get(4)?,
            button_count: r.get(5)?,
            status:       r.get(6)?,
            updated_at:   r.get(7)?,
        })
    })?;

    rows.collect()
}

pub fn find_by_id(conn: &Connection, id: &str) -> Result<Option<Draft>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, post_title, content_json, content_text, parse_mode,
                status, created_at, updated_at
         FROM drafts WHERE id = ?1",
    )?;

    let mut rows = stmt.query_map([id], |r| {
        Ok(Draft {
            id:           r.get(0)?,
            title:        r.get(1)?,
            post_title:   r.get::<_, Option<String>>(2)?.unwrap_or_default(),
            content_json: r.get(3)?,
            content_text: r.get(4)?,
            parse_mode:   r.get(5)?,
            status:       r.get(6)?,
            created_at:   r.get(7)?,
            updated_at:   r.get(8)?,
            media:        vec![],
            buttons:      vec![],
            attachments:  vec![],
        })
    })?;

    if let Some(row) = rows.next() {
        let mut draft = row?;

        // Load media
        let mut mstmt = conn.prepare(
            "SELECT id, draft_id, file_path, file_name, mime_type,
                    file_size, width, height, duration, sort_order, created_at
             FROM draft_media WHERE draft_id = ?1 ORDER BY sort_order",
        )?;
        draft.media = mstmt
            .query_map([&draft.id], |r| {
                Ok(DraftMedia {
                    id:         r.get(0)?,
                    draft_id:   r.get(1)?,
                    file_path:  r.get(2)?,
                    file_name:  r.get(3)?,
                    mime_type:  r.get(4)?,
                    file_size:  r.get(5)?,
                    width:      r.get(6)?,
                    height:     r.get(7)?,
                    duration:   r.get(8)?,
                    sort_order: r.get(9)?,
                    created_at: r.get(10)?,
                })
            })?
            .filter_map(|x| x.ok())
            .collect();

        // Load buttons
        let mut bstmt = conn.prepare(
            "SELECT id, draft_id, row_index, col_index, label, url, callback
             FROM draft_buttons WHERE draft_id = ?1 ORDER BY row_index, col_index",
        )?;
        draft.buttons = bstmt
            .query_map([&draft.id], |r| {
                Ok(DraftButton {
                    id:        r.get(0)?,
                    draft_id:  r.get(1)?,
                    row_index: r.get(2)?,
                    col_index: r.get(3)?,
                    label:     r.get(4)?,
                    url:       r.get(5)?,
                    callback:  r.get(6)?,
                })
            })?
            .filter_map(|x| x.ok())
            .collect();

        return Ok(Some(draft));
    }

    Ok(None)
}

pub fn upsert(conn: &Connection, draft: &Draft) -> Result<()> {
    conn.execute(
        "INSERT INTO drafts (id, title, post_title, content_json, content_text,
                             parse_mode, status, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(id) DO UPDATE SET
             title        = excluded.title,
             post_title   = excluded.post_title,
             content_json = excluded.content_json,
             content_text = excluded.content_text,
             parse_mode   = excluded.parse_mode,
             status       = excluded.status,
             updated_at   = excluded.updated_at",
        rusqlite::params![
            draft.id,
            draft.title,
            draft.post_title,
            draft.content_json,
            draft.content_text,
            draft.parse_mode,
            draft.status,
            draft.created_at,
            draft.updated_at,
        ],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM drafts WHERE id = ?1", [id])?;
    Ok(())
}
