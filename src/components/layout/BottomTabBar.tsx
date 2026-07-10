import { useEffect, useRef, useState } from "react";
import {
  PenLine, Files, LayoutTemplate, CalendarClock, History,
  Radio, Bot, Settings, MoreHorizontal,
} from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { useDraftsStore } from "@/store/draftsStore";
import { t } from "@/lib/i18n";
import { Badge } from "@/components/ui/Badge";

const TABS: Array<{ to: string; icon: LucideIcon; key: "nav.editor" | "nav.drafts" | "nav.templates" | "nav.schedule" | "nav.history"; hasBadge?: boolean; dataTour?: string }> = [
  { to: "/editor",    icon: PenLine,       key: "nav.editor",    dataTour: "nav-editor" },
  { to: "/drafts",    icon: Files,         key: "nav.drafts",    hasBadge: true },
  { to: "/schedule",  icon: CalendarClock, key: "nav.schedule" },
  { to: "/history",   icon: History,       key: "nav.history" },
  { to: "/templates", icon: LayoutTemplate, key: "nav.templates" },
];

const MORE_ITEMS: Array<{ to: string; icon: LucideIcon; key: "nav.channels" | "nav.bots" | "nav.settings" }> = [
  { to: "/channels", icon: Radio,    key: "nav.channels" },
  { to: "/bots",     icon: Bot,      key: "nav.bots" },
  { to: "/settings", icon: Settings, key: "nav.settings" },
];

// Mobile equivalent of Sidebar — a fixed bottom tab bar (thumb-reachable,
// doesn't eat into the narrow width the way an always-visible sidebar would).
// The 3 least-used sections live behind a "More" sheet instead of a 6th/7th/8th
// icon crammed into the bar.
export function BottomTabBar() {
  const draftCount = useDraftsStore((s) => s.drafts.length);
  const location = useLocation();
  const navigate = useNavigate();
  const [showMore, setShowMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  const isMoreActive = MORE_ITEMS.some((item) => location.pathname.startsWith(item.to));

  useEffect(() => {
    if (!showMore) return;
    function handleDown(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setShowMore(false);
    }
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [showMore]);

  return (
    <nav
      className="flex items-stretch flex-shrink-0"
      style={{
        height: 56,
        borderTop: "1px solid var(--border-subtle)",
        backgroundColor: "var(--bg-sidebar)",
        position: "relative",
      }}
    >
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          data-tour={tab.dataTour}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 relative"
          style={({ isActive }) => ({
            color: isActive ? "var(--accent)" : "var(--text-muted)",
          })}
        >
          {({ isActive }) => (
            <>
              <span style={{ position: "relative" }}>
                <tab.icon size={19} strokeWidth={isActive ? 2.25 : 1.75} />
                {tab.hasBadge && draftCount > 0 && (
                  <span style={{ position: "absolute", top: -4, right: -8 }}>
                    <Badge count={draftCount} />
                  </span>
                )}
              </span>
              <span style={{ fontSize: 9.5, fontWeight: isActive ? 600 : 400 }}>{t(tab.key)}</span>
            </>
          )}
        </NavLink>
      ))}

      <button
        onClick={() => setShowMore((v) => !v)}
        className="flex flex-col items-center justify-center gap-0.5 flex-1"
        style={{ color: isMoreActive || showMore ? "var(--accent)" : "var(--text-muted)", background: "none", border: "none" }}
      >
        <MoreHorizontal size={19} strokeWidth={isMoreActive ? 2.25 : 1.75} />
        <span style={{ fontSize: 9.5, fontWeight: isMoreActive ? 600 : 400 }}>{t("nav.more")}</span>
      </button>

      {showMore && (
        <div
          ref={moreRef}
          style={{
            position: "absolute",
            bottom: "100%",
            right: 6,
            marginBottom: 6,
            minWidth: 180,
            backgroundColor: "var(--bg-elevated)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            padding: "4px 0",
            zIndex: 100,
          }}
        >
          {MORE_ITEMS.map((item) => (
            <button
              key={item.to}
              onClick={() => { setShowMore(false); navigate(item.to); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left"
              style={{
                color: location.pathname.startsWith(item.to) ? "var(--accent)" : "var(--text-secondary)",
                background: "none",
                border: "none",
              }}
            >
              <item.icon size={15} strokeWidth={1.75} />
              {t(item.key)}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
