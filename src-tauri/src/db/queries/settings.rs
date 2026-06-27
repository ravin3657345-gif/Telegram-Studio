use crate::db::models::AppSettings;
use rusqlite::{Connection, Result};

pub fn load(conn: &Connection) -> Result<AppSettings> {
    let mut s = AppSettings::default();
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows.flatten() {
        let (key, value) = row;
        match key.as_str() {
            "theme"                  => s.theme = value,
            "language"               => s.language = value,
            "autosave_interval"      => { if let Ok(v) = value.parse() { s.autosave_interval = v; } }
            "default_parse_mode"     => s.default_parse_mode = value,
            "default_bot_id"         => s.default_bot_id = value,
            "default_channel_id"     => s.default_channel_id = value,
            "show_char_counter"      => s.show_char_counter = value == "true",
            "confirm_before_publish" => s.confirm_before_publish = value == "true",
            _ => {}
        }
    }
    Ok(s)
}

pub fn save_key(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        [key, value],
    )?;
    Ok(())
}
