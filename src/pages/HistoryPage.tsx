import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { History, Clock, Trash2, CheckCircle2, XCircle, RefreshCw, Pencil, Loader, Link2, ExternalLink } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { toast, useUiStore } from "@/store/uiStore";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { useChannelsStore } from "@/store/channelsStore";
import { useEditorStore } from "@/store/editorStore";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";
import type { Channel } from "@/types/channel";

interface HistoryItem {
  id: string;
  channelId: string;
  channelTitle: string;
  postTitle: string;
  botId: string;
  telegramMsgId: number | null;
  telegramChatId: string | null;
  status: "published" | "failed" | "deleted";
  errorMessage: string | null;
  publishedAt: string;
  deleteAt: string | null;
  contentPreview: string | null;
  publishMode: string;
}

function getDeleteOptions() {
  return [
    { label: t("history.deleteNow"),    hours: 0  },
    { label: t("history.deleteIn1h"),   hours: 1  },
    { label: t("history.deleteIn6h"),   hours: 6  },
    { label: t("history.deleteIn24h"),  hours: 24 },
    { label: t("history.deleteIn48h"),  hours: 48 },
  ] as const;
}

// Public link for a published post. Prefer the channel's @username when the
// channel is still in the app (nicer t.me/<username>/<msg> link); otherwise
// fall back to Telegram's numeric t.me/c/<chatId>/<msg> form for private
// channels (the -100 prefix must be stripped for the c/ path).
function buildPostUrl(item: HistoryItem, channels: Channel[]): string | null {
  if (item.status !== "published" || !item.telegramMsgId) return null;
  const channel = channels.find((c) => c.id === item.channelId);
  if (channel?.username) {
    return `https://t.me/${channel.username}/${item.telegramMsgId}`;
  }
  const chatId = (item.telegramChatId ?? "").replace(/^-100/, "");
  if (!chatId) return null;
  return `https://t.me/c/${chatId}/${item.telegramMsgId}`;
}

export function HistoryPage() {
  const [items, setItems]   = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  useSettingsStore((s) => s.language);
  const isMobile = useIsMobileLayout();
  const historyVersion = useUiStore((s) => s.historyVersion);
  const navigate    = useNavigate();
  const resetEditor = useEditorStore((s) => s.resetEditor);

  // No Delete-key binding on this page — the only "removal" action is
  // "schedule delete" (pick a time from a dropdown), not a single instant
  // action a keypress could stand in for.
  const listNav = useListKeyboardNav(
    items,
    (item) => item.id,
    {
      onOpen: (item) => {
        // Mirrors HistoryCard's own Edit-button availability check below —
        // Enter silently no-ops on rows that don't have an edit target
        // (same as the disabled button gives no feedback on click).
        if (item.status !== "published" || !item.telegramMsgId || item.publishMode === "rich") return;
        resetEditor();
        navigate("/editor", { state: { _histId: item.id } });
      },
    },
  );

  const load = () => {
    setLoading(true);
    invoke<HistoryItem[]>("get_history")
      .then(setItems)
      .catch(() => toast.error(t("history.loadError")))
      .finally(() => setLoading(false));
  };

  useEffect(load, [historyVersion]);

  async function handleScheduleDelete(item: HistoryItem, hours: number | null) {
    // hours === 0 means "delete now" — must stay distinct from null
    // ("cancel pending deletion"), so this can't collapse to `hours ? ... :
    // null`, that treats 0 as falsy and would silently cancel instead.
    const deleteAt = hours === null ? null : new Date(Date.now() + hours * 3600_000).toISOString();
    try {
      await invoke("schedule_post_delete", {
        payload: { historyId: item.id, deleteAt },
      });
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, deleteAt } : it))
      );
      if (hours === 0) {
        toast.success(t("history.deleteNowScheduled"));
      } else if (deleteAt) {
        const d = new Date(deleteAt).toLocaleString("ru", {
          day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        });
        toast.success(ti("history.deleteSchedul", { date: d }));
      } else {
        toast.success(t("history.deleteCancell"));
      }
    } catch {
      toast.error(t("history.deleteError"));
    }
  }

  return (
    <>
      <TopBar
        actions={
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-2 h-7 rounded text-xs"
            style={{ color: "var(--text-muted)", backgroundColor: "var(--bg-elevated)" }}
            title={t("history.refresh")}
          >
            <RefreshCw size={12} />
          </button>
        }
      />
      <div className="page-content" style={{ padding: isMobile ? 12 : 24 }}>
        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner size={24} color="var(--text-muted)" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={History}
            title={t("history.empty")}
            description={t("history.emptyDesc")}
          />
        ) : (
          <div
            className="flex flex-col gap-2 max-w-2xl"
            ref={listNav.containerRef}
            {...listNav.containerProps}
            style={{ outline: "none" }}
          >
            {items.map((item) => (
              <HistoryCard
                key={item.id}
                item={item}
                selected={listNav.selectedId === item.id}
                onScheduleDelete={handleScheduleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function HistoryCard({
  item,
  selected,
  onScheduleDelete,
}: {
  item: HistoryItem;
  selected: boolean;
  onScheduleDelete: (item: HistoryItem, hours: number | null) => void;
}) {
  const [showMenu, setShowMenu]   = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);
  useSettingsStore((s) => s.language);
  const isMobile = useIsMobileLayout();
  const channels = useChannelsStore((s) => s.channels);
  const postUrl = buildPostUrl(item, channels);

  const navigate    = useNavigate();
  const resetEditor = useEditorStore((s) => s.resetEditor);

  async function openInEditor() {
    setLoadingEdit(true);
    try {
      // Just reset state and pass historyId via router state.
      // PostEditor will fetch full data from Rust (same pattern as draft loading).
      resetEditor();
      navigate("/editor", {
        state: { _histId: item.id },
      });
    } catch (e) {
      toast.error(t("editor.postLoadError"), String(e));
    } finally {
      setLoadingEdit(false);
    }
  }

  async function handleCopyLink() {
    if (!postUrl) return;
    try {
      await navigator.clipboard.writeText(postUrl);
      toast.success(t("history.linkCopied"));
    } catch {
      toast.error(t("history.openError"));
    }
  }

  async function handleOpenInTelegram() {
    if (!postUrl) return;
    try {
      await openUrl(postUrl);
    } catch {
      toast.error(t("history.openError"));
    }
  }

  const pubDate = new Date(item.publishedAt).toLocaleString("ru", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  const deleteDate = item.deleteAt
    ? new Date(item.deleteAt).toLocaleString("ru", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      })
    : null;

  const StatusIcon =
    item.status === "published" ? CheckCircle2
    : item.status === "deleted"  ? Trash2
    : XCircle;

  const statusColor =
    item.status === "published" ? "var(--success)"
    : item.status === "deleted"  ? "var(--text-muted)"
    : "var(--danger)";

  return (
    <div
      data-nav-id={item.id}
      className={"rounded-lg border flex items-start " + (isMobile ? "p-3.5 gap-2.5" : "p-3 gap-3")}
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: selected ? "var(--accent)" : "var(--border-subtle)",
        boxShadow: selected ? "0 0 0 1.5px var(--accent)" : "none",
      }}
    >
      <StatusIcon size={16} style={{ color: statusColor, flexShrink: 0, marginTop: 1 }} />

      <div className="flex-1 min-w-0">
        <div className={"flex items-center justify-between gap-2 " + (isMobile ? "flex-wrap" : "")}>
          <p
            className="text-sm font-medium truncate"
            style={{ color: "var(--text-primary)", ...(isMobile ? { flex: "1 1 100%", minWidth: 0 } : {}) }}
          >
            {item.postTitle.trim() || t("editor.untitled")}
          </p>
          <span
            className="text-2xs flex-shrink-0 truncate"
            style={{ color: "var(--text-muted)", maxWidth: isMobile ? undefined : 160 }}
          >
            {item.channelTitle || item.channelId} · {pubDate}
          </span>
        </div>

        {item.contentPreview && !item.errorMessage && (
          <p
            className="text-2xs mt-0.5 overflow-hidden"
            style={{
              color: "var(--text-muted)",
              display: "-webkit-box",
              WebkitLineClamp: 1,
              WebkitBoxOrient: "vertical",
            }}
          >
            {item.contentPreview}
          </p>
        )}

        {item.errorMessage && (
          <p className="text-2xs mt-0.5 truncate" style={{ color: "var(--danger)" }}>
            {item.errorMessage}
          </p>
        )}

        {deleteDate && item.status === "published" && (
          <p className="text-2xs mt-0.5 flex items-center gap-1" style={{ color: "var(--warning, #f59e0b)" }}>
            <Clock size={10} />
            {ti("history.deleteAt", { date: deleteDate })}
          </p>
        )}
      </div>

      {/* Post link actions — copy t.me link / open in Telegram. */}
      {postUrl && (
        <>
          <button
            onClick={handleCopyLink}
            className={"flex items-center justify-center rounded flex-shrink-0 transition-colors " + (isMobile ? "w-9 h-9" : "w-6 h-6")}
            style={{ color: "var(--text-muted)", backgroundColor: "var(--bg-elevated)" }}
            title={t("history.copyLink")}
          >
            <Link2 size={isMobile ? 15 : 12} />
          </button>
          <button
            onClick={handleOpenInTelegram}
            className={"flex items-center justify-center rounded flex-shrink-0 transition-colors " + (isMobile ? "w-9 h-9" : "w-6 h-6")}
            style={{ color: "var(--text-muted)", backgroundColor: "var(--bg-elevated)" }}
            title={t("history.openInTelegram")}
          >
            <ExternalLink size={isMobile ? 15 : 12} />
          </button>
        </>
      )}

      {/* Edit button — opens full editor. Rich posts can't be edited at all
          (no resync/re-snapshot path once sent) — shown disabled with an
          explanatory tooltip instead of hidden outright, so the restriction
          is visible rather than silently absent. The hover target has to be
          a non-disabled wrapper — native <button disabled> doesn't reliably
          fire mouseenter/mouseleave in Chromium/WebView2 for a tooltip. */}
      {item.status === "published" && item.telegramMsgId && (
        item.publishMode === "rich" ? (
          <span
            className="flex items-center gap-1 px-2 h-6 rounded flex-shrink-0 text-2xs font-medium"
            style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)", opacity: 0.5, cursor: "not-allowed" }}
            title={t("history.editUnavailableRich")}
          >
            <Pencil size={11} />
            {t("history.edit")}
          </span>
        ) : (
          <button
            onClick={openInEditor}
            disabled={loadingEdit}
            className={"flex items-center gap-1 rounded flex-shrink-0 text-2xs font-medium " + (isMobile ? "px-3 h-9" : "px-2 h-6")}
            style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--accent)";
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-muted)";
              e.currentTarget.style.borderColor = "transparent";
            }}
            title={t("history.edit")}
          >
            {loadingEdit
              ? <Loader size={11} style={{ animation: "spin 1s linear infinite" }} />
              : <Pencil size={11} />}
            {t("history.edit")}
          </button>
        )
      )}

      {/* Delete schedule button */}
      {item.status === "published" && (
        <div className="relative flex-shrink-0">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className={"flex items-center justify-center rounded transition-colors " + (isMobile ? "w-9 h-9" : "w-6 h-6")}
            style={{ color: "var(--text-muted)", backgroundColor: "var(--bg-elevated)" }}
            title={t("history.schedDelete")}
          >
            <Trash2 size={isMobile ? 16 : 12} />
          </button>

          {showMenu && (
            <div
              className={"absolute right-0 top-full mt-1 rounded-lg border z-50 overflow-hidden " + (isMobile ? "text-sm" : "text-xs")}
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-default)",
                boxShadow: "var(--shadow-md)",
                width: isMobile ? 200 : 160,
              }}
            >
              {getDeleteOptions().map((opt) => (
                <button
                  key={opt.hours}
                  onClick={() => { onScheduleDelete(item, opt.hours); setShowMenu(false); }}
                  className={"w-full text-left hover:bg-[var(--bg-hover)] transition-colors " + (isMobile ? "px-4 py-3" : "px-3 py-1.5")}
                  style={{ color: "var(--text-primary)" }}
                >
                  {opt.label}
                </button>
              ))}
              {item.deleteAt && (
                <button
                  onClick={() => { onScheduleDelete(item, null); setShowMenu(false); }}
                  className={"w-full text-left hover:bg-[var(--bg-hover)] transition-colors border-t " + (isMobile ? "px-4 py-3" : "px-3 py-1.5")}
                  style={{ color: "var(--danger)", borderColor: "var(--border-subtle)" }}
                >
                  {t("history.cancelDelete")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
