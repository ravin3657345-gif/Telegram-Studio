import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Trash2, RefreshCw } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Spinner } from "@/components/ui/Spinner";
import { toast } from "@/store/uiStore";
import { getScheduledPosts, cancelScheduledPost, getDrafts, getHistory } from "@/lib/tauriApi";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { useDraftsStore } from "@/store/draftsStore";
import { useEditorStore } from "@/store/editorStore";
import type { ScheduledPostInfo } from "@/types/publish";
import { WEEKDAY_BASE_DATES, buildCalendarGrid, sameDay } from "@/lib/calendarGrid";

// getHistory() is typed Promise<unknown[]> at the call site — only the
// fields the calendar actually reads are declared here.
interface HistoryItemLite {
  id: string;
  postTitle: string;
  status: string;
  publishedAt: string;
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
}

function chipStyle(kind: CalendarKind) {
  if (kind === "published") return { color: "var(--status-published-color)", bg: "var(--status-published-bg)" };
  if (kind === "draft") return { color: "var(--status-draft-color)", bg: "var(--status-draft-bg)" };
  return { color: "var(--status-sched-color)", bg: "var(--status-sched-bg)" };
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SchedulePage() {
  const navigate                  = useNavigate();
  const [posts, setPosts]         = useState<ScheduledPostInfo[]>([]);
  const [history, setHistory]     = useState<HistoryItemLite[]>([]);
  const [loading, setLoading]     = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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

      <div className="page-content" style={{ padding: "24px" }}>
        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner size={24} color="var(--text-muted)" />
          </div>
        ) : (
          <div style={{ maxWidth: 900 }}>
            {/* ── Calendar header ─────────────────────────────────────── */}
            <div className="flex items-center justify-between mb-4">
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
                className="flex items-center gap-4 rounded-lg border"
                style={{
                  fontSize: 12.5,
                  padding: "6px 12px",
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
                    className="text-center py-2"
                    style={{
                      fontSize: 11,
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
                        minHeight: 96,
                        borderRight: colIndex < 6 ? "1px solid var(--border-subtle)" : "none",
                        borderBottom: idx < grid.length - 7 ? "1px solid var(--border-subtle)" : "none",
                        backgroundColor: day ? "var(--bg-surface)" : "var(--bg-elevated)",
                        padding: "6px 6px 4px",
                      }}
                    >
                      {day && (
                        <>
                          {/* Day number */}
                          <div className="flex justify-end mb-1">
                            <span
                              className="w-6 h-6 flex items-center justify-center rounded-full text-xs font-medium"
                              style={{
                                color: isToday ? "#fff" : isWeekend ? "#b08a8a" : "var(--text-secondary)",
                                backgroundColor: isToday ? "var(--accent)" : "transparent",
                              }}
                            >
                              {day.getDate()}
                            </span>
                          </div>

                          {/* Post chips */}
                          <div className="flex flex-col gap-0.5">
                            {dayEntries.map((entry) => {
                              const cs = chipStyle(entry.kind);
                              const time = entry.time.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
                              return (
                                <div
                                  key={entry.key}
                                  className="relative rounded px-1.5 flex items-center gap-1 group cursor-pointer"
                                  style={{
                                    height: 20,
                                    backgroundColor: cs.bg,
                                    color: cs.color,
                                    fontSize: 10,
                                    overflow: "hidden",
                                  }}
                                  onMouseEnter={() => setHoveredId(entry.key)}
                                  onMouseLeave={() => setHoveredId(null)}
                                  onClick={() => {
                                    if (entry.kind === "published") {
                                      // Same pattern HistoryPage's "open in editor" uses —
                                      // PostEditor fetches the full post via _histId, no
                                      // separate draft record needed for a published post.
                                      resetEditor();
                                      navigate("/editor", { state: { _histId: entry.historyId } });
                                      return;
                                    }
                                    if (entry.draftId) navigate(`/editor/${entry.draftId}`);
                                    else navigate("/editor");
                                  }}
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
                                  {entry.kind === "scheduled" && hoveredId === entry.key && (
                                    <button
                                      onClick={(e) => handleCancel(e, entry.scheduledPostId!)}
                                      className="ml-auto flex-shrink-0"
                                      style={{ color: cs.color }}
                                    >
                                      <Trash2 size={10} />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
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
    </>
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
