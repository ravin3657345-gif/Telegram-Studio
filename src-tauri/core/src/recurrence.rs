//! Next-occurrence math for recurring posts.
//!
//! A recurring post is a standing rule ("каждый день в 09:00"), and every time
//! it comes due the scheduler stamps a concrete `scheduled_posts` row out of
//! it. Working out *when* it is next due is the only part of that worth
//! testing on its own — and it is the part that is easy to get subtly wrong
//! (off-by-one-day, a weekly rule that skips its own slot, a month rollover).
//!
//! Deliberately timezone-free: everything here works in *naive local* terms.
//! Turning the result into a stored UTC instant is the caller's job, because
//! that is where the machine's timezone and DST actually live — see
//! `scheduler::process_recurring`.

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, Timelike};

/// How often a recurring post repeats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Frequency {
    /// Every day at the rule's time.
    Daily,
    /// Once a week, on `weekday` (ISO: 1 = Monday … 7 = Sunday).
    Weekly { weekday: u32 },
    /// Once a month, on `day` (1–28 — capped so the rule never has to be
    /// "skipped" in February, which is a far more confusing behaviour than
    /// simply not offering the 29th–31st).
    Monthly { day: u32 },
}

impl Frequency {
    /// Parses the stored `frequency` string plus its two numeric fields.
    /// Returns `None` for anything that could not have been written by the UI,
    /// so a corrupted row is skipped instead of silently repeating daily.
    pub fn from_parts(frequency: &str, weekday: u32, day_of_month: u32) -> Option<Self> {
        match frequency {
            "daily" => Some(Frequency::Daily),
            "weekly" if (1..=7).contains(&weekday) => Some(Frequency::Weekly { weekday }),
            "monthly" if (1..=28).contains(&day_of_month) => {
                Some(Frequency::Monthly { day: day_of_month })
            }
            _ => None,
        }
    }

    /// The value stored back into the `frequency` column.
    pub fn as_str(&self) -> &'static str {
        match self {
            Frequency::Daily => "daily",
            Frequency::Weekly { .. } => "weekly",
            Frequency::Monthly { .. } => "monthly",
        }
    }
}

/// Parses a `HH:MM` 24-hour time. `None` for anything malformed or out of
/// range — a bad value must not silently become midnight.
pub fn parse_time_of_day(value: &str) -> Option<(u32, u32)> {
    let (h, m) = value.split_once(':')?;
    let hour: u32 = h.trim().parse().ok()?;
    let minute: u32 = m.trim().parse().ok()?;
    if hour < 24 && minute < 60 {
        Some((hour, minute))
    } else {
        None
    }
}

/// Renders `(hour, minute)` back as the stored `HH:MM`.
pub fn format_time_of_day(time: (u32, u32)) -> String {
    format!("{:02}:{:02}", time.0, time.1)
}

/// The first moment strictly after `after` at which the rule fires, in naive
/// local time. `None` only if the rule's own fields are impossible.
///
/// Strictly-after matters: the scheduler recomputes the next run immediately
/// after firing, and an inclusive comparison would hand back the very instant
/// that just ran — turning the rule into a loop.
pub fn next_occurrence(
    frequency: Frequency,
    time_of_day: (u32, u32),
    after: NaiveDateTime,
) -> Option<NaiveDateTime> {
    let on = |date: NaiveDate| -> Option<NaiveDateTime> {
        date.and_hms_opt(time_of_day.0, time_of_day.1, 0)
    };

    match frequency {
        Frequency::Daily => {
            let today = on(after.date())?;
            if today > after {
                Some(today)
            } else {
                on(after.date() + Duration::days(1))
            }
        }

        Frequency::Weekly { weekday } => {
            let target = weekday - 1; // ISO 1..=7 → 0..=6
            let current = after.date().weekday().num_days_from_monday();
            // Days from today to the target weekday, never negative.
            let ahead = (target + 7 - current) % 7;
            let candidate = on(after.date() + Duration::days(ahead as i64))?;
            if candidate > after {
                Some(candidate)
            } else {
                on(after.date() + Duration::days(ahead as i64 + 7))
            }
        }

        Frequency::Monthly { day } => {
            let candidate = on(NaiveDate::from_ymd_opt(after.year(), after.month(), day)?)?;
            if candidate > after {
                return Some(candidate);
            }
            let (year, month) = if after.month() == 12 {
                (after.year() + 1, 1)
            } else {
                (after.year(), after.month() + 1)
            };
            on(NaiveDate::from_ymd_opt(year, month, day)?)
        }
    }
}

/// Minutes past midnight, for the "лучшее время публикации" analysis.
pub fn minute_of_day(dt: NaiveDateTime) -> u32 {
    dt.hour() * 60 + dt.minute()
}

/// How late a post went out, described for the user, or `None` when it was on
/// time (within `threshold_minutes`).
///
/// A post only leaves the queue while the app is running, so anything that
/// became due while the machine was off goes out late when the app next
/// starts — and silently, unless we say so. Saying "опубликован с опозданием
/// на 9 ч" is the difference between a feature that looks broken and one that
/// plainly did its best.
///
/// Both timestamps are RFC 3339; unparseable input yields `None` (nothing to
/// report beats a wrong report).
pub fn describe_lateness(
    scheduled_at: &str,
    now: &str,
    threshold_minutes: i64,
) -> Option<String> {
    let at = chrono::DateTime::parse_from_rfc3339(scheduled_at).ok()?;
    let now = chrono::DateTime::parse_from_rfc3339(now).ok()?;
    let minutes = (now - at).num_minutes();
    if minutes <= threshold_minutes {
        return None;
    }
    Some(humanize_minutes(minutes))
}

/// "45 мин" / "2 ч 15 мин" / "1 д 3 ч" — rounded to the largest two units that
/// matter, never seconds.
fn humanize_minutes(minutes: i64) -> String {
    if minutes < 60 {
        format!("{minutes} мин")
    } else if minutes < 60 * 24 {
        format!("{} ч {} мин", minutes / 60, minutes % 60)
    } else {
        format!("{} д {} ч", minutes / (60 * 24), (minutes % (60 * 24)) / 60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(y, m, d)
            .unwrap()
            .and_hms_opt(h, min, 0)
            .unwrap()
    }

    #[test]
    fn daily_picks_today_when_the_time_is_still_ahead() {
        let next = next_occurrence(Frequency::Daily, (9, 0), at(2026, 9, 12, 7, 30));
        assert_eq!(next, Some(at(2026, 9, 12, 9, 0)));
    }

    #[test]
    fn daily_rolls_to_tomorrow_once_the_time_has_passed() {
        let next = next_occurrence(Frequency::Daily, (9, 0), at(2026, 9, 12, 9, 0));
        // Exactly on the slot counts as passed — otherwise the scheduler,
        // which recomputes right after firing, would loop on this instant.
        assert_eq!(next, Some(at(2026, 9, 13, 9, 0)));
    }

    #[test]
    fn daily_crosses_a_month_boundary() {
        let next = next_occurrence(Frequency::Daily, (23, 59), at(2026, 9, 30, 23, 59));
        assert_eq!(next, Some(at(2026, 10, 1, 23, 59)));
    }

    #[test]
    fn weekly_finds_the_same_week() {
        // 2026-09-12 is a Saturday; Monday of that week is the 14th.
        let next = next_occurrence(Frequency::Weekly { weekday: 1 }, (8, 0), at(2026, 9, 12, 12, 0));
        assert_eq!(next, Some(at(2026, 9, 14, 8, 0)));
    }

    #[test]
    fn weekly_falls_through_to_next_week_when_today_is_the_day_but_late() {
        // Saturday, rule is "every Saturday at 08:00", now 12:00 → next week.
        let next =
            next_occurrence(Frequency::Weekly { weekday: 6 }, (8, 0), at(2026, 9, 12, 12, 0));
        assert_eq!(next, Some(at(2026, 9, 19, 8, 0)));
    }

    #[test]
    fn weekly_never_skips_its_own_slot() {
        // Saturday at 07:00, rule 08:00 the same day → still today.
        let next =
            next_occurrence(Frequency::Weekly { weekday: 6 }, (8, 0), at(2026, 9, 12, 7, 0));
        assert_eq!(next, Some(at(2026, 9, 12, 8, 0)));
    }

    #[test]
    fn weekly_sunday_is_the_last_day_of_the_iso_week() {
        // Saturday 2026-09-12 → Sunday is the 13th, six days ahead.
        let next =
            next_occurrence(Frequency::Weekly { weekday: 7 }, (10, 0), at(2026, 9, 12, 9, 0));
        assert_eq!(next, Some(at(2026, 9, 13, 10, 0)));
    }

    #[test]
    fn weekly_wraps_across_a_year_boundary() {
        // 2026-12-31 is a Thursday; the next Monday is 2027-01-04.
        let next =
            next_occurrence(Frequency::Weekly { weekday: 1 }, (6, 0), at(2026, 12, 31, 20, 0));
        assert_eq!(next, Some(at(2027, 1, 4, 6, 0)));
    }

    #[test]
    fn monthly_stays_in_the_month_when_the_day_is_ahead() {
        let next = next_occurrence(Frequency::Monthly { day: 20 }, (12, 0), at(2026, 9, 12, 0, 0));
        assert_eq!(next, Some(at(2026, 9, 20, 12, 0)));
    }

    #[test]
    fn monthly_moves_to_next_month_once_the_day_has_passed() {
        let next = next_occurrence(Frequency::Monthly { day: 5 }, (12, 0), at(2026, 9, 12, 0, 0));
        assert_eq!(next, Some(at(2026, 10, 5, 12, 0)));
    }

    #[test]
    fn monthly_rolls_over_the_year_end() {
        let next = next_occurrence(Frequency::Monthly { day: 3 }, (9, 0), at(2026, 12, 20, 0, 0));
        assert_eq!(next, Some(at(2027, 1, 3, 9, 0)));
    }

    #[test]
    fn monthly_day_28_survives_february() {
        // The reason the UI caps the day at 28: this can never be impossible.
        let next = next_occurrence(Frequency::Monthly { day: 28 }, (9, 0), at(2027, 2, 1, 0, 0));
        assert_eq!(next, Some(at(2027, 2, 28, 9, 0)));
    }

    #[test]
    fn parses_only_real_times() {
        assert_eq!(parse_time_of_day("09:05"), Some((9, 5)));
        assert_eq!(parse_time_of_day("0:00"), Some((0, 0)));
        assert_eq!(parse_time_of_day("23:59"), Some((23, 59)));
        assert_eq!(parse_time_of_day("24:00"), None);
        assert_eq!(parse_time_of_day("09:60"), None);
        assert_eq!(parse_time_of_day("9"), None);
        assert_eq!(parse_time_of_day("nine:00"), None);
        assert_eq!(parse_time_of_day(""), None);
    }

    #[test]
    fn formats_times_zero_padded() {
        assert_eq!(format_time_of_day((9, 5)), "09:05");
        assert_eq!(format_time_of_day((0, 0)), "00:00");
    }

    #[test]
    fn rejects_nonsense_frequency_data() {
        assert_eq!(Frequency::from_parts("daily", 0, 0), Some(Frequency::Daily));
        assert_eq!(
            Frequency::from_parts("weekly", 3, 0),
            Some(Frequency::Weekly { weekday: 3 })
        );
        assert_eq!(
            Frequency::from_parts("monthly", 0, 31),
            None // 31 is deliberately not offered
        );
        assert_eq!(Frequency::from_parts("weekly", 8, 0), None);
        assert_eq!(Frequency::from_parts("hourly", 0, 0), None);
        assert_eq!(Frequency::from_parts("", 0, 0), None);
    }

    #[test]
    fn a_post_within_the_threshold_is_not_late() {
        assert_eq!(
            describe_lateness("2026-09-12T09:00:00+00:00", "2026-09-12T09:04:59+00:00", 5),
            None
        );
    }

    #[test]
    fn a_post_that_missed_its_slot_is_described() {
        // The realistic case: app was closed at 09:00, opened at 18:00.
        assert_eq!(
            describe_lateness("2026-09-12T09:00:00+00:00", "2026-09-12T18:00:00+00:00", 5),
            Some("9 ч 0 мин".to_string())
        );
    }

    #[test]
    fn lateness_scales_to_minutes_and_days() {
        assert_eq!(
            describe_lateness("2026-09-12T09:00:00+00:00", "2026-09-12T09:45:00+00:00", 5),
            Some("45 мин".to_string())
        );
        assert_eq!(
            describe_lateness("2026-09-12T09:00:00+00:00", "2026-09-13T12:30:00+00:00", 5),
            Some("1 д 3 ч".to_string())
        );
    }

    #[test]
    fn a_future_or_broken_timestamp_reports_nothing() {
        assert_eq!(
            describe_lateness("2026-09-12T10:00:00+00:00", "2026-09-12T09:00:00+00:00", 5),
            None
        );
        assert_eq!(describe_lateness("not a date", "2026-09-12T09:00:00+00:00", 5), None);
        assert_eq!(describe_lateness("2026-09-12T09:00:00+00:00", "", 5), None);
    }

    #[test]
    fn frequency_string_round_trips() {
        for f in [
            Frequency::Daily,
            Frequency::Weekly { weekday: 2 },
            Frequency::Monthly { day: 15 },
        ] {
            assert_eq!(Frequency::from_parts(f.as_str(), 2, 15), Some(f));
        }
    }
}
