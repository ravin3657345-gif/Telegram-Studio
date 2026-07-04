import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Trash2, RefreshCw } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Spinner } from "@/components/ui/Spinner";
import { toast } from "@/store/uiStore";
import { getScheduledPosts, cancelScheduledPost, getDrafts } from "@/lib/tauriApi";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { useDraftsStore } from "@/store/draftsStore";
import type { ScheduledPostInfo } from "@/types/publish";

// ── Calendar helpers ──────────────────────────────────────────────────────────

// Jan 1–7 2024 = Mon–Sun — used to derive locale weekday names
const WEEKDAY_BASE_DATES = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, i + 1));

function startOfMonth(year: number, month: number): Date {
  return new Date(year, month, 1);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Return Monday-based weekday index (0=Mon … 6=Sun) */
function weekdayMon(date: Date): number {
  return (date.getDay() + 6) % 7;
}

// Build calendar grid (always 6 rows × 7 cols, padded with null)
function buildCalendarGrid(year: number, month: number): Array<Date | null> {
  const firstDay = startOfMonth(year, month);
  const startPad = weekdayMon(firstDay);
  const days = daysInMonth(year, month);
  const grid: Array<Date | null> = [];

  for (let i = 0; i < startPad; i++) grid.push(null);
  for (let d = 1; d <= days; d++) grid.push(new Date(year, month, d));
  while (grid.length % 7 !== 0) grid.push(null);
  return grid;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

// ── Chip colors ───────────────────────────────────────────────────────────────

function chipStyle(isPast: boolean) {
  if (isPast) return { color: "var(--status-ready-color)", bg: "var(--status-ready-bg)" };
  return { color: "var(--status-sched-color)", bg: "var(--status-sched-bg)" };
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SchedulePage() {
  const navigate                  = useNavigate();
  const [posts, setPosts]         = useState<ScheduledPostInfo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const language = useSettingsStore((s) => s.language) ?? "ru";
  const drafts    = useDraftsStore((s) => s.drafts);
  const setDrafts = useDraftsStore((s) => s.setDrafts);

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
    getScheduledPosts()
      .then(setPosts)
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

  function postsForDay(day: Date): ScheduledPostInfo[] {
    return posts.filter((p) => sameDay(new Date(p.scheduledAt), day));
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
              <div className="flex items-center gap-3" style={{ fontSize: 11 }}>
                <LegendItem color="var(--status-ready-color)" label={t("sched.legend.published")} />
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
                  const dayPosts = day ? postsForDay(day) : [];
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
                            {dayPosts.map((post) => {
                              const isPast = new Date(post.scheduledAt) < today;
                              const cs = chipStyle(isPast);
                              const time = new Date(post.scheduledAt).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
                              return (
                                <div
                                  key={post.id}
                                  className="relative rounded px-1.5 flex items-center gap-1 group cursor-pointer"
                                  style={{
                                    height: 20,
                                    backgroundColor: cs.bg,
                                    color: cs.color,
                                    fontSize: 10,
                                    overflow: "hidden",
                                  }}
                                  onMouseEnter={() => setHoveredId(post.id)}
                                  onMouseLeave={() => setHoveredId(null)}
                                  onClick={() => post.draftId ? navigate(`/editor/${post.draftId}`) : navigate("/editor")}
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
                                    {(() => {
                                      const draft = drafts.find((d) => d.id === post.draftId);
                                      return draft?.postTitle || draft?.title || t("editor.untitled");
                                    })()}
                                  </span>
                                  {hoveredId === post.id && (
                                    <button
                                      onClick={(e) => handleCancel(e, post.id)}
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
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
    </div>
  );
}
