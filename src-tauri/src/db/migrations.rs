use rusqlite::{Connection, Result};

pub fn run(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA)?;
    migrate_v2(conn)?;
    migrate_v3(conn)?;
    migrate_v4(conn)?;
    seed_settings(conn)?;
    Ok(())
}

fn migrate_v2(conn: &Connection) -> Result<()> {
    // ADD COLUMN IF NOT EXISTS — SQLite doesn't support it natively,
    // so we attempt and ignore "duplicate column" errors.
    let _ = conn.execute_batch(
        "ALTER TABLE drafts ADD COLUMN post_title TEXT NOT NULL DEFAULT '';"
    );
    Ok(())
}

fn migrate_v3(conn: &Connection) -> Result<()> {
    // Templates table (added in v3)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS templates (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            content_json TEXT NOT NULL DEFAULT '{}',
            parse_mode   TEXT NOT NULL DEFAULT 'HTML',
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_templates_updated ON templates(updated_at DESC);"
    )?;
    // delete_at column for scheduled deletion of published posts
    let _ = conn.execute_batch(
        "ALTER TABLE publication_history ADD COLUMN delete_at TEXT;"
    );
    Ok(())
}

fn migrate_v4(conn: &Connection) -> Result<()> {
    // Recreate scheduled_posts: make draft_id nullable, add content_html.
    // Guard: skip if content_html already exists.
    let has_col: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('scheduled_posts') WHERE name='content_html'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if has_col {
        return Ok(());
    }

    conn.execute_batch("
        PRAGMA foreign_keys = OFF;

        CREATE TABLE scheduled_posts_new (
            id              TEXT PRIMARY KEY,
            draft_id        TEXT,
            channel_id      TEXT NOT NULL,
            bot_id          TEXT NOT NULL,
            content_html    TEXT,
            scheduled_at    TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending',
            error_message   TEXT,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );

        INSERT INTO scheduled_posts_new
            SELECT id, draft_id, channel_id, bot_id, NULL,
                   scheduled_at, status, error_message, created_at, updated_at
            FROM scheduled_posts;

        DROP TABLE scheduled_posts;
        ALTER TABLE scheduled_posts_new RENAME TO scheduled_posts;
        CREATE INDEX IF NOT EXISTS idx_scheduled_time ON scheduled_posts(status, scheduled_at);

        PRAGMA foreign_keys = ON;
    ")?;

    Ok(())
}

fn seed_settings(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "INSERT OR IGNORE INTO settings (key, value) VALUES
            ('theme', 'dark'),
            ('language', 'ru'),
            ('autosave_interval', '2000'),
            ('default_parse_mode', 'HTML'),
            ('default_bot_id', ''),
            ('default_channel_id', ''),
            ('show_char_counter', '1'),
            ('confirm_before_publish', '1');",
    )
}

const SCHEMA: &str = "
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS bots (
    id          TEXT PRIMARY KEY,
    token       TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    username    TEXT NOT NULL,
    avatar_url  TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
    id              TEXT PRIMARY KEY,
    bot_id          TEXT NOT NULL,
    telegram_id     TEXT NOT NULL,
    title           TEXT NOT NULL,
    username        TEXT,
    description     TEXT,
    avatar_path     TEXT,
    member_count    INTEGER,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY (bot_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS drafts (
    id              TEXT PRIMARY KEY,
    title           TEXT,
    content_json    TEXT NOT NULL DEFAULT '{}',
    content_text    TEXT,
    parse_mode      TEXT NOT NULL DEFAULT 'HTML',
    status          TEXT NOT NULL DEFAULT 'draft',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS draft_media (
    id          TEXT PRIMARY KEY,
    draft_id    TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    file_name   TEXT NOT NULL,
    mime_type   TEXT NOT NULL,
    file_size   INTEGER NOT NULL,
    width       INTEGER,
    height      INTEGER,
    duration    INTEGER,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS draft_buttons (
    id          TEXT PRIMARY KEY,
    draft_id    TEXT NOT NULL,
    row_index   INTEGER NOT NULL,
    col_index   INTEGER NOT NULL,
    label       TEXT NOT NULL,
    url         TEXT,
    callback    TEXT,
    FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
    id              TEXT PRIMARY KEY,
    draft_id        TEXT NOT NULL,
    channel_id      TEXT NOT NULL,
    bot_id          TEXT NOT NULL,
    scheduled_at    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    error_message   TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY (draft_id) REFERENCES drafts(id),
    FOREIGN KEY (channel_id) REFERENCES channels(id),
    FOREIGN KEY (bot_id) REFERENCES bots(id)
);

CREATE TABLE IF NOT EXISTS publication_history (
    id              TEXT PRIMARY KEY,
    draft_id        TEXT,
    channel_id      TEXT NOT NULL,
    bot_id          TEXT NOT NULL,
    telegram_msg_id INTEGER,
    content_json    TEXT NOT NULL,
    status          TEXT NOT NULL,
    error_message   TEXT,
    published_at    TEXT NOT NULL,
    FOREIGN KEY (channel_id) REFERENCES channels(id),
    FOREIGN KEY (bot_id) REFERENCES bots(id)
);

CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drafts_status   ON drafts(status);
CREATE INDEX IF NOT EXISTS idx_drafts_updated  ON drafts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_channels_bot    ON channels(bot_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_time  ON scheduled_posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_history_pub     ON publication_history(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_channel ON publication_history(channel_id);
CREATE INDEX IF NOT EXISTS idx_media_draft     ON draft_media(draft_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_buttons_draft   ON draft_buttons(draft_id, row_index, col_index);
";
