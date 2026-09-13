import { useEffect, useState } from "react";
import { Repeat, Trash2, Paperclip } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useSettingsStore } from "@/store/settingsStore";
import { toast } from "@/store/uiStore";
import { t, ti } from "@/lib/i18n";
import { describeRecurrence, formatNextRun } from "@/lib/recurrence";
import { getRecurringPosts, setRecurringEnabled, deleteRecurringPost } from "@/lib/tauriApi";
import type { RecurringPostInfo } from "@/types/recurring";

/**
 * The rules created from the editor's "Повторять" action, listed under the
 * calendar. Each one is a standing instruction, so this is where they are
 * paused, resumed and removed — there is no date to click on, because they
 * have no end.
 */
export function RecurringSection() {
  const language = useSettingsStore((s) => s.language) ?? "ru";
  const [rules, setRules] = useState<RecurringPostInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<RecurringPostInfo | null>(null);

  const load = () => {
    getRecurringPosts()
      .then(setRules)
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  async function toggle(rule: RecurringPostInfo) {
    setPendingId(rule.id);
    try {
      const updated = await setRecurringEnabled(rule.id, !rule.enabled);
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      toast.success(t(updated.enabled ? "repeat.resumed" : "repeat.paused"));
    } catch (e) {
      toast.error(t("repeat.error"), String(e));
    } finally {
      setPendingId(null);
    }
  }

  async function remove(rule: RecurringPostInfo) {
    setConfirming(null);
    try {
      await deleteRecurringPost(rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      toast.success(t("repeat.deleted"));
    } catch (e) {
      toast.error(t("repeat.error"), String(e));
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Spinner size={18} color="var(--text-muted)" />
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2">
        <Repeat size={14} style={{ color: "var(--accent)" }} />
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("repeat.section")}
        </h2>
        {rules.length > 0 && (
          <span
            className="px-1.5 rounded-full text-xs font-medium"
            style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}
          >
            {rules.length}
          </span>
        )}
      </div>

      {rules.length === 0 ? (
        <div
          className="rounded-xl border px-4 py-5 text-center"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-surface)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("repeat.empty")}</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{t("repeat.emptyHint")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => {
            const next = formatNextRun(rule.nextRunAt, language);
            const busy = pendingId === rule.id;
            return (
              <div
                key={rule.id}
                className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
                style={{
                  borderColor: "var(--border-subtle)",
                  backgroundColor: "var(--bg-surface)",
                  opacity: rule.enabled ? 1 : 0.6,
                }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate" style={{ color: "var(--text-primary)" }}>
                    {describeRecurrence(rule, language)}
                  </p>
                  <p className="text-[11.5px] truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {rule.channelTitle || rule.channelId}
                    {rule.mediaCount > 0 && (
                      <span className="inline-flex items-center gap-1 ml-2">
                        <Paperclip size={10} />
                        {rule.mediaCount}
                      </span>
                    )}
                    {!rule.enabled && ` · ${t("repeat.pausedBadge")}`}
                  </p>
                  {rule.enabled && next && (
                    <p className="text-[11px] mt-0.5" style={{ color: "var(--accent)" }}>
                      {ti("repeat.nextRun", { date: next })}
                    </p>
                  )}
                </div>

                {/* Pause / resume — the whole point of a standing rule is that
                    you can stop it without losing its settings. */}
                <button
                  onClick={() => toggle(rule)}
                  disabled={busy}
                  title={rule.enabled ? t("repeat.paused") : t("repeat.resumed")}
                  aria-pressed={rule.enabled}
                  style={{
                    width: 38, height: 22, borderRadius: 11, border: "none", flexShrink: 0,
                    cursor: busy ? "wait" : "pointer", position: "relative",
                    backgroundColor: rule.enabled ? "var(--accent)" : "var(--bg-elevated)",
                    transition: "background-color 0.15s",
                  }}
                >
                  <span
                    style={{
                      position: "absolute", top: 3, left: rule.enabled ? 19 : 3,
                      width: 16, height: 16, borderRadius: "50%",
                      backgroundColor: rule.enabled ? "#fff" : "var(--text-muted)",
                      transition: "left 0.15s",
                    }}
                  />
                </button>

                <button
                  onClick={() => setConfirming(rule)}
                  title={t("common.delete")}
                  className="flex items-center justify-center rounded-md flex-shrink-0"
                  style={{ width: 28, height: 28, color: "var(--text-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={t("repeat.deleteTitle")}
          description={t("repeat.deleteDesc")}
          confirmLabel={t("common.delete")}
          onConfirm={() => remove(confirming)}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
