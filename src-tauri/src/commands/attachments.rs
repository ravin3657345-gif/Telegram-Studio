// Shared validation + on-disk persistence for files embedded in a post's
// content (blockImage/blockVideo `fileId` attrs) — used by both drafts and
// templates, since a template is just a `drafts` row with kind='template'
// (see migrations.rs::migrate_v11) and needs the exact same media handling.

use base64::Engine;
use chrono::Utc;
use rusqlite::Connection;
use std::path::Path;

use crate::db::models::DraftAttachmentPayload;

pub const MAX_ATTACHMENTS: usize = 60;
pub const MAX_ATTACHMENT_BYTES: usize = 52_428_800;   // 50 MB per file
pub const MAX_TOTAL_BYTES: usize = 524_288_000;       // 500 MB total per post

/// Call before acquiring the DB lock — cheap, no I/O.
pub fn validate(attachments: &[DraftAttachmentPayload]) -> Result<(), String> {
    if attachments.len() > MAX_ATTACHMENTS {
        return Err(format!("Слишком много вложений (максимум {})", MAX_ATTACHMENTS));
    }

    let mut total = 0usize;
    for att in attachments {
        // base64 → raw size ≈ len * 3/4
        let approx = att.data_base64.len() * 3 / 4;
        if approx > MAX_ATTACHMENT_BYTES {
            return Err(format!("Файл «{}» превышает лимит 50 МБ", att.file_name));
        }
        total += approx;
        if total > MAX_TOTAL_BYTES {
            return Err("Суммарный размер вложений превышает 500 МБ".to_string());
        }
    }
    Ok(())
}

/// `owner_id`/`file_id` become raw filesystem path segments below (joined
/// under `app_dir`), so both must be restricted to a safe allow-list before
/// ever touching `Path::join` — an unchecked `"..\\..\\...\\Startup\\evil"`
/// would otherwise let a crafted payload write arbitrary bytes to an
/// arbitrary path on disk. Real ids are always client/server-generated
/// UUIDs, which this charset accepts unchanged.
fn is_safe_path_segment(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Writes each attachment to `{app_dir}/draft_media/{owner_id}/` and upserts
/// its `draft_media` row — `owner_id` is a draft id or a template id, both
/// valid `drafts.id` values now that templates live in the same table.
pub fn persist(
    db: &Connection,
    app_dir: &Path,
    owner_id: &str,
    attachments: &[DraftAttachmentPayload],
) -> Result<(), String> {
    if !is_safe_path_segment(owner_id) {
        return Err("Недопустимый идентификатор черновика/шаблона".to_string());
    }

    let media_dir = app_dir.join("draft_media").join(owner_id);
    std::fs::create_dir_all(&media_dir)
        .map_err(|e| format!("Не удалось создать директорию: {}", e))?;

    for att in attachments {
        if !is_safe_path_segment(&att.file_id) {
            return Err(format!("Недопустимый идентификатор файла «{}»", att.file_name));
        }

        let raw = base64::engine::general_purpose::STANDARD
            .decode(&att.data_base64)
            .map_err(|_| format!("Ошибка декодирования файла «{}»", att.file_name))?;

        if raw.is_empty() { continue; }

        // Sanitize extension: allow only alphanumeric
        let ext = att.file_name
            .rsplit('.')
            .next()
            .unwrap_or("bin")
            .chars()
            .filter(|c| c.is_alphanumeric())
            .take(10)
            .collect::<String>();
        let ext = if ext.is_empty() { "bin".to_string() } else { ext };

        let file_path = media_dir.join(format!("{}.{}", att.file_id, ext));
        std::fs::write(&file_path, &raw)
            .map_err(|e| format!("Ошибка сохранения файла: {}", e))?;

        let path_str = file_path.to_string_lossy().into_owned();
        let now = Utc::now().to_rfc3339();
        db.execute(
            "INSERT INTO draft_media (id, draft_id, file_path, file_name, mime_type,
                                     file_size, sort_order, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(id) DO UPDATE SET
               file_path=excluded.file_path,
               file_name=excluded.file_name,
               mime_type=excluded.mime_type,
               file_size=excluded.file_size",
            rusqlite::params![
                att.file_id, owner_id, path_str, att.file_name, att.mime_type,
                raw.len() as i64, 0i64, now
            ],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Reads every `draft_media` row for `owner_id` back off disk as base64 —
/// mirrors `commands::drafts::get_draft`'s attachment loop, reused for
/// `commands::templates::get_template`.
pub fn load_as_attachments(
    db: &Connection,
    owner_id: &str,
) -> Result<Vec<crate::db::models::DraftAttachment>, String> {
    let mut stmt = db
        .prepare("SELECT id, file_path, file_name, mime_type FROM draft_media WHERE draft_id = ?1")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![owner_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut attachments = Vec::new();
    for row in rows {
        let (id, file_path, file_name, mime_type) = row.map_err(|e| e.to_string())?;
        if let Ok(raw) = std::fs::read(&file_path) {
            let data_base64 = base64::engine::general_purpose::STANDARD.encode(&raw);
            attachments.push(crate::db::models::DraftAttachment {
                file_id: id,
                data_base64,
                mime_type,
                file_name,
            });
        }
    }
    Ok(attachments)
}
