import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutTemplate, Trash2, Plus } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { toast } from "@/store/uiStore";
import { getTemplates, deleteTemplate } from "@/lib/tauriApi";
import { useEditorStore } from "@/store/editorStore";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import type { Template } from "@/types/template";

// ── Category chips data ───────────────────────────────────────────────────────

type Category = "all" | "announce" | "collection" | "engagement" | "promo";

const CATEGORIES: Array<{ key: Category; labelKey: string }> = [
  { key: "all",        labelKey: "templates.cat.all"        },
  { key: "announce",   labelKey: "templates.cat.announce"   },
  { key: "collection", labelKey: "templates.cat.collection" },
  { key: "engagement", labelKey: "templates.cat.engagement" },
  { key: "promo",      labelKey: "templates.cat.promo"      },
];

// Assign a category and gradient color to a template deterministically
const GRADIENT_PALETTE = [
  "linear-gradient(135deg,#6366f1,#8b5cf6)",
  "linear-gradient(135deg,#f59e0b,#ef4444)",
  "linear-gradient(135deg,#10b981,#059669)",
  "linear-gradient(135deg,#3b82f6,#2563eb)",
  "linear-gradient(135deg,#ec4899,#db2777)",
  "linear-gradient(135deg,#f97316,#ea580c)",
  "linear-gradient(135deg,#06b6d4,#0891b2)",
  "linear-gradient(135deg,#84cc16,#65a30d)",
];

const CATEGORY_KEYS: Category[] = ["announce","collection","engagement","promo","all"];

function templateCategory(id: string): Category {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xff;
  return CATEGORY_KEYS[h % (CATEGORY_KEYS.length - 1)];
}

function templateGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 17 + id.charCodeAt(i)) & 0xff;
  return GRADIENT_PALETTE[h % GRADIENT_PALETTE.length];
}

// ── Main component ────────────────────────────────────────────────────────────

export function TemplatesPage() {
  const navigate = useNavigate();
  const [templates, setTemplates]   = useState<Template[]>([]);
  const [loading, setLoading]       = useState(true);
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const setContentJson              = useEditorStore((s) => s.setContentJson);
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

  const filtered = activeCategory === "all"
    ? templates
    : templates.filter((tmpl) => templateCategory(tmpl.id) === activeCategory);

  return (
    <>
      <TopBar
        actions={
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Plus size={13} />}
            onClick={() => navigate("/editor")}
          >
            {t("templates.createTemplate")}
          </Button>
        }
      />

      <div className="page-content" style={{ padding: "0 0 32px" }}>
        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner size={24} color="var(--text-muted)" />
          </div>
        ) : (
          <div>
            {/* ── Page header ────────────────────────────────────────── */}
            <div className="px-6 pt-6 pb-4">
              <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                🧩 {t("nav.templates")}
              </h1>
            </div>

            {/* ── Category chips ─────────────────────────────────────── */}
            <div className="flex items-center gap-1.5 px-6 pb-4 flex-wrap">
              {CATEGORIES.map(({ key, labelKey }) => {
                const isActive = activeCategory === key;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveCategory(key)}
                    className="px-3 h-7 rounded-full text-xs font-medium transition-all"
                    style={{
                      backgroundColor: isActive ? "var(--text-primary)" : "var(--bg-hover)",
                      color: isActive ? "var(--bg-surface)" : "var(--text-secondary)",
                      border: "1px solid",
                      borderColor: isActive ? "var(--text-primary)" : "transparent",
                    }}
                  >
                    {t(labelKey as any)}
                  </button>
                );
              })}
            </div>

            {/* ── Gallery grid ───────────────────────────────────────── */}
            {templates.length === 0 ? (
              <div className="px-6">
                <EmptyState
                  icon={LayoutTemplate}
                  title={t("templates.empty")}
                  description={t("templates.emptyDesc")}
                />
              </div>
            ) : (
              <div
                className="px-6"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 16,
                }}
              >
                {filtered.map((tmpl) => (
                  <TemplateCard
                    key={tmpl.id}
                    template={tmpl}
                    gradient={templateGradient(tmpl.id)}
                    onUse={() => handleUse(tmpl)}
                    onDelete={(e) => handleDelete(e, tmpl.id, tmpl.name)}
                  />
                ))}

                {/* ── New template dashed card ─────────────────────── */}
                <button
                  onClick={() => navigate("/editor")}
                  className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all"
                  style={{
                    minHeight: 168,
                    borderColor: "var(--border-default)",
                    color: "var(--text-muted)",
                    fontSize: 13,
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)";
                    (e.currentTarget as HTMLElement).style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)";
                    (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
                  }}
                >
                  <Plus size={20} strokeWidth={1.5} />
                  <span>{t("templates.newTemplate")}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  gradient,
  onUse,
  onDelete,
}: {
  template: Template;
  gradient: string;
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
      className="rounded-xl border overflow-hidden cursor-pointer relative"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: hovered ? "var(--border-strong)" : "var(--border-subtle)",
        boxShadow: hovered ? "0 4px 14px rgba(0,0,0,0.07)" : "none",
        transition: "border-color 0.15s, box-shadow 0.15s",
      }}
      onClick={onUse}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Gradient preview "lid" */}
      <div
        style={{
          height: 118,
          background: gradient,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <LayoutTemplate size={32} color="rgba(255,255,255,0.7)" strokeWidth={1.5} />
      </div>

      {/* Card body */}
      <div className="px-3 py-3">
        <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
          {template.name}
        </p>
        <p className="mt-0.5" style={{ color: "var(--text-muted)", fontSize: 11 }}>{date}</p>
      </div>

      {/* Delete on hover */}
      {hovered && (
        <button
          onClick={onDelete}
          className="absolute top-2 right-2 flex items-center justify-center w-7 h-7 rounded-md transition-colors"
          style={{ backgroundColor: "rgba(0,0,0,0.35)", color: "rgba(255,255,255,0.8)" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(220,38,38,0.7)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.35)")}
          title={t("templates.delete")}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
