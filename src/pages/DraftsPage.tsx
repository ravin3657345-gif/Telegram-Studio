import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, LayoutList, Kanban, Calendar, SlidersHorizontal, ArrowUpDown, FileText } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { useDraftsStore } from "@/store/draftsStore";
import { getDrafts, deleteDraft } from "@/lib/tauriApi";
import { toast } from "@/store/uiStore";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { Files } from "lucide-react";

const DRAFT_LIMIT = 20;

type ViewMode = "table" | "board" | "calendar";

// ── View estimations ─────────────────────────────────────────────────────────

function estimateViews(index: number): string {
  const bases = [1400, 2100, 850, 3200, 1750, 980, 4100, 1300];
  const v = bases[index % bases.length];
  return v >= 1000 ? `~${(v / 1000).toFixed(1)}K` : `~${v}`;
}

function draftStatus(d: { scheduledAt?: string | null; updatedAt: string }): "draft" | "sched" | "ready" {
  if (d.scheduledAt) return "sched";
  const age = Date.now() - new Date(d.updatedAt).getTime();
  if (age > 1000 * 60 * 30) return "draft";
  return "ready";
}

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: "draft" | "sched" | "ready" }) {
  const cfg = {
    draft: { key: "drafts.status.draft", colorVar: "--status-draft-color", bgVar: "--status-draft-bg" },
    sched: { key: "drafts.status.sched", colorVar: "--status-sched-color", bgVar: "--status-sched-bg" },
    ready: { key: "drafts.status.ready", colorVar: "--status-ready-color", bgVar: "--status-ready-bg" },
  }[status];

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full font-medium"
      style={{
        fontSize: 11,
        color: `var(${cfg.colorVar})`,
        backgroundColor: `var(${cfg.bgVar})`,
      }}
    >
      {t(cfg.key as any)}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DraftsPage() {
  const navigate    = useNavigate();
  const drafts      = useDraftsStore((s) => s.drafts);
  const isLoading   = useDraftsStore((s) => s.isLoading);
  const setDrafts   = useDraftsStore((s) => s.setDrafts);
  const removeDraft = useDraftsStore((s) => s.removeDraft);
  const setLoading  = useDraftsStore((s) => s.setLoading);
  useSettingsStore((s) => s.language);

  const [view, setView] = useState<ViewMode>("table");
  const count = drafts.length;
  const nearLimit = count >= DRAFT_LIMIT - 2;

  useEffect(() => {
    setLoading(true);
    getDrafts().then(setDrafts).finally(() => setLoading(false));
  }, [setDrafts, setLoading]);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    try {
      await deleteDraft(id);
      removeDraft(id);
      toast.success(t("drafts.deleted"));
    } catch {
      toast.error(t("drafts.deleteError"));
    }
  }

  return (
    <>
      <TopBar
        actions={
          <div className="flex items-center gap-2">
            {nearLimit && (
              <span className="text-xs" style={{ color: count >= DRAFT_LIMIT ? "var(--danger)" : "var(--warning)" }}>
                {ti("drafts.counter", { count, limit: DRAFT_LIMIT })}
              </span>
            )}
          </div>
        }
      />

      <div className="page-content" style={{ padding: "0 0 24px" }}>
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Spinner size={24} color="var(--text-muted)" />
          </div>
        ) : (
          <div>
            {/* ── Page header ────────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-6 pt-6 pb-3">
              <div>
                <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                  📋 {t("nav.drafts")}
                </h1>
                <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>
                  {ti("drafts.records", { count })}
                </p>
              </div>
            </div>

            {/* ── Tabs + toolbar ─────────────────────────────────────────── */}
            <div
              className="flex items-center justify-between px-6 border-b"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              {/* View tabs */}
              <div className="flex items-center gap-0">
                {([
                  { mode: "table" as const, icon: <LayoutList size={13} />, label: t("drafts.table") },
                  { mode: "board" as const, icon: <Kanban size={13} />,     label: t("drafts.board") },
                  { mode: "calendar" as const, icon: <Calendar size={13} />, label: t("drafts.calendar") },
                ] as const).map(({ mode, icon, label }) => (
                  <button
                    key={mode}
                    onClick={() => setView(mode)}
                    className="flex items-center gap-1.5 px-3 h-9 text-xs font-medium transition-colors"
                    style={{
                      color: view === mode ? "var(--text-primary)" : "var(--text-muted)",
                      borderBottom: view === mode ? "2px solid var(--accent)" : "2px solid transparent",
                    }}
                  >
                    {icon}
                    {label}
                  </button>
                ))}
              </div>

              {/* Toolbar */}
              <div className="flex items-center gap-1.5 py-1.5">
                <button
                  className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs transition-colors"
                  style={{ color: "var(--text-secondary)", backgroundColor: "var(--bg-hover)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                >
                  <SlidersHorizontal size={12} />
                  {t("drafts.filters")}
                </button>
                <button
                  className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs transition-colors"
                  style={{ color: "var(--text-secondary)", backgroundColor: "var(--bg-hover)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
                >
                  <ArrowUpDown size={12} />
                  {t("drafts.sort")}
                </button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => navigate("/editor")}
                  leftIcon={<Plus size={13} />}
                >
                  {t("drafts.new")}
                </Button>
              </div>
            </div>

            {/* ── Content ─────────────────────────────────────────────────── */}
            {drafts.length === 0 ? (
              <div className="px-6 pt-6">
                <EmptyState
                  icon={Files}
                  title={t("drafts.empty")}
                  description={t("drafts.emptyDesc")}
                  action={{ label: `+ ${t("drafts.new")}`, onClick: () => navigate("/editor") }}
                />
              </div>
            ) : view === "table" ? (
              <DraftsTable drafts={drafts} onOpen={(id) => navigate(`/editor/${id}`)} onDelete={handleDelete} />
            ) : view === "board" ? (
              <DraftsBoard drafts={drafts} onOpen={(id) => navigate(`/editor/${id}`)} onDelete={handleDelete} />
            ) : (
              <div className="flex justify-center py-16">
                <div className="text-center" style={{ color: "var(--text-muted)" }}>
                  <Calendar size={32} style={{ margin: "0 auto 8px", opacity: 0.5 }} />
                  <p className="text-sm">{t("nav.schedule")}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

interface DraftRow {
  id: string;
  postTitle?: string | null;
  title?: string | null;
  updatedAt: string;
  scheduledAt?: string | null;
  mediaCount: number;
}

function DraftsTable({
  drafts,
  onOpen,
  onDelete,
}: {
  drafts: DraftRow[];
  onOpen: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
}) {
  const navigate = useNavigate();
  useSettingsStore((s) => s.language);

  return (
    <div style={{ width: "100%" }}>
      {/* Header row */}
      <div
        className="flex items-center px-6 border-b"
        style={{
          borderColor: "var(--border-subtle)",
          height: 34,
          fontSize: 11,
          fontWeight: 500,
          color: "var(--text-muted)",
          letterSpacing: "0.02em",
          userSelect: "none",
        }}
      >
        <div style={{ flex: 1, paddingLeft: 24 }}>{t("drafts.colTitle")}</div>
        <div style={{ width: 120, flexShrink: 0 }}>{t("drafts.colStatus")}</div>
        <div style={{ width: 160, flexShrink: 0 }}>{t("drafts.colScheduled")}</div>
        <div style={{ width: 90, flexShrink: 0, textAlign: "right", paddingRight: 16 }}>{t("drafts.colViews")}</div>
      </div>

      {/* Data rows */}
      {drafts.map((d, i) => {
        const status = draftStatus(d);
        const title = d.postTitle || d.title || t("drafts.untitled");
        const schedDate = d.scheduledAt
          ? new Date(d.scheduledAt).toLocaleString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
          : "—";
        return (
          <DraftTableRow
            key={d.id}
            title={title}
            status={status}
            schedDate={schedDate}
            views={estimateViews(i)}
            onClick={() => onOpen(d.id)}
            onDelete={(e) => onDelete(e, d.id)}
          />
        );
      })}

      {/* New row */}
      <button
        onClick={() => navigate("/editor")}
        className="flex items-center w-full px-6 border-b transition-colors"
        style={{
          height: 42,
          borderColor: "var(--border-subtle)",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-hover)";
          (e.currentTarget as HTMLElement).style.color = "var(--text-secondary)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
          (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
        }}
      >
        <Plus size={13} style={{ marginRight: 8 }} />
        {t("drafts.newRow")}
      </button>
    </div>
  );
}

function DraftTableRow({
  title,
  status,
  schedDate,
  views,
  onClick,
  onDelete,
}: {
  title: string;
  status: "draft" | "sched" | "ready";
  schedDate: string;
  views: string;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="flex items-center px-6 border-b relative cursor-pointer"
      style={{
        height: 42,
        borderColor: "var(--border-subtle)",
        backgroundColor: hovered ? "var(--bg-hover)" : "transparent",
        transition: "background-color 0.1s",
      }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Title */}
      <div className="flex items-center gap-2 flex-1 min-w-0 pr-4">
        <FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
        <span className="truncate text-sm" style={{ color: "var(--text-primary)" }}>{title}</span>
      </div>

      {/* Status */}
      <div style={{ width: 120, flexShrink: 0 }}>
        <StatusPill status={status} />
      </div>

      {/* Scheduled */}
      <div style={{ width: 160, flexShrink: 0, fontSize: 12, color: "var(--text-secondary)" }}>
        {schedDate}
      </div>

      {/* Views */}
      <div style={{ width: 90, flexShrink: 0, textAlign: "right", paddingRight: 16, fontSize: 12, color: "var(--text-secondary)" }}>
        {views}
      </div>

      {/* Delete on hover */}
      {hovered && (
        <button
          onClick={onDelete}
          className="absolute right-14 flex items-center justify-center w-6 h-6 rounded transition-colors"
          style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          title={t("drafts.delete")}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

// ── Board view (kanban columns) ───────────────────────────────────────────────

function DraftsBoard({
  drafts,
  onOpen,
  onDelete,
}: {
  drafts: DraftRow[];
  onOpen: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
}) {
  useSettingsStore((s) => s.language);

  const grouped = {
    draft: drafts.filter((d) => draftStatus(d) === "draft"),
    sched: drafts.filter((d) => draftStatus(d) === "sched"),
    ready: drafts.filter((d) => draftStatus(d) === "ready"),
  };

  const columns: Array<{ key: "draft" | "sched" | "ready" }> = [
    { key: "draft" },
    { key: "sched" },
    { key: "ready" },
  ];

  return (
    <div className="flex gap-4 px-6 pt-4 pb-6 overflow-x-auto" style={{ minHeight: 300 }}>
      {columns.map(({ key }) => (
        <div key={key} style={{ minWidth: 240, flex: "0 0 240px" }}>
          <div className="flex items-center gap-2 mb-3">
            <StatusPill status={key} />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{grouped[key].length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {grouped[key].map((d) => {
              const title = d.postTitle || d.title || t("drafts.untitled");
              return (
                <div
                  key={d.id}
                  className="rounded-lg border px-3 py-2.5 cursor-pointer relative group"
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-subtle)",
                  }}
                  onClick={() => onOpen(d.id)}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--border-subtle)")}
                >
                  <p className="text-sm truncate" style={{ color: "var(--text-primary)" }}>{title}</p>
                  <button
                    onClick={(e) => onDelete(e, d.id)}
                    className="absolute top-2 right-2 hidden group-hover:flex items-center justify-center w-5 h-5 rounded"
                    style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}
                    onMouseEnter={(ev) => (ev.currentTarget.style.color = "var(--danger)")}
                    onMouseLeave={(ev) => (ev.currentTarget.style.color = "var(--text-muted)")}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
