import { useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import type { Editor } from "@tiptap/react";
import { CheckCircle2, AlertCircle, Loader2, LayoutTemplate, PenLine, Eye, Send, Lock, XCircle } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { PostEditor } from "@/components/editor/PostEditor";
import { PublishPanel } from "@/components/editor/PublishPanel";
import { BlockPalette } from "@/components/editor/BlockPalette";
import { TelegramPreview } from "@/components/preview/TelegramPreview";
import { SaveTemplateDialog } from "@/components/editor/SaveTemplateDialog";
import { useEditorStore } from "@/store/editorStore";
import { saveTemplate, getScheduledPosts, cancelScheduledPost } from "@/lib/tauriApi";
import { collectInlineAttachments } from "@/lib/attachmentRestore";
import { toast } from "@/store/uiStore";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";
import type { TemplateCategory } from "@/types/template";
import type { LucideIcon } from "lucide-react";

type MobileTab = "editor" | "preview" | "publish";

// ── EditorPage ────────────────────────────────────────────────────────────────

export function EditorPage() {
  const { draftId } = useParams<{ draftId?: string }>();
  const navigate    = useNavigate();
  const location    = useLocation();
  const isCreateTemplate = !!(location.state as { _createTemplate?: boolean } | null)?._createTemplate;
  useSettingsStore((s) => s.language);
  const showPreview = useSettingsStore((s) => s.showTelegramPreview);
  const isMobile = useIsMobileLayout();

  const { draftTitle, postTitle, contentJson, saveStatus, saveErrorMessage, lastSavedAt, draftId: storeDraftId, templateName,
          draftStatus, publishMode, setDraftStatus } = useEditorStore();

  const effectiveDraftId = draftId ?? storeDraftId ?? undefined;
  const displayTitle     = postTitle || draftTitle || t("editor.untitled");

  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("editor");
  const [unlocking, setUnlocking] = useState(false);
  // Only needed to render BlockPalette in the right panel (in place of the
  // Telegram preview when it's off) — the editor instance itself lives in
  // PostEditor, this is just a read-only handle to it.
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  // Whether the right panel has something above the publish panel (preview
  // or, in its place, the block palette) — governs whether Publish is capped
  // at 60% of the column or gets the whole thing to itself.
  const hasTopContent = showPreview || !!editorInstance;

  // Editing an already-scheduled Rich draft is blocked entirely — Rich only
  // supports "compose fresh, then publish or schedule once" (see
  // PublishPanel.tsx's resync effect, which deliberately has no Rich branch).
  // The only way forward is to cancel the schedule, which drops the draft
  // back to a normal editable one.
  const isRichScheduledLocked = !!effectiveDraftId && draftStatus === "scheduled" && publishMode === "rich";

  async function handleUnlockScheduledRich() {
    if (!effectiveDraftId) return;
    setUnlocking(true);
    try {
      const posts = await getScheduledPosts();
      const mine = posts.filter((p) => p.draftId === effectiveDraftId);
      await Promise.all(mine.map((p) => cancelScheduledPost(p.id)));
      setDraftStatus("draft");
      toast.success(t("editor.scheduledRichUnlocked"));
    } catch {
      toast.error(t("editor.scheduledRichUnlockError"));
    } finally {
      setUnlocking(false);
    }
  }

  async function handleSaveAsTemplate(name: string, category: TemplateCategory) {
    setShowTemplateDialog(false);
    try {
      const attachments = await collectInlineAttachments(contentJson);
      await saveTemplate({ name, contentJson, category, attachments });
      toast.success(ti("editor.templateSaved", { name }));
      if (isCreateTemplate) navigate("/templates");
    } catch {
      toast.error(t("editor.templateError"));
    }
  }

  return (
    <>
      {/* ── TopBar with breadcrumbs ─────────────────────────────────────── */}
      <TopBar
        title={
          <div className="flex items-center gap-2 min-w-0">
            <span style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: 13 }}>
              {isCreateTemplate ? t("templates.createTemplate") : displayTitle}
            </span>
            {!isCreateTemplate && templateName && (
              <span
                className="flex items-center gap-1 truncate"
                style={{ color: "var(--text-muted)", fontSize: 11 }}
                title={ti("editor.fromTemplate", { name: templateName })}
              >
                <LayoutTemplate size={11} />
                {ti("editor.fromTemplate", { name: templateName })}
              </span>
            )}
          </div>
        }
        actions={
          <div className="flex items-center gap-2">
            {isCreateTemplate ? (
              <button
                onClick={() => setShowTemplateDialog(true)}
                className="flex items-center gap-1.5 px-3 h-7 rounded text-xs font-medium transition-colors"
                style={{ color: "#fff", backgroundColor: "var(--accent)" }}
              >
                <LayoutTemplate size={12} />
                {t("editor.saveAsTemplate")}
              </button>
            ) : (
              <button
                onClick={() => setShowTemplateDialog(true)}
                className="flex items-center gap-1.5 px-2 h-7 rounded text-xs transition-colors"
                style={{ color: "var(--text-muted)", backgroundColor: "var(--bg-elevated)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
              >
                <LayoutTemplate size={12} />
                {t("editor.saveAsTemplate")}
              </button>
            )}
            <SaveStatus status={saveStatus} lastSavedAt={lastSavedAt} errorMessage={saveErrorMessage} />
          </div>
        }
      />

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      {isMobile ? (
        isRichScheduledLocked ? (
          <ScheduledRichLockedPanel onUnlock={handleUnlockScheduledRich} unlocking={unlocking} />
        ) : (
          <MobileEditorBody
            draftId={draftId}
            effectiveDraftId={effectiveDraftId}
            showPreview={showPreview}
            activeTab={mobileTab}
            onTabChange={setMobileTab}
          />
        )
      ) : isRichScheduledLocked ? (
        <>
          {/* Kept mounted (hidden) so its draft-load effect still runs — that's
              what populated draftStatus/publishMode in the first place. */}
          <div style={{ display: "none" }}><PostEditor draftId={draftId} /></div>
          <ScheduledRichLockedPanel onUnlock={handleUnlockScheduledRich} unlocking={unlocking} />
        </>
      ) : (
        <div className="flex flex-1 overflow-hidden">

          {/* ── Editor column ───────────────────────────────────────────── */}
          <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-col flex-1 overflow-hidden">
              <PostEditor draftId={draftId} onEditorReady={setEditorInstance} />
            </div>

            {/* Docked in its original spot right next to the editor while the
                preview is showing — it relocates into the right panel below
                (in place of the preview) only once the preview is off. */}
            {showPreview && editorInstance && <BlockPalette editor={editorInstance} />}
          </div>

          {/* ── Right panel ─────────────────────────────────────────────── */}
          {/* Always rendered — Publish (channels/format/send) must stay
              reachable regardless of the "show Telegram preview" setting.
              Only the preview label + TelegramPreview above it are gated by
              showPreview; hiding them just lets Publish take the full column. */}
          <div
            className="flex flex-col flex-shrink-0 border-l overflow-hidden"
            style={{
              width: 300,
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--bg-surface)",
            }}
          >
            {showPreview ? (
              <>
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
              </>
            ) : (
              // Preview off — the block palette takes its place instead of
              // leaving that space empty (it's normally docked next to the
              // editor; here it moves into this column).
              editorInstance && <BlockPalette editor={editorInstance} fill />
            )}

            {/* Publish panel — buttons stay pinned inside it; only its own
                content area scrolls, so "Опубликовать"/"Запланировать" can
                never be pushed out of view regardless of how tall the
                channel list or warnings above them get. Capped at 60% only
                when something (preview or block palette) fills the rest of
                the column above it — otherwise it owns the whole column. */}
            <div
              data-tour="publish-panel"
              className={hasTopContent ? "border-t flex-shrink-0" : "flex-1"}
              style={{
                borderColor: "var(--border-subtle)",
                maxHeight: hasTopContent ? "60%" : undefined,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <PublishPanel draftId={effectiveDraftId} />
            </div>
          </div>
        </div>
      )}

      {showTemplateDialog && (
        <SaveTemplateDialog
          initialName={draftTitle}
          onConfirm={handleSaveAsTemplate}
          onClose={() => setShowTemplateDialog(false)}
        />
      )}
    </>
  );
}

// ── SaveStatus sub-component ──────────────────────────────────────────────────

function SaveStatus({
  status,
  lastSavedAt,
  errorMessage,
}: {
  status: "idle" | "saving" | "saved" | "error";
  lastSavedAt: Date | null;
  errorMessage: string | null;
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
      style={{ color: cfg.color, cursor: status === "error" && errorMessage ? "help" : undefined }}
      title={status === "error" && errorMessage ? errorMessage : undefined}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

// ── ScheduledRichLockedPanel ───────────────────────────────────────────────────
// Shown instead of the editor when a draft is scheduled and in Rich mode —
// editing an already-scheduled Rich post is blocked entirely (no resync path
// for it, unlike normal mode). The only way forward is to cancel the
// schedule (the draft goes back to a normal editable draft).

function ScheduledRichLockedPanel({ onUnlock, unlocking }: { onUnlock: () => void; unlocking: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div
        className="flex flex-col items-center gap-3 text-center rounded-xl border p-8"
        style={{ maxWidth: 420, borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-surface)" }}
      >
        <Lock size={28} style={{ color: "var(--text-muted)" }} />
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("editor.scheduledRichLockedTitle")}
        </p>
        <p className="text-xs" style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>
          {t("editor.scheduledRichLockedDesc")}
        </p>
        <button
          onClick={onUnlock}
          disabled={unlocking}
          className="flex items-center gap-1.5 px-3 h-8 rounded text-xs font-medium transition-colors mt-1"
          style={{ color: "#fff", backgroundColor: "var(--danger)", opacity: unlocking ? 0.6 : 1 }}
        >
          {unlocking ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
          {t("editor.scheduledRichLockedCancel")}
        </button>
      </div>
    </div>
  );
}

// ── MobileEditorBody sub-component ────────────────────────────────────────────
// Editor / Preview / Publish rendered as tabs instead of side-by-side columns.
// All three panels stay mounted (only `display` toggles) so the TipTap editor
// keeps its state and focus when the user switches tabs.

function MobileEditorBody({
  draftId,
  effectiveDraftId,
  showPreview,
  activeTab,
  onTabChange,
}: {
  draftId?: string;
  effectiveDraftId?: string;
  showPreview: boolean;
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}) {
  const tabs: { id: MobileTab; label: string; icon: LucideIcon }[] = [
    { id: "editor", label: t("editor.tabEditor"), icon: PenLine },
    ...(showPreview ? [{ id: "preview" as MobileTab, label: t("editor.preview"), icon: Eye }] : []),
    { id: "publish", label: t("editor.tabPublish"), icon: Send },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Tab switcher */}
      <div
        className="flex flex-shrink-0 border-b"
        style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-surface)" }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors"
              style={{
                color: isActive ? "var(--accent)" : "var(--text-muted)",
                borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
              }}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Editor panel */}
      <div
        className="flex-col flex-1 overflow-hidden"
        style={{ display: activeTab === "editor" ? "flex" : "none" }}
      >
        <PostEditor draftId={draftId} />
      </div>

      {/* Preview panel */}
      {showPreview && (
        <div
          className="flex-1 overflow-y-auto"
          style={{ display: activeTab === "preview" ? "block" : "none", minHeight: 0 }}
        >
          <TelegramPreview />
        </div>
      )}

      {/* Publish panel — full height on mobile, reachable regardless of the
          desktop "show preview" setting (unlike the desktop layout, where
          hiding the preview column also hides Publish). */}
      <div
        data-tour="publish-panel"
        className="flex-col flex-1 overflow-hidden"
        style={{ display: activeTab === "publish" ? "flex" : "none" }}
      >
        <PublishPanel draftId={effectiveDraftId} />
      </div>
    </div>
  );
}
