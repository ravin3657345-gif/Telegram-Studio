export type Theme    = "dark" | "light" | "system";
// Alternate visual skin, chosen separately from the light/dark Theme toggle
// above — "standard" defers to Theme, "soft" has its own light+dark tokens
// in designs.css and honors the Theme toggle too.
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
