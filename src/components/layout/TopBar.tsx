import { useLocation } from "react-router-dom";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
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

      {actions && (
        <div className="flex items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}
