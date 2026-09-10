import { X, Send, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { t } from "@/lib/i18n";
import type { PublishMode } from "@/store/editorStore";
import type { Channel } from "@/types/channel";

interface PublishConfirmDialogProps {
  channels: Channel[];
  publishMode: PublishMode;
  postTitle: string;
  onConfirm: () => void;
  onClose: () => void;
}

function modeLabel(mode: PublishMode) {
  switch (mode) {
    case "rich": return t("publish.rich");
    default:     return t("publish.normal");
  }
}

export function PublishConfirmDialog({ channels, publishMode, postTitle, onConfirm, onClose }: PublishConfirmDialogProps) {
  return (
    <Dialog
      mobileSheet
      onOpenChange={(open) => !open && onClose()}
      style={{
        width: 340,
        maxWidth: "calc(100vw - 32px)",
        borderRadius: 16,
        backgroundColor: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
        overflow: "hidden",
      }}
    >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 8px" }}>
          <DialogTitle asChild>
            <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>
              {t("publish.confirmTitle")}
            </span>
          </DialogTitle>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "var(--text-muted)", lineHeight: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "6px 16px 4px", display: "flex", flexDirection: "column", gap: 10 }}>
          <DialogDescription asChild>
            <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
              {t("publish.confirmIntro")}
            </p>
          </DialogDescription>

          {/* Channel list */}
          <div className="flex flex-col gap-1" style={{ maxHeight: 140, overflowY: "auto" }}>
            {channels.map((ch) => (
              <div key={ch.id} className="flex items-center gap-1.5" style={{ fontSize: 13, color: "var(--text-primary)" }}>
                <span style={{ width: 4, height: 4, borderRadius: "50%", backgroundColor: "var(--accent)", flexShrink: 0 }} />
                <span className="truncate">{ch.title}</span>
                {ch.username && (
                  <span style={{ color: "var(--text-muted)", fontSize: 11.5, flexShrink: 0 }}>@{ch.username}</span>
                )}
              </div>
            ))}
          </div>

          {/* Format + title summary */}
          <div
            style={{
              display: "flex", flexDirection: "column", gap: 4,
              padding: "8px 10px", borderRadius: 8,
              backgroundColor: "var(--bg-elevated)",
              fontSize: 12,
            }}
          >
            <div className="flex items-center justify-between">
              <span style={{ color: "var(--text-muted)" }}>{t("publish.format")}</span>
              <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{modeLabel(publishMode)}</span>
            </div>
            {postTitle.trim() && (
              <div className="flex items-center justify-between gap-2">
                <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{t("publish.confirmPostTitle")}</span>
                <span className="truncate" style={{ color: "var(--text-primary)", fontWeight: 500 }}>{postTitle.trim()}</span>
              </div>
            )}
          </div>

          {/* Warning */}
          <div className="flex items-start gap-1.5" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1, color: "var(--warning)" }} />
            <span>{t("publish.confirmWarning")}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2" style={{ padding: "12px 16px 16px" }}>
          <Button variant="secondary" size="sm" fullWidth onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="sm" fullWidth leftIcon={<Send size={13} />} onClick={onConfirm}>
            {t("publish.button")}
          </Button>
        </div>
    </Dialog>
  );
}
