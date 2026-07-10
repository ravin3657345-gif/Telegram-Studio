export const TELEGRAM_MAX_TEXT_LENGTH    = 4096;   // Bot API — sendMessage
export const TELEGRAM_MAX_RICH_LENGTH   = 32768;  // Bot API 10.1 — sendRichMessage (UTF-8)
export const TELEGRAM_MAX_CAPTION_LENGTH = 1024;
export const TELEGRAM_MAX_MEDIA_GROUP  = 10;
export const TELEGRAM_MAX_PHOTO_SIZE   = 10 * 1024 * 1024; // 10 MB
export const TELEGRAM_MAX_VIDEO_SIZE   = 50 * 1024 * 1024; // 50 MB
export const TELEGRAM_MAX_AUDIO_SIZE   = 50 * 1024 * 1024; // 50 MB
export const TELEGRAM_MAX_FILE_SIZE    = 50 * 1024 * 1024; // 50 MB
export const TELEGRAM_MAX_BUTTONS_PER_ROW = 8;
export const TELEGRAM_MAX_BUTTON_ROWS    = 100;

export const DRAFT_MAX_COUNT = 100;

export const CHAR_COUNTER_WARNING_THRESHOLD = 3500;
export const CHAR_COUNTER_DANGER_THRESHOLD  = 3900;

// Rich messages are one HTML document capped at 32,768 chars regardless of
// whether photos/videos are embedded in it — unlike a normal-mode post, where
// attaching media turns it into a sendPhoto/sendVideo call with a much
// shorter 1024-char caption. Mode must be checked before hasMedia, or a Rich
// post with any image/video block would wrongly inherit the caption limit.
export function resolveMessageLimit(
  mode: "normal" | "rich" | "telegraph",
  hasMedia: boolean,
): number {
  if (mode === "rich") return TELEGRAM_MAX_RICH_LENGTH;
  return hasMedia ? TELEGRAM_MAX_CAPTION_LENGTH : TELEGRAM_MAX_TEXT_LENGTH;
}

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/mpeg"];
export const ALLOWED_GIF_TYPES   = ["image/gif", "video/mp4"];
export const ALLOWED_AUDIO_TYPES = ["audio/mpeg", "audio/ogg", "audio/mp4", "audio/wav"];

export const SUPPORTED_MEDIA_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
  ...ALLOWED_GIF_TYPES,
];
