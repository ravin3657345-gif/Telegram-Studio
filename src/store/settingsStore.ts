import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Theme, Language, ParseMode, DesignTheme } from "@/types/settings";
import { setI18nLanguage } from "@/lib/i18n";

export type SidebarWidgetId = "clock" | "channels" | "drafts" | "nextPost" | "todayStats";
export const SIDEBAR_WIDGET_IDS: SidebarWidgetId[] = ["clock", "channels", "drafts", "nextPost", "todayStats"];

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
  // Alternate visual skin, independent of the light/dark Theme toggle above
  // — "standard" defers to Theme as usual, anything else applies its own
  // fixed look (see designs.css) regardless of the Theme setting.
  designTheme: DesignTheme;
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
  sidebarWidget: SidebarWidgetId;
  hasSeenOnboardingTour: boolean;
  // Empty string = use the default translated "👆 Лифт" text.
  anchorLinkText: string;

  setTheme: (theme: Theme) => void;
  setDesignTheme: (design: DesignTheme) => void;
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
  setSidebarWidget: (id: SidebarWidgetId) => void;
  setHasSeenOnboardingTour: (v: boolean) => void;
  setAnchorLinkText: (text: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme:                "light",
      designTheme:          "standard",
      language:             "ru",
      autosaveInterval:     2000,
      defaultParseMode:     "HTML",
      defaultBotId:         "",
      defaultChannelId:     "",
      showCharCounter:      true,
      confirmBeforePublish: true,
      accentColor:          "#3b6fe0",
      largeFontEditor:      false,
      showTelegramPreview:  true,
      sidebarWidget:        "clock",
      hasSeenOnboardingTour: false,
      anchorLinkText:       "",

      setTheme:                (theme)    => set({ theme }),
      // "soft" only has light-mode tokens (no dark variant designed for it),
      // so switching to it forces the light/dark Theme toggle back to light
      // — otherwise leftover dark-theme tokens (success/warning/danger/status
      // colors, which soft doesn't override) would leak through against its
      // light paper background.
      setDesignTheme: (design) => {
        set({ designTheme: design });
        document.documentElement.setAttribute("data-design", design);
        if (design === "soft" && get().theme !== "light") {
          set({ theme: "light" });
          document.documentElement.setAttribute("data-theme", "light");
        }
      },
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
      setSidebarWidget: (id) => set({ sidebarWidget: id }),
      setHasSeenOnboardingTour: (v) => set({ hasSeenOnboardingTour: v }),
      setAnchorLinkText: (text) => set({ anchorLinkText: text }),
    }),
    {
      name: "ts-settings",
      onRehydrateStorage: () => (state) => {
        if (state) {
          const resolved = state.designTheme === "soft" ? "light" :
            state.theme === "system"
              ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
              : state.theme;
          document.documentElement.setAttribute("data-theme", resolved);
          document.documentElement.setAttribute("data-design", state.designTheme ?? "standard");
          setI18nLanguage(state.language ?? "ru");
          if (state.accentColor && state.accentColor !== "#3b6fe0") {
            document.documentElement.style.setProperty("--accent", state.accentColor);
            document.documentElement.style.setProperty("--accent-hover", darkenHex(state.accentColor));
          }
          applyEditorFont(state.largeFontEditor ?? false);
        }
      },
    }
  )
);
