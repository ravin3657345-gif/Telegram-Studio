import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, FileEdit, LayoutTemplate, Loader2 } from "lucide-react";
import { getTemplates, getTemplate, upsertDraft, recordTemplateUse } from "@/lib/tauriApi";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { toast } from "@/store/uiStore";
import type { Template } from "@/types/template";
import { Dialog, DialogTitle, DialogDescription, VisuallyHidden } from "@/components/ui/Dialog";

interface Props {
  onClose: () => void;
}

// Single entry point for "New post" — offers starting from scratch or from a
// saved template right here, instead of requiring a separate trip to the
// Templates page first. Reuses the exact same create-draft-from-template
// logic as TemplatesPage.tsx's handleUse (upsertDraft + recordTemplateUse).
export function NewPostChooserDialog({ onClose }: Props) {
  useSettingsStore((s) => s.language);
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingId, setUsingId] = useState<string | null>(null);

  useEffect(() => {
    getTemplates().then(setTemplates).catch(() => {}).finally(() => setLoading(false));
  }, []);

  function handleFromScratch() {
    onClose();
    // _newPost tells PostEditor this is a genuinely blank post, not a return
    // trip to whatever was already open — see PostEditor's isFreshSession.
    // A fresh timestamp, not `true` — see the HistoryNavState comment in
    // PostEditor.tsx for why a repeated static value wouldn't reset twice.
    navigate("/editor", { state: { _newPost: Date.now() } });
  }

  async function handleUse(tmpl: Template) {
    setUsingId(tmpl.id);
    try {
      const full = await getTemplate(tmpl.id);
      const draft = await upsertDraft({
        contentJson: tmpl.contentJson,
        templateId: tmpl.id,
        attachments: full.attachments,
      });
      await recordTemplateUse(tmpl.id);
      onClose();
      navigate(`/editor/${draft.id}`);
    } catch {
      toast.error(t("templates.useError"));
      setUsingId(null);
    }
  }

  return (
    <Dialog
      mobileSheet
      onOpenChange={(open) => !open && onClose()}
      style={{
        width: 460,
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "calc(100vh - 64px)",
        borderRadius: 16,
        backgroundColor: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 16px 12px", flexShrink: 0 }}>
          <DialogTitle asChild>
            <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>
              {t("drafts.new")}
            </span>
          </DialogTitle>
          <VisuallyHidden><DialogDescription>{t("drafts.chooser.scratchDesc")}</DialogDescription></VisuallyHidden>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "var(--text-muted)", lineHeight: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: "0 16px 16px", overflowY: "auto" }}>
          {/* From scratch */}
          <button
            onClick={handleFromScratch}
            style={{
              display: "flex", alignItems: "center", gap: 12, width: "100%",
              padding: "12px 14px", borderRadius: 10,
              border: "1.5px solid var(--border-default)",
              backgroundColor: "var(--bg-elevated)",
              cursor: "pointer", textAlign: "left",
              marginBottom: 14,
              transition: "border-color 0.15s, background-color 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--accent) 7%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.backgroundColor = "var(--bg-elevated)"; }}
          >
            <div style={{ width: 34, height: 34, borderRadius: 8, flexShrink: 0, backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <FileEdit size={16} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{t("drafts.chooser.scratch")}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{t("drafts.chooser.scratchDesc")}</div>
            </div>
          </button>

          {!loading && templates.length > 0 && (
            <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.03em", textTransform: "uppercase" }}>
              {t("drafts.chooser.orTemplate")}
            </p>
          )}

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={18} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {templates.map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => handleUse(tmpl)}
                  disabled={usingId !== null}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, width: "100%",
                    padding: "10px 14px", borderRadius: 10,
                    border: "1.5px solid var(--border-default)",
                    backgroundColor: "var(--bg-elevated)",
                    cursor: usingId ? "default" : "pointer", textAlign: "left",
                    opacity: usingId && usingId !== tmpl.id ? 0.5 : 1,
                    transition: "border-color 0.15s, background-color 0.15s",
                  }}
                  onMouseEnter={(e) => { if (!usingId) { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--accent) 7%, transparent)"; } }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.backgroundColor = "var(--bg-elevated)"; }}
                >
                  <div style={{ width: 30, height: 30, borderRadius: 7, flexShrink: 0, backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {usingId === tmpl.id ? <Loader2 size={14} className="animate-spin" /> : <LayoutTemplate size={14} />}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {tmpl.name}
                    </div>
                    {tmpl.usageCount > 0 && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {ti("templates.useCount", { count: tmpl.usageCount })}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
    </Dialog>
  );
}
