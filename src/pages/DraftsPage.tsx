import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Trash2, SlidersHorizontal, ArrowUpDown, FileText, Check, Search, X, XCircle,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { Fab } from "@/components/ui/Fab";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { useDraftsStore } from "@/store/draftsStore";
import { getDrafts, deleteDraft, getScheduledPosts, cancelScheduledPost } from "@/lib/tauriApi";
import { toast, TOAST_DURATIONS } from "@/store/uiStore";
import { t, ti, type TranslationKey } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { Files } from "lucide-react";
import {
  type DraftStatus, type DraftSortKey, filterAndSortDrafts, searchDrafts,
} from "@/lib/draftsFilter";
import { DRAFT_MAX_COUNT } from "@/lib/constants";
import { NewPostChooserDialog } from "@/components/drafts/NewPostChooserDialog";
import { useListKeyboardNav } from "@/hooks/useListKeyboardNav";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";

const DRAFT_LIMIT = DRAFT_MAX_COUNT;

const ALL_STATUSES: DraftStatus[] = ["draft", "scheduled", "published"];

const STATUS_LABEL_KEY: Record<DraftStatus, TranslationKey> = {
  draft:     "drafts.status.draft",
  scheduled: "drafts.status.sched",
  published: "drafts.status.published",
};

// ── Countdown ──────────────────────────────────────────────────────────────────

function formatCountdown(scheduledAt: string): string {
  const diffMs = new Date(scheduledAt).getTime() - Date.now();
  if (diffMs <= 0) return t("drafts.countdownDue");
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return ti("drafts.countdownMinutes", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return ti("drafts.countdownHours", { n: hours });
  const days = Math.round(hours / 24);
  return ti("drafts.countdownDays", { n: days });
}

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
  const isMobile = useIsMobileLayout();

  // Pending optimistic deletes, keyed by draft id — cleared by Undo.
  const pendingDeletesRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const count = drafts.length;
  const nearLimit = count >= DRAFT_LIMIT - 2;

  const [statusFilter, setStatusFilter] = useState<Set<DraftStatus>>(new Set(ALL_STATUSES));
  const [sortBy, setSortBy] = useState<DraftSortKey>("updated");
  const [search, setSearch] = useState("");
  const [openMenu, setOpenMenu] = useState<"filters" | "sort" | null>(null);
  const [showChooser, setShowChooser] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!toolbarRef.current?.contains(e.target as Node)) setOpenMenu(null);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const visibleDrafts = useMemo(
    () => searchDrafts(filterAndSortDrafts(drafts, statusFilter, sortBy), search),
    [drafts, statusFilter, sortBy, search],
  );

  const listNav = useListKeyboardNav(
    visibleDrafts,
    (d) => d.id,
    {
      onOpen: (d) => navigate(`/editor/${d.id}`),
      onDelete: (d) => deleteDraftById(d.id),
    },
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

  // Re-renders the countdown column periodically without a full data refetch.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  async function handleCancelSchedule(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    try {
      const posts = await getScheduledPosts();
      const mine = posts.filter((p) => p.draftId === id);
      await Promise.all(mine.map((p) => cancelScheduledPost(p.id)));
      const fresh = await getDrafts();
      setDrafts(fresh);
      toast.success(t("sched.cancelled"));
    } catch {
      toast.error(t("sched.cancelError"));
    }
  }

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    deleteDraftById(id);
  }

  // Split out from handleDelete so the keyboard Delete-key path (no mouse
  // event to stopPropagation on) can call the same optimistic-remove +
  // undo-window logic without needing a fake event.
  function deleteDraftById(id: string) {
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

      {/* Extra bottom padding on mobile clears the fixed FAB (bottom: 74,
          52px tall) — otherwise the last card's delete button renders right
          under it instead of the list scrolling clear above. */}
      <div className="page-content" style={{ padding: isMobile ? "0 0 140px" : "0 0 24px" }}>
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

            {/* ── Toolbar ────────────────────────────────────────────────── */}
            {/* Mobile: search gets its own full-width row, filters/sort sit
                on a second row below — squeezed side-by-side they used to
                crush the 220px search box (and its text) on a phone. */}
            <div
              className={isMobile ? "flex flex-col gap-1.5 px-4 pt-1 pb-2 border-b" : "flex items-center justify-between px-6 border-b"}
              style={{ borderColor: "var(--border-subtle)" }}
            >
              {/* Search */}
              <div className="relative flex items-center py-1.5" style={{ width: isMobile ? "100%" : 220 }}>
                <Search size={isMobile ? 15 : 13} style={{ position: "absolute", left: 10, color: "var(--text-muted)", pointerEvents: "none" }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("drafts.search")}
                  className="w-full text-xs"
                  style={{
                    height: isMobile ? 38 : 28,
                    paddingLeft: isMobile ? 32 : 28,
                    paddingRight: search ? (isMobile ? 30 : 24) : 8,
                    borderRadius: 8,
                    border: "1px solid transparent",
                    backgroundColor: "var(--bg-hover)",
                    color: "var(--text-primary)",
                  }}
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="flex items-center justify-center rounded"
                    style={{ position: "absolute", right: 6, width: isMobile ? 22 : 16, height: isMobile ? 22 : 16, color: "var(--text-muted)" }}
                    title={t("drafts.searchClear")}
                  >
                    <X size={isMobile ? 13 : 12} />
                  </button>
                )}
              </div>

              {/* Toolbar */}
              <div ref={toolbarRef} className="flex items-center gap-1.5 py-1">
                <div className="relative">
                  <button
                    className="flex items-center gap-1.5 px-3 rounded-md text-xs transition-colors"
                    style={{
                      height: isMobile ? 38 : 28,
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
                          className="flex items-center gap-2 w-full px-2.5 rounded text-xs text-left transition-colors"
                          style={{ color: "var(--text-primary)", paddingTop: isMobile ? 9 : 6, paddingBottom: isMobile ? 9 : 6 }}
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
                    className="flex items-center gap-1.5 px-3 rounded-md text-xs transition-colors"
                    style={{
                      height: isMobile ? 38 : 28,
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
                          className="flex items-center justify-between w-full px-2.5 rounded text-xs text-left transition-colors"
                          style={{ color: sortBy === key ? "var(--accent)" : "var(--text-primary)", paddingTop: isMobile ? 9 : 6, paddingBottom: isMobile ? 9 : 6 }}
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

                {/* Mobile gets a thumb-reachable FAB instead (below) —
                    a header button needs a reach to the top of the screen,
                    the exact ergonomics problem the FAB fixes. */}
                {!isMobile && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowChooser(true)}
                    leftIcon={<Plus size={13} />}
                  >
                    {t("drafts.new")}
                  </Button>
                )}
              </div>
            </div>

            {/* ── Content ─────────────────────────────────────────────────── */}
            {drafts.length === 0 ? (
              <div className="px-6 pt-6">
                <EmptyState
                  icon={Files}
                  title={t("drafts.empty")}
                  description={t("drafts.emptyDesc")}
                  action={{ label: `+ ${t("drafts.new")}`, onClick: () => setShowChooser(true) }}
                />
              </div>
            ) : visibleDrafts.length === 0 ? (
              <div className="px-6 pt-6">
                <EmptyState
                  icon={SlidersHorizontal}
                  title={t("drafts.filters.emptyTitle")}
                  description=""
                  action={{
                    label: t("drafts.filters.emptyReset"),
                    onClick: () => { setStatusFilter(new Set(ALL_STATUSES)); setSearch(""); },
                  }}
                />
              </div>
            ) : isMobile ? (
              <MobileDraftsList
                drafts={visibleDrafts}
                onOpen={(id) => navigate(`/editor/${id}`)}
                onDelete={handleDelete}
                onCancelSchedule={handleCancelSchedule}
                onNew={() => setShowChooser(true)}
              />
            ) : (
              <DraftsTable
                drafts={visibleDrafts}
                onOpen={(id) => navigate(`/editor/${id}`)}
                onDelete={handleDelete}
                onCancelSchedule={handleCancelSchedule}
                onNew={() => setShowChooser(true)}
                selectedId={listNav.selectedId}
                containerRef={listNav.containerRef}
                containerProps={listNav.containerProps}
              />
            )}
          </div>
        )}
      </div>

      {isMobile && <Fab icon={Plus} label={t("drafts.new")} onClick={() => setShowChooser(true)} />}

      {showChooser && <NewPostChooserDialog onClose={() => setShowChooser(false)} />}
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
  onCancelSchedule,
  onNew,
  selectedId,
  containerRef,
  containerProps,
}: {
  drafts: DraftRow[];
  onOpen: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onCancelSchedule: (e: React.MouseEvent, id: string) => void;
  onNew: () => void;
  selectedId: string | null;
  containerRef: React.RefObject<HTMLDivElement>;
  containerProps: { tabIndex: number; onKeyDown: (e: React.KeyboardEvent) => void };
}) {
  useSettingsStore((s) => s.language);

  return (
    <div ref={containerRef} {...containerProps} style={{ width: "100%", outline: "none" }}>
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
        const countdown = status === "scheduled" && d.scheduledAt ? formatCountdown(d.scheduledAt) : null;
        return (
          <DraftTableRow
            key={d.id}
            navId={d.id}
            selected={selectedId === d.id}
            title={title}
            status={status}
            schedDate={schedDate}
            countdown={countdown}
            onClick={() => onOpen(d.id)}
            onDelete={(e) => onDelete(e, d.id)}
            onCancelSchedule={(e) => onCancelSchedule(e, d.id)}
          />
        );
      })}

      {/* New row */}
      <button
        onClick={onNew}
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
  navId,
  selected,
  title,
  status,
  schedDate,
  countdown,
  onClick,
  onDelete,
  onCancelSchedule,
}: {
  navId: string;
  selected: boolean;
  title: string;
  status: DraftStatus;
  schedDate: string;
  countdown: string | null;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onCancelSchedule: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      data-nav-id={navId}
      className="flex items-center px-6 border-b relative cursor-pointer"
      style={{
        height: 42,
        borderColor: "var(--border-subtle)",
        backgroundColor: selected ? "var(--bg-active)" : hovered ? "var(--bg-hover)" : "transparent",
        outline: selected ? "1.5px solid var(--accent)" : "none",
        outlineOffset: -1.5,
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
      <div
        className="flex items-center gap-1.5"
        style={{ width: 160, flexShrink: 0, fontSize: 12, color: "var(--text-secondary)" }}
        title={status === "scheduled" ? schedDate : undefined}
      >
        {countdown ? (
          <>
            <span className="truncate">{countdown}</span>
            <button
              onClick={onCancelSchedule}
              className="flex items-center justify-center flex-shrink-0 rounded transition-colors"
              style={{ width: 18, height: 18, color: "var(--text-muted)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
              title={t("sched.cancel")}
            >
              <XCircle size={13} />
            </button>
          </>
        ) : (
          schedDate
        )}
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

// ── Mobile card view ──────────────────────────────────────────────────────────
// Replaces DraftsTable's fixed-width Status(120px)/Scheduled(160px) columns —
// confirmed during planning to squeeze the title column down to ~50-70px on
// a phone. Cards stack the title full-width on its own line, status+date on
// a second line below instead of beside it. No selectedId/containerRef/
// containerProps here — useListKeyboardNav's arrow-key list navigation has
// no touch equivalent, unlike the delete/cancel-schedule actions (which stay
// always-visible instead of hover-revealed, same reasoning as
// BlockHoverControls.tsx's mobile branch elsewhere in this pass).

function MobileDraftsList({
  drafts,
  onOpen,
  onDelete,
  onCancelSchedule,
  onNew,
}: {
  drafts: DraftRow[];
  onOpen: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onCancelSchedule: (e: React.MouseEvent, id: string) => void;
  onNew: () => void;
}) {
  useSettingsStore((s) => s.language);

  return (
    <div style={{ padding: "0 16px" }}>
      {drafts.map((d) => {
        const status = d.status;
        const title = d.postTitle || d.title || t("drafts.untitled");
        const schedDate = d.scheduledAt
          ? new Date(d.scheduledAt).toLocaleString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
          : "—";
        const countdown = status === "scheduled" && d.scheduledAt ? formatCountdown(d.scheduledAt) : null;
        return (
          <MobileDraftCard
            key={d.id}
            title={title}
            status={status}
            schedDate={schedDate}
            countdown={countdown}
            onClick={() => onOpen(d.id)}
            onDelete={(e) => onDelete(e, d.id)}
            onCancelSchedule={(e) => onCancelSchedule(e, d.id)}
          />
        );
      })}

      <button
        onClick={onNew}
        className="flex items-center justify-center w-full"
        style={{
          height: 44,
          marginTop: 4,
          marginBottom: 12,
          borderRadius: 10,
          border: "1px dashed var(--border-default)",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        <Plus size={14} style={{ marginRight: 6 }} />
        {t("drafts.newRow")}
      </button>
    </div>
  );
}

function MobileDraftCard({
  title,
  status,
  schedDate,
  countdown,
  onClick,
  onDelete,
  onCancelSchedule,
}: {
  title: string;
  status: DraftStatus;
  schedDate: string;
  countdown: string | null;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onCancelSchedule: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onClick}
      className="virtualized-item"
      style={{
        borderRadius: 12,
        border: "1px solid var(--border-subtle)",
        backgroundColor: "var(--bg-surface)",
        padding: "12px 14px",
        marginTop: 10,
        cursor: "pointer",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <span className="truncate text-sm" style={{ color: "var(--text-primary)", fontWeight: 500 }}>{title}</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(e); }}
          className="flex items-center justify-center flex-shrink-0 rounded"
          style={{ width: 32, height: 32, backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}
          title={t("drafts.delete")}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 8 }}>
        <StatusPill status={status} />
        {countdown ? (
          <>
            <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{countdown}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onCancelSchedule(e); }}
              className="flex items-center justify-center flex-shrink-0 rounded"
              style={{ width: 24, height: 24, color: "var(--text-muted)" }}
              title={t("sched.cancel")}
            >
              <XCircle size={13} />
            </button>
          </>
        ) : (
          <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{schedDate}</span>
        )}
      </div>
    </div>
  );
}
