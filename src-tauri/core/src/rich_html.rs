//! Pure string helpers for Rich Message HTML (Bot API 10.2).
//!
//! Lives here rather than next to `telegram::methods` for the reason stated in
//! this crate's doc comment: the main app crate's test binary cannot even
//! start on Windows (STATUS_ENTRYPOINT_NOT_FOUND from the WebView2 link), so
//! anything in it is effectively untestable. This logic decides whether a post
//! is accepted or rejected outright by Telegram, which is exactly the kind of
//! thing that needs tests.

/// Every `id` referenced by a `tg://{photo,video,audio}?id=…` attribute in
/// `html`, in per-kind document order, deduplicated.
///
/// `send_rich_message` compares this against the attachments it was actually
/// handed: a reference with no matching attachment makes Telegram reject the
/// entire message with `RICH_MESSAGE_PHOTO_NO_MEDIA_FOUND`, so those tags have
/// to be stripped before sending.
///
/// Hand-rolled rather than regex-based — this workspace pulls in no regex
/// dependency, and the pattern is a fixed prefix followed by everything up to
/// the closing quote.
pub fn referenced_media_ids(html: &str) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for prefix in ["tg://photo?id=", "tg://video?id=", "tg://audio?id="] {
        let mut from = 0usize;
        while let Some(rel) = html[from..].find(prefix) {
            let start = from + rel + prefix.len();
            let end = html[start..].find('"').map(|i| start + i).unwrap_or(html.len());
            let id = &html[start..end];
            if !id.is_empty() && !ids.iter().any(|existing| existing == id) {
                ids.push(id.to_string());
            }
            // Advance past the id even when the closing quote is missing, so a
            // malformed tag can't spin this loop forever.
            from = end.max(start + 1);
        }
    }
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_ids_of_every_media_kind() {
        let html = r#"<p>hi</p><img src="tg://photo?id=img_0"/><video src="tg://video?id=vid_1"/><audio src="tg://audio?id=aud_2"></audio>"#;
        assert_eq!(referenced_media_ids(html), vec!["img_0", "vid_1", "aud_2"]);
    }

    #[test]
    fn finds_every_id_inside_a_collage() {
        let html = r#"<tg-collage><img src="tg://photo?id=img_0"/><img src="tg://photo?id=img_1"/><img src="tg://photo?id=img_2"/></tg-collage>"#;
        assert_eq!(referenced_media_ids(html), vec!["img_0", "img_1", "img_2"]);
    }

    #[test]
    fn html_without_media_yields_nothing() {
        assert!(referenced_media_ids("<p>just text</p>").is_empty());
        assert!(referenced_media_ids("").is_empty());
    }

    #[test]
    fn a_repeated_id_is_only_reported_once() {
        let html = r#"<img src="tg://photo?id=img_0"/><img src="tg://photo?id=img_0"/>"#;
        assert_eq!(referenced_media_ids(html), vec!["img_0"]);
    }

    #[test]
    fn similar_looking_text_is_not_mistaken_for_a_reference() {
        // A plain link to the string, not a media src — no `?id=` prefix match.
        let html = r#"<p>see tg://photo for details</p>"#;
        assert!(referenced_media_ids(html).is_empty());
    }

    #[test]
    fn malformed_tag_without_closing_quote_terminates() {
        // Must not loop forever or panic; the trailing run is taken as the id.
        let html = r#"<img src="tg://photo?id=img_0"#;
        assert_eq!(referenced_media_ids(html), vec!["img_0"]);
    }

    #[test]
    fn empty_id_is_ignored() {
        let html = r#"<img src="tg://photo?id="/>"#;
        assert!(referenced_media_ids(html).is_empty());
    }

    #[test]
    fn non_ascii_around_references_does_not_break_slicing() {
        // Byte-index slicing must land on char boundaries — Cyrillic caption text
        // around the tag would panic if an index were ever computed wrong.
        let html = r#"<p>Привет, мир</p><img src="tg://photo?id=img_0"/><p>Пока</p>"#;
        assert_eq!(referenced_media_ids(html), vec!["img_0"]);
    }
}
