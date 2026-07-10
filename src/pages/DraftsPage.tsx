import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Trash2, LayoutList, Kanban, Calendar, SlidersHorizontal, ArrowUpDown, FileText,
  Check, ChevronLeft, ChevronRight,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { useDraftsStore } from "@/store/draftsStore";
import { getDrafts, deleteDraft } from "@/lib/tauriApi";
import { toast, TOAST_DURATIONS } from "@/store/uiStore";
import { t, ti, type TranslationKey } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { Files } from "lucide-react";
import {
  type DraftStatus, type DraftSortKey, filterAndSortDrafts,
} from "@/lib/draftsFilter";
import { WEEKDAY_BASE_DATES, buildCalendarGrid, sameDay } from "@/lib/calendarGrid";
import { DRAFT_MAX_COUNT } from "@/lib/constants";

const DRAFT_LIMIT = DRAFT_MAX_COUNT;

type ViewMode = "table" | "board" | "calendar";

const ALL_STATUSES: DraftStatus[] = ["draft", "scheduled", "published"];

const STATUS_LABEL_KEY: Record<DraftStatus, TranslationKey> = {
  draft:     "drafts.status.draft",
  scheduled: "drafts.status.sched",
  published: "drafts.status.published",
};

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: DraftStatus }) {
  const cfg = {
    draft:     { key: STATUS_LABEL_KEY.draft,     colorVar: "--status-draft-color",     bgVar: "--status-draft-bg" },
    scheduled: { key: STATUS_LABEL_KEY.scheduled, colorVar: "--status-sched-color",     bgVar: "--status-sched-bg" },
    published: { key: STATUS_LABEL_KEY.published, colorVar: "--status-published-color", bgVar: "--status-published-bg" },
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
      {t(cfg.key)}
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
  const restoreDraft = useDraftsStore((s) => s.restoreDraft);
  const setLoading  = useDraftsStore((s) => s.setLoading);
  useSettingsStore((s) => s.language);

  // Pending optimistic deletes, keyed by draft id — cleared by Undo.
  const pendingDeletesRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const [view, setView] = useState<ViewMode>("table");
  const count = drafts.length;
  const nearLimit = count >= DRAFT_LIMIT - 2;

  const [statusFilter, setStatusFilter] = useState<Set<DraftStatus>>(new Set(ALL_STATUSES));
  const [sortBy, setSortBy] = useState<DraftSortKey>("updated");
  const [openMenu, setOpenMenu] = useState<"filters" | "sort" | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!toolbarRef.current?.contains(e.target as Node)) setOpenMenu(null);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const visibleDrafts = useMemo(
    () => filterAndSortDrafts(drafts, statusFilter, sortBy),
    [drafts, statusFilter, sortBy],
  );

  function toggleStatus(s: DraftStatus) {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  useEffect(() => {
    setLoading(true);
    getDrafts().then(setDrafts).finally(() => setLoading(false));
  }, [setDrafts, setLoading]);

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    const draft = drafts.find((d) => d.id === id);
    if (!draft) return;

    // Optimistic remove — the actual backend delete is deferred to the end of
    // the undo window, so clicking "Undo" never has to reverse a completed
    // deletion, it just cancels a pending one.
    removeDraft(id);

    const timer = setTimeout(async () => {
      pendingDeletesRef.current.delete(id);
      try {
        await deleteDraft(id);
      } catch {
        restoreDraft(draft);
        toast.error(t("drafts.deleteError"));
      }
    }, TOAST_DURATIONS.warning);
    pendingDeletesRef.current.set(id, timer);

    const title = draft.postTitle || draft.title || t("drafts.untitled");
    toast.warning(ti("drafts.deletedPending", { name: title }), undefined, {
      label: t("drafts.undo"),
      onClick: () => {
        const pending = pendingDeletesRef.current.get(id);
        if (pending) {
          clearTimeout(pending);
          pendingDeletesRef.current.delete(id);
        }
        restoreDraft(draft);
      },
    });
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
              <div ref={toolbarRef} className="flex items-center gap-1.5 py-1.5">
                <div className="relative">
                  <button
                    className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs transition-colors"
                    style={{
                      color: statusFilter.size < ALL_STATUSES.length ? "var(--accent)" : "var(--text-secondary)",
                      backgroundColor: openMenu === "filters" ? "var(--bg-elevated)" : "var(--bg-hover)",
                    }}
                    onClick={() => setOpenMenu((m) => (m === "filters" ? null : "filters"))}
                  >
                    <SlidersHorizontal size={12} />
                    {t("drafts.filters")}
                    {statusFilter.size < ALL_STATUSES.length && (
                      <span
                        className="flex items-center justify-center rounded-full"
                        style={{ width: 15, height: 15, fontSize: 9, backgroundColor: "var(--accent)", color: "#fff" }}
                      >
                        {statusFilter.size}
                      </span>
                    )}
                  </button>
                  {openMenu === "filters" && (
                    <div
                      className="absolute right-0 mt-1 rounded-lg border shadow-lg z-20"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-default)", minWidth: 170, padding: 4 }}
                    >
                      {ALL_STATUSES.map((s) => (
                        <button
                          key={s}
                          onClick={() => toggleStatus(s)}
                          className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded text-xs text-left transition-colors"
                          style={{ color: "var(--text-primary)" }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <span
                            className="flex items-center justify-center rounded"
                            style={{
                              width: 14, height: 14, flexShrink: 0,
                              border: `1.5px solid ${statusFilter.has(s) ? "var(--accent)" : "var(--border-default)"}`,
                              backgroundColor: statusFilter.has(s) ? "var(--accent)" : "transparent",
                            }}
                          >
                            {statusFilter.has(s) && <Check size={10} color="#fff" />}
                          </span>
                          {t(STATUS_LABEL_KEY[s])}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button
                    className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs transition-colors"
                    style={{
                      color: "var(--text-secondary)",
                      backgroundColor: openMenu === "sort" ? "var(--bg-elevated)" : "var(--bg-hover)",
                    }}
                    onClick={() => setOpenMenu((m) => (m === "sort" ? null : "sort"))}
                  >
                    <ArrowUpDown size={12} />
                    {t("drafts.sort")}
                  </button>
                  {openMenu === "sort" && (
                    <div
                      className="absolute right-0 mt-1 rounded-lg border shadow-lg z-20"
                      style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-default)", minWidth: 190, padding: 4 }}
                    >
                      {([
                        { key: "updated" as const, label: t("drafts.sort.updated") },
                        { key: "title" as const, label: t("drafts.sort.title") },
                        { key: "scheduled" as const, label: t("drafts.sort.scheduled") },
                      ]).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => { setSortBy(key); setOpenMenu(null); }}
                          className="flex items-center justify-between w-full px-2.5 py-1.5 rounded text-xs text-left transition-colors"
                          style={{ color: sortBy === key ? "var(--accent)" : "var(--text-primary)" }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          {label}
                          {sortBy === key && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

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
            ) : visibleDrafts.length === 0 ? (
              <div className="px-6 pt-6">
                <EmptyState
                  icon={SlidersHorizontal}
                  title={t("drafts.filters.emptyTitle")}
                  description=""
                  action={{ label: t("drafts.filters.emptyReset"), onClick: () => setStatusFilter(new Set(ALL_STATUSES)) }}
                />
              </div>
            ) : view === "table" ? (
              <DraftsTable drafts={visibleDrafts} onOpen={(id) => navigate(`/editor/${id}`)} onDelete={handleDelete} />
            ) : view === "board" ? (
              <DraftsBoard drafts={visibleDrafts} onOpen={(id) => navigate(`/editor/${id}`)} onDelete={handleDelete} />
            ) : (
              <DraftsCalendar drafts={visibleDrafts} onOpen={(id) => navigate(`/editor/${id}`)} />
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
  status: DraftStatus;
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
      </div>

      {/* Data rows */}
      {drafts.map((d) => {
        const status = d.status;
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
  onClick,
  onDelete,
}: {
  title: string;
  status: DraftStatus;
  schedDate: string;
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
    draft:     drafts.filter((d) => d.status === "draft"),
    scheduled: drafts.filter((d) => d.status === "scheduled"),
    published: drafts.filter((d) => d.status === "published"),
  };

  const columns: Array<{ key: DraftStatus }> = [
    { key: "draft" },
    { key: "scheduled" },
    { key: "published" },
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

// ── Calendar view ──────────────────────────────────────────────────────────────
// Places each visible draft on the day it's scheduled for, or (if unscheduled)
// the day it was last updated — so every draft shows up somewhere, unlike
// SchedulePage's calendar which only ever shows actually-scheduled posts.

function draftCalendarDate(d: DraftRow): Date {
  return new Date(d.scheduledAt || d.updatedAt);
}

function DraftsCalendar({
  drafts,
  onOpen,
}: {
  drafts: DraftRow[];
  onOpen: (id: string) => void;
}) {
  const language = useSettingsStore((s) => s.language) ?? "ru";
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const grid = buildCalendarGrid(viewYear, viewMonth);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  }
  function goToday() {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  }

  function draftsForDay(day: Date): DraftRow[] {
    return drafts.filter((d) => sameDay(draftCalendarDate(d), day));
  }

  return (
    <div className="px-6 pt-4 pb-6">
      {/* Month header */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          {new Date(viewYear, viewMonth, 1)
            .toLocaleDateString(language, { month: "long", year: "numeric" })
            .replace(/^./, (c) => c.toUpperCase())}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={prevMonth}
            title={t("drafts.calendar.prevMonth")}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={nextMonth}
            title={t("drafts.calendar.nextMonth")}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          onClick={goToday}
          className="px-2.5 h-7 rounded-md text-xs font-medium transition-colors border"
          style={{ color: "var(--text-secondary)", backgroundColor: "var(--bg-surface)", borderColor: "var(--border-default)" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-surface)")}
        >
          {t("drafts.calendar.today")}
        </button>
      </div>

      {/* Grid */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
        <div
          className="grid"
          style={{ gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--border-subtle)", backgroundColor: "var(--bg-elevated)" }}
        >
          {WEEKDAY_BASE_DATES.map((d, i) => (
            <div
              key={i}
              className="text-center py-2"
              style={{ fontSize: 11, fontWeight: 600, color: i >= 5 ? "#b08a8a" : "var(--text-muted)", letterSpacing: "0.03em" }}
            >
              {d.toLocaleDateString(language, { weekday: "short" }).replace(/\.$/, "")}
            </div>
          ))}
        </div>

        <div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
          {grid.map((day, idx) => {
            const isToday = day ? sameDay(day, today) : false;
            const dayDrafts = day ? draftsForDay(day) : [];
            const colIndex = idx % 7;

            return (
              <div
                key={idx}
                style={{
                  minHeight: 92,
                  borderRight: colIndex < 6 ? "1px solid var(--border-subtle)" : "none",
                  borderBottom: idx < grid.length - 7 ? "1px solid var(--border-subtle)" : "none",
                  backgroundColor: day ? "var(--bg-surface)" : "var(--bg-elevated)",
                  padding: "6px 6px 4px",
                }}
              >
                {day && (
                  <>
                    <div className="flex justify-end mb-1">
                      <span
                        className="w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium"
                        style={{
                          color: isToday ? "#fff" : colIndex >= 5 ? "#b08a8a" : "var(--text-secondary)",
                          backgroundColor: isToday ? "var(--accent)" : "transparent",
                        }}
                      >
                        {day.getDate()}
                      </span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {dayDrafts.slice(0, 3).map((d) => {
                        const status = d.status;
                        const cfg = {
                          draft:     { color: "var(--status-draft-color)",     bg: "var(--status-draft-bg)" },
                          scheduled: { color: "var(--status-sched-color)",     bg: "var(--status-sched-bg)" },
                          published: { color: "var(--status-published-color)", bg: "var(--status-published-bg)" },
                        }[status];
                        const title = d.postTitle || d.title || t("drafts.untitled");
                        return (
                          <div
                            key={d.id}
                            onClick={() => onOpen(d.id)}
                            className="rounded px-1.5 cursor-pointer truncate"
                            style={{ height: 18, lineHeight: "18px", fontSize: 10, backgroundColor: cfg.bg, color: cfg.color }}
                            title={title}
                          >
                            {title}
                          </div>
                        );
                      })}
                      {dayDrafts.length > 3 && (
                        <div style={{ fontSize: 10, color: "var(--text-muted)", paddingLeft: 2 }}>
                          +{dayDrafts.length - 3}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
