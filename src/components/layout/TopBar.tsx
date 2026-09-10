import { useLocation } from "react-router-dom";
import { Search } from "lucide-react";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";
import type { TranslationKey } from "@/lib/i18n";

const PAGE_TITLE_KEYS: Record<string, TranslationKey> = {
  "/editor":    "topbar.editor",
  "/drafts":    "topbar.drafts",
  "/templates": "topbar.templates",
  "/schedule":  "topbar.schedule",
  "/history":   "topbar.history",
  "/channels":  "topbar.channels",
  "/bots":      "topbar.bots",
  "/settings":  "topbar.settings",
};

interface TopBarProps {
  title?: React.ReactNode;
  actions?: React.ReactNode;
}

export function TopBar({ title, actions }: TopBarProps) {
  const location = useLocation();
  // Subscribe to language so title re-renders on change
  useSettingsStore((s) => s.language);
  const isMobile = useIsMobileLayout();

  const key = Object.keys(PAGE_TITLE_KEYS).find((path) =>
    location.pathname.startsWith(path)
  ) as TranslationKey | undefined;

  const autoTitle = key ? t(PAGE_TITLE_KEYS[key]) : t("topbar.app");

  return (
    <header
      className="flex items-center justify-between px-5 flex-shrink-0 border-b"
      style={{
        height: "48px",
        backgroundColor: "var(--bg-app)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        className="text-sm font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        {title ?? autoTitle}
      </div>

      {(actions || isMobile) && (
        <div className="flex items-center gap-2">
          {isMobile && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("telegramstudio:open-palette"))}
              aria-label={t("palette.placeholder")}
              title={t("palette.placeholder")}
              className="flex items-center justify-center rounded-full"
              style={{ width: 36, height: 36, color: "var(--text-muted)", backgroundColor: "var(--bg-elevated)", border: "none" }}
            >
              <Search size={17} />
            </button>
          )}
          {actions}
        </div>
      )}
    </header>
  );
}
