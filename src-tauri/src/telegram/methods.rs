use base64::{Engine as _, engine::general_purpose};
use serde::{Deserialize, Serialize};
use crate::telegram::{
    client::{TelegramClient, TelegramError},
    types::{InlineKeyboardMarkup, TgChat, TgFile, TgMessage, TgUser},
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

/// getFile — resolve a file_id to a temporary downloadable file_path
pub async fn get_file(
    client: &TelegramClient,
    file_id: &str,
) -> Result<TgFile, TelegramError> {
    client
        .call("getFile", &serde_json::json!({ "file_id": file_id }))
        .await
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

/// Re-host a local JPEG on Telegram's own CDN and return a public HTTPS URL
/// suitable as `<img src=...>` inside a rich message, together with the staging
/// message id (so the caller can delete it AFTER the rich message is sent — the
/// file must stay alive until Telegram fetches it).
///
/// Flow (entirely server-side, the bot token never reaches JS):
/// 1. sendPhoto (silent) to a staging chat → get the largest photo's file_id
/// 2. getFile → file_path → build the public api.telegram.org/file URL
///
/// When this URL is placed in a rich message, Telegram re-fetches the media
/// server-side and serves it from its own CDN, so the token URL is not exposed
/// to recipients.
pub async fn stage_photo_url(
    client: &TelegramClient,
    staging_chat: &str,
    jpeg_bytes: Vec<u8>,
) -> Result<(String, i64), TelegramError> {
    let part = reqwest::multipart::Part::bytes(jpeg_bytes)
        .file_name("photo.jpg")
        .mime_str("image/jpeg")
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    let form = reqwest::multipart::Form::new()
        .text("chat_id", staging_chat.to_string())
        .text("disable_notification", "true")
        .part("photo", part);

    let msg: TgMessage = client.call_multipart("sendPhoto", form).await?;

    let file_id = msg
        .photo
        .as_ref()
        .and_then(|sizes| sizes.last())
        .map(|s| s.file_id.clone())
        .ok_or_else(|| TelegramError::Api("sendPhoto не вернул photo".to_string()))?;

    let file = get_file(client, &file_id).await?;

    let path = file
        .file_path
        .ok_or_else(|| TelegramError::Api("getFile вернул пустой file_path".to_string()))?;

    let url = format!(
        "https://api.telegram.org/file/bot{}/{}",
        client.token(),
        path
    );
    Ok((url, msg.message_id))
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

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(name)
        .mime_str(&mime)
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    let mut form = reqwest::multipart::Form::new()
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

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(media.file_name.clone())
        .mime_str(&media.mime_type)
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    let mut form = reqwest::multipart::Form::new()
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
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(media.file_name.clone())
        .mime_str(mime)
        .map_err(|e| TelegramError::Network(e.to_string()))?;

    let mut form = reqwest::multipart::Form::new()
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

/// sendRichMessage — Bot API 10.1.
/// HTML must contain real public HTTPS URLs for images (Telegraph CDN).
/// All photo uploading and placeholder replacement happens before this call.
pub async fn send_rich_message(
    client: &TelegramClient,
    chat_id: &str,
    html: &str,
) -> Result<TgMessage, TelegramError> {
    if html.is_empty() {
        return Err(TelegramError::Api("Rich message HTML пустой".to_string()));
    }
    log::debug!("[rich] sending html len={}", html.len());
    let body = serde_json::json!({
        "chat_id": chat_id,
        "rich_message": { "html": html }
    });
    client.call("sendRichMessage", &body).await
}

/// Remove `<img src="PLACEHOLDER"/>` tags from HTML when upload failed.
pub fn remove_img_placeholder(html: &str, placeholder: &str) -> String {
    let mut result = String::new();
    let mut remaining = html;
    while let Some(img_start) = remaining.find("<img") {
        let before = &remaining[..img_start];
        let after = &remaining[img_start..];
        if let Some(img_end) = after.find('>') {
            let tag = &after[..=img_end];
            if tag.contains(placeholder) {
                result.push_str(before.trim_end_matches('\n'));
                remaining = after[img_end + 1..].trim_start_matches('\n');
                continue;
            }
        }
        result.push_str(before);
        result.push_str("<img");
        remaining = &after[4..];
    }
    result.push_str(remaining);
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
    let mut form = reqwest::multipart::Form::new()
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

        let part = reqwest::multipart::Part::bytes(bytes)
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
