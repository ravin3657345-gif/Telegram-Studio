export type Theme    = "dark" | "light" | "system";
// Alternate visual skin (a fixed look of its own, chosen separately from
// the light/dark Theme toggle above — see designs.css).
export type DesignTheme = "standard" | "soft";
export type Language = "ru" | "en" | "fr" | "pl" | "es";
export type ParseMode = "HTML" | "MarkdownV2";

export interface AppSettings {
  theme: Theme;
  language: Language;
  autosaveInterval: number;
  defaultParseMode: ParseMode;
  defaultBotId: string;
  defaultChannelId: string;
  showCharCounter: boolean;
  confirmBeforePublish: boolean;
}
