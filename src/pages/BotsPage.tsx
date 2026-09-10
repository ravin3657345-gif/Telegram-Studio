import { Bot, Plus, Trash2, Eye, EyeOff, Copy, Check, CheckCircle, AlertCircle, Loader } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { useChannelsStore } from "@/store/channelsStore";
import { validateBotToken, addBot, deleteBot, getBots, revealBotToken } from "@/lib/tauriApi";
import { toast } from "@/store/uiStore";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import type { Bot as BotType } from "@/types/bot";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";


// ─── Add-bot modal ────────────────────────────────────────────────────────────

interface AddBotModalProps {
  onClose: () => void;
  onAdded: (bot: BotType) => void;
}

function AddBotModal({ onClose, onAdded }: AddBotModalProps) {
  const [token, setToken]     = useState("");
  const [stage, setStage]     = useState<"input" | "validating" | "preview">("input");
  const [adding, setAdding]   = useState(false);
  const [botInfo, setBotInfo] = useState<{ name: string; username: string } | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const inputRef              = useRef<HTMLInputElement>(null);
  useSettingsStore((s) => s.language);
  const isMobile = useIsMobileLayout();

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handleValidate() {
    const tok = token.trim();
    if (!tok) return;
    setError(null);
    setStage("validating");
    try {
      const info = await validateBotToken(tok);
      setBotInfo({
        name:     info.firstName,
        username: info.username ?? "",
      });
      setStage("preview");
    } catch (e) {
      setError(String(e));
      setStage("input");
    }
  }

  async function handleAdd() {
    setAdding(true);
    try {
      const bot = await addBot(token.trim());
      onAdded(bot);
      toast.success(ti("bots.added", { username: bot.username }));
      onClose();
    } catch (e) {
      setError(String(e));
      setAdding(false);
    }
  }

  const heading = (
    <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
      {t("bots.addTitle")}
    </h2>
  );

  const description = (
    <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 18, lineHeight: 1.5 }}>
      {t("bots.createHintPre")} <span style={{ color: "var(--accent)" }}>@BotFather</span> {t("bots.createHintPost")}
    </p>
  );

  // Token input + error + preview + actions — shared verbatim between the
  // desktop centered dialog and the mobile bottom sheet, so the form never
  // forks into two copies.
  const fields = (
    <>
      {/* Token input */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: "var(--text-secondary)", display: "block", marginBottom: 6 }}>
          {t("bots.tokenLabel")}
        </label>
        <input
          ref={inputRef}
          value={token}
          onChange={(e) => { setToken(e.target.value); setStage("input"); setBotInfo(null); setError(null); }}
          onKeyDown={(e) => e.key === "Enter" && stage === "input" && handleValidate()}
          placeholder="1234567890:AAExx..."
          disabled={stage === "validating" || adding}
          style={{
            width: "100%", padding: "9px 12px", borderRadius: 8, fontSize: 13,
            fontFamily: "monospace",
            backgroundColor: "var(--bg-elevated)",
            border: `1.5px solid ${error ? "var(--danger)" : "var(--border-default)"}`,
            color: "var(--text-primary)", outline: "none",
          }}
        />
      </div>

      {/* Error */}
      {error && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 12,
          padding: "8px 10px", borderRadius: 8,
          backgroundColor: "rgba(231,76,60,0.10)", border: "1px solid rgba(231,76,60,0.2)",
        }}>
          <AlertCircle size={14} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.5 }}>{error}</span>
        </div>
      )}

      {/* Bot preview */}
      {botInfo && stage === "preview" && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12, marginBottom: 16,
          padding: "10px 12px", borderRadius: 10,
          backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 20%, transparent)",
        }}>
          <CheckCircle size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{botInfo.name}</p>
            {botInfo.username && (
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>@{botInfo.username}</p>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onClose}
          style={{
            padding: isMobile ? "11px 18px" : "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500,
            border: "1px solid var(--border-default)", background: "none",
            color: "var(--text-secondary)", cursor: "pointer",
          }}
        >
          {t("common.cancel")}
        </button>

        {stage !== "preview" ? (
          <button
            onClick={handleValidate}
            disabled={!token.trim() || stage === "validating"}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: isMobile ? "11px 20px" : "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              backgroundColor: !token.trim() ? "var(--bg-elevated)" : "var(--accent)",
              border: "none",
              color: !token.trim() ? "var(--text-muted)" : "#fff",
              cursor: !token.trim() ? "default" : "pointer",
            }}
          >
            {stage === "validating" && <Loader size={13} style={{ animation: "spin 1s linear infinite" }} />}
            {t("bots.verify")}
          </button>
        ) : (
          <button
            onClick={handleAdd}
            disabled={adding}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: isMobile ? "11px 20px" : "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              backgroundColor: "var(--accent)", border: "none", color: "#fff", cursor: "pointer",
            }}
          >
            {adding && <Loader size={13} style={{ animation: "spin 1s linear infinite" }} />}
            {t("common.add")}
          </button>
        )}
      </div>
    </>
  );

  if (isMobile) {
    return (
      <BottomSheet onOpenChange={(open) => !open && onClose()} title={t("bots.addTitle")} maxHeight="90vh">
        <div style={{ padding: "14px 16px 8px" }}>
          {heading}
          {description}
          {fields}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </BottomSheet>
    );
  }

  return (
    <Dialog
      onOpenChange={(open) => !open && onClose()}
      overlayStyle={{ backgroundColor: "rgba(0,0,0,0.55)", backdropFilter: "blur(2px)" }}
      style={{
        width: 440, maxWidth: "calc(100vw - 32px)", backgroundColor: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 14, padding: 24,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}
    >
      <DialogTitle asChild>{heading}</DialogTitle>
      <DialogDescription asChild>{description}</DialogDescription>
      {fields}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </Dialog>
  );
}

// ─── Bot card ─────────────────────────────────────────────────────────────────

function BotCard({ bot, selected, deleting, onRequestDelete }: { bot: BotType; selected: boolean; deleting: boolean; onRequestDelete: () => void }) {
  const [showToken, setShowToken] = useState(false);
  // bot.token from getBots()/addBot() is already masked server-side — the
  // real value is fetched (and cached here) only on explicit reveal/copy.
  const [realToken, setRealToken] = useState<string | null>(null);
  const [copied, setCopied]       = useState(false);
  useSettingsStore((s) => s.language);
  const isMobile = useIsMobileLayout();

  async function getRealToken(): Promise<string> {
    if (realToken) return realToken;
    const token = await revealBotToken(bot.id);
    setRealToken(token);
    return token;
  }

  async function handleToggleShowToken() {
    if (!showToken) {
      try {
        await getRealToken();
      } catch (e) {
        toast.error(String(e));
        return;
      }
    }
    setShowToken((v) => !v);
  }

  async function handleCopyToken(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      const token = await getRealToken();
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <div
      data-nav-id={bot.id}
      className="virtualized-item"
      style={{
        borderRadius: 12,
        border: "1px solid " + (selected ? "var(--accent)" : "var(--border-subtle)"),
        boxShadow: selected ? "0 0 0 1.5px var(--accent)" : "none",
        backgroundColor: "var(--bg-surface)", overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
        <div style={{
          width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
          backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)",
          border: "1.5px solid color-mix(in srgb, var(--accent) 25%, transparent)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Bot size={19} style={{ color: "var(--accent)" }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: isMobile ? 15 : 14, fontWeight: 600, color: "var(--text-primary)" }}>{bot.name}</p>
          <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 1 }}>@{bot.username}</p>
        </div>

        <span style={{
          fontSize: 11, fontWeight: 500, padding: "3px 8px", borderRadius: 20,
          backgroundColor: "rgba(39,174,96,0.12)", color: "var(--success)",
        }}>
          {t("bots.active")}
        </span>
      </div>

      {/* Token row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        margin: "0 16px 12px",
        padding: "8px 12px", borderRadius: 8,
        backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-subtle)",
      }}>
        <code style={{
          flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          color: "var(--text-secondary)", fontFamily: "monospace",
        }}>
          {showToken && realToken ? realToken : bot.token}
        </code>
        <button
          onClick={handleToggleShowToken}
          style={{
            background: "none", border: "none", cursor: "pointer",
            padding: isMobile ? 9 : 2, color: "var(--text-muted)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {showToken ? <EyeOff size={isMobile ? 17 : 14} /> : <Eye size={isMobile ? 17 : 14} />}
        </button>
        <button
          onClick={handleCopyToken}
          title={t("bots.copyToken")}
          style={{
            background: "none", border: "none", cursor: "pointer",
            padding: isMobile ? 9 : 2, color: copied ? "var(--success)" : "var(--text-muted)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {copied ? <Check size={isMobile ? 16 : 13} /> : <Copy size={isMobile ? 16 : 13} />}
        </button>
      </div>

      {/* Footer */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "10px 16px", borderTop: "1px solid var(--border-subtle)",
        backgroundColor: "var(--bg-elevated)",
      }}>
        <button
          onClick={onRequestDelete}
          disabled={deleting}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: isMobile ? "9px 16px" : "5px 12px", borderRadius: 8, fontSize: isMobile ? 13 : 12, fontWeight: 500,
            border: "1px solid rgba(231,76,60,0.3)",
            backgroundColor: "rgba(231,76,60,0.07)",
            color: "var(--danger)", cursor: deleting ? "default" : "pointer",
          }}
        >
          {deleting
            ? <Loader size={12} style={{ animation: "spin 1s linear infinite" }} />
            : <Trash2 size={12} />}
          {t("bots.delete")}
        </button>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function BotsPage() {
  const { bots, setBots, addBot: storeAddBot, removeBot } = useChannelsStore();
  const [showAdd, setShowAdd] = useState(false);
  useSettingsStore((s) => s.language);
  const isMobile = useIsMobileLayout();

  // Delete confirm — a real ConfirmDialog (bottom sheet on mobile), not a
  // blocking native window.confirm(): the confirm must survive both the
  // card's button and the keyboard Delete key.
  const [confirmBot, setConfirmBot] = useState<BotType | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Sync from DB on mount
  useEffect(() => {
    getBots().then(setBots).catch(() => {});
  }, []);

  // Card button and keyboard Delete both funnel through the same
  // confirm → delete sequence.
  function requestDeleteBot(bot: BotType) {
    setConfirmBot(bot);
  }

  async function runDeleteBot(bot: BotType) {
    setDeletingId(bot.id);
    setConfirmBot(null);
    try {
      await deleteBot(bot.id);
      removeBot(bot.id);
      toast.success(ti("bots.deletedMsg", { username: bot.username }));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeletingId(null);
    }
  }

  // No Enter binding — a bot row has no navigation/detail target, only a
  // local "reveal token" toggle owned by each BotCard's own state, not
  // cleanly triggerable from outside without lifting that state up. ↑/↓
  // selection + Delete still work.
  const listNav = useListKeyboardNav(
    bots,
    (bot) => bot.id,
    { onDelete: requestDeleteBot },
  );

  return (
    <>
      <TopBar
        actions={
          <button
            onClick={() => setShowAdd(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: isMobile ? "11px 18px" : "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              backgroundColor: "var(--accent)", border: "none", color: "#fff", cursor: "pointer",
            }}
          >
            <Plus size={14} />
            {t("bots.add")}
          </button>
        }
      />

      <div className="page-content max-w-3xl" style={{ padding: isMobile ? 12 : 24 }}>
        {bots.length === 0 ? (
          <EmptyState icon={Bot} title={t("bots.empty")} description={t("bots.emptyDesc")} />
        ) : (
          <div
            className="space-y-3"
            ref={listNav.containerRef}
            {...listNav.containerProps}
            style={{ outline: "none" }}
          >
            {bots.map((bot) => (
              <BotCard
                key={bot.id}
                bot={bot}
                selected={listNav.selectedId === bot.id}
                deleting={deletingId === bot.id}
                onRequestDelete={() => requestDeleteBot(bot)}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddBotModal
          onClose={() => setShowAdd(false)}
          onAdded={(bot) => storeAddBot(bot)}
        />
      )}

      {confirmBot && (
        <ConfirmDialog
          title={t("bots.delete")}
          description={ti("bots.confirmDelete", { username: confirmBot.username })}
          confirmLabel={t("common.delete")}
          onConfirm={() => runDeleteBot(confirmBot)}
          onClose={() => setConfirmBot(null)}
        />
      )}
    </>
  );
}
