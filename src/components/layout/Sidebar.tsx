import {
  Home,
  PenLine,
  Files,
  LayoutTemplate,
  CalendarClock,
  History,
  Radio,
  Bot,
  Settings,
  ChevronRight,
  Clock,
  BarChart2,
  FilePlus,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { SidebarItem } from "./SidebarItem";
import { Tooltip } from "@/components/ui/Tooltip";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useDraftsStore } from "@/store/draftsStore";
import { useChannelsStore } from "@/store/channelsStore";
import { useSettingsStore, SIDEBAR_WIDGET_IDS } from "@/store/settingsStore";
import type { SidebarWidgetId } from "@/store/settingsStore";
import { t, ti } from "@/lib/i18n";
import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getScheduledPosts, getTodayStats } from "@/lib/tauriApi";
import type { ScheduledPostInfo, TodayStats } from "@/types/publish";

// ─── Nav groups ───────────────────────────────────────────────────────────────

const CONTENT_ROUTES = [
  { to: "/",          icon: Home,           key: "nav.dashboard" as const, end: true },
  { to: "/editor",    icon: PenLine,        key: "nav.editor"    as const, dataTour: "nav-editor" },
  { to: "/drafts",    icon: Files,          key: "nav.drafts"    as const, hasBadge: true },
  { to: "/templates", icon: LayoutTemplate, key: "nav.templates" as const, dataTour: "nav-templates" },
  { to: "/schedule",  icon: CalendarClock,  key: "nav.schedule"  as const, dataTour: "nav-schedule" },
  { to: "/history",   icon: History,        key: "nav.history"   as const, dataTour: "nav-history" },
];

const MANAGE_ROUTES = [
  { to: "/channels",  icon: Radio,          key: "nav.channels"  as const },
  { to: "/bots",      icon: Bot,            key: "nav.bots"      as const },
];

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  const draftCount = useDraftsStore((s) => s.drafts.length);
  const navigate = useNavigate();
  useSettingsStore((s) => s.language);
  const [appVersion, setAppVersion] = useState("1.0.0");
  const [showNewPostConfirm, setShowNewPostConfirm] = useState(false);
  useEffect(() => { getVersion().then(setAppVersion).catch(() => {}); }, []);

  function confirmNewPost() {
    setShowNewPostConfirm(false);
    navigate("/editor", { state: { _newPost: Date.now() } });
  }

  return (
    <aside
      className="flex flex-col flex-shrink-0 border-r"
      style={{
        backgroundColor: "var(--bg-sidebar)",
        borderColor: "var(--border-subtle)",
        width: 240,
      }}
    >
      {/* ── Widget (clock / channels / drafts / next post / today) ─────────── */}
      <SidebarWidget />

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
            dataTour={"dataTour" in item ? item.dataTour : undefined}
            end={"end" in item ? item.end : undefined}
            action={
              item.to === "/editor"
                ? {
                    icon: FilePlus,
                    label: t("palette.newPost"),
                    // Confirm first — this unconditionally wipes whatever's
                    // in the editor (see PostEditor's isFreshSession reset),
                    // and unlike TimedUndoAction elsewhere in this app there's
                    // no "undo" to offer once unsaved content is gone.
                    onClick: () => setShowNewPostConfirm(true),
                  }
                : undefined
            }
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

      {showNewPostConfirm && (
        <ConfirmDialog
          title={t("editor.newPostConfirmTitle")}
          description={t("editor.newPostConfirmDesc")}
          confirmLabel={t("editor.newPostConfirmButton")}
          onConfirm={confirmNewPost}
          onClose={() => setShowNewPostConfirm(false)}
        />
      )}
    </aside>
  );
}

// ─── Widget shared styles ───────────────────────────────────────────────────────

const widgetLabelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 2, letterSpacing: "0.04em",
};
const widgetBigStyle: React.CSSProperties = {
  fontSize: 30, fontWeight: 700, letterSpacing: "-1px", color: "var(--text-primary)", lineHeight: 1,
  // Tabular figures so the ticking clock's digits don't jitter in width
  // second to second — also benefits the other widgets' plain counts.
  fontFamily: '"Geist Mono Variable", "Segoe UI Variable", monospace',
  fontVariantNumeric: "tabular-nums",
};
const widgetSecondaryStyle: React.CSSProperties = {
  fontSize: 12, color: "var(--text-primary)", fontWeight: 500,
};
const widgetLinkStyle: React.CSSProperties = {
  fontSize: 12, color: "var(--accent)", fontWeight: 600, background: "none", border: "none",
  padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 2,
};

function widgetLabel(id: SidebarWidgetId): string {
  switch (id) {
    case "channels":   return t("sidebar.widget.channels");
    case "drafts":     return t("sidebar.widget.drafts");
    case "nextPost":   return t("sidebar.widget.nextPost");
    case "todayStats": return t("sidebar.widget.todayStats");
    default:           return t("sidebar.widget.clock");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function widgetIcon(id: SidebarWidgetId): React.ComponentType<any> {
  switch (id) {
    case "channels":   return Radio;
    case "drafts":     return Files;
    case "nextPost":   return CalendarClock;
    case "todayStats": return BarChart2;
    default:           return Clock;
  }
}

// ─── Widget card frame + picker dots ────────────────────────────────────────────

function SidebarWidget() {
  const widget    = useSettingsStore((s) => s.sidebarWidget);
  const setWidget = useSettingsStore((s) => s.setSidebarWidget);

  return (
    <div
      data-tour="sidebar-widget"
      className="soft-ui"
      style={{
        margin: "10px 10px 6px",
        borderRadius: 12,
        padding: "12px 14px 10px",
        background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 12%, transparent) 0%, rgba(99,102,241,0.10) 100%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative blur circle */}
      <div style={{
        position: "absolute", top: -18, right: -18,
        width: 70, height: 70, borderRadius: "50%",
        background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 18%, transparent) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div style={{ position: "relative", minHeight: 66 }}>
        {widget === "clock"      && <ClockWidget />}
        {widget === "channels"   && <ChannelsWidget />}
        {widget === "drafts"     && <DraftsWidget />}
        {widget === "nextPost"   && <NextPostWidget />}
        {widget === "todayStats" && <TodayStatsWidget />}
      </div>

      {/* Picker — icon-only toggle group; no inline text label (it wrapped/
          overflowed the card), so the app's own Tooltip names each one on
          hover instead of the slow, inconsistently-styled native title. */}
      <div style={{ position: "relative", display: "flex", justifyContent: "center", gap: 4, marginTop: 9 }}>
        {SIDEBAR_WIDGET_IDS.map((id) => {
          const Icon = widgetIcon(id);
          const active = id === widget;
          return (
            <Tooltip key={id} content={widgetLabel(id)} delay={300}>
              <button
                onClick={() => setWidget(id)}
                aria-label={widgetLabel(id)}
                aria-current={active}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  flexShrink: 0,
                  borderRadius: 11,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: active ? "var(--accent)" : "transparent",
                  color: active ? "#fff" : "var(--text-muted)",
                  transition: "background-color 0.15s ease, color 0.15s ease",
                }}
                onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)"; }}
                onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
              >
                <Icon size={12} style={{ flexShrink: 0 }} />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

// ─── Clock widget ────────────────────────────────────────────────────────────

function ClockWidget() {
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
    <>
      <p style={widgetLabelStyle}>{day}</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3, marginBottom: 3 }}>
        <span style={widgetBigStyle}>{time}</span>
        <span
          style={{
            fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", lineHeight: 1, minWidth: 18,
            fontFamily: '"Geist Mono Variable", "Segoe UI Variable", monospace',
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {secs}
        </span>
      </div>
      <p style={widgetSecondaryStyle}>{date}</p>
    </>
  );
}

// ─── Channels widget ─────────────────────────────────────────────────────────

function ChannelsWidget() {
  const channels = useChannelsStore((s) => s.channels);
  const language = useSettingsStore((s) => s.language);
  const total = channels.length;
  const subs  = channels.reduce((sum, c) => sum + (c.memberCount ?? 0), 0);

  return (
    <>
      <p style={widgetLabelStyle}>{t("sidebar.widget.channels")}</p>
      <div style={{ marginBottom: 3 }}>
        <span style={widgetBigStyle}>{total}</span>
      </div>
      <p style={widgetSecondaryStyle}>
        {ti("sidebar.widget.subscribers", { n: subs.toLocaleString(language ?? "ru") })}
      </p>
    </>
  );
}

// ─── Drafts widget ───────────────────────────────────────────────────────────

function DraftsWidget() {
  const drafts   = useDraftsStore((s) => s.drafts);
  const navigate = useNavigate();

  const last = [...drafts].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )[0];

  return (
    <>
      <p style={widgetLabelStyle}>{t("sidebar.widget.drafts")}</p>
      <div style={{ marginBottom: 3 }}>
        <span style={widgetBigStyle}>{drafts.length}</span>
      </div>
      {last ? (
        <button onClick={() => navigate(`/editor/${last.id}`)} style={widgetLinkStyle}>
          {t("sidebar.widget.continueLast")}
          <ChevronRight size={12} />
        </button>
      ) : (
        <button onClick={() => navigate("/editor")} style={widgetLinkStyle}>
          {t("sidebar.widget.newDraft")}
          <ChevronRight size={12} />
        </button>
      )}
    </>
  );
}

// ─── Next scheduled post widget ──────────────────────────────────────────────

function formatTimeUntil(target: Date, now: Date): string {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return t("sidebar.widget.dueNow");
  const mins = Math.round(diffMs / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? ti("sidebar.widget.inHoursMinutes", { h, m }) : ti("sidebar.widget.inMinutes", { m });
}

function NextPostWidget() {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<ScheduledPostInfo[] | null>(null);
  const [now, setNow]     = useState(new Date());

  useEffect(() => {
    let active = true;
    const load = () => getScheduledPosts()
      .then((p) => { if (active) setPosts(p); })
      .catch(() => { if (active) setPosts([]); });
    load();
    const poll = setInterval(load, 60_000);
    return () => { active = false; clearInterval(poll); };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const next = posts?.[0];

  return (
    <>
      <p style={widgetLabelStyle}>{t("sidebar.widget.nextPost")}</p>
      {posts === null ? (
        <span style={{ ...widgetBigStyle, color: "var(--text-muted)" }}>…</span>
      ) : next ? (
        <>
          <div style={{ marginBottom: 3 }}>
            <span style={widgetBigStyle}>{formatTimeUntil(new Date(next.scheduledAt), now)}</span>
          </div>
          <p className="truncate" style={widgetSecondaryStyle}>
            {next.channelTitle}
            {next.contentPreview ? ` · ${next.contentPreview}` : ""}
          </p>
        </>
      ) : (
        <>
          <p style={{ ...widgetSecondaryStyle, marginBottom: 5 }}>{t("sidebar.widget.nextPostEmpty")}</p>
          <button onClick={() => navigate("/schedule")} style={widgetLinkStyle}>
            {t("sidebar.widget.nextPostEmptyHint")}
            <ChevronRight size={12} />
          </button>
        </>
      )}
    </>
  );
}

// ─── Today's activity widget ─────────────────────────────────────────────────

function TodayStatsWidget() {
  const [stats, setStats] = useState<TodayStats | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => getTodayStats()
      .then((s) => { if (active) setStats(s); })
      .catch(() => { if (active) setStats({ published: 0, failed: 0 }); });
    load();
    const poll = setInterval(load, 60_000);
    return () => { active = false; clearInterval(poll); };
  }, []);

  return (
    <>
      <p style={widgetLabelStyle}>{t("sidebar.widget.todayStats")}</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 3 }}>
        <span style={widgetBigStyle}>{stats === null ? "…" : stats.published}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>{t("sidebar.widget.todayPublished")}</span>
      </div>
      <p style={widgetSecondaryStyle}>
        {stats && stats.failed > 0 ? (
          <span style={{ color: "var(--danger)" }}>{ti("sidebar.widget.todayFailed", { n: stats.failed })}</span>
        ) : (
          t("sidebar.widget.todayAllGood")
        )}
      </p>
    </>
  );
}
