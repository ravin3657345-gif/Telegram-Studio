import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Theme, Language, ParseMode } from "@/types/settings";
import { setI18nLanguage } from "@/lib/i18n";

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
  compactMode: boolean;
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
  setCompactMode: (v: boolean) => void;
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
      compactMode:          false,
      largeFontEditor:      false,
      showTelegramPreview:  true,

      setTheme:                (theme)   => set({ theme }),
      setLanguage:             (language) => { set({ language }); setI18nLanguage(language); },
      setAutosaveInterval:     (ms)      => set({ autosaveInterval: ms }),
      setDefaultParseMode:     (mode)    => set({ defaultParseMode: mode }),
      setDefaultBotId:         (id)      => set({ defaultBotId: id }),
      setDefaultChannelId:     (id)      => set({ defaultChannelId: id }),
      setShowCharCounter:      (v)       => set({ showCharCounter: v }),
      setConfirmBeforePublish: (v)       => set({ confirmBeforePublish: v }),
      setAccentColor:          (color)   => {
        set({ accentColor: color });
        document.documentElement.style.setProperty("--accent", color);
        document.documentElement.style.setProperty("--accent-hover", color);
      },
      setCompactMode:          (v)       => set({ compactMode: v }),
      setLargeFontEditor:      (v)       => set({ largeFontEditor: v }),
      setShowTelegramPreview:  (v)       => set({ showTelegramPreview: v }),
    }),
    {
      name: "ts-settings",
      onRehydrateStorage: () => (state) => {
        if (state) {
          const resolved =
            state.theme === "system"
              ? window.matchMedia("(prefers-color-scheme: dark)").matches
                ? "dark"
                : "light"
              : state.theme;
          document.documentElement.setAttribute("data-theme", resolved);
          setI18nLanguage(state.language ?? "ru");
          if (state.accentColor && state.accentColor !== "#2c87c9") {
            document.documentElement.style.setProperty("--accent", state.accentColor);
            document.documentElement.style.setProperty("--accent-hover", state.accentColor);
          }
        }
      },
    }
  )
);
