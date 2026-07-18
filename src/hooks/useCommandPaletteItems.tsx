import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { PenLine, Files, LayoutTemplate, CalendarClock, History, Radio, Bot, Settings, FileText, Hash } from "lucide-react";
import { useDraftsStore } from "@/store/draftsStore";
import { useChannelsStore } from "@/store/channelsStore";
import { t } from "@/lib/i18n";

export interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  section: string;
  icon: ReactNode;
  onSelect: () => void;
}

// Static page shortcuts — same routes/icons as Sidebar.tsx's CONTENT_ROUTES/
// MANAGE_ROUTES, kept in sync manually (there's no shared source of truth
// for the nav list to import from).
const NAV_ROUTES = [
  { to: "/editor",    icon: PenLine,        key: "nav.editor" as const },
  { to: "/drafts",    icon: Files,          key: "nav.drafts" as const },
  { to: "/templates", icon: LayoutTemplate, key: "nav.templates" as const },
  { to: "/schedule",  icon: CalendarClock,  key: "nav.schedule" as const },
  { to: "/history",   icon: History,        key: "nav.history" as const },
  { to: "/channels",  icon: Radio,          key: "nav.channels" as const },
  { to: "/bots",      icon: Bot,            key: "nav.bots" as const },
  { to: "/settings",  icon: Settings,       key: "nav.settings" as const },
];

// Aggregates the three data sources the app already keeps in separate
// zustand stores (drafts, channels, bots — see BlockTable... no, see
// draftsStore.ts/channelsStore.ts) into one flat searchable list for the
// command palette. No new store: this just re-derives on every render from
// whatever's already loaded, memoized on the actual inputs.
export function useCommandPaletteItems(): CommandItem[] {
  const navigate = useNavigate();
  const drafts = useDraftsStore((s) => s.drafts);
  const channels = useChannelsStore((s) => s.channels);
  const bots = useChannelsStore((s) => s.bots);

  return useMemo(() => {
    const navItems: CommandItem[] = NAV_ROUTES.map((r) => ({
      id: `nav-${r.to}`,
      title: t(r.key),
      section: t("palette.sectionNav"),
      icon: <r.icon size={15} />,
      onSelect: () => navigate(r.to),
    }));

    const draftItems: CommandItem[] = drafts.map((d) => ({
      id: `draft-${d.id}`,
      title: d.postTitle || d.title || t("drafts.untitled"),
      subtitle: d.status === "scheduled" ? t("nav.schedule") : undefined,
      section: t("nav.drafts"),
      icon: <FileText size={15} />,
      onSelect: () => navigate(`/editor/${d.id}`),
    }));

    const channelItems: CommandItem[] = channels.map((c) => ({
      id: `channel-${c.id}`,
      title: c.title,
      subtitle: c.username ? `@${c.username}` : undefined,
      section: t("nav.channels"),
      icon: <Hash size={15} />,
      onSelect: () => navigate("/channels"),
    }));

    const botItems: CommandItem[] = bots.map((b) => ({
      id: `bot-${b.id}`,
      title: b.name,
      subtitle: `@${b.username}`,
      section: t("nav.bots"),
      icon: <Bot size={15} />,
      onSelect: () => navigate("/bots"),
    }));

    return [...navItems, ...draftItems, ...channelItems, ...botItems];
  }, [navigate, drafts, channels, bots]);
}
