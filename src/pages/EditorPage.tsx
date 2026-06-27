import { useParams, useNavigate } from "react-router-dom";
import { CheckCircle2, AlertCircle, Loader2, LayoutTemplate, ChevronRight } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { PostEditor } from "@/components/editor/PostEditor";
import { PublishPanel } from "@/components/editor/PublishPanel";
import { TelegramPreview } from "@/components/preview/TelegramPreview";
import { useEditorStore } from "@/store/editorStore";
import { saveTemplate } from "@/lib/tauriApi";
import { toast } from "@/store/uiStore";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";

// ── Word count helper ─────────────────────────────────────────────────────────

function countWordsFromJson(json: string): { words: number; chars: number } {
  try {
    const doc = JSON.parse(json) as { content?: unknown[] };
    let text = "";
    function walk(node: { type?: string; text?: string; content?: unknown[] }) {
      if (node.text) text += node.text + " ";
      for (const child of node.content ?? []) walk(child as typeof node);
    }
    walk(doc as { type?: string; text?: string; content?: unknown[] });
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.replace(/\s/g, "").length;
    return { words, chars };
  } catch {
    return { words: 0, chars: 0 };
  }
}

// ── EditorPage ────────────────────────────────────────────────────────────────

export function EditorPage() {
  const { draftId } = useParams<{ draftId?: string }>();
  const navigate    = useNavigate();
  useSettingsStore((s) => s.language);
  const showPreview = useSettingsStore((s) => s.showTelegramPreview);

  const { draftTitle, postTitle, contentJson, saveStatus, lastSavedAt, draftId: storeDraftId } =
    useEditorStore();

  const effectiveDraftId = draftId ?? storeDraftId ?? undefined;
  const displayTitle     = postTitle || draftTitle || t("editor.untitled");
  const { words, chars } = countWordsFromJson(contentJson || "{}");
  const MAX_CHARS        = 30000;

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
      {/* ── TopBar with breadcrumbs ─────────────────────────────────────── */}
      <TopBar
        title={
          <div className="flex items-center gap-1.5" style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            <button
              onClick={() => navigate("/drafts")}
              className="transition-colors hover:text-[var(--text-primary)]"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("nav.drafts")}
            </button>
            <ChevronRight size={13} style={{ color: "var(--text-muted)" }} />
            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
              {displayTitle}
            </span>
          </div>
        }
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

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Editor column ───────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <PostEditor draftId={draftId} />

          {/* ── Word count footer bar ────────────────────────────────── */}
          <div
            className="flex items-center justify-end px-6 border-t flex-shrink-0"
            style={{
              height: 30,
              borderColor: "var(--border-subtle)",
              gap: 16,
            }}
          >
            <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
              {words} {words === 1 ? "слово" : words < 5 ? "слова" : "слов"}
            </span>
            <span
              style={{
                color: chars > MAX_CHARS ? "var(--danger)" : "var(--text-muted)",
                fontSize: 11,
              }}
            >
              {chars.toLocaleString("ru")} / {MAX_CHARS.toLocaleString("ru")}
            </span>
          </div>
        </div>

        {/* ── Right panel ─────────────────────────────────────────────── */}
        {showPreview && (
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
            <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
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
        )}
      </div>
    </>
  );
}

// ── SaveStatus sub-component ──────────────────────────────────────────────────

function SaveStatus({
  status,
  lastSavedAt,
}: {
  status: "idle" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
}) {
  if (status === "idle") return null;

  const cfg = {
    saving: { icon: <Loader2 size={12} className="animate-spin" />, label: t("editor.saving"),  color: "var(--text-muted)" },
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
