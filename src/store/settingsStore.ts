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

  setTheme: (theme: Theme) => void;
  setLanguage: (lang: Language) => void;
  setAutosaveInterval: (ms: number) => void;
  setDefaultParseMode: (mode: ParseMode) => void;
  setDefaultBotId: (id: string) => void;
  setDefaultChannelId: (id: string) => void;
  setShowCharCounter: (v: boolean) => void;
  setConfirmBeforePublish: (v: boolean) => void;
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

      setTheme:                (theme)   => set({ theme }),
      setLanguage:             (language) => { set({ language }); setI18nLanguage(language); },
      setAutosaveInterval:     (ms)      => set({ autosaveInterval: ms }),
      setDefaultParseMode:     (mode)    => set({ defaultParseMode: mode }),
      setDefaultBotId:         (id)      => set({ defaultBotId: id }),
      setDefaultChannelId:     (id)      => set({ defaultChannelId: id }),
      setShowCharCounter:      (v)       => set({ showCharCounter: v }),
      setConfirmBeforePublish: (v)       => set({ confirmBeforePublish: v }),
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
          // Apply saved language immediately so t() works on first render
          setI18nLanguage(state.language ?? "ru");
        }
      },
    }
  )
);
