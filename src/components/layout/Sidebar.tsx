import {
  PenLine,
  Files,
  LayoutTemplate,
  CalendarClock,
  History,
  Radio,
  Bot,
  Settings,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { SidebarItem } from "./SidebarItem";
import { useDraftsStore } from "@/store/draftsStore";
import { useSettingsStore } from "@/store/settingsStore";
import { t } from "@/lib/i18n";
import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";

// ─── Nav groups ───────────────────────────────────────────────────────────────

const CONTENT_ROUTES = [
  { to: "/editor",    icon: PenLine,        key: "nav.editor"    as const },
  { to: "/drafts",    icon: Files,          key: "nav.drafts"    as const, hasBadge: true },
  { to: "/templates", icon: LayoutTemplate, key: "nav.templates" as const },
  { to: "/schedule",  icon: CalendarClock,  key: "nav.schedule"  as const },
  { to: "/history",   icon: History,        key: "nav.history"   as const },
];

const MANAGE_ROUTES = [
  { to: "/channels",  icon: Radio,          key: "nav.channels"  as const },
  { to: "/bots",      icon: Bot,            key: "nav.bots"      as const },
];

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  const draftCount = useDraftsStore((s) => s.drafts.length);
  useSettingsStore((s) => s.language);
  const [appVersion, setAppVersion] = useState("1.0.0");
  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  return (
    <aside
      className="flex flex-col flex-shrink-0 border-r"
      style={{
        backgroundColor: "var(--bg-sidebar)",
        borderColor: "var(--border-subtle)",
        width: 240,
      }}
    >
      {/* ── Date / time widget ──────────────────────────────────────────────── */}
      <DateTimeWidget />

      <div className="h-px mx-3 my-1" style={{ backgroundColor: "var(--border-subtle)" }} />

      {/* ── Content nav ────────────────────────────────────────────────────── */}
      <nav className="py-0.5 space-y-0.5">
        {CONTENT_ROUTES.map((item) => (
          <SidebarItem
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={t(item.key)}
            badge={"hasBadge" in item && item.hasBadge ? draftCount : undefined}
          />
        ))}
      </nav>

      {/* ── Manage group ───────────────────────────────────────────────────── */}
      <div className="h-px mx-3 my-1.5" style={{ backgroundColor: "var(--border-subtle)" }} />

      <p
        className="px-4 mb-1"
        style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", color: "var(--text-muted)", textTransform: "uppercase" }}
      >
        {t("sidebar.manage")}
      </p>

      <nav className="py-0.5 space-y-0.5">
        {MANAGE_ROUTES.map((item) => (
          <SidebarItem
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={t(item.key)}
          />
        ))}
      </nav>

      {/* ── Spacer ─────────────────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Settings + version ─────────────────────────────────────────────── */}
      <div className="pb-1">
        <SidebarItem to="/settings" icon={Settings} label={t("nav.settings")} />
        <NavLink
          to="/settings"
          className="block text-center py-1.5 transition-colors hover:text-[var(--text-secondary)]"
          style={{ color: "var(--text-muted)", fontSize: 11 }}
        >
          v{appVersion}
        </NavLink>
      </div>
    </aside>
  );
}

// ─── Date / time widget ────────────────────────────────────────────────────────

function DateTimeWidget() {
  const [now, setNow] = useState(new Date());
  const language = useSettingsStore((s) => s.language);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const pad  = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const secs = pad(now.getSeconds());
  const locale = language ?? "ru";
  const day  = now.toLocaleDateString(locale, { weekday: "long" });
  const date = now.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });

  return (
    <div
      style={{
        margin: "10px 10px 6px",
        borderRadius: 12,
        padding: "12px 14px 10px",
        background: "linear-gradient(135deg, rgba(42,171,238,0.12) 0%, rgba(99,102,241,0.10) 100%)",
        border: "1px solid rgba(42,171,238,0.18)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative blur circle */}
      <div style={{
        position: "absolute", top: -18, right: -18,
        width: 70, height: 70, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(42,171,238,0.18) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Day of week */}
      <p style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)", marginBottom: 2, letterSpacing: "0.04em" }}>
        {day}
      </p>

      {/* Time — large */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginBottom: 3 }}>
        <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-1px", color: "var(--text-primary)", lineHeight: 1 }}>
          {time}
        </span>
        <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-muted)", lineHeight: 1, minWidth: 18 }}>
          {secs}
        </span>
      </div>

      {/* Date */}
      <p style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 400 }}>
        {date}
      </p>
    </div>
  );
}
