import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Theme, Language, ParseMode } from "@/types/settings";
import { setI18nLanguage } from "@/lib/i18n";

function darkenHex(hex: string, pct = 0.15): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - pct)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - pct)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - pct)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function applyEditorFont(large: boolean) {
  document.documentElement.style.setProperty("--editor-font-size", large ? "19px" : "15px");
  document.documentElement.style.setProperty("--editor-line-height", large ? "30px" : "26px");
}

interface SettingsState {
  theme: Theme;
  language: Language;
  autosaveInterval: number;
  defaultParseMode: ParseMode;
  defaultBotId: string;
  defaultChannelId: string;
  showCharCounter: boolean;
  confirmBeforePublish: boolean;
  accentColor: string;
  largeFontEditor: boolean;
  showTelegramPreview: boolean;

  setTheme: (theme: Theme) => void;
  setLanguage: (lang: Language) => void;
  setAutosaveInterval: (ms: number) => void;
  setDefaultParseMode: (mode: ParseMode) => void;
  setDefaultBotId: (id: string) => void;
  setDefaultChannelId: (id: string) => void;
  setShowCharCounter: (v: boolean) => void;
  setConfirmBeforePublish: (v: boolean) => void;
  setAccentColor: (color: string) => void;
  setLargeFontEditor: (v: boolean) => void;
  setShowTelegramPreview: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme:                "dark",
      language:             "ru",
      autosaveInterval:     2000,
      defaultParseMode:     "HTML",
      defaultBotId:         "",
      defaultChannelId:     "",
      showCharCounter:      true,
      confirmBeforePublish: true,
      accentColor:          "#2c87c9",
      largeFontEditor:      false,
      showTelegramPreview:  true,

      setTheme:                (theme)    => set({ theme }),
      setLanguage:             (language) => { set({ language }); setI18nLanguage(language); },
      setAutosaveInterval:     (ms)       => set({ autosaveInterval: ms }),
      setDefaultParseMode:     (mode)     => set({ defaultParseMode: mode }),
      setDefaultBotId:         (id)       => set({ defaultBotId: id }),
      setDefaultChannelId:     (id)       => set({ defaultChannelId: id }),
      setShowCharCounter:      (v)        => set({ showCharCounter: v }),
      setConfirmBeforePublish: (v)        => set({ confirmBeforePublish: v }),
      setAccentColor: (color) => {
        set({ accentColor: color });
        document.documentElement.style.setProperty("--accent", color);
        document.documentElement.style.setProperty("--accent-hover", darkenHex(color));
      },
      setLargeFontEditor: (v) => {
        set({ largeFontEditor: v });
        applyEditorFont(v);
      },
      setShowTelegramPreview: (v) => set({ showTelegramPreview: v }),
    }),
    {
      name: "ts-settings",
      onRehydrateStorage: () => (state) => {
        if (state) {
          const resolved =
            state.theme === "system"
              ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
              : state.theme;
          document.documentElement.setAttribute("data-theme", resolved);
          setI18nLanguage(state.language ?? "ru");
          if (state.accentColor && state.accentColor !== "#2c87c9") {
            document.documentElement.style.setProperty("--accent", state.accentColor);
            document.documentElement.style.setProperty("--accent-hover", darkenHex(state.accentColor));
          }
          applyEditorFont(state.largeFontEditor ?? false);
        }
      },
    }
  )
);
