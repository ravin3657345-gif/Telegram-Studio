// Own multipart form builder, chainable the same way as reqwest's own
// `multipart::Form`/`Part` (see the 6 call sites in methods.rs — the diff
// there is just the type name) but able to produce TWO different outputs
// from the same field data: a `reqwest::multipart::Form` for the normal
// path, and hand-encoded raw multipart/form-data bytes for the fragmented
// fallback path in fragmented.rs, which doesn't go through reqwest at all
// and so can't be handed a `reqwest::multipart::Form` (that type can't be
// introspected/rebuilt once constructed — it's meant to be consumed once by
// reqwest itself).
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
    /// request and isn't `Clone`. Called again for the fragmented fallback
    /// path would be wrong (double-consumes the same bytes into two
    /// concurrently-live `Form`s) — that path uses `encode_raw` instead.
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

    /// Hand-encodes the same fields as a raw multipart/form-data body (RFC
    /// 7578) for the fragmented fallback path, which sends its own
    /// `Content-Type: multipart/form-data; boundary=...` header built from
    /// the same `boundary` string.
    pub fn encode_raw(&self, boundary: &str) -> Vec<u8> {
        let mut out = Vec::new();
        for (name, field) in &self.fields {
            out.extend_from_slice(b"--");
            out.extend_from_slice(boundary.as_bytes());
            out.extend_from_slice(b"\r\n");
            match field {
                TgField::Text(value) => {
                    out.extend_from_slice(
                        format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
                    );
                    out.extend_from_slice(value.as_bytes());
                }
                TgField::File { filename, mime, bytes } => {
                    out.extend_from_slice(
                        format!(
                            "Content-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n"
                        )
                        .as_bytes(),
                    );
                    out.extend_from_slice(bytes);
                }
            }
            out.extend_from_slice(b"\r\n");
        }
        out.extend_from_slice(b"--");
        out.extend_from_slice(boundary.as_bytes());
        out.extend_from_slice(b"--\r\n");
        out
    }
}

impl Default for TgForm {
    fn default() -> Self {
        Self::new()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_raw_matches_expected_bytes() {
        let form = TgForm::new()
            .text("chat_id", "123".to_string())
            .part("photo", TgPart::bytes(vec![1, 2, 3]).file_name("a.jpg".to_string()).mime_str("image/jpeg").unwrap());

        let out = form.encode_raw("BOUNDARY");
        let expected = b"--BOUNDARY\r\n\
Content-Disposition: form-data; name=\"chat_id\"\r\n\r\n\
123\r\n\
--BOUNDARY\r\n\
Content-Disposition: form-data; name=\"photo\"; filename=\"a.jpg\"\r\n\
Content-Type: image/jpeg\r\n\r\n\
\x01\x02\x03\r\n\
--BOUNDARY--\r\n"
            .to_vec();

        assert_eq!(out, expected);
    }
}
