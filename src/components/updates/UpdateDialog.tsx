import { useEffect, useState } from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogTitle, DialogDescription } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { getScheduledPosts } from "@/lib/tauriApi";
import { t, ti } from "@/lib/i18n";
import { useUpdateStore } from "@/store/updateStore";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${bytes} Б`;
}

/**
 * The one dialog the whole update flow funnels through — opened by the silent
 * startup check (UpdateChecker) and by the manual button in Settings.
 *
 * Install/restart lives here rather than in the checker because the decision is
 * the user's: the app has a background publisher (scheduler/mod.rs) that keeps
 * working while the window is hidden in the tray, and installing an update
 * kills that process — so the dialog says out loud how many posts are queued
 * instead of silently delaying them.
 */
export function UpdateDialog() {
  const status = useUpdateStore((s) => s.status);
  const info = useUpdateStore((s) => s.info);
  const downloaded = useUpdateStore((s) => s.downloaded);
  const contentLength = useUpdateStore((s) => s.contentLength);
  const error = useUpdateStore((s) => s.error);
  const dialogOpen = useUpdateStore((s) => s.dialogOpen);
  const install = useUpdateStore((s) => s.install);
  const installed = useUpdateStore((s) => s.installed);
  const restart = useUpdateStore((s) => s.restart);
  const remindNextLaunch = useUpdateStore((s) => s.remindNextLaunch);
  const skipVersion = useUpdateStore((s) => s.skipVersion);

  const [pendingPosts, setPendingPosts] = useState(0);

  // Only worth asking the database while the dialog is actually up — this is a
  // "how bad would a restart right now be" hint, not app state.
  useEffect(() => {
    if (!dialogOpen) return;
    let cancelled = false;
    getScheduledPosts()
      .then((posts) => {
        if (!cancelled) setPendingPosts(posts.filter((p) => p.status === "pending").length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dialogOpen]);

  if (!dialogOpen || !info) return null;

  const busy = status === "downloading" || status === "installing";
  const percent =
    contentLength && contentLength > 0
      ? Math.min(100, Math.round((downloaded / contentLength) * 100))
      : null;

  return (
    <Dialog
      mobileSheet
      // Deliberately inert: Escape and an outside click are ignored, so the
      // dialog cannot be dismissed by accident (a stray click losing an update
      // prompt the user never got to read was the actual complaint). The two
      // buttons — «Обновить сейчас» / «Позже» — and the explicit «Не напоминать
      // об этой версии» link are the only ways out. `open` is always true while
      // mounted, so Radix cannot close this itself either.
      onOpenChange={() => {}}
      style={{
        width: 420,
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
          <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>
            {t("update.title")}
          </span>
        </DialogTitle>
      </div>

      <div style={{ padding: "4px 16px 16px" }}>
        <DialogDescription asChild>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            <span style={{ display: "block", fontWeight: 600, color: "var(--text-primary)" }}>
              {ti("update.newVersion", { version: info.version })}
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
              {ti("update.currentVersion", { version: info.currentVersion })}
            </span>
          </div>
        </DialogDescription>

        {/* ── Release notes ──────────────────────────────────────────────── */}
        {status !== "error" && info.notes && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>
              {t("update.whatsNew")}
            </p>
            <div
              style={{
                maxHeight: 180,
                overflowY: "auto",
                fontSize: 12.5,
                lineHeight: 1.55,
                color: "var(--text-secondary)",
                backgroundColor: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                borderRadius: 10,
                padding: "10px 12px",
                whiteSpace: "pre-wrap",
              }}
            >
              {info.notes}
            </div>
          </div>
        )}

        {/* ── Pending scheduled posts ─────────────────────────────────────── */}
        {pendingPosts > 0 && status !== "error" && (
          <div
            className="flex items-start gap-1.5"
            style={{
              marginTop: 12,
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--warning)",
              backgroundColor: "var(--warning-subtle)",
              borderRadius: 10,
              padding: "8px 10px",
            }}
          >
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{ti("update.pendingPosts", { count: pendingPosts })}</span>
          </div>
        )}

        {/* ── Progress ───────────────────────────────────────────────────── */}
        {busy && (
          <div style={{ marginTop: 14 }}>
            <p className="flex items-center gap-2" style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
              {status === "installing" ? (
                <>
                  <Spinner size={14} />
                  {t("update.installing")}
                </>
              ) : (
                <>
                  <Download size={14} />
                  {t("update.downloading")}
                </>
              )}
            </p>

            {status === "downloading" && (
              <>
                <div
                  style={{
                    marginTop: 8,
                    height: 6,
                    borderRadius: 999,
                    backgroundColor: "var(--bg-elevated)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: percent === null ? "30%" : `${percent}%`,
                      height: "100%",
                      backgroundColor: "var(--accent)",
                      borderRadius: 999,
                      transition: "width 0.2s ease",
                    }}
                  />
                </div>
                <p style={{ marginTop: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
                  {contentLength
                    ? `${ti("update.downloaded", { done: formatBytes(downloaded), total: formatBytes(contentLength) })} · ${percent}%`
                    : formatBytes(downloaded)}
                </p>
              </>
            )}
          </div>
        )}

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {status === "error" && installed && (
          <p style={{ marginTop: 12, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {t("update.restartHint")}
          </p>
        )}

        {status === "error" && !installed && (
          <div
            className="flex items-start gap-1.5"
            style={{
              marginTop: 12,
              fontSize: 12.5,
              lineHeight: 1.5,
              color: "var(--danger)",
              backgroundColor: "var(--danger-subtle)",
              borderRadius: 10,
              padding: "8px 10px",
            }}
          >
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{ti("update.error", { error: error ?? "" })}</span>
          </div>
        )}
      </div>

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      {status === "downloading" || status === "installing" ? (
        <div style={{ padding: "0 16px 16px" }}>
          <Button variant="secondary" size="sm" fullWidth disabled>
            {status === "installing" ? t("update.installing") : t("update.downloading")}
          </Button>
        </div>
      ) : (
        <div style={{ padding: "0 16px 16px" }}>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              fullWidth
              leftIcon={installed || status === "error" ? <RefreshCw size={14} /> : <Download size={14} />}
              // Already installed but the relaunch didn't happen → only the
              // restart is left. Otherwise (re)download and install.
              onClick={() => void (installed ? restart() : install())}
            >
              {status === "error" && !installed
                ? t("update.retry")
                : installed
                  ? t("update.restart")
                  : t("update.install")}
            </Button>
            <Button variant="secondary" size="sm" fullWidth onClick={remindNextLaunch}>
              {t("update.later")}
            </Button>
          </div>

          <button
            onClick={() => skipVersion(info.version)}
            style={{
              display: "block",
              width: "100%",
              marginTop: 10,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 11.5,
              color: "var(--text-muted)",
              textDecoration: "underline",
            }}
          >
            {t("update.skip")}
          </button>

          <p style={{ marginTop: 6, textAlign: "center", fontSize: 11, color: "var(--text-muted)" }}>
            {t("update.laterHint")}
          </p>
        </div>
      )}
    </Dialog>
  );
}
