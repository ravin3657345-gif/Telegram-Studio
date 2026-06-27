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

// ─── Avatar color from name (consistent per channel) ─────────────────────────

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

  const currentBot     = bots.find((b) => b.id === activeBot);
  const currentChannel = channels.find((c) => c.id === activeChannel);
  const chanName       = currentChannel?.title ?? "";
  const bgColor        = chanName ? avatarColor(chanName) : "var(--accent)";

  return (
    <aside
      className="flex flex-col flex-shrink-0 border-r"
      style={{
        backgroundColor: "var(--bg-sidebar)",
        borderColor: "var(--border-subtle)",
        width: 240,
      }}
    >
      {/* Bot / Channel switcher */}
      <div className="relative mx-2 mt-2 mb-1">
        <button
          onClick={() => setShowChannelPicker((v) => !v)}
          className={clsx(
            "flex items-center gap-2 w-full px-3 py-2 rounded-lg transition-colors text-left",
            showChannelPicker ? "bg-[var(--bg-active)]" : "hover:bg-[var(--bg-hover)]"
          )}
        >
          <div
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
            style={{ backgroundColor: bgColor, color: "#fff" }}
          >
            {chanName?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>
              {currentBot ? `@${currentBot.username}` : t("sidebar.noBot")}
            </p>
            <p className="text-2xs truncate" style={{ color: "var(--text-secondary)" }}>
              {currentChannel?.title ?? t("sidebar.noChannel")}
            </p>
          </div>
          <ChevronDown
            size={14} strokeWidth={2}
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

      <div className="h-px mx-4 my-1" style={{ backgroundColor: "var(--border-subtle)" }} />

      {/* Content group */}
      <nav className="py-1 space-y-0.5">
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

      {/* Divider */}
      <div className="h-px mx-4 my-1.5" style={{ backgroundColor: "var(--border-subtle)" }} />

      {/* Manage group */}
      <nav className="py-1 space-y-0.5">
        {MANAGE_ROUTES.map((item) => (
          <SidebarItem
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={t(item.key)}
          />
        ))}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings + version */}
      <div className="pb-1">
        <SidebarItem to="/settings" icon={Settings} label={t("nav.settings")} />
        <NavLink
          to="/settings"
          className="block text-center text-2xs py-1.5 transition-colors hover:text-[var(--text-secondary)]"
          style={{ color: "var(--text-muted)" }}
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
              className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-2xs font-bold"
              style={{ backgroundColor: avatarColor(ch.title), color: "#fff" }}
            >
              {ch.title[0]?.toUpperCase()}
            </div>
            <span className="flex-1 truncate">{ch.title}</span>
            {ch.username && (
              <span className="text-2xs" style={{ color: "var(--text-muted)" }}>@{ch.username}</span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
