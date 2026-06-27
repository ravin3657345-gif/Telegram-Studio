import { useParams } from "react-router-dom";
import { CheckCircle2, AlertCircle, Loader2, LayoutTemplate } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { PostEditor } from "@/components/editor/PostEditor";
import { PublishPanel } from "@/components/editor/PublishPanel";
import { TelegramPreview } from "@/components/preview/TelegramPreview";
import { useEditorStore } from "@/store/editorStore";
import { saveTemplate } from "@/lib/tauriApi";
import { toast } from "@/store/uiStore";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";

export function EditorPage() {
  const { draftId } = useParams<{ draftId?: string }>();
  // Subscribe to language so labels re-render on change
  useSettingsStore((s) => s.language);

  const { draftTitle, contentJson, saveStatus, lastSavedAt, draftId: storeDraftId } =
    useEditorStore();

  // URL param draftId (when opening existing draft) OR autosave-created draft id
  const effectiveDraftId = draftId ?? storeDraftId ?? undefined;

  async function handleSaveAsTemplate() {
    const name = draftTitle.trim() || t("editor.untitled");
    try {
      await saveTemplate({ name, contentJson });
      toast.success(ti("editor.templateSaved", { name }));
    } catch {
      toast.error(t("editor.templateError"));
    }
  }

  return (
    <>
      {/* ── TopBar ──────────────────────────────────────────────────────────── */}
      <TopBar
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveAsTemplate}
              className="flex items-center gap-1.5 px-2 h-7 rounded text-xs transition-colors"
              style={{ color: "var(--text-muted)", backgroundColor: "var(--bg-elevated)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
              title={t("editor.saveAsTemplate")}
            >
              <LayoutTemplate size={12} />
              {t("editor.template")}
            </button>
            <SaveStatus status={saveStatus} lastSavedAt={lastSavedAt} />
          </div>
        }
      />

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Editor column ───────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <PostEditor draftId={draftId} />  {/* URL param — controls which draft to load */}
        </div>

        {/* ── Right panel ─────────────────────────────────────────────────── */}
        <div
          className="flex flex-col flex-shrink-0 border-l overflow-hidden"
          style={{
            width: 300,
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--bg-surface)",
          }}
        >
          {/* Preview label */}
          <div
            className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide border-b flex-shrink-0"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-muted)",
            }}
          >
            {t("editor.preview")}
          </div>

          {/* Telegram preview */}
          <div
            className="flex-1 overflow-y-auto"
            style={{ minHeight: 0 }}
          >
            <TelegramPreview />
          </div>

          {/* Publish panel */}
          <div
            className="border-t flex-shrink-0 overflow-y-auto"
            style={{
              borderColor: "var(--border-subtle)",
              maxHeight: "60%",
            }}
          >
            <PublishPanel draftId={effectiveDraftId} />
          </div>
        </div>
      </div>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SaveStatus({
  status,
  lastSavedAt,
}: {
  status: "idle" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
}) {
  if (status === "idle") return null;

  const cfg = {
    saving: { icon: <Loader2 size={12} className="animate-spin" />, label: t("editor.saving"), color: "var(--text-muted)" },
    saved:  { icon: <CheckCircle2 size={12} />, label: lastSavedAt ? ti("editor.savedAt", { time: formatTime(lastSavedAt) }) : t("editor.saved"), color: "var(--success)" },
    error:  { icon: <AlertCircle size={12} />,  label: t("editor.saveError"), color: "var(--danger)" },
    idle:   { icon: null, label: "", color: "" },
  }[status];

  return (
    <span
      key={status}
      className="save-status-anim flex items-center gap-1 text-2xs"
      style={{ color: cfg.color }}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
