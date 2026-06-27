import {
  PenLine,
  Files,
  LayoutTemplate,
  CalendarClock,
  History,
  Radio,
  Bot,
  Settings,
  ChevronDown,
  Search,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { SidebarItem } from "./SidebarItem";
import { useChannelsStore } from "@/store/channelsStore";
import { useDraftsStore } from "@/store/draftsStore";
import { useSettingsStore } from "@/store/settingsStore";
import { t } from "@/lib/i18n";
import { useState } from "react";
import clsx from "clsx";

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

// ─── Bot avatar gradient ──────────────────────────────────────────────────────

const AVATAR_PALETTE = [
  "#FF6B6B","#FF8E53","#FFC542","#2ECC71","#1ABC9C",
  "#3498DB","#9B59B6","#E91E63","#00BCD4","#4CAF50",
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export function Sidebar() {
  const bots          = useChannelsStore((s) => s.bots);
  const channels      = useChannelsStore((s) => s.channels);
  const activeBot     = useChannelsStore((s) => s.activeBot);
  const activeChannel = useChannelsStore((s) => s.activeChannel);
  const draftCount    = useDraftsStore((s) => s.drafts.length);
  useSettingsStore((s) => s.language);
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [searchQuery, setSearchQuery]             = useState("");

  const currentBot     = bots.find((b) => b.id === activeBot);
  const currentChannel = channels.find((c) => c.id === activeChannel);
  const botName        = currentBot ? `@${currentBot.username}` : t("sidebar.noBot");
  const chanName       = currentChannel?.title ?? t("sidebar.noChannel");

  return (
    <aside
      className="flex flex-col flex-shrink-0 border-r"
      style={{
        backgroundColor: "var(--bg-sidebar)",
        borderColor: "var(--border-subtle)",
        width: 240,
      }}
    >
      {/* ── Workspace switcher ──────────────────────────────────────────────── */}
      <div className="relative mx-2 mt-2 mb-1">
        <button
          onClick={() => setShowChannelPicker((v) => !v)}
          className={clsx(
            "flex items-center gap-2 w-full px-2.5 py-2 rounded-lg transition-colors text-left",
            showChannelPicker ? "bg-[var(--bg-active)]" : "hover:bg-[var(--bg-hover)]"
          )}
        >
          {/* Bot avatar — purple gradient */}
          <div
            className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold"
            style={{
              background: "linear-gradient(135deg, #9b6ff0, #7a4fe0)",
              color: "#fff",
              fontSize: 11,
            }}
          >
            {botName.replace("@", "")[0]?.toUpperCase() ?? "T"}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
              {botName}
            </p>
            <p className="truncate" style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: "16px" }}>
              {chanName}
            </p>
          </div>

          <ChevronDown
            size={13}
            strokeWidth={2}
            className={clsx("flex-shrink-0 transition-transform", showChannelPicker && "rotate-180")}
            style={{ color: "var(--text-muted)" }}
          />
        </button>

        {showChannelPicker && (
          <ChannelDropdown
            channels={channels}
            activeChannel={activeChannel}
            onClose={() => setShowChannelPicker(false)}
          />
        )}
      </div>

      {/* ── Search row ─────────────────────────────────────────────────────── */}
      <div className="mx-2 mb-1 px-2.5 h-8 flex items-center gap-2 rounded-lg transition-colors"
        style={{ backgroundColor: "var(--bg-hover)" }}
      >
        <Search size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("sidebar.search")}
          className="flex-1 bg-transparent text-xs outline-none"
          style={{ color: "var(--text-primary)" }}
        />
      </div>

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
          v0.5.0
        </NavLink>
      </div>
    </aside>
  );
}

// ─── Channel dropdown ──────────────────────────────────────────────────────────

function ChannelDropdown({
  channels,
  activeChannel,
  onClose,
}: {
  channels: { id: string; title: string; username?: string | null }[];
  activeChannel: string | null;
  onClose: () => void;
}) {
  const setActiveChannel = useChannelsStore((s) => s.setActiveChannel);
  useSettingsStore((s) => s.language);

  return (
    <div
      className="absolute left-0 right-0 top-full mt-1 rounded-lg border overflow-hidden z-50"
      style={{
        backgroundColor: "var(--bg-elevated)",
        borderColor: "var(--border-default)",
        boxShadow: "var(--shadow-md)",
      }}
    >
      {channels.length === 0 ? (
        <p className="px-3 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {t("sidebar.noChannels")}
        </p>
      ) : (
        channels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => { setActiveChannel(ch.id); onClose(); }}
            className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: ch.id === activeChannel ? "var(--accent)" : "var(--text-primary)" }}
          >
            <div
              className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center font-bold"
              style={{ backgroundColor: avatarColor(ch.title), color: "#fff", fontSize: 10 }}
            >
              {ch.title[0]?.toUpperCase()}
            </div>
            <span className="flex-1 truncate">{ch.title}</span>
            {ch.username && (
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>@{ch.username}</span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
