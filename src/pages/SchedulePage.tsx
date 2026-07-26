import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Trash2, RefreshCw, X } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Spinner } from "@/components/ui/Spinner";
import { Dialog, DialogTitle, DialogDescription, VisuallyHidden } from "@/components/ui/Dialog";
import { toast } from "@/store/uiStore";
import { getScheduledPosts, cancelScheduledPost, getDrafts, getHistory } from "@/lib/tauriApi";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { useDraftsStore } from "@/store/draftsStore";
import { useEditorStore } from "@/store/editorStore";
import type { ScheduledPostInfo } from "@/types/publish";
import { WEEKDAY_BASE_DATES, buildCalendarGrid, sameDay } from "@/lib/calendarGrid";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";

// Cells stay a fixed height regardless of how many posts land on one day —
// past this many, the rest fold into a "+N ещё" chip that opens the full
// list in a dialog, instead of the cell growing to fit every single entry
// (a busy day could otherwise push the whole grid row hundreds of px tall).
const MAX_VISIBLE_ENTRIES = 4;

// getHistory() is typed Promise<unknown[]> at the call site — only the
// fields the calendar actually reads are declared here.
interface HistoryItemLite {
  id: string;
  postTitle: string;
  status: string;
  publishedAt: string;
  publishMode: string;
}

// ── Calendar entries ─────────────────────────────────────────────────────────
// Three independent sources feed the calendar, matching the legend:
// scheduled_posts (still pending — get_scheduled_posts already filters to
// status='pending' server-side), publication_history (status='published',
// plotted on the day it actually went out), and drafts that are still plain
// drafts (not scheduled/published), plotted on the day they were last
// touched. Previously only scheduled posts were fetched at all, and a
// "scheduledAt already passed" heuristic stood in for "published" — neither
// drafts nor real publish history ever appeared on the grid.
type CalendarKind = "published" | "scheduled" | "draft";

interface CalendarEntry {
  key: string;
  kind: CalendarKind;
  time: Date;
  title: string;
  scheduledPostId?: string;
  draftId?: string;
  historyId?: string;
  publishMode?: string;
}

function chipStyle(kind: CalendarKind) {
  if (kind === "published") return { color: "var(--status-published-color)", bg: "var(--status-published-bg)" };
  if (kind === "draft") return { color: "var(--status-draft-color)", bg: "var(--status-draft-bg)" };
  return { color: "var(--status-sched-color)", bg: "var(--status-sched-bg)" };
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SchedulePage() {
  const navigate                  = useNavigate();
  const isMobile                  = useIsMobileLayout();
  const [posts, setPosts]         = useState<ScheduledPostInfo[]>([]);
  const [history, setHistory]     = useState<HistoryItemLite[]>([]);
  const [loading, setLoading]     = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<Date | null>(null);
  const language = useSettingsStore((s) => s.language) ?? "ru";
  const drafts    = useDraftsStore((s) => s.drafts);
  const setDrafts = useDraftsStore((s) => s.setDrafts);
  const resetEditor = useEditorStore((s) => s.resetEditor);

  const today      = new Date();
  const [viewYear, setViewYear]   = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  // Load drafts if not yet populated (e.g. direct navigation to /schedule)
  useEffect(() => {
    if (drafts.length === 0) {
      getDrafts().then(setDrafts).catch(() => {});
    }
  }, []);

  const load = () => {
    setLoading(true);
    Promise.all([
      getScheduledPosts(),
      getHistory() as Promise<HistoryItemLite[]>,
    ])
      .then(([sched, hist]) => { setPosts(sched); setHistory(hist); })
      .catch(() => toast.error(t("sched.loadError")))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  async function handleCancel(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    try {
      await cancelScheduledPost(id);
      setPosts((prev) => prev.filter((p) => p.id !== id));
      toast.success(t("sched.cancelled"));
    } catch {
      toast.error(t("sched.cancelError"));
    }
  }

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

  function handleEntryClick(entry: CalendarEntry) {
    setExpandedDay(null);
    if (entry.kind === "published") {
      // Editing an already-published Rich post is blocked entirely (see
      // HistoryPage.tsx's disabled Edit button — this is the same entry
      // point, just reached from the calendar instead of the History list).
      if (entry.publishMode === "rich") {
        toast.error(t("history.editUnavailableRich"));
        return;
      }
      // Same pattern HistoryPage's "open in editor" uses — PostEditor
      // fetches the full post via _histId, no separate draft record needed
      // for a published post.
      resetEditor();
      navigate("/editor", { state: { _histId: entry.historyId } });
      return;
    }
    if (entry.draftId) navigate(`/editor/${entry.draftId}`);
    else navigate("/editor");
  }

  function entriesForDay(day: Date): CalendarEntry[] {
    const entries: CalendarEntry[] = [];

    for (const p of posts) {
      const time = new Date(p.scheduledAt);
      if (!sameDay(time, day)) continue;
      const draft = drafts.find((d) => d.id === p.draftId);
      entries.push({
        key: `sched-${p.id}`,
        kind: "scheduled",
        time,
        title: draft?.postTitle || draft?.title || t("editor.untitled"),
        scheduledPostId: p.id,
        draftId: p.draftId ?? undefined,
      });
    }

    for (const h of history) {
      if (h.status !== "published") continue;
      const time = new Date(h.publishedAt);
      if (!sameDay(time, day)) continue;
      entries.push({
        key: `hist-${h.id}`,
        kind: "published",
        time,
        title: h.postTitle || t("editor.untitled"),
        historyId: h.id,
        publishMode: h.publishMode,
      });
    }

    for (const d of drafts) {
      if (d.status !== "draft") continue;
      const time = new Date(d.updatedAt);
      if (!sameDay(time, day)) continue;
      entries.push({
        key: `draft-${d.id}`,
        kind: "draft",
        time,
        title: d.postTitle || d.title || t("editor.untitled"),
        draftId: d.id,
      });
    }

    return entries.sort((a, b) => a.time.getTime() - b.time.getTime());
  }

  return (
    <>
      <TopBar
        actions={
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-2 h-7 rounded text-xs"
            style={{ color: "var(--text-muted)", backgroundColor: "var(--bg-elevated)" }}
            title={t("sched.refresh")}
          >
            <RefreshCw size={12} />
          </button>
        }
      />

      <div className="page-content" style={{ padding: isMobile ? "12px" : "24px" }}>
        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner size={24} color="var(--text-muted)" />
          </div>
        ) : (
          <div style={{ maxWidth: isMobile ? "100%" : 900 }}>
            {/* ── Calendar header ─────────────────────────────────────── */}
            {/* Mobile: month-nav row and legend stack instead of sharing one
                row — squeezed together they used to force the whole row
                (including the month title) wider than the screen, which
                pushed the calendar grid into horizontal scroll and wrapped
                "Июль 2026" into three lines fighting the nav/legend for
                space. */}
            <div className={isMobile ? "flex flex-col gap-2 mb-3" : "flex items-center justify-between mb-4"}>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                  {new Date(viewYear, viewMonth, 1).toLocaleDateString(language, { month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase())}
                </h1>
                <div className="flex items-center gap-1">
                  <button
                    onClick={prevMonth}
                    className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
                    style={{ color: "var(--text-secondary)" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-hover)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={nextMonth}
                    className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
                    style={{ color: "var(--text-secondary)" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-hover)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <button
                  onClick={goToday}
                  className="px-2.5 h-7 rounded-md text-xs font-medium transition-colors border"
                  style={{
                    color: "var(--text-secondary)",
                    backgroundColor: "var(--bg-surface)",
                    borderColor: "var(--border-default)",
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-hover)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-surface)")}
                >
                  {t("sched.today")}
                </button>
              </div>

              {/* Legend */}
              <div
                className="flex items-center rounded-lg border"
                style={{
                  fontSize: isMobile ? 11 : 12.5,
                  padding: isMobile ? "5px 8px" : "6px 12px",
                  gap: isMobile ? 10 : 16,
                  flexWrap: isMobile ? "wrap" : "nowrap",
                  alignSelf: isMobile ? "flex-start" : undefined,
                  backgroundColor: "var(--bg-elevated)",
                  borderColor: "var(--border-default)",
                }}
              >
                <LegendItem color="var(--status-published-color)" label={t("sched.legend.published")} />
                <LegendItem color="var(--status-sched-color)" label={t("sched.legend.scheduled")} />
                <LegendItem color="var(--status-draft-color)" label={t("sched.legend.draft")} />
              </div>
            </div>

            {/* ── Calendar grid ───────────────────────────────────────── */}
            <div
              className="rounded-xl border overflow-hidden"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              {/* Weekday header */}
              <div
                className="grid"
                style={{
                  gridTemplateColumns: "repeat(7, 1fr)",
                  borderBottom: "1px solid var(--border-subtle)",
                  backgroundColor: "var(--bg-elevated)",
                }}
              >
                {WEEKDAY_BASE_DATES.map((d, i) => {
                  const day = d.toLocaleDateString(language, { weekday: "short" }).replace(/\.$/, "");
                  return (
                  <div
                    key={i}
                    className={isMobile ? "text-center py-1" : "text-center py-2"}
                    style={{
                      fontSize: isMobile ? 9.5 : 11,
                      fontWeight: 600,
                      color: i >= 5 ? "#b08a8a" : "var(--text-muted)",
                      letterSpacing: "0.03em",
                    }}
                  >
                    {day}
                  </div>
                  );
                })}
              </div>

              {/* Day cells */}
              <div
                className="grid"
                style={{ gridTemplateColumns: "repeat(7, 1fr)" }}
              >
                {grid.map((day, idx) => {
                  const isToday = day ? sameDay(day, today) : false;
                  const dayEntries = day ? entriesForDay(day) : [];
                  const colIndex = idx % 7;
                  const isWeekend = colIndex >= 5;

                  return (
                    <div
                      key={idx}
                      style={{
                        minHeight: isMobile ? 60 : 96,
                        borderRight: colIndex < 6 ? "1px solid var(--border-subtle)" : "none",
                        borderBottom: idx < grid.length - 7 ? "1px solid var(--border-subtle)" : "none",
                        backgroundColor: day ? "var(--bg-surface)" : "var(--bg-elevated)",
                        padding: isMobile ? "3px 3px 2px" : "6px 6px 4px",
                      }}
                    >
                      {day && (
                        <>
                          {/* Day number */}
                          <div className="flex justify-end mb-1">
                            <span
                              className={isMobile ? "w-5 h-5 flex items-center justify-center rounded-full font-medium" : "w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium"}
                              style={{
                                fontSize: isMobile ? 10.5 : undefined,
                                color: isToday ? "#fff" : isWeekend ? "#b08a8a" : "var(--text-secondary)",
                                backgroundColor: isToday ? "var(--accent)" : "transparent",
                              }}
                            >
                              {day.getDate()}
                            </span>
                          </div>

                          {/* Post chips — capped so one busy day can't blow
                              up the whole grid row; the rest fold into a
                              "+N ещё" chip that opens the full list. */}
                          <div className="flex flex-col gap-0.5">
                            {dayEntries.slice(0, MAX_VISIBLE_ENTRIES).map((entry) => (
                              <EntryChip
                                key={entry.key}
                                entry={entry}
                                hovered={hoveredId === entry.key}
                                onHover={setHoveredId}
                                onClick={() => handleEntryClick(entry)}
                                onCancel={(e) => handleCancel(e, entry.scheduledPostId!)}
                              />
                            ))}
                            {dayEntries.length > MAX_VISIBLE_ENTRIES && (
                              <button
                                onClick={() => setExpandedDay(day)}
                                className="text-left rounded px-1.5 flex-shrink-0"
                                style={{
                                  height: 20,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: "var(--text-muted)",
                                  backgroundColor: "var(--bg-hover)",
                                  border: "none",
                                  cursor: "pointer",
                                }}
                              >
                                {ti("sched.dayMore", { count: dayEntries.length - MAX_VISIBLE_ENTRIES })}
                              </button>
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
        )}
      </div>

      {/* Full day list — opened from a "+N ещё" chip when a day has more
          entries than fit in the cell. */}
      {expandedDay && (
        <Dialog
          onOpenChange={(open) => !open && setExpandedDay(null)}
          style={{
            width: 340,
            maxHeight: "70vh",
            display: "flex",
            flexDirection: "column",
            borderRadius: 16,
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 16px 10px", flexShrink: 0,
              borderBottom: "1px solid var(--border-subtle)",
            }}
          >
            <DialogTitle asChild>
              <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>
                {expandedDay.toLocaleDateString(language, { day: "numeric", month: "long", year: "numeric" }).replace(/^./, c => c.toUpperCase())}
              </span>
            </DialogTitle>
            <VisuallyHidden>
              <DialogDescription>
                {expandedDay.toLocaleDateString(language, { day: "numeric", month: "long", year: "numeric" })}
              </DialogDescription>
            </VisuallyHidden>
            <button
              onClick={() => setExpandedDay(null)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "var(--text-muted)", lineHeight: 0 }}
            >
              <X size={16} />
            </button>
          </div>
          <div style={{ padding: "10px 12px 14px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
            {entriesForDay(expandedDay).map((entry) => (
              <EntryChip
                key={entry.key}
                entry={entry}
                hovered={hoveredId === entry.key}
                onHover={setHoveredId}
                onClick={() => handleEntryClick(entry)}
                onCancel={(e) => handleCancel(e, entry.scheduledPostId!)}
                compact={false}
              />
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}

// Shared by the day-cell grid (compact, height-capped) and the "+N ещё"
// dialog's full list (roomier) — same look either way, just a size variant.
function EntryChip({
  entry, hovered, onHover, onClick, onCancel, compact = true,
}: {
  entry: CalendarEntry;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onClick: () => void;
  onCancel: (e: React.MouseEvent) => void;
  compact?: boolean;
}) {
  const cs = chipStyle(entry.kind);
  const time = entry.time.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
  return (
    <div
      className="relative rounded px-1.5 flex items-center gap-1 group cursor-pointer"
      style={{
        height: compact ? 20 : 30,
        flexShrink: 0,
        backgroundColor: cs.bg,
        color: cs.color,
        fontSize: compact ? 10 : 12.5,
        overflow: "hidden",
      }}
      onMouseEnter={() => onHover(entry.key)}
      onMouseLeave={() => onHover(null)}
      onClick={onClick}
    >
      <span style={{ flexShrink: 0, fontWeight: 600 }}>{time}</span>
      <span
        style={{
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          flex: 1,
        }}
      >
        {entry.title}
      </span>
      {entry.kind === "scheduled" && hovered && (
        <button
          onClick={onCancel}
          className="ml-auto flex-shrink-0"
          style={{ color: cs.color }}
        >
          <Trash2 size={compact ? 10 : 12} />
        </button>
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{label}</span>
    </div>
  );
}
