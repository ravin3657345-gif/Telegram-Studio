// Own multipart form builder, chainable the same way as reqwest's own
// `multipart::Form`/`Part` (see the 6 call sites in methods.rs — the diff
// there is just the type name). Used instead of reqwest's own type directly
// so the same field data can be handed to both the direct and Supabase-relay
// call paths in client.rs without double-consuming it (`reqwest::multipart::
// Form` can't be introspected/rebuilt once constructed — it's meant to be
// consumed once by a single request).
//
// Files are buffered fully in memory rather than streamed — Telegram's own
// Bot API caps uploads at 50MB, trivial to hold in RAM on a desktop app.

use crate::telegram::client::TelegramError;

enum TgField {
    Text(String),
    File { filename: String, mime: String, bytes: Vec<u8> },
}

pub struct TgForm {
    fields: Vec<(String, TgField)>,
}

impl TgForm {
    pub fn new() -> Self {
        Self { fields: Vec::new() }
    }

    pub fn text(mut self, name: impl Into<String>, value: String) -> Self {
        self.fields.push((name.into(), TgField::Text(value)));
        self
    }

    pub fn part(mut self, name: impl Into<String>, part: TgPart) -> Self {
        self.fields.push((
            name.into(),
            TgField::File { filename: part.filename, mime: part.mime, bytes: part.bytes },
        ));
        self
    }

    /// Builds a fresh `reqwest::multipart::Form` from the field data — not
    /// cached, since `Form` is meant to be consumed once by a single
    /// request and isn't `Clone`. Called again (once per call path that
    /// needs one) rather than shared, since a single `Form` can't be reused
    /// across two concurrent requests.
    pub fn into_reqwest(&self) -> Result<reqwest::multipart::Form, TelegramError> {
        let mut form = reqwest::multipart::Form::new();
        for (name, field) in &self.fields {
            form = match field {
                TgField::Text(value) => form.text(name.clone(), value.clone()),
                TgField::File { filename, mime, bytes } => {
                    let part = reqwest::multipart::Part::bytes(bytes.clone())
                        .file_name(filename.clone())
                        .mime_str(mime)
                        .map_err(|e| TelegramError::Network(e.to_string()))?;
                    form.part(name.clone(), part)
                }
            };
        }
        Ok(form)
    }
}

impl Default for TgForm {
    fn default() -> Self {
        Self::new()
    }
}

/// Read-only view of a `TgForm` field — lets client.rs build the
/// chunked-storage-relay JSON payload (see client.rs's `call_multipart_via_storage`)
/// without exposing `TgField`/`fields` themselves.
pub(crate) enum TgFieldRef<'a> {
    Text(&'a str),
    File { filename: &'a str, mime: &'a str, bytes: &'a [u8] },
}

impl TgForm {
    pub(crate) fn iter_fields(&self) -> impl Iterator<Item = (&str, TgFieldRef<'_>)> {
        self.fields.iter().map(|(name, field)| {
            let r = match field {
                TgField::Text(v) => TgFieldRef::Text(v),
                TgField::File { filename, mime, bytes } => {
                    TgFieldRef::File { filename, mime, bytes }
                }
            };
            (name.as_str(), r)
        })
    }
}

pub struct TgPart {
    filename: String,
    mime: String,
    bytes: Vec<u8>,
}

impl TgPart {
    pub fn bytes(bytes: Vec<u8>) -> Self {
        Self { filename: "file".to_string(), mime: "application/octet-stream".to_string(), bytes }
    }

    pub fn file_name(mut self, name: String) -> Self {
        self.filename = name;
        self
    }

    /// Matches reqwest::multipart::Part::mime_str's fallible signature (it
    /// validates against the `mime` crate's parser) purely so the 6 call
    /// sites in methods.rs — which already `.map_err(...)` this — don't
    /// need to change their error handling when swapping the type name.
    pub fn mime_str(mut self, mime: &str) -> Result<Self, TelegramError> {
        // reqwest::multipart::Part::mime_str does real validation via the
        // `mime` crate; a minimal sanity check here is enough since this
        // value only ever comes from `MediaItem.mime_type`/normalize_image,
        // never from unvalidated external input.
        if mime.is_empty() || !mime.contains('/') {
            return Err(TelegramError::Network(format!("invalid mime type: {mime}")));
        }
        self.mime = mime.to_string();
        Ok(self)
    }
}
