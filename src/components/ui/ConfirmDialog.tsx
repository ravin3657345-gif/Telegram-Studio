import { AlertTriangle, X } from "lucide-react";
import { Button } from "./Button";
import { Dialog, DialogTitle, DialogDescription } from "./Dialog";
import { t } from "@/lib/i18n";

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

// Generic blocking confirm for actions that would silently discard unsaved
// work (e.g. PostEditor's "new post" reset) — deliberately a real dialog,
// not a native window.confirm() or a post-hoc undo toast (TimedUndoAction's
// pattern, used elsewhere in this app for reversible deletes): there's
// nothing to "undo" back to once the live editor content the user hadn't
// saved yet is gone.
export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 8px" }}>
        <DialogTitle asChild>
          <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>{title}</span>
        </DialogTitle>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "var(--text-muted)", lineHeight: 0 }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ padding: "6px 16px 4px" }}>
        <DialogDescription asChild>
          <div className="flex items-start gap-1.5" style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2, color: "var(--warning)" }} />
            <span>{description}</span>
          </div>
        </DialogDescription>
      </div>

      <div className="flex gap-2" style={{ padding: "16px" }}>
        <Button variant="secondary" size="sm" fullWidth onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant="danger-solid" size="sm" fullWidth onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
