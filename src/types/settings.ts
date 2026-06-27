export type Theme    = "dark" | "light" | "system";
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
