use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use crate::telegram::{
    client::{TelegramClient, TelegramError},
    types::{InlineKeyboardMarkup, TgChat, TgMessage, TgUser},
    TgForm, TgPart,
};

// ─── Payload structs ─────────────────────────────────────────────────────────

#[derive(Serialize)]
struct SendMessageBody<'a> {
    chat_id: &'a str,
    text: &'a str,
    parse_mode: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_markup: Option<&'a InlineKeyboardMarkup>,
    #[serde(skip_serializing_if = "Option::is_none")]
    disable_web_page_preview: Option<bool>,
}

#[derive(Serialize)]
struct GetChatBody<'a> {
    chat_id: &'a str,
}

// ─── Media item passed from the frontend ─────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub file_name: String,
    pub mime_type: String,
    pub media_type: String, // "image" | "video" | "file"
    pub data_base64: String,
}

// ─── API methods ─────────────────────────────────────────────────────────────

/// getMe — validate token, return bot info
pub async fn get_me(client: &TelegramClient) -> Result<TgUser, TelegramError> {
    client.call("getMe", &serde_json::json!({})).await
}

/// getChat — fetch channel/group info by @username or -100xxx id
pub async fn get_chat(
    client: &TelegramClient,
    chat_id: &str,
) -> Result<TgChat, TelegramError> {
    client.call("getChat", &GetChatBody { chat_id }).await
}

/// deleteMessage — remove a message the bot posted (best-effort)
pub async fn delete_message(
    client: &TelegramClient,
    chat_id: &str,
    message_id: i64,
) -> Result<(), TelegramError> {
    let _: bool = client
        .call(
            "deleteMessage",
            &serde_json::json!({ "chat_id": chat_id, "message_id": message_id }),
        )
        .await?;
    Ok(())
}

pub async fn get_chat_member_count(
    client: &TelegramClient,
    chat_id: &str,
) -> Result<i64, TelegramError> {
    client
        .call("getChatMemberCount", &GetChatBody { chat_id })
        .await
}

pub async fn edit_message_text(
    client: &TelegramClient,
    chat_id: &str,
    message_id: i64,
    text: &str,
    parse_mode: &str,
) -> Result<TgMessage, TelegramError> {
    client
        .call(
            "editMessageText",
            &serde_json::json!({
                "chat_id": chat_id,
                "message_id": message_id,
                "text": text,
                "parse_mode": parse_mode,
            }),
        )
        .await
}

pub async fn edit_message_caption(
    client: &TelegramClient,
    chat_id: &str,
    message_id: i64,
    caption: &str,
    parse_mode: &str,
) -> Result<TgMessage, TelegramError> {
    client
        .call(
            "editMessageCaption",
            &serde_json::json!({
                "chat_id": chat_id,
                "message_id": message_id,
                "caption": caption,
                "parse_mode": parse_mode,
            }),
        )
        .await
}

/// sendMessage — plain text with optional inline keyboard
pub async fn send_message(
    client: &TelegramClient,
    chat_id: &str,
    text: &str,
    parse_mode: &str,
    keyboard: Option<&InlineKeyboardMarkup>,
) -> Result<TgMessage, TelegramError> {
    client
        .call(
            "sendMessage",
            &SendMessageBody {
                chat_id,
                text,
                parse_mode,
                reply_markup: keyboard,
                disable_web_page_preview: Some(false),
            },
        )
        .await
}

/// sendPhoto — single image with caption
pub async fn send_photo(
    client: &TelegramClient,
    chat_id: &str,
    media: &MediaItem,
    caption: &str,
    parse_mode: &str,
    keyboard: Option<&InlineKeyboardMarkup>,
) -> Result<TgMessage, TelegramError> {
    let raw = general_purpose::STANDARD
        .decode(&media.data_base64)
        .map_err(|e| TelegramError::Base64(e.to_string()))?;

    let raw_len = raw.len();
    let (bytes, mime, name) = crate::image_utils::normalize_image(raw, &media.file_name)
        .map_err(TelegramError::Api)?;
    log::debug!("[photo] raw={} bytes, normalized={} bytes, mime={}, name={}", raw_len, bytes.len(), mime, name);

    let part = TgPart::bytes(bytes)
        .file_name(name)
        .mime_str(&mime)
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    let mut form = TgForm::new()
        .text("chat_id", chat_id.to_string())
        .text("caption", caption.to_string())
        .text("parse_mode", parse_mode.to_string())
        .part("photo", part);

    if let Some(kb) = keyboard {
        let kb_json = serde_json::to_string(kb)
            .map_err(|e| TelegramError::Json(e.to_string()))?;
        form = form.text("reply_markup", kb_json);
    }

    client.call_multipart("sendPhoto", form).await
}

/// sendVideo — single video with caption
pub async fn send_video(
    client: &TelegramClient,
    chat_id: &str,
    media: &MediaItem,
    caption: &str,
    parse_mode: &str,
    keyboard: Option<&InlineKeyboardMarkup>,
) -> Result<TgMessage, TelegramError> {
    let bytes = general_purpose::STANDARD
        .decode(&media.data_base64)
        .map_err(|e| TelegramError::Base64(e.to_string()))?;

    let part = TgPart::bytes(bytes)
        .file_name(media.file_name.clone())
        .mime_str(&media.mime_type)
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    let mut form = TgForm::new()
        .text("chat_id", chat_id.to_string())
        .text("caption", caption.to_string())
        .text("parse_mode", parse_mode.to_string())
        .part("video", part);

    if let Some(kb) = keyboard {
        let kb_json = serde_json::to_string(kb)
            .map_err(|e| TelegramError::Json(e.to_string()))?;
        form = form.text("reply_markup", kb_json);
    }

    client.call_multipart("sendVideo", form).await
}

/// sendDocument — any file type
pub async fn send_document(
    client: &TelegramClient,
    chat_id: &str,
    media: &MediaItem,
    caption: &str,
    parse_mode: &str,
    keyboard: Option<&InlineKeyboardMarkup>,
) -> Result<TgMessage, TelegramError> {
    let bytes = general_purpose::STANDARD
        .decode(&media.data_base64)
        .map_err(|e| TelegramError::Base64(e.to_string()))?;

    let mime = if media.mime_type.is_empty() { "application/octet-stream" } else { &media.mime_type };
    let part = TgPart::bytes(bytes)
        .file_name(media.file_name.clone())
        .mime_str(mime)
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    let mut form = TgForm::new()
        .text("chat_id", chat_id.to_string())
        .text("caption", caption.to_string())
        .text("parse_mode", parse_mode.to_string())
        .part("document", part);

    if let Some(kb) = keyboard {
        let kb_json = serde_json::to_string(kb)
            .map_err(|e| TelegramError::Json(e.to_string()))?;
        form = form.text("reply_markup", kb_json);
    }

    client.call_multipart("sendDocument", form).await
}

/// Kind of a `RichMediaPart` — maps directly to `InputMedia*`'s `type` field
/// (Bot API 10.2's `InputRichMessageMedia.media`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RichMediaKind {
    Photo,
    Video,
    Audio,
}

impl RichMediaKind {
    fn api_type(self) -> &'static str {
        match self {
            RichMediaKind::Photo => "photo",
            RichMediaKind::Video => "video",
            RichMediaKind::Audio => "audio",
        }
    }
}

/// One media attachment for `send_rich_message` — `id` is both the
/// `tg://{photo,video,audio}?id=` reference used in the HTML and the
/// multipart form field name the raw bytes are attached under (matching
/// `attach://{id}` in the generated `InputRichMessageMedia.media.media`).
#[derive(Debug, Clone)]
pub struct RichMediaPart {
    pub id: String,
    pub kind: RichMediaKind,
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub file_name: String,
}

/// sendRichMessage — Bot API 10.2.
/// Media is attached directly via multipart/form-data (Bot API 10.2's
/// `InputRichMessageMedia`/`media` field) instead of needing a public URL:
/// the HTML references each attachment as `tg://photo?id=…`/`tg://video?id=…`/
/// `tg://audio?id=…`, and `media` maps each such id to an `attach://{id}`
/// multipart part carrying the actual bytes — the same convention already
/// used by `send_media_group` below, just wrapped in `rich_message` instead
/// of a bare `media` array. This replaced an earlier design where photos had
/// to be uploaded to a public host first (external anonymous hosts, or a
/// throwaway sendPhoto-then-delete trick) purely because `sendRichMessage`
/// used to accept only HTTP(S) URLs for media.
pub async fn send_rich_message(
    client: &TelegramClient,
    chat_id: &str,
    html: &str,
    media: &[RichMediaPart],
) -> Result<TgMessage, TelegramError> {
    // Drop references to media that never made it into `media`. Callers strip
    // placeholders for attachments THEY failed to process, but an attachment
    // can also go missing before it ever reaches Rust — a file evicted from
    // the frontend's fileRegistry is skipped client-side while its
    // `tg://photo?id=…` tag stays in the HTML. Telegram then rejects the whole
    // message with RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND, losing an otherwise fine
    // post over one absent image. Guarding here rather than in each caller
    // covers every send path (immediate, republish, scheduled) at once.
    let known: std::collections::HashSet<&str> = media.iter().map(|m| m.id.as_str()).collect();
    let mut html = html.to_string();
    let mut dropped = 0usize;
    for id in tstudio_core::rich_html::referenced_media_ids(&html) {
        if !known.contains(id.as_str()) {
            log::warn!("[rich] dropping reference to missing media {id}");
            html = remove_img_placeholder(&html, &id);
            dropped += 1;
        }
    }

    // Losing SOME media still degrades gracefully above, but losing every last
    // attachment means nothing actually arrived — the frontend's fileRegistry
    // was emptied, or the files were evicted. Carrying on there posts a bubble
    // containing only the title to a real channel, which is worse than
    // failing: the user sees "published", the channel gets a stub, and there
    // is no hint anything went wrong. Live-reported 2026-08-01.
    if dropped > 0 && media.is_empty() {
        return Err(TelegramError::Api(
            "Файлы поста не найдены — переоткройте черновик и попробуйте ещё раз".to_string(),
        ));
    }

    let html = strip_empty_media_groups(html.trim());
    let html = html.as_str();

    if html.is_empty() {
        return Err(TelegramError::Api("Rich message HTML пустой".to_string()));
    }
    log::debug!("[rich] sending html len={} media={}", html.len(), media.len());

    let media_json: Vec<serde_json::Value> = media
        .iter()
        .map(|m| {
            serde_json::json!({
                "id": m.id,
                "media": {
                    "type": m.kind.api_type(),
                    "media": format!("attach://{}", m.id),
                },
            })
        })
        .collect();

    let mut rich_message = serde_json::json!({ "html": html });
    if !media_json.is_empty() {
        rich_message["media"] = serde_json::Value::Array(media_json);
    }

    let form = TgForm::new()
        .text("chat_id", chat_id.to_string())
        .text(
            "rich_message",
            serde_json::to_string(&rich_message).map_err(|e| TelegramError::Json(e.to_string()))?,
        );

    let form = media.iter().try_fold(form, |form, m| {
        let part = TgPart::bytes(m.bytes.clone())
            .file_name(m.file_name.clone())
            .mime_str(&m.mime_type)
            .map_err(|e| TelegramError::Network(e.to_string()))?;
        Ok::<_, TelegramError>(form.part(m.id.clone(), part))
    })?;

    client.call_multipart("sendRichMessage", form).await
}

/// Remove a failed-processing `<img src="tg://photo?id=ID"/>`/
/// `<video src="tg://video?id=ID"/>`/`<audio src="tg://audio?id=ID"></audio>`
/// tag from Rich HTML when `id` never made it into the `media` list (e.g. the
/// image failed to decode/normalize) — same shape whether the tag is
/// standalone or inside a `<tg-collage>` group (a dedicated content-based
/// `<photo>URL</photo>` form was tried and confirmed broken: Telegram doesn't
/// recognize it, strips the tag, and auto-links the bare URL text left behind).
pub fn remove_img_placeholder(html: &str, id: &str) -> String {
    let candidates = [
        format!("<img src=\"tg://photo?id={id}\"/>"),
        format!("<video src=\"tg://video?id={id}\"/>"),
        format!("<audio src=\"tg://audio?id={id}\"></audio>"),
    ];
    for candidate in &candidates {
        if let Some(pos) = html.find(candidate.as_str()) {
            let mut result = html[..pos].to_string();
            result.push_str(&html[pos + candidate.len()..]);
            return result;
        }
    }
    html.to_string()
}

/// After per-photo placeholder removal a `<tg-collage>`/`<tg-slideshow>`
/// group can end up with zero surviving `<img>`/`<video>` children — e.g.
/// every photo in that one group failed to upload while the rest of the post
/// (text, other groups) is fine. Telegram rejects the WHOLE message with
/// `RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND` if any group is left empty, so strip
/// such empty wrappers entirely rather than let one failed group take down
/// everything else that uploaded fine.
pub fn strip_empty_media_groups(html: &str) -> String {
    let mut result = html.to_string();
    for tag in ["tg-collage", "tg-slideshow"] {
        let open_needle = format!("<{tag}");
        let close_tag = format!("</{tag}>");
        let mut search_from = 0usize;
        loop {
            let Some(rel_open) = result[search_from..].find(&open_needle) else { break };
            let open_start = search_from + rel_open;
            let Some(rel_gt) = result[open_start..].find('>') else { break };
            let open_end = open_start + rel_gt + 1;
            let Some(rel_close) = result[open_end..].find(&close_tag) else { break };
            let close_start = open_end + rel_close;
            let close_end = close_start + close_tag.len();
            let inner = &result[open_end..close_start];
            if inner.contains("<img") || inner.contains("<video") {
                search_from = close_end;
            } else {
                result.replace_range(open_start..close_end, "");
                search_from = open_start;
            }
        }
    }
    result
}

/// sendPoll — create a poll in a channel
pub async fn send_poll(
    client: &TelegramClient,
    chat_id: &str,
    question: &str,
    options: &[String],
    is_anonymous: bool,
    allows_multiple_answers: bool,
) -> Result<TgMessage, TelegramError> {
    #[derive(Serialize)]
    struct InputPollOption {
        text: String,
    }
    #[derive(Serialize)]
    struct SendPollBody {
        chat_id: String,
        question: String,
        options: Vec<InputPollOption>,
        is_anonymous: bool,
        allows_multiple_answers: bool,
    }

    let body = SendPollBody {
        chat_id: chat_id.to_string(),
        question: question.to_string(),
        options: options.iter().map(|o| InputPollOption { text: o.clone() }).collect(),
        is_anonymous,
        allows_multiple_answers,
    };
    client.call("sendPoll", &body).await
}

/// sendMediaGroup — up to 10 media items in one album
pub async fn send_media_group(
    client: &TelegramClient,
    chat_id: &str,
    items: &[MediaItem],
    caption: &str,
    parse_mode: &str,
) -> Result<Vec<TgMessage>, TelegramError> {
    let mut form = TgForm::new()
        .text("chat_id", chat_id.to_string());

    let mut media_json = Vec::new();

    for (i, item) in items.iter().enumerate() {
        let attach_name = format!("file{}", i);

        let media_type_str = match item.media_type.as_str() {
            "image" => "photo",
            "video" => "video",
            _ => "document",
        };

        let mut entry = serde_json::json!({
            "type": media_type_str,
            "media": format!("attach://{}", attach_name),
        });
        if i == 0 {
            entry["caption"] = serde_json::Value::String(caption.to_string());
            entry["parse_mode"] = serde_json::Value::String(parse_mode.to_string());
        }
        media_json.push(entry);

        let raw = general_purpose::STANDARD
            .decode(&item.data_base64)
            .map_err(|e| TelegramError::Base64(e.to_string()))?;

        // normalize_image is for photos only — videos and files use raw bytes
        let (bytes, mime, name) = if item.media_type == "image" {
            let (b, m, n) = crate::image_utils::normalize_image(raw, &item.file_name)
                .map_err(TelegramError::Api)?;
            (b, m.to_string(), n)
        } else {
            let mime = if item.mime_type.is_empty() {
                "application/octet-stream".to_string()
            } else {
                item.mime_type.clone()
            };
            (raw, mime, item.file_name.clone())
        };

        let part = TgPart::bytes(bytes)
            .file_name(name)
            .mime_str(&mime)
            .map_err(|e| TelegramError::Network(e.to_string()))?;

        form = form.part(attach_name, part);
    }

    let media_str = serde_json::to_string(&media_json)
        .map_err(|e| TelegramError::Json(e.to_string()))?;
    form = form.text("media", media_str);

    client.call_multipart("sendMediaGroup", form).await
}
