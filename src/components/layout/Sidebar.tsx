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
import { SidebarItem } from "./SidebarItem";
import { useChannelsStore } from "@/store/channelsStore";
import { useDraftsStore } from "@/store/draftsStore";
import { useSettingsStore } from "@/store/settingsStore";
import { t } from "@/lib/i18n";
import { useState } from "react";
import clsx from "clsx";

const NAV_ROUTES = [
  { to: "/editor",    icon: PenLine,        key: "nav.editor"    as const },
  { to: "/drafts",    icon: Files,          key: "nav.drafts"    as const, hasBadge: true },
  { to: "/templates", icon: LayoutTemplate, key: "nav.templates" as const },
  { to: "/schedule",  icon: CalendarClock,  key: "nav.schedule"  as const },
  { to: "/history",   icon: History,        key: "nav.history"   as const },
  { to: "/channels",  icon: Radio,          key: "nav.channels"  as const },
  { to: "/bots",      icon: Bot,            key: "nav.bots"      as const },
  { to: "/settings",  icon: Settings,       key: "nav.settings"  as const },
];

export function Sidebar() {
  const bots          = useChannelsStore((s) => s.bots);
  const channels      = useChannelsStore((s) => s.channels);
  const activeBot     = useChannelsStore((s) => s.activeBot);
  const activeChannel = useChannelsStore((s) => s.activeChannel);
  const draftCount    = useDraftsStore((s) => s.drafts.length);
  // Subscribe to language so sidebar labels re-render on change
  useSettingsStore((s) => s.language);
  const [showChannelPicker, setShowChannelPicker] = useState(false);

  const currentBot = bots.find((b) => b.id === activeBot);
  const currentChannel = channels.find((c) => c.id === activeChannel);

  return (
    <aside
      className="flex flex-col w-60 flex-shrink-0 border-r"
      style={{
        backgroundColor: "var(--bg-sidebar)",
        borderColor: "var(--border-subtle)",
        width: "240px",
      }}
    >
      {/* Bot / Channel switcher */}
      <div className="relative mx-2 mt-2 mb-1">
        <button
          onClick={() => setShowChannelPicker((v) => !v)}
          className={clsx(
            "flex items-center gap-2 w-full px-3 py-2 rounded-lg transition-colors text-left",
            showChannelPicker
              ? "bg-[var(--bg-active)]"
              : "hover:bg-[var(--bg-hover)]"
          )}
        >
          <div
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ backgroundColor: "var(--accent)", color: "#fff" }}
          >
            {currentChannel?.title?.[0] ?? "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-sm font-medium truncate"
              style={{ color: "var(--text-primary)" }}
            >
              {currentBot ? `@${currentBot.username}` : t("sidebar.noBot")}
            </p>
            <p
              className="text-2xs truncate"
              style={{ color: "var(--text-secondary)" }}
            >
              {currentChannel?.title ?? t("sidebar.noChannel")}
            </p>
          </div>
          <ChevronDown
            size={14}
            strokeWidth={2}
            className={clsx(
              "flex-shrink-0 transition-transform",
              showChannelPicker && "rotate-180"
            )}
            style={{ color: "var(--text-muted)" }}
          />
        </button>

        {/* Channel dropdown */}
        {showChannelPicker && (
          <ChannelDropdown
            channels={channels}
            activeChannel={activeChannel}
            onClose={() => setShowChannelPicker(false)}
          />
        )}
      </div>

      <div className="h-px mx-4 my-1" style={{ backgroundColor: "var(--border-subtle)" }} />

      {/* Navigation */}
      <nav className="flex-1 py-1 space-y-0.5">
        {NAV_ROUTES.map((item) => (
          <SidebarItem
            key={item.to}
            to={item.to}
            icon={item.icon}
            label={t(item.key)}
            badge={"hasBadge" in item && item.hasBadge ? draftCount : undefined}
          />
        ))}
      </nav>

      {/* Version */}
      <p
        className="text-center text-2xs py-2"
        style={{ color: "var(--text-muted)" }}
      >
        v0.5.0
      </p>
    </aside>
  );
}

interface ChannelDropdownProps {
  channels: { id: string; title: string; username?: string | null }[];
  activeChannel: string | null;
  onClose: () => void;
}

function ChannelDropdown({ channels, activeChannel, onClose }: ChannelDropdownProps) {
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
        <p
          className="px-3 py-2 text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          {t("sidebar.noChannels")}
        </p>
      ) : (
        channels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => {
              setActiveChannel(ch.id);
              onClose();
            }}
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--bg-hover)]"
            style={{
              color:
                ch.id === activeChannel
                  ? "var(--accent)"
                  : "var(--text-primary)",
            }}
          >
            <Radio size={14} />
            {ch.title}
            {ch.username && (
              <span style={{ color: "var(--text-muted)" }}>@{ch.username}</span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
