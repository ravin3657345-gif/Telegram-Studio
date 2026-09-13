//! Publication analytics.
//!
//! Telegram's Bot API exposes no view or reach counters for channel posts, so
//! "how well did this do?" cannot be answered from the platform. What *can* be
//! answered honestly is what this app itself knows: how many posts went out,
//! how many failed, when they were sent, and to which channel. That is what
//! this computes — no invented numbers, nothing the channel owner could not
//! verify by scrolling their own channel.
//!
//! Everything is aggregated from `publication_history`, which already holds one
//! row per send attempt, so there is no new bookkeeping and no new table.
//!
//! Deliberately returns no per-day series: the dashboard already charts the
//! last seven days straight from history, and a second, differently-windowed
//! bar chart next to it would be noise rather than insight.

use std::collections::HashMap;

use chrono::{Local, Timelike};
use serde::Serialize;

use crate::db::AppState;

/// Most channels the breakdown shows. A dashboard is for the shape of the
/// picture, not an exhaustive report.
const MAX_CHANNELS: usize = 5;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelBucket {
    pub title: String,
    pub published: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationAnalytics {
    pub published: i64,
    pub failed: i64,
    /// Top channels by successful posts, most active first.
    pub by_channel: Vec<ChannelBucket>,
    /// Local hour of day (0–23) with the most successful posts, or `None` when
    /// there is nothing to compare yet. Local, not UTC: the user schedules in
    /// their own day, and "вы публикуете в 19:00" has to mean their 19:00.
    pub best_hour: Option<u32>,
}

#[tauri::command]
pub async fn get_publication_analytics(
    days: i64,
    state: tauri::State<'_, AppState>,
) -> Result<PublicationAnalytics, String> {
    let days = days.clamp(1, 365);
    let since = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();

    let rows: Vec<(String, String, String)> = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = db
            .prepare(
                "SELECT h.published_at, h.status, COALESCE(c.title, '')
                 FROM publication_history h
                 LEFT JOIN channels c ON c.id = h.channel_id
                 WHERE h.published_at >= ?1",
            )
            .map_err(|e| e.to_string())?;
        // Stored and compared as RFC 3339 with the same UTC offset, so the
        // string comparison is also a chronological one.
        let collected: Vec<(String, String, String)> = stmt
            .query_map([since.as_str()], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        collected
    };

    let mut published = 0i64;
    let mut failed = 0i64;
    let mut per_channel: HashMap<String, i64> = HashMap::new();
    let mut per_hour = [0i64; 24];

    for (published_at, status, channel_title) in rows {
        if status != "published" {
            failed += 1;
            continue;
        }
        published += 1;

        if let Some(local) = chrono::DateTime::parse_from_rfc3339(&published_at)
            .ok()
            .map(|d| d.with_timezone(&Local))
        {
            per_hour[local.hour() as usize] += 1;
        }
        if !channel_title.is_empty() {
            *per_channel.entry(channel_title).or_insert(0) += 1;
        }
    }

    // Ties go to the earlier hour — "чаще всего в 9:00" is more useful, and
    // less surprising, than the same count reported as midnight.
    let best_hour = per_hour
        .iter()
        .enumerate()
        .filter(|(_, count)| **count > 0)
        .max_by_key(|(hour, count)| (**count, std::cmp::Reverse(*hour)))
        .map(|(hour, _)| hour as u32);

    let mut by_channel: Vec<ChannelBucket> = per_channel
        .into_iter()
        .map(|(title, published)| ChannelBucket { title, published })
        .collect();
    by_channel.sort_by(|a, b| b.published.cmp(&a.published).then_with(|| a.title.cmp(&b.title)));
    by_channel.truncate(MAX_CHANNELS);

    Ok(PublicationAnalytics { published, failed, by_channel, best_hour })
}
