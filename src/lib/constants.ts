export const TELEGRAM_MAX_TEXT_LENGTH    = 30000;  // Bot API — sendMessage
export const TELEGRAM_MAX_RICH_LENGTH   = 32768;  // Bot API 10.1 — sendRichMessage (UTF-8)
export const TELEGRAM_MAX_CAPTION_LENGTH = 1024;
export const TELEGRAM_MAX_MEDIA_GROUP  = 10;
export const TELEGRAM_MAX_PHOTO_SIZE   = 10 * 1024 * 1024; // 10 MB
export const TELEGRAM_MAX_VIDEO_SIZE   = 50 * 1024 * 1024; // 50 MB
export const TELEGRAM_MAX_FILE_SIZE    = 50 * 1024 * 1024; // 50 MB
export const TELEGRAM_MAX_BUTTONS_PER_ROW = 8;
export const TELEGRAM_MAX_BUTTON_ROWS    = 100;

export const DRAFT_MAX_COUNT = 20;

export const AUTOSAVE_DEBOUNCE_MS = 2000;

export const CHAR_COUNTER_WARNING_THRESHOLD = 26000;
export const CHAR_COUNTER_DANGER_THRESHOLD  = 29500;

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/mpeg"];
export const ALLOWED_GIF_TYPES   = ["image/gif", "video/mp4"];

export const SUPPORTED_MEDIA_TYPES = [
  ...ALLOWED_IMAGE_TYPES,
  ...ALLOWED_VIDEO_TYPES,
  ...ALLOWED_GIF_TYPES,
];
