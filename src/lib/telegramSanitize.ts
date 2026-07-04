import DOMPurify from "dompurify";

// The tag/attr allow-list mirrors what Telegram renders in messages and rich
// posts. Shared by the preview and any other component that shows user HTML.
export const TELEGRAM_TAGS = [
  "b", "strong", "i", "em", "u", "s", "strike", "del",
  "code", "pre", "a", "br", "blockquote",
  "h1", "h2", "h3", "ul", "ol", "li",
  "tg-spoiler", "mark", "sub", "sup",
  "img", "video", "span", "details", "summary",
];

export const TELEGRAM_ATTRS = [
  "href", "src", "alt", "data-post-title", "class", "style",
  "loop", "preload", "playsInline", "expandable",
];

/** Sanitize HTML down to the tag/attribute set Telegram supports. */
export function sanitizeTelegramHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: TELEGRAM_TAGS,
    ALLOWED_ATTR: TELEGRAM_ATTRS,
    ALLOW_DATA_ATTR: false,
  });
}
