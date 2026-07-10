import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LayoutTemplate, Trash2, Plus, Megaphone, List, Users, Tag, Layers, Sparkles, type LucideIcon } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { toast, TOAST_DURATIONS } from "@/store/uiStore";
import { getTemplates, getTemplate, deleteTemplate, upsertDraft, recordTemplateUse } from "@/lib/tauriApi";
import { useEditorStore } from "@/store/editorStore";
import { t, ti, type TranslationKey } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import type { Template, TemplateCategory } from "@/types/template";
import { EXAMPLE_TEMPLATES, type ExampleTemplate } from "@/lib/exampleTemplates";

// ── Category metadata ─────────────────────────────────────────────────────────

const CATEGORY_META: Record<TemplateCategory, { labelKey: TranslationKey; Icon: LucideIcon; gradient: string }> = {
  announcements: { labelKey: "templates.cat.announce",    Icon: Megaphone, gradient: "linear-gradient(135deg,#3b82f6,#2563eb)" },
  collections:   { labelKey: "templates.cat.collection",  Icon: List,      gradient: "linear-gradient(135deg,#8b5cf6,#6366f1)" },
  engagement:    { labelKey: "templates.cat.engagement",  Icon: Users,     gradient: "linear-gradient(135deg,#10b981,#059669)" },
  promo:         { labelKey: "templates.cat.promo",       Icon: Tag,       gradient: "linear-gradient(135deg,#f59e0b,#ef4444)" },
  other:         { labelKey: "templates.cat.other",       Icon: Layers,    gradient: "linear-gradient(135deg,#64748b,#475569)" },
};

const CATEGORY_ORDER: TemplateCategory[] = ["announcements", "collections", "engagement", "promo", "other"];

// ── Main component ────────────────────────────────────────────────────────────

export function TemplatesPage() {
  const navigate   = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading]     = useState(true);
  const [activeFilter, setActiveFilter] = useState<TemplateCategory | "all">("all");
  const setContentJson = useEditorStore((s) => s.setContentJson);
  useSettingsStore((s) => s.language);

  // Pending optimistic deletes, keyed by template id — cleared by Undo.
  const pendingDeletesRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    getTemplates()
      .then(setTemplates)
      .catch(() => toast.error(t("templates.loadError")))
      .finally(() => setLoading(false));
  }, []);

  // Creates a real draft right away (rather than only populating the open
  // editor) so the template link (templateId) and usage counter attach
  // immediately, regardless of whether the user ever edits further. Also
  // re-fetches the template's own media (the list view's Template objects
  // never carry attachments) and carries it over to the new draft's own
  // files — the editor we navigate to next re-derives fresh blob URLs from
  // these same attachments itself (see PostEditor's draft-load effect), so
  // there's no need to patch blob src's into contentJson here too.
  async function handleUse(tmpl: Template) {
    try {
      const full = await getTemplate(tmpl.id);
      const draft = await upsertDraft({
        contentJson: tmpl.contentJson,
        templateId: tmpl.id,
        attachments: full.attachments,
      });
      await recordTemplateUse(tmpl.id);
      navigate(`/editor/${draft.id}`);
      toast.success(ti("templates.opened", { name: tmpl.name }));
    } catch {
      toast.error(t("templates.useError"));
    }
  }

  function handleUseExample(example: ExampleTemplate) {
    setContentJson(example.contentJson);
    navigate("/editor");
    toast.success(ti("templates.examples.opened", { name: example.name }));
  }

  function handleDelete(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation();
    const removed = templates.find((tpl) => tpl.id === id);
    if (!removed) return;

    // Optimistic remove — the actual backend delete is deferred to the end of
    // the undo window, so clicking "Undo" only ever cancels a pending delete.
    setTemplates((prev) => prev.filter((tpl) => tpl.id !== id));

    const timer = setTimeout(async () => {
      pendingDeletesRef.current.delete(id);
      try {
        await deleteTemplate(id);
      } catch {
        setTemplates((prev) => (prev.some((tpl) => tpl.id === id) ? prev : [...prev, removed]));
        toast.error(t("templates.deleteError"));
      }
    }, TOAST_DURATIONS.warning);
    pendingDeletesRef.current.set(id, timer);

    toast.warning(ti("templates.deletedMsg", { name }), undefined, {
      label: t("templates.undo"),
      onClick: () => {
        const pending = pendingDeletesRef.current.get(id);
        if (pending) {
          clearTimeout(pending);
          pendingDeletesRef.current.delete(id);
        }
        setTemplates((prev) => (prev.some((tpl) => tpl.id === id) ? prev : [...prev, removed]));
      },
    });
  }

  // Categories that actually have templates
  const usedCategories = CATEGORY_ORDER.filter((cat) =>
    templates.some((tmpl) => (tmpl.category || "other") === cat)
  );

  const filtered = activeFilter === "all"
    ? templates
    : templates.filter((tmpl) => (tmpl.category || "other") === activeFilter);

  // Group filtered templates by category
  const grouped: { cat: TemplateCategory; items: Template[] }[] = CATEGORY_ORDER
    .map((cat) => ({ cat, items: filtered.filter((tmpl) => (tmpl.category || "other") === cat) }))
    .filter(({ items }) => items.length > 0);

  return (
    <>
      <TopBar
        actions={
          <Button variant="primary" size="sm" leftIcon={<Plus size={13} />} onClick={() => navigate("/editor", { state: { _createTemplate: true } })}>
            {t("templates.createTemplate")}
          </Button>
        }
      />

      <div className="page-content" style={{ padding: "0 0 40px" }}>
        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner size={24} color="var(--text-muted)" />
          </div>
        ) : (
          <div>
            {/* Page header */}
            <div className="px-6 pt-6 pb-4">
              <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                🧩 {t("nav.templates")}
              </h1>
            </div>

            {/* Ready-made examples — always visible, undeletable, not stored in the DB */}
            <div className="px-6 pb-8">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={15} style={{ color: "var(--accent)" }} />
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {t("templates.examples.title")}
                </h2>
              </div>
              <p className="mb-3" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {t("templates.examples.subtitle")}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
                {EXAMPLE_TEMPLATES.map((ex) => (
                  <ExampleCard
                    key={ex.id}
                    example={ex}
                    gradient={CATEGORY_META[ex.category].gradient}
                    Icon={CATEGORY_META[ex.category].Icon}
                    onUse={() => handleUseExample(ex)}
                  />
                ))}
              </div>
            </div>

            {/* My templates */}
            {templates.length > 0 && (
              <div className="px-6 pb-1">
                <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {t("templates.myTemplates")}
                </h2>
              </div>
            )}

            {/* Filter chips */}
            {templates.length > 0 && (
              <div className="flex items-center gap-1.5 px-6 pb-5 flex-wrap">
                <FilterChip label={t("templates.cat.all")} active={activeFilter === "all"} onClick={() => setActiveFilter("all")} />
                {usedCategories.map((cat) => (
                  <FilterChip
                    key={cat}
                    label={t(CATEGORY_META[cat].labelKey)}
                    active={activeFilter === cat}
                    onClick={() => setActiveFilter(cat)}
                  />
                ))}
              </div>
            )}

            {/* Empty state */}
            {templates.length === 0 ? (
              <div className="px-6">
                <EmptyState
                  icon={LayoutTemplate}
                  title={t("templates.empty")}
                  description={t("templates.emptyDesc")}
                />
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-6 py-16 text-center" style={{ color: "var(--text-muted)", fontSize: 13 }}>
                {t("templates.noResults")}
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                {grouped.map(({ cat, items }) => {
                  const meta = CATEGORY_META[cat];
                  const Icon = meta.Icon;
                  return (
                    <div key={cat}>
                      {/* Section header — only show when "all" or multiple groups */}
                      {(activeFilter === "all" || grouped.length > 1) && (
                        <div className="flex items-center gap-2 px-6 mb-3">
                          <div
                            style={{
                              width: 26, height: 26, borderRadius: 7,
                              background: meta.gradient,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <Icon size={13} color="rgba(255,255,255,0.9)" />
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                            {t(meta.labelKey)}
                          </span>
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {items.length}
                          </span>
                        </div>
                      )}

                      {/* Cards grid */}
                      <div
                        className="px-6"
                        style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}
                      >
                        {items.map((tmpl) => (
                          <TemplateCard
                            key={tmpl.id}
                            template={tmpl}
                            gradient={meta.gradient}
                            Icon={meta.Icon}
                            onUse={() => handleUse(tmpl)}
                            onDelete={(e) => handleDelete(e, tmpl.id, tmpl.name)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}

                {/* New template dashed card — always visible */}
                <div className="px-6">
                  <button
                    onClick={() => navigate("/editor", { state: { _createTemplate: true } })}
                    className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all w-full"
                    style={{
                      minHeight: 80,
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
                    <Plus size={18} strokeWidth={1.5} />
                    <span>{t("templates.newTemplate")}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Filter chip ───────────────────────────────────────────────────────────────

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 h-7 rounded-full text-xs font-medium transition-all"
      style={{
        backgroundColor: active ? "var(--text-primary)" : "var(--bg-hover)",
        color: active ? "var(--bg-surface)" : "var(--text-secondary)",
        border: "1px solid",
        borderColor: active ? "var(--text-primary)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}

// ── Template card ─────────────────────────────────────────────────────────────

function TemplateCard({
  template, gradient, Icon, onUse, onDelete,
}: {
  template: Template;
  gradient: string;
  Icon: LucideIcon;
  onUse: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);
  useSettingsStore((s) => s.language);

  const date = new Date(template.updatedAt).toLocaleString("ru", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
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
      {/* Gradient preview */}
      <div style={{ height: 100, background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={28} color="rgba(255,255,255,0.75)" strokeWidth={1.5} />
      </div>

      {/* Card body */}
      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
          {template.name}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p style={{ color: "var(--text-muted)", fontSize: 11 }}>{date}</p>
          {template.usageCount > 0 && (
            <>
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>·</span>
              <p style={{ color: "var(--text-muted)", fontSize: 11 }}>
                {ti("templates.useCount", { count: template.usageCount })}
              </p>
            </>
          )}
        </div>
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

// ── Example card (built-in, undeletable) ──────────────────────────────────────

function ExampleCard({
  example, gradient, Icon, onUse,
}: {
  example: ExampleTemplate;
  gradient: string;
  Icon: LucideIcon;
  onUse: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  useSettingsStore((s) => s.language);

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
      {/* Gradient preview */}
      <div style={{ height: 72, background: gradient, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <Icon size={24} color="rgba(255,255,255,0.75)" strokeWidth={1.5} />
        <span
          className="absolute top-2 right-2 flex items-center justify-center rounded-full"
          style={{ width: 20, height: 20, backgroundColor: "rgba(255,255,255,0.22)" }}
          title={t("templates.examples.title")}
        >
          <Sparkles size={11} color="#fff" />
        </span>
      </div>

      {/* Card body */}
      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
          {example.name}
        </p>
        <p className="mt-1" style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 }}>
          {example.technique}
        </p>
      </div>

      {/* "Use" hint on hover — no delete button, these aren't removable */}
      {hovered && (
        <div
          className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-md"
          style={{ backgroundColor: "rgba(0,0,0,0.4)", color: "#fff", fontSize: 10, fontWeight: 600 }}
        >
          {t("templates.use")}
        </div>
      )}
    </div>
  );
}
