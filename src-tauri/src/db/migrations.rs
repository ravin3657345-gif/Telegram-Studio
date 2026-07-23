use rusqlite::{Connection, Result};

pub fn run(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA)?;
    migrate_v2(conn)?;
    migrate_v3(conn)?;
    migrate_v4(conn)?;
    migrate_v5(conn)?;
    migrate_v6(conn)?;
    migrate_v7(conn)?;
    migrate_v8(conn)?;
    migrate_v9(conn)?;
    migrate_v10(conn)?;
    migrate_v11(conn)?;
    migrate_v12(conn)?;
    migrate_v13(conn)?;
    migrate_v14(conn)?;
    migrate_v15(conn)?;
    migrate_v16(conn)?;
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

fn migrate_v5(conn: &Connection) -> Result<()> {
    let _ = conn.execute_batch(
        "ALTER TABLE templates ADD COLUMN category TEXT NOT NULL DEFAULT 'other';"
    );
    Ok(())
}

fn migrate_v6(conn: &Connection) -> Result<()> {
    let _ = conn.execute_batch(
        "ALTER TABLE publication_history ADD COLUMN publish_mode TEXT NOT NULL DEFAULT 'normal';"
    );
    Ok(())
}

fn migrate_v7(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS license (
            id           INTEGER PRIMARY KEY CHECK (id = 1),
            key          TEXT NOT NULL,
            activated_at TEXT NOT NULL
        );"
    )?;
    Ok(())
}

fn migrate_v8(conn: &Connection) -> Result<()> {
    // Tracks transient-failure retries for scheduled posts so a temporary
    // network blip doesn't permanently fail a post (see scheduler::process_pending).
    let _ = conn.execute_batch(
        "ALTER TABLE scheduled_posts ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;"
    );
    Ok(())
}

fn migrate_v9(conn: &Connection) -> Result<()> {
    // Media (images/video/documents) attached to a scheduled post — persisted
    // to disk so it survives until the scheduler actually sends it, mirroring
    // the draft_media pattern. See scheduler::process_pending.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scheduled_media (
            id                TEXT PRIMARY KEY,
            scheduled_post_id TEXT NOT NULL,
            file_path         TEXT NOT NULL,
            file_name         TEXT NOT NULL,
            mime_type         TEXT NOT NULL,
            media_type        TEXT NOT NULL,
            file_size         INTEGER NOT NULL,
            sort_order        INTEGER NOT NULL DEFAULT 0,
            created_at        TEXT NOT NULL,
            FOREIGN KEY (scheduled_post_id) REFERENCES scheduled_posts(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_media ON scheduled_media(scheduled_post_id, sort_order);"
    )?;
    Ok(())
}

fn migrate_v10(conn: &Connection) -> Result<()> {
    // Template variables feature: track how often/when a template was used,
    // and which template a draft was created from (for display only — no FK
    // enforcement, a stale id just means the join finds no name later).
    let _ = conn.execute_batch(
        "ALTER TABLE templates ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0;"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE templates ADD COLUMN last_used_at TEXT;"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE drafts ADD COLUMN template_id TEXT;"
    );
    Ok(())
}

fn migrate_v11(conn: &Connection) -> Result<()> {
    // Unify templates into drafts as kind='template' rows — a template is
    // conceptually just a reusable post, and keeping it in a separate table
    // meant duplicating soft-delete/attachments/list logic and left templates
    // without any media persistence at all (see the ALTER for media below).
    let _ = conn.execute_batch("ALTER TABLE drafts ADD COLUMN kind TEXT NOT NULL DEFAULT 'draft';");
    let _ = conn.execute_batch("ALTER TABLE drafts ADD COLUMN category TEXT;");
    let _ = conn.execute_batch("ALTER TABLE drafts ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0;");
    let _ = conn.execute_batch("ALTER TABLE drafts ADD COLUMN last_used_at TEXT;");

    let templates_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='templates'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);

    if templates_exists {
        conn.execute_batch(
            "INSERT INTO drafts (id, title, post_title, content_json, content_text, parse_mode,
                                 status, kind, category, usage_count, last_used_at,
                                 created_at, updated_at)
             SELECT id, name, '', content_json, NULL, parse_mode,
                    'draft', 'template', category, usage_count, last_used_at,
                    created_at, updated_at
             FROM templates;
             DROP TABLE templates;"
        )?;
    }

    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_drafts_kind ON drafts(kind);")?;

    Ok(())
}

fn migrate_v12(conn: &Connection) -> Result<()> {
    // Persists which publish mode (normal/rich) a draft was written in — was
    // previously only a runtime UI toggle, never saved with the draft. Needed
    // so a scheduled post's mode can be checked later (e.g. to block editing
    // rich posts after they've been queued — Telegram has no editRichMessage).
    let _ = conn.execute_batch(
        "ALTER TABLE drafts ADD COLUMN publish_mode TEXT NOT NULL DEFAULT 'normal';"
    );
    Ok(())
}

fn migrate_v13(conn: &Connection) -> Result<()> {
    // Supabase-backed single-machine licensing: the local row now also
    // caches the machine hash the key was redeemed with, so
    // get_license_status can re-check "activated on THIS machine" fully
    // offline, without hitting the server on every launch (see
    // commands/license.rs). A copied/restored DB file with a stale hash
    // just re-triggers one online redeem call, which the server accepts
    // again for the same machine (already_this_machine) or rejects for a
    // different one (used_elsewhere).
    let _ = conn.execute_batch(
        "ALTER TABLE license ADD COLUMN machine_hash TEXT NOT NULL DEFAULT '';"
    );
    Ok(())
}

fn migrate_v14(conn: &Connection) -> Result<()> {
    // Rich Message scheduling: which mode a scheduled_posts row was written
    // in (mirrors drafts.publish_mode from migrate_v12 — needed so the
    // scheduler can tell whether to send via sendPhoto/sendVideo/sendDocument
    // or via sendRichMessage), and which tg://…?id= a scheduled_media row
    // corresponds to for a Rich post (NULL for normal-mode rows, unused there).
    let _ = conn.execute_batch(
        "ALTER TABLE scheduled_posts ADD COLUMN publish_mode TEXT NOT NULL DEFAULT 'normal';"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE scheduled_media ADD COLUMN attach_name TEXT;"
    );
    Ok(())
}

fn migrate_v15(conn: &Connection) -> Result<()> {
    // Reusable text snippets (CTA lines, hashtag sets, signatures) —
    // deliberately a standalone table, not folded into `drafts` the way
    // templates were: no attachments/publish machinery needed, just plain
    // text inserted at the editor cursor.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS snippets (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            content    TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_snippets_order ON snippets(sort_order, created_at);"
    )?;
    Ok(())
}

fn migrate_v16(conn: &Connection) -> Result<()> {
    // draft_media.id used to be the sole PRIMARY KEY, but it's also reused
    // as the semantic file_id that content_json's blockImage/blockVideo
    // nodes reference by (commands::drafts::get_draft maps media.id straight
    // to DraftAttachment.file_id) — so it can't just become a fresh UUID
    // without breaking that link. Any code path that reuses the same
    // file_id across MULTIPLE drafts silently lost its media as a result:
    // the built-in "Витрина блоков" example template's fileIds are fixed
    // constants, not freshly generated per use (see exampleTemplates.ts's
    // SHOWCASE_ASSETS), so a second draft's INSERT for id='demo-collage-1'
    // collided with whichever draft first ever used it — the ON CONFLICT
    // UPDATE clause refreshed the file bytes/metadata but never reassigned
    // draft_id, so that first draft silently kept absorbing every later
    // use's files while every subsequent draft got zero of its own rows.
    // Live-reported 2026-07-23. Normal user uploads never hit this (their
    // file_id is already a fresh UUID per attachment via fileRegistry.add),
    // which is why it went unnoticed until a fixed-fileId example did.
    // Fixed by scoping the primary key to (draft_id, id) instead of id
    // alone — the same file_id can now coexist across different drafts,
    // each with its own row. SQLite can't ALTER a PRIMARY KEY in place, so
    // this rebuilds the table; existing rows carry over unchanged (the
    // four demo-* rows currently pointing at the oldest showcase draft
    // stay valid for that draft, they just stop blocking every later one).
    //
    // Idempotency: `run()` re-executes every migrate_vN on every launch
    // (same pattern as migrate_v11's `templates_exists` check below it in
    // this file), so this only rebuilds while the table still has the OLD
    // single-column key — a fresh `CREATE TABLE draft_media_v16` on an
    // already-migrated database would otherwise error the moment this
    // function ran a second time.
    let already_migrated: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='draft_media' AND sql LIKE '%PRIMARY KEY (draft_id, id)%'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|c| c > 0)
        .unwrap_or(false);
    if already_migrated {
        return Ok(());
    }

    conn.execute_batch(
        "CREATE TABLE draft_media_v16 (
            id          TEXT NOT NULL,
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
            PRIMARY KEY (draft_id, id),
            FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
        );
        INSERT INTO draft_media_v16
            SELECT id, draft_id, file_path, file_name, mime_type, file_size,
                   width, height, duration, sort_order, created_at
            FROM draft_media;
        DROP TABLE draft_media;
        ALTER TABLE draft_media_v16 RENAME TO draft_media;
        CREATE INDEX IF NOT EXISTS idx_media_draft ON draft_media(draft_id, sort_order);"
    )?;
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
    id          TEXT NOT NULL,
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
    PRIMARY KEY (draft_id, id),
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
    retry_count     INTEGER NOT NULL DEFAULT 0,
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
