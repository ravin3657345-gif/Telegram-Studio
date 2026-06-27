import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutTemplate, Trash2 } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { toast } from "@/store/uiStore";
import { getTemplates, deleteTemplate } from "@/lib/tauriApi";
import { useEditorStore } from "@/store/editorStore";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import type { Template } from "@/types/template";

export function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading]     = useState(true);
  const setContentJson            = useEditorStore((s) => s.setContentJson);
  useSettingsStore((s) => s.language);

  useEffect(() => {
    getTemplates()
      .then(setTemplates)
      .catch(() => toast.error(t("templates.loadError")))
      .finally(() => setLoading(false));
  }, []);

  function handleUse(tmpl: Template) {
    setContentJson(tmpl.contentJson);
    navigate("/editor");
    toast.success(ti("templates.opened", { name: tmpl.name }));
  }

  async function handleDelete(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation();
    try {
      await deleteTemplate(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast.success(ti("templates.deletedMsg", { name }));
    } catch {
      toast.error(t("templates.deleteError"));
    }
  }

  return (
    <>
      <TopBar />
      <div className="page-content">
        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner size={24} color="var(--text-muted)" />
          </div>
        ) : templates.length === 0 ? (
          <EmptyState
            icon={LayoutTemplate}
            title={t("templates.empty")}
            description={t("templates.emptyDesc")}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 max-w-4xl">
            {templates.map((tmpl) => (
              <TemplateCard
                key={tmpl.id}
                template={tmpl}
                onUse={() => handleUse(tmpl)}
                onDelete={(e) => handleDelete(e, tmpl.id, tmpl.name)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function TemplateCard({
  template,
  onUse,
  onDelete,
}: {
  template: Template;
  onUse: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  useSettingsStore((s) => s.language);

  const date = new Date(template.updatedAt).toLocaleString("ru", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className="rounded-lg border p-4 relative"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: hovered ? "var(--border-default)" : "var(--border-subtle)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <button
          onClick={onDelete}
          className="absolute top-2 right-2 flex items-center justify-center w-6 h-6 rounded transition-colors"
          style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          title={t("templates.delete")}
        >
          <Trash2 size={12} />
        </button>
      )}

      <div className="flex items-start gap-2 mb-3">
        <LayoutTemplate size={14} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
        <p className="text-sm font-semibold truncate pr-6" style={{ color: "var(--text-primary)" }}>
          {template.name}
        </p>
      </div>

      <div
        className="flex items-center justify-between pt-2 border-t text-2xs"
        style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
      >
        <span>{date}</span>
        <button
          onClick={onUse}
          className="px-2 py-0.5 rounded text-xs font-medium transition-colors"
          style={{ backgroundColor: "var(--accent)", color: "#fff" }}
        >
          {t("templates.use")}
        </button>
      </div>
    </div>
  );
}
