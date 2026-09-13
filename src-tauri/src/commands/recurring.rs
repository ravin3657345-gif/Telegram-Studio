//! Recurring posts ("повторять каждый день / по неделям / по месяцам").
//!
//! A rule stores what to send, where, and when; the scheduler (see
//! `scheduler::process_recurring`) stamps out a real `scheduled_posts` row
//! every time the rule comes due, so everything after that point — retries,
//! media handling, history, the "опоздал" notice — is the exact code path an
//! ordinary scheduled post already takes.

use chrono::{Local, NaiveDateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    db::{
        queries::{bots as bots_q, channels as channels_q},
        AppState,
    },
    telegram::methods::MediaItem,
};
use tstudio_core::recurrence::{format_time_of_day, next_occurrence, parse_time_of_day, Frequency};

/// Highest day-of-month the UI offers. February cannot reach 29 in a common
/// year, and silently skipping a month is more confusing than simply not
/// offering those days — see `Frequency::Monthly`.
const MAX_MONTHLY_DAY: u32 = 28;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringPayload {
    pub bot_id: Option<String>,
    pub channel_ids: Vec<String>,
    pub content_html: String,
    pub media: Vec<MediaItem>,
    pub draft_id: Option<String>,
    /// `daily` | `weekly` | `monthly`
    pub frequency: String,
    /// ISO weekday for `weekly`: 1 = Monday … 7 = Sunday.
    #[serde(default = "default_weekday")]
    pub weekday: u32,
    /// Day of month for `monthly`, 1–28.
    #[serde(default = "default_day")]
    pub day_of_month: u32,
    /// Local `HH:MM`.
    pub time_of_day: String,
}

fn default_weekday() -> u32 {
    1
}
fn default_day() -> u32 {
    1
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecurringInfo {
    pub id: String,
    pub draft_id: Option<String>,
    pub channel_id: String,
    pub channel_title: String,
    pub bot_id: String,
    pub content_preview: String,
    pub frequency: String,
    pub weekday: u32,
    pub day_of_month: u32,
    pub time_of_day: String,
    pub enabled: bool,
    pub next_run_at: Option<String>,
    pub last_run_at: Option<String>,
    pub media_count: i64,
}

/// Converts a naive local moment into the stored UTC instant.
///
/// The one real hazard is DST: around a spring-forward transition the local
/// time the rule names may not exist at all (`earliest()` returns `None`). In
/// that case the post goes out an hour later rather than not at all — a
/// plausible reading of "09:00" is better than silently dropping the run.
pub(crate) fn to_utc(local: NaiveDateTime) -> Option<chrono::DateTime<Utc>> {
    let resolved = Local
        .from_local_datetime(&local)
        .earliest()
        .or_else(|| Local.from_local_datetime(&(local + chrono::Duration::hours(1))).earliest())?;
    Some(resolved.with_timezone(&Utc))
}

/// Computes the rule's next firing instant (UTC) strictly after now.
fn compute_next_run(
    frequency: &Frequency,
    time_of_day: (u32, u32),
    now_local: NaiveDateTime,
) -> Result<String, String> {
    let next_local = next_occurrence(*frequency, time_of_day, now_local)
        .ok_or_else(|| "Не удалось вычислить следующую дату".to_string())?;
    let next_utc = to_utc(next_local).ok_or_else(|| "Не удалось перевести время в UTC".to_string())?;
    Ok(next_utc.to_rfc3339())
}

/// Persists a rule's attachments into its own directory, mirroring
/// `persist_scheduled_media`. Files are copied only once, at creation — a rule
/// fires indefinitely, so re-uploading media each run would be pointless work.
fn persist_recurring_media(
    db: &rusqlite::Connection,
    app_dir: &std::path::Path,
    recurring_id: &str,
    media: &[MediaItem],
    now: &str,
) -> Result<(), String> {
    if media.is_empty() {
        return Ok(());
    }
    use base64::Engine;
    let media_dir = app_dir.join("recurring_media").join(recurring_id);
    std::fs::create_dir_all(&media_dir).map_err(|e| format!("Не удалось создать директорию: {e}"))?;

    for (i, item) in media.iter().enumerate() {
        let raw = base64::engine::general_purpose::STANDARD
            .decode(&item.data_base64)
            .map_err(|_| format!("Ошибка декодирования файла «{}»", item.file_name))?;
        if raw.is_empty() {
            continue;
        }

        let ext: String = item
            .file_name
            .rsplit('.')
            .next()
            .unwrap_or("bin")
            .chars()
            .filter(|c| c.is_alphanumeric())
            .take(10)
            .collect();
        let ext = if ext.is_empty() { "bin".to_string() } else { ext };

        let file_path = media_dir.join(format!("{i}.{ext}"));
        std::fs::write(&file_path, &raw).map_err(|e| format!("Ошибка сохранения файла: {e}"))?;

        db.execute(
            "INSERT INTO recurring_media
             (id, recurring_id, file_path, file_name, mime_type, media_type, file_size, sort_order, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            rusqlite::params![
                Uuid::new_v4().to_string(),
                recurring_id,
                file_path.to_string_lossy(),
                item.file_name,
                item.mime_type,
                item.media_type,
                raw.len() as i64,
                i as i64,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn validate(payload: &RecurringPayload) -> Result<(Frequency, (u32, u32)), String> {
    if payload.channel_ids.is_empty() {
        return Err("Не выбран канал".to_string());
    }
    // Multiple channels are allowed and become one rule each (see the loop in
    // create_recurring_post). Keeping them as separate rules — rather than one
    // rule spanning several channels — is what makes "остановить повтор в этом
    // канале" a single, obvious action instead of an edit to a shared rule.
    if payload.content_html.trim().is_empty() {
        return Err("Пустой пост".to_string());
    }
    if payload.weekday > 7 || payload.day_of_month > MAX_MONTHLY_DAY {
        return Err("Некорректная периодичность".to_string());
    }
    let frequency = Frequency::from_parts(&payload.frequency, payload.weekday, payload.day_of_month)
        .ok_or_else(|| "Некорректная периодичность".to_string())?;
    let time_of_day =
        parse_time_of_day(&payload.time_of_day).ok_or_else(|| "Некорректное время".to_string())?;
    Ok((frequency, time_of_day))
}

/// Creates one rule per requested channel.
#[tauri::command]
pub async fn create_recurring_post(
    payload: RecurringPayload,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RecurringInfo>, String> {
    let (frequency, time_of_day) = validate(&payload)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let now_local = Local::now().naive_local();

    let bot_id = match &payload.bot_id {
        Some(id) if !id.is_empty() => id.clone(),
        _ => bots_q::find_all(&db)
            .map_err(|e| e.to_string())?
            .into_iter()
            .next()
            .map(|b| b.id)
            .ok_or_else(|| "Нет доступных ботов".to_string())?,
    };

    let next_run_at = compute_next_run(&frequency, time_of_day, now_local)?;
    let mut infos = Vec::new();

    for ch_id in &payload.channel_ids {
        let channel = channels_q::find_by_id(&db, ch_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Канал {ch_id} не найден"))?;

        let id = Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO recurring_posts
             (id, draft_id, channel_id, bot_id, content_html, frequency, weekday, day_of_month,
              time_of_day, enabled, next_run_at, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10,?11,?11)",
            rusqlite::params![
                id,
                payload.draft_id,
                ch_id,
                bot_id,
                payload.content_html,
                frequency.as_str(),
                payload.weekday,
                payload.day_of_month,
                format_time_of_day(time_of_day),
                next_run_at,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;

        persist_recurring_media(&db, &state.app_dir, &id, &payload.media, &now)?;

        infos.push(RecurringInfo {
            id,
            draft_id: payload.draft_id.clone(),
            channel_id: ch_id.clone(),
            channel_title: channel.title,
            bot_id: bot_id.clone(),
            content_preview: crate::commands::history::strip_html_preview(&payload.content_html, 60)
                .unwrap_or_default(),
            frequency: frequency.as_str().to_string(),
            weekday: payload.weekday,
            day_of_month: payload.day_of_month,
            time_of_day: format_time_of_day(time_of_day),
            enabled: true,
            next_run_at: Some(next_run_at.clone()),
            last_run_at: None,
            media_count: payload.media.len() as i64,
        });
    }

    Ok(infos)
}

fn read_all(db: &rusqlite::Connection) -> Result<Vec<RecurringInfo>, String> {
    let mut stmt = db
        .prepare(
            "SELECT r.id, r.draft_id, r.channel_id, COALESCE(c.title, ''), r.bot_id,
                    r.content_html, r.frequency, r.weekday, r.day_of_month, r.time_of_day,
                    r.enabled, r.next_run_at, r.last_run_at,
                    (SELECT COUNT(*) FROM recurring_media m WHERE m.recurring_id = r.id)
             FROM recurring_posts r
             LEFT JOIN channels c ON c.id = r.channel_id
             ORDER BY r.next_run_at IS NULL, r.next_run_at",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |r| {
            Ok(RecurringInfo {
                id: r.get(0)?,
                draft_id: r.get(1)?,
                channel_id: r.get(2)?,
                channel_title: r.get(3)?,
                bot_id: r.get(4)?,
                content_preview: crate::commands::history::strip_html_preview(
                    &r.get::<_, String>(5)?,
                    60,
                )
                .unwrap_or_default(),
                frequency: r.get(6)?,
                weekday: r.get(7)?,
                day_of_month: r.get(8)?,
                time_of_day: r.get(9)?,
                enabled: r.get::<_, i64>(10)? != 0,
                next_run_at: r.get(11)?,
                last_run_at: r.get(12)?,
                media_count: r.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub async fn get_recurring_posts(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<RecurringInfo>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    read_all(&db)
}

/// Enables or disables a rule. Re-enabling recomputes the next run from *now*,
/// so a rule turned back on after a long pause resumes with its next real
/// occurrence instead of firing a backlog of missed ones.
#[tauri::command]
pub async fn set_recurring_enabled(
    id: String,
    enabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<RecurringInfo, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    let (frequency_str, weekday, day_of_month, time_of_day): (String, u32, u32, String) = db
        .query_row(
            "SELECT frequency, weekday, day_of_month, time_of_day FROM recurring_posts WHERE id = ?1",
            rusqlite::params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| "Повтор не найден".to_string())?;

    let next_run_at = if enabled {
        let frequency = Frequency::from_parts(&frequency_str, weekday, day_of_month)
            .ok_or_else(|| "Некорректная периодичность".to_string())?;
        let tod = parse_time_of_day(&time_of_day).ok_or_else(|| "Некорректное время".to_string())?;
        Some(compute_next_run(&frequency, tod, Local::now().naive_local())?)
    } else {
        None
    };

    db.execute(
        "UPDATE recurring_posts SET enabled=?1, next_run_at=?2, updated_at=?3 WHERE id=?4",
        rusqlite::params![if enabled { 1 } else { 0 }, next_run_at, now, id],
    )
    .map_err(|e| e.to_string())?;

    read_all(&db)?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(|| "Повтор не найден".to_string())
}

#[tauri::command]
pub async fn delete_recurring_post(
    id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Attachments belong to the rule, so they go with it. Materialized posts
    // already copied what they need into their own directory.
    let _ = std::fs::remove_dir_all(state.app_dir.join("recurring_media").join(&id));
    db.execute("DELETE FROM recurring_media WHERE recurring_id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    db.execute("DELETE FROM recurring_posts WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Copies one rule's attachments into a freshly-materialized post's own
/// directory, so the scheduler's normal cleanup can delete them afterwards
/// without touching the rule's originals.
pub fn copy_media_to_scheduled(
    db: &rusqlite::Connection,
    app_dir: &std::path::Path,
    recurring_id: &str,
    scheduled_post_id: &str,
    now: &str,
) -> Result<(), String> {
    let mut stmt = db
        .prepare(
            "SELECT file_path, file_name, mime_type, media_type, file_size, sort_order
             FROM recurring_media WHERE recurring_id = ?1 ORDER BY sort_order",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, String, String, String, i64, i64)> = stmt
        .query_map(rusqlite::params![recurring_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    if rows.is_empty() {
        return Ok(());
    }

    let media_dir = app_dir.join("scheduled_media").join(scheduled_post_id);
    std::fs::create_dir_all(&media_dir).map_err(|e| format!("Не удалось создать директорию: {e}"))?;

    for (file_path, file_name, mime_type, media_type, file_size, sort_order) in rows {
        // A missing source file is not fatal: the post still goes out, just
        // without that attachment (the same graceful degradation the send path
        // already applies to unreadable media).
        let ext = std::path::Path::new(&file_path)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin")
            .to_string();
        let dest = media_dir.join(format!("{sort_order}.{ext}"));
        let size = match std::fs::copy(&file_path, &dest) {
            Ok(bytes) => bytes as i64,
            Err(e) => {
                log::warn!("[recurring] could not copy attachment {file_path}: {e}");
                continue;
            }
        };

        db.execute(
            "INSERT INTO scheduled_media
             (id, scheduled_post_id, file_path, file_name, mime_type, media_type, file_size, sort_order, created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            rusqlite::params![
                Uuid::new_v4().to_string(),
                scheduled_post_id,
                dest.to_string_lossy(),
                file_name,
                mime_type,
                media_type,
                if size > 0 { size } else { file_size },
                sort_order,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
