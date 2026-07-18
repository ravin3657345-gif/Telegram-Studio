import { useState, useEffect, useRef } from "react";
import {
  Radio, Plus, Trash2, BarChart2, ChevronDown,
  Users, CheckCircle2, XCircle, AlertCircle, Loader, CheckCircle, Bot, Pencil, Check,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { CopyButton } from "@/components/ui/CopyButton";
import { TimedUndoAction } from "@/components/ui/TimedUndoAction";
import { useChannelsStore, dedupeChannels } from "@/store/channelsStore";
import { addChannel, deleteChannel, getChannels, updateChannelBot } from "@/lib/tauriApi";
import { toast } from "@/store/uiStore";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import type { Channel } from "@/types/channel";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";


interface ChannelStats {
  channelId:    string;
  channelTitle: string;
  telegramId:   string;
  memberCount:  number | null;
  postsTotal:   number;
  postsSuccess: number;
  postsFailed:  number;
  lastPostAt:   string | null;
}

// ─── Add-channel modal ────────────────────────────────────────────────────────

interface AddChannelModalProps {
  onClose: () => void;
  onAdded: (ch: Channel) => void;
}

function AddChannelModal({ onClose, onAdded }: AddChannelModalProps) {
  const bots = useChannelsStore((s) => s.bots);
  const [botId,    setBotId]    = useState(bots[0]?.id ?? "");
  const [username, setUsername] = useState("");
  const [adding,   setAdding]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useSettingsStore((s) => s.language);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const canonical = username.trim().replace(/^@/, "");

  async function handleAdd() {
    if (!botId || !canonical || adding) return;
    setError(null);
    setAdding(true);
    try {
      const ch = await addChannel(botId, canonical);
      onAdded(ch);
      toast.success(ti("channels.added", { title: ch.title }));
      onClose();
    } catch (e) {
      setError(String(e));
      setAdding(false);
    }
  }

  const canSubmit = !!botId && !!canonical && !adding;

  return (
    <Dialog
      onOpenChange={(open) => !open && onClose()}
      overlayStyle={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
      style={{
        width: 460, maxWidth: "calc(100vw - 32px)", backgroundColor: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)", borderRadius: 14, padding: 24,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}
    >
        <DialogTitle asChild>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
            {t("channels.addTitle")}
          </h2>
        </DialogTitle>
        <DialogDescription asChild>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.5 }}>
            {t("channels.adminHint")}
          </p>
        </DialogDescription>

        {bots.length === 0 ? (
          <div style={{
            padding: "12px 14px", borderRadius: 10, marginBottom: 16,
            backgroundColor: "rgba(243,156,18,0.10)", border: "1px solid rgba(243,156,18,0.25)",
          }}>
            <p style={{ fontSize: 13, color: "var(--warning)" }}>
              {t("channels.noBotHint")}
            </p>
          </div>
        ) : (
          <>
            {/* Bot selector */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
                {t("channels.botLabel")}
              </label>
              <select
                value={botId}
                onChange={(e) => setBotId(e.target.value)}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8, fontSize: 13,
                  backgroundColor: "var(--bg-elevated)",
                  border: "1.5px solid var(--border-default)",
                  color: "var(--text-primary)", outline: "none",
                }}
              >
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>@{b.username} — {b.name}</option>
                ))}
              </select>
            </div>

            {/* Username input */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
                {t("channels.usernameLabel")}
              </label>
              <input
                ref={inputRef}
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder={t("channels.usernamePlaceholder")}
                disabled={adding}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8, fontSize: 13,
                  backgroundColor: "var(--bg-elevated)",
                  border: `1.5px solid ${error ? "var(--danger)" : "var(--border-default)"}`,
                  color: "var(--text-primary)", outline: "none",
                }}
              />
            </div>
          </>
        )}

        {/* Error */}
        {error && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 14,
            padding: "8px 10px", borderRadius: 8,
            backgroundColor: "rgba(231,76,60,0.10)", border: "1px solid rgba(231,76,60,0.2)",
          }}>
            <AlertCircle size={14} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500,
              border: "1px solid var(--border-default)", background: "none",
              color: "var(--text-secondary)", cursor: "pointer",
            }}
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleAdd}
            disabled={!canSubmit || bots.length === 0}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              backgroundColor: canSubmit && bots.length > 0 ? "var(--accent)" : "var(--bg-elevated)",
              border: "none",
              color: canSubmit && bots.length > 0 ? "#fff" : "var(--text-muted)",
              cursor: canSubmit && bots.length > 0 ? "pointer" : "default",
            }}
          >
            {adding && <Loader size={13} style={{ animation: "spin 1s linear infinite" }} />}
            {t("common.add")}
          </button>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </Dialog>
  );
}

// ─── Channel card ─────────────────────────────────────────────────────────────

function ChannelCard({ channel, selected, onDelete }: { channel: Channel; selected: boolean; onDelete: () => void }) {
  const [open,        setOpen]        = useState(false);
  const [stats,       setStats]       = useState<ChannelStats | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [deleting,    setDeleting]    = useState(false);
  const [editingBot,  setEditingBot]  = useState(false);
  const [changingBot, setChangingBot] = useState(false);
  const { bots, updateChannelBot: storeUpdateBot } = useChannelsStore();
  useSettingsStore((s) => s.language);

  async function handleBotChange(newBotId: string) {
    if (newBotId === channel.botId || changingBot) return;
    setChangingBot(true);
    try {
      await updateChannelBot(channel.id, newBotId);
      storeUpdateBot(channel.id, newBotId);
      setEditingBot(false);
      const bot = bots.find((b) => b.id === newBotId);
      toast.success(ti("channels.botChanged", { username: bot?.username ?? newBotId }));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setChangingBot(false);
    }
  }

  async function loadStats() {
    if (stats) { setOpen((v) => !v); return; }
    setLoading(true);
    setOpen(true);
    try {
      const s = await invoke<ChannelStats>("get_channel_dashboard", { channelId: channel.id });
      setStats(s);
    } catch {
      toast.error(t("channels.loadError"));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  async function refreshStats() {
    setLoading(true);
    setStats(null);
    try {
      const s = await invoke<ChannelStats>("get_channel_dashboard", { channelId: channel.id });
      setStats(s);
    } catch {
      toast.error(t("channels.refreshError"));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteChannel(channel.id);
      onDelete();
      toast.success(ti("channels.deletedMsg", { title: channel.title }));
    } catch (e) {
      toast.error(String(e));
      setDeleting(false);
    }
  }

  const lastPost = stats?.lastPostAt
    ? new Date(stats.lastPostAt).toLocaleString("ru", {
        day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      })
    : null;

  return (
    <div
      data-nav-id={channel.id}
      style={{
        borderRadius: 12,
        border: "1px solid " + (selected ? "var(--accent)" : "var(--border-subtle)"),
        boxShadow: selected ? "0 0 0 1.5px var(--accent)" : "none",
        backgroundColor: "var(--bg-surface)", overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px" }}>
        <div style={{
          width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
          backgroundColor: "var(--accent)", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 15, fontWeight: 700,
        }}>
          {channel.title[0]?.toUpperCase() ?? "?"}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {channel.title}
          </p>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 1, display: "flex", alignItems: "center", gap: 3 }}>
            <span>
              {channel.username ? `@${channel.username}` : t("channels.private")}
              {channel.memberCount != null && ` · 👥 ${channel.memberCount.toLocaleString()}`}
            </span>
            {channel.username && (
              <CopyButton value={channel.username} title={t("channels.copyUsername")} size={10} />
            )}
          </p>

          {/* Bot row */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 5 }}>
            <Bot size={11} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            {editingBot ? (
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <select
                  autoFocus
                  value={channel.botId}
                  onChange={(e) => handleBotChange(e.target.value)}
                  disabled={changingBot}
                  style={{
                    fontSize: 11, padding: "1px 4px", borderRadius: 5,
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border-default)",
                    color: "var(--text-primary)", outline: "none",
                  }}
                >
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>@{b.username}</option>
                  ))}
                </select>
                {changingBot
                  ? <Loader size={11} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />
                  : <button onClick={() => setEditingBot(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)" }}><Check size={11} /></button>}
              </div>
            ) : (
              <>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  @{bots.find((b) => b.id === channel.botId)?.username ?? "—"}
                </span>
                {bots.length > 1 && (
                  <button
                    onClick={() => setEditingBot(true)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", color: "var(--text-muted)", lineHeight: 1 }}
                    title={t("channels.changeBot")}
                  >
                    <Pencil size={10} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={loadStats}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500,
              border: "1px solid var(--border-default)",
              backgroundColor: "var(--bg-elevated)", color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            <BarChart2 size={13} />
            {t("channels.stats")}
            <ChevronDown size={11} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
          </button>

          <TimedUndoAction
            label={t("channels.delete")}
            undoLabel={t("channels.cancelDelete")}
            icon={deleting
              ? <Loader size={12} style={{ animation: "spin 1s linear infinite" }} />
              : <Trash2 size={12} />}
            onConfirm={handleDelete}
            disabled={deleting}
          />
        </div>
      </div>

      {/* Stats panel */}
      {open && (
        <div style={{
          borderTop: "1px solid var(--border-subtle)",
          backgroundColor: "var(--bg-elevated)",
          padding: "12px 16px",
        }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Spinner size={14} color="var(--text-muted)" />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("channels.loading")}</span>
            </div>
          ) : stats ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <StatTile icon={<Users size={13} />}
                label={t("channels.subscribers")}
                value={stats.memberCount != null ? stats.memberCount.toLocaleString("ru") : "—"} />
              <StatTile icon={<CheckCircle2 size={13} style={{ color: "var(--success)" }} />}
                label={t("channels.success")}
                value={`${stats.postsSuccess} / ${stats.postsTotal}`} />
              <StatTile icon={<XCircle size={13} style={{ color: "var(--danger)" }} />}
                label={t("channels.failed")}
                value={String(stats.postsFailed)} />
              <StatTile icon={<Radio size={13} />}
                label={t("channels.lastPost")}
                value={lastPost ?? t("channels.noLastPost")} />
              <div style={{ gridColumn: "1/-1", marginTop: 4 }}>
                <button
                  onClick={refreshStats}
                  style={{
                    display: "flex", alignItems: "center", gap: 4, fontSize: 11,
                    background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 0,
                  }}
                >
                  <CheckCircle size={10} />{t("channels.refresh")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div
      className="soft-ui-sm"
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "9px 12px", borderRadius: 10, backgroundColor: "var(--bg-surface)",
      }}
    >
      <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{icon}</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>{value}</span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ChannelsPage() {
  const { channels, setChannels, addChannel: storeAdd, removeChannel } = useChannelsStore();
  const [showAdd, setShowAdd] = useState(false);
  useSettingsStore((s) => s.language);

  useEffect(() => {
    getChannels()
      .then((chs) => setChannels(dedupeChannels(chs)))
      .catch(() => {});
  }, []);

  // Standalone rather than reusing ChannelCard's own handleDelete (that one
  // also drives a per-card "deleting" spinner, which a keyboard-triggered
  // delete has no natural place to show) — same confirm+delete sequence.
  async function handleDeleteChannel(ch: Channel) {
    if (!confirm(ti("channels.confirmDelete", { title: ch.title }))) return;
    try {
      await deleteChannel(ch.id);
      removeChannel(ch.id);
      toast.success(ti("channels.deletedMsg", { title: ch.title }));
    } catch (e) {
      toast.error(String(e));
    }
  }

  // No Enter binding here — a channel row has no navigation/detail target,
  // only a local "expand stats" toggle owned by each ChannelCard's own
  // state, not cleanly triggerable from outside without lifting that state
  // up. ↑/↓ selection + Delete still work.
  const listNav = useListKeyboardNav(
    channels,
    (ch) => ch.id,
    { onDelete: handleDeleteChannel },
  );

  return (
    <>
      <TopBar
        actions={
          <button
            onClick={() => setShowAdd(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              backgroundColor: "var(--accent)", border: "none", color: "#fff", cursor: "pointer",
            }}
          >
            <Plus size={14} />
            {t("channels.add")}
          </button>
        }
      />

      <div className="page-content max-w-3xl">
        {channels.length === 0 ? (
          <EmptyState icon={Radio} title={t("channels.empty")} description={t("channels.emptyDesc")} />
        ) : (
          <div
            className="space-y-3"
            ref={listNav.containerRef}
            {...listNav.containerProps}
            style={{ outline: "none" }}
          >
            {channels.map((ch) => (
              <ChannelCard
                key={ch.id}
                channel={ch}
                selected={listNav.selectedId === ch.id}
                onDelete={() => removeChannel(ch.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddChannelModal
          onClose={() => setShowAdd(false)}
          onAdded={(ch) => storeAdd(ch)}
        />
      )}
    </>
  );
}
