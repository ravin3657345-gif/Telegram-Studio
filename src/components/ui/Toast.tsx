import { useEffect, useRef } from "react";
import { X, CheckCircle2, XCircle, Info, AlertTriangle } from "lucide-react";
import type { ToastItem } from "@/store/uiStore";
import { useUiStore, TOAST_DURATIONS } from "@/store/uiStore";
import clsx from "clsx";

const ICONS = {
  success: CheckCircle2,
  error:   XCircle,
  info:    Info,
  warning: AlertTriangle,
};

const ACCENT_COLORS = {
  success: "var(--success)",
  error:   "var(--danger)",
  info:    "var(--accent)",
  warning: "var(--warning)",
};

interface ToastProps {
  toast: ToastItem;
}

export function Toast({ toast }: ToastProps) {
  const dismiss = useUiStore((s) => s.dismissToast);
  const progressRef = useRef<HTMLDivElement>(null);
  const Icon = ICONS[toast.type];
  const accent = ACCENT_COLORS[toast.type];
  const duration = TOAST_DURATIONS[toast.type];

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), duration);
    return () => clearTimeout(timer);
  }, [dismiss, duration, toast.id]);

  useEffect(() => {
    if (!progressRef.current) return;
    progressRef.current.animate(
      [{ width: "100%" }, { width: "0%" }],
      { duration, easing: "linear", fill: "forwards" }
    );
  }, [duration]);

  return (
    <div
      className={clsx(
        "relative flex items-start gap-3 w-80 rounded-lg border overflow-hidden",
        "shadow-[var(--shadow-lg)] animate-in slide-in-from-right-4 fade-in duration-200"
      )}
      style={{
        backgroundColor: "var(--bg-elevated)",
        borderColor: "var(--border-default)",
        padding: "12px 14px",
        borderLeft: `3px solid ${accent}`,
      }}
      role="alert"
    >
      <Icon size={16} style={{ color: accent, marginTop: 1, flexShrink: 0 }} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {toast.title}
        </p>
        {toast.description && (
          <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {toast.description}
          </p>
        )}
        {toast.action && (
          <button
            onClick={() => {
              toast.action!.onClick();
              dismiss(toast.id);
            }}
            className="text-xs font-semibold mt-1.5"
            style={{ color: accent, textDecoration: "underline", background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            {toast.action.label}
          </button>
        )}
      </div>

      <button
        onClick={() => dismiss(toast.id)}
        className="flex-shrink-0 rounded transition-colors"
        style={{ color: "var(--text-muted)" }}
      >
        <X size={14} />
      </button>

      {/* Progress bar */}
      <div
        ref={progressRef}
        className="absolute bottom-0 left-0 h-0.5"
        style={{ backgroundColor: accent, width: "100%" }}
      />
    </div>
  );
}
