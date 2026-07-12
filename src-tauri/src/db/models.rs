use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Bot {
    pub id: String,
    pub token: String,
    pub name: String,
    pub username: String,
    pub avatar_url: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub bot_id: String,
    pub telegram_id: String,
    pub title: String,
    pub username: Option<String>,
    pub description: Option<String>,
    pub avatar_path: Option<String>,
    pub member_count: Option<i64>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: String,
    pub title: Option<String>,
    pub post_title: String,
    pub content_json: String,
    pub content_text: Option<String>,
    pub parse_mode: String,
    pub status: String,
    /// "normal" | "rich" — which publish mode the post was composed in.
    /// Rich posts can't be edited via Telegram's API once scheduled/published
    /// (no editRichMessage), so the frontend gates the editor on this.
    pub publish_mode: String,
    pub template_id: Option<String>,
    /// Joined from `templates.name` for display only — not a stored column.
    pub template_name: Option<String>,
    pub media: Vec<DraftMedia>,
    pub buttons: Vec<DraftButton>,
    pub attachments: Vec<DraftAttachment>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DraftSummary {
    pub id: String,
    pub title: Option<String>,
    pub post_title: String,
    pub content_text: Option<String>,
    pub media_count: i64,
    pub button_count: i64,
    pub status: String,
    pub publish_mode: String,
    pub scheduled_at: Option<String>,
    pub updated_at: String,
}

/// File attachment sent with a draft (frontend → Rust)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DraftAttachmentPayload {
    pub file_id:    String,
    pub data_base64: String,
    pub mime_type:  String,
    pub file_name:  String,
}

/// File attachment returned to frontend (Rust → frontend)
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DraftAttachment {
    pub file_id:    String,
    pub data_base64: String,
    pub mime_type:  String,
    pub file_name:  String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DraftPayload {
    pub id: Option<String>,
    pub title: Option<String>,
    pub post_title: Option<String>,
    pub content_json: String,
    pub content_text: Option<String>,
    pub parse_mode: Option<String>,
    /// "normal" | "rich". Sent on every autosave once the frontend toggle
    /// changes; falls back to the existing row's value when absent (older
    /// frontend builds / payloads that predate this field).
    pub publish_mode: Option<String>,
    /// Set only when creating a draft from a template; omitted on every later
    /// autosave, which must preserve the existing row's value instead of
    /// clearing it (see commands::drafts::upsert_draft).
    pub template_id: Option<String>,
    /// Files referenced by blockImage/blockVideo nodes
    pub attachments: Option<Vec<DraftAttachmentPayload>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DraftMedia {
    pub id: String,
    pub draft_id: String,
    pub file_path: String,
    pub file_name: String,
    pub mime_type: String,
    pub file_size: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration: Option<i64>,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DraftButton {
    pub id: String,
    pub draft_id: String,
    pub row_index: i64,
    pub col_index: i64,
    pub label: String,
    pub url: Option<String>,
    pub callback: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ScheduledPost {
    pub id: String,
    pub draft_id: String,
    pub channel_id: String,
    pub bot_id: String,
    pub scheduled_at: String,
    pub status: String,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PublicationHistory {
    pub id: String,
    pub draft_id: Option<String>,
    pub channel_id: String,
    pub bot_id: String,
    pub telegram_msg_id: Option<i64>,
    pub content_json: String,
    pub status: String,
    pub error_message: Option<String>,
    pub published_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub language: String,
    pub autosave_interval: u64,
    pub default_parse_mode: String,
    pub default_bot_id: String,
    pub default_channel_id: String,
    pub show_char_counter: bool,
    pub confirm_before_publish: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            theme: "dark".to_string(),
            language: "ru".to_string(),
            autosave_interval: 2000,
            default_parse_mode: "HTML".to_string(),
            default_bot_id: String::new(),
            default_channel_id: String::new(),
            show_char_counter: true,
            confirm_before_publish: true,
        }
    }
}
