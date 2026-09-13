import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PenLine,
  CalendarClock,
  Files,
  CheckCircle2,
  XCircle,
  Send,
  ChevronRight,
  AlertTriangle,
  Trash2,
  Loader2,
  LayoutTemplate,
  BarChart2,
  type LucideIcon,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { TopBar } from "@/components/layout/TopBar";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { NewPostChooserDialog } from "@/components/drafts/NewPostChooserDialog";
import { getTodayStats, getScheduledPosts, getDrafts, cancelScheduledPost, getPublicationAnalytics } from "@/lib/tauriApi";
import type { PublicationAnalytics } from "@/types/analytics";
import { useUiStore, toast } from "@/store/uiStore";
import { t, ti, type TranslationKey } from "@/lib/i18n";
import { formatTimeUntil } from "@/lib/formatCountdown";
import { useSettingsStore } from "@/store/settingsStore";
import { useChannelsStore } from "@/store/channelsStore";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";
import { WEEKDAY_BASE_DATES, buildCalendarGrid, sameDay } from "@/lib/calendarGrid";
import type { TodayStats, ScheduledPostInfo } from "@/types/publish";
import type { DraftSummary } from "@/types/draft";

// Minimal shape of a history row — enough for the sent count, the 7-day
// chart and the "last post" channel hint. The Rust command returns more.
interface DashboardHistoryRow {
  status: string;
  publishedAt: string;
  channelId: string;
  channelTitle: string;
}

// ─── Shared card chrome ──────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--bg-surface)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 12,
  padding: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--text-secondary)",
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  marginBottom: 10,
};

function fmtDateTime(iso: string, language?: string) {
  return new Date(iso).toLocaleString(language ?? "ru", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  value,
  label,
  color,
  onClick,
}: {
  icon: LucideIcon;
  value: string | number;
  label: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="transition-colors"
      style={{
        ...cardStyle,
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: onClick ? "pointer" : "default",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        if (onClick) e.currentTarget.style.borderColor = "var(--border-default)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--border-subtle)";
      }}
    >
      <Icon size={20} style={{ color, flexShrink: 0 }} />
      <div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "var(--text-primary)",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
          {label}
        </div>
      </div>
    </button>
  );
}

// ─── Hero block ──────────────────────────────────────────────────────────────

function greetingKey(hour: number): TranslationKey {
  if (hour >= 5 && hour < 12) return "dashboard.hero.greetingMorning";
  if (hour >= 12 && hour < 18) return "dashboard.hero.greetingDay";
  if (hour >= 18 && hour < 23) return "dashboard.hero.greetingEvening";
  return "dashboard.hero.greetingNight";
}

function HeroBlock() {
  const isMobile = useIsMobileLayout();
  const language = useSettingsStore((s) => s.language);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const dateStr = now.toLocaleDateString(language ?? "ru", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const capitalizedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 14,
        border: "1px solid var(--border-subtle)",
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--bg-surface)) 0%, var(--bg-surface) 55%)",
        padding: isMobile ? 16 : 20,
      }}
    >
      {/* Decorative blur circle */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -50,
          right: -50,
          width: 180,
          height: 180,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--accent) 16%, transparent) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative", display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "0 10px" }}>
        <span
          style={{
            fontSize: isMobile ? 19 : 22,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "var(--text-primary)",
          }}
        >
          {t(greetingKey(now.getHours()))}
        </span>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{capitalizedDate}</span>
      </div>
    </div>
  );
}

// ─── Error alert banner ──────────────────────────────────────────────────────

function ErrorBanner({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 rounded-xl px-4 py-3 text-left transition-opacity hover:opacity-90"
      style={{
        backgroundColor: "var(--danger-subtle)",
        border: "1px solid color-mix(in srgb, var(--danger) 28%, transparent)",
        cursor: "pointer",
      }}
    >
      <AlertTriangle size={15} style={{ color: "var(--danger)", flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--danger)" }}>
        {ti("dashboard.alertFailed", { n: count })}
      </span>
      <span className="ml-auto flex items-center gap-1 flex-shrink-0" style={{ fontSize: 12, color: "var(--danger)", fontWeight: 500 }}>
        {t("dashboard.alertOpen")}
        <ChevronRight size={13} />
      </span>
    </button>
  );
}

// ─── Big "next post" card ────────────────────────────────────────────────────

function NextPostCard({
  upcoming,
  onCancel,
}: {
  upcoming: ScheduledPostInfo[] | null;
  onCancel: (id: string) => Promise<void>;
}) {
  const isMobile = useIsMobileLayout();
  const language = useSettingsStore((s) => s.language);
  const navigate = useNavigate();
  const [now, setNow] = useState(() => new Date());
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const next =
    upcoming === null
      ? null
      : [...upcoming]
          .filter((p) => new Date(p.scheduledAt).getTime() > now.getTime())
          .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0] ?? null;

  async function handleCancel() {
    if (!next || cancelling) return;
    setCancelling(true);
    try {
      await onCancel(next.id);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div style={cardStyle}>
      <p style={sectionTitleStyle}>{t("sidebar.widget.nextPost")}</p>
      {upcoming === null ? (
        <div className="flex justify-center py-8">
          <Spinner size={20} color="var(--text-muted)" />
        </div>
      ) : next ? (
        <div className="flex flex-col gap-4">
          <div>
            <div
              style={{
                fontSize: isMobile ? 26 : 32,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: "var(--accent)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatTimeUntil(new Date(next.scheduledAt), now)}
            </div>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginTop: 5 }}>
              {next.channelTitle || next.channelId}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {fmtDateTime(next.scheduledAt, language)}
            </div>
          </div>
          <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
            <Button
              variant="primary"
              size={isMobile ? "md" : "sm"}
              onClick={() => (next.draftId ? navigate(`/editor/${next.draftId}`) : navigate("/schedule"))}
            >
              {t("dashboard.openPost")}
            </Button>
            <Button
              variant="secondary"
              size={isMobile ? "md" : "sm"}
              disabled={cancelling}
              leftIcon={cancelling ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              onClick={handleCancel}
            >
              {t("dashboard.cancelPost")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.upcomingEmpty")}</p>
          <Button variant="secondary" size="sm" onClick={() => navigate("/schedule")}>
            {t("dashboard.openSchedule")}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── "Today in plan" card ────────────────────────────────────────────────────

function TodayPlanCard({ upcoming }: { upcoming: ScheduledPostInfo[] | null }) {
  const language = useSettingsStore((s) => s.language);
  const navigate = useNavigate();

  const todayPosts = (upcoming ?? [])
    .filter((p) => sameDay(new Date(p.scheduledAt), new Date()))
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  return (
    <div style={cardStyle}>
      <p style={sectionTitleStyle}>{t("dashboard.todayPlan")}</p>
      {upcoming === null ? (
        <div className="flex justify-center py-8">
          <Spinner size={20} color="var(--text-muted)" />
        </div>
      ) : todayPosts.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.upcomingEmpty")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {todayPosts.map((p) => (
            <button
              key={p.id}
              onClick={() => (p.draftId ? navigate(`/editor/${p.draftId}`) : navigate("/schedule"))}
              className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
              style={{ background: "none", border: "none", cursor: "pointer" }}
            >
              <CalendarClock size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                  {p.channelTitle || p.channelId}
                </div>
                {p.contentPreview && (
                  <div className="truncate" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {p.contentPreview}
                  </div>
                )}
              </div>
              <span className="flex-shrink-0" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                {fmtDateTime(p.scheduledAt, language)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 7-day activity chart ────────────────────────────────────────────────────

function ActivityChart({ history }: { history: DashboardHistoryRow[] | null }) {
  const language = useSettingsStore((s) => s.language);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    return d;
  });
  const now = new Date();
  const counts = days.map((day) =>
    (history ?? []).filter((h) => h.status === "published" && sameDay(new Date(h.publishedAt), day)).length
  );
  const max = Math.max(...counts, 1);
  const total = counts.reduce((s, n) => s + n, 0);

  return (
    <div style={cardStyle}>
      <p style={sectionTitleStyle}>{t("dashboard.chart7")}</p>
      <div className="flex items-end justify-between gap-1.5" style={{ height: 116 }}>
        {days.map((day, i) => {
          const count = counts[i];
          const h = count === 0 ? 3 : Math.max(6, Math.round((count / max) * 92));
          const isToday = sameDay(day, now);
          return (
            <div key={i} className="flex flex-col items-center gap-1 flex-1" style={{ minWidth: 0 }}>
              <span
                style={{
                  fontSize: 10,
                  color: count > 0 ? "var(--text-secondary)" : "var(--text-muted)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {count > 0 ? count : ""}
              </span>
              <div
                style={{
                  width: "100%",
                  maxWidth: 26,
                  height: h,
                  borderRadius: 4,
                  backgroundColor:
                    count > 0
                      ? isToday
                        ? "var(--accent)"
                        : "color-mix(in srgb, var(--accent) 45%, transparent)"
                      : "var(--bg-hover)",
                }}
              />
              <span
                style={{
                  fontSize: 10,
                  color: isToday ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: isToday ? 700 : 400,
                }}
              >
                {day.toLocaleDateString(language ?? "ru", { weekday: "short" }).replace(/\.$/, "")}
              </span>
            </div>
          );
        })}
      </div>
      {total === 0 && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>{t("dashboard.chartEmpty")}</p>
      )}
    </div>
  );
}

// ─── Publication analytics ───────────────────────────────────────────────────

function AnalyticsCard() {
  const [data, setData] = useState<PublicationAnalytics | null>(null);

  // A fortnight is deliberate: "чаще всего вы публикуете в 19:00" has to describe
  // a habit the user still has, and a wide window would average over posting
  // patterns they have long since changed.
  useEffect(() => {
    getPublicationAnalytics(14).then(setData).catch(() => setData(null));
  }, []);

  const bestHour = data?.bestHour ?? null;
  const topChannels = data?.byChannel.slice(0, 3) ?? [];

  return (
    <div style={cardStyle}>
      <p style={sectionTitleStyle}>{t("analytics.title")}</p>

      {data === null ? (
        <div className="flex justify-center py-8">
          <Spinner size={20} color="var(--text-muted)" />
        </div>
      ) : data.published + data.failed === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("analytics.empty")}</p>
      ) : (
        <>
          <div className="flex items-end gap-6">
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {data.published}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                {t("analytics.published")}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 24, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums",
                  color: data.failed > 0 ? "var(--danger)" : "var(--text-primary)",
                }}
              >
                {data.failed}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                {t("analytics.failed")}
              </div>
            </div>
          </div>

          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
            {t("analytics.last14")}
          </p>

          {bestHour !== null && (
            <p style={{ fontSize: 12.5, color: "var(--accent)", marginTop: 10 }}>
              {ti("analytics.bestHour", { time: `${String(bestHour).padStart(2, "0")}:00` })}
            </p>
          )}

          {topChannels.length > 0 && (
            <div style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 12, paddingTop: 10 }}>
              {topChannels.map((c) => (
                <div
                  key={c.title}
                  className="flex items-center justify-between gap-3"
                  style={{ fontSize: 12, marginBottom: 5 }}
                >
                  <span className="truncate" style={{ color: "var(--text-secondary)" }} title={c.title}>
                    {c.title}
                  </span>
                  <span style={{ color: "var(--text-primary)", fontWeight: 600, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {c.published}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Mini calendar ───────────────────────────────────────────────────────────

function MiniCalendarCard({ upcoming }: { upcoming: ScheduledPostInfo[] | null }) {
  const language = useSettingsStore((s) => s.language);
  const navigate = useNavigate();

  const now = new Date();
  const grid = buildCalendarGrid(now.getFullYear(), now.getMonth());
  const scheduled = new Set(
    (upcoming ?? []).map((p) => {
      const d = new Date(p.scheduledAt);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    })
  );
  const monthLabel = now
    .toLocaleDateString(language ?? "ru", { month: "long", year: "numeric" })
    .replace(/^./, (c) => c.toUpperCase());

  return (
    <div style={cardStyle}>
      <p style={sectionTitleStyle}>{t("dashboard.calendar")}</p>
      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>{monthLabel}</p>
      <div className="grid" style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {WEEKDAY_BASE_DATES.map((d, i) => (
          <div
            key={i}
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              color: "var(--text-muted)",
              textAlign: "center",
              paddingBottom: 4,
            }}
          >
            {d.toLocaleDateString(language ?? "ru", { weekday: "short" }).replace(/\.$/, "")}
          </div>
        ))}
        {grid.map((day, idx) => {
          if (!day) return <div key={idx} />;
          const isToday = sameDay(day, now);
          const has = scheduled.has(`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`);
          return (
            <button
              key={idx}
              onClick={() => navigate("/schedule")}
              title={has ? t("dashboard.calendarLegend") : undefined}
              className="flex items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-hover)]"
              style={{
                width: 26,
                height: 26,
                margin: "0 auto",
                fontSize: 11,
                cursor: "pointer",
                border: "none",
                backgroundColor: isToday ? "var(--accent)" : "transparent",
                color: isToday ? "#fff" : "var(--text-secondary)",
                position: "relative",
              }}
            >
              {day.getDate()}
              {has && !isToday && (
                <span
                  style={{
                    position: "absolute",
                    bottom: 2,
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    backgroundColor: "var(--accent)",
                  }}
                />
              )}
              {has && isToday && (
                <span
                  style={{
                    position: "absolute",
                    bottom: 2,
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    backgroundColor: "#fff",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: "var(--accent)" }} />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("dashboard.calendarLegend")}</span>
      </div>
    </div>
  );
}

// ─── Channels card ───────────────────────────────────────────────────────────

function ChannelsCard({ history }: { history: DashboardHistoryRow[] | null }) {
  const channels = useChannelsStore((s) => s.channels);
  const language = useSettingsStore((s) => s.language);
  const navigate = useNavigate();

  const totalSubs = channels.reduce((sum, c) => sum + (c.memberCount ?? 0), 0);
  const last = [...(history ?? [])]
    .filter((h) => h.status === "published")
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())[0];
  const lastChannel = last ? channels.find((c) => c.id === last.channelId) : null;
  const lastLabel = lastChannel
    ? lastChannel.username
      ? `@${lastChannel.username}`
      : lastChannel.title
    : last?.channelTitle || null;

  return (
    <button
      onClick={() => navigate("/channels")}
      className="transition-colors"
      style={{ ...cardStyle, cursor: "pointer", textAlign: "left", width: "100%" }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--border-default)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-subtle)")}
    >
      <p style={sectionTitleStyle}>{t("nav.channels")}</p>
      <div className="flex flex-col">
        <div
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "var(--text-primary)",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {channels.length}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
          {t("dashboard.channelsCount")}
        </div>
        <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)", marginTop: 8 }}>
          {ti("sidebar.widget.subscribers", { n: totalSubs.toLocaleString(language ?? "ru") })}
        </div>
        <div style={{ borderTop: "1px solid var(--border-subtle)", marginTop: 12, paddingTop: 10 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>
            {t("channels.lastPost")}
          </div>
          <div className="truncate" style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-primary)" }}>
            {lastLabel ?? t("channels.noLastPost")}
          </div>
          {last && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {fmtDateTime(last.publishedAt, language)}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export function DashboardPage() {
  const isMobile = useIsMobileLayout();
  const language = useSettingsStore((s) => s.language);
  const navigate = useNavigate();

  const [stats, setStats] = useState<TodayStats | null>(null);
  const [upcoming, setUpcoming] = useState<ScheduledPostInfo[] | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [history, setHistory] = useState<DashboardHistoryRow[] | null>(null);
  const [showNewPostConfirm, setShowNewPostConfirm] = useState(false);
  const [showChooser, setShowChooser] = useState(false);
  // Bumped by uiStore whenever a post is published/scheduled/cancelled —
  // re-fetch everything so the counts and lists stay fresh.
  const historyVersion = useUiStore((s) => s.historyVersion);
  const bumpHistory = useUiStore((s) => s.bumpHistory);

  useEffect(() => {
    let active = true;
    getTodayStats()
      .then((s) => { if (active) setStats(s); })
      .catch(() => { if (active) setStats({ published: 0, failed: 0 }); });
    getScheduledPosts()
      .then((p) => { if (active) setUpcoming(p); })
      .catch(() => { if (active) setUpcoming([]); });
    getDrafts()
      .then((d) => { if (active) setDrafts(d); })
      .catch(() => { if (active) setDrafts([]); });
    invoke<DashboardHistoryRow[]>("get_history")
      .then((items) => { if (active) setHistory(items); })
      .catch(() => { if (active) setHistory([]); });
    return () => { active = false; };
  }, [historyVersion]);

  const scheduledCount = (upcoming ?? []).filter(
    (p) => new Date(p.scheduledAt).getTime() > Date.now()
  ).length;

  const sentTotal = history === null ? null : history.filter((h) => h.status === "published").length;

  const recentDrafts = [...(drafts ?? [])]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  function confirmNewPost() {
    setShowNewPostConfirm(false);
    navigate("/editor", { state: { _newPost: Date.now() } });
  }

  function newPoll() {
    navigate("/editor", { state: { _newPost: Date.now(), _withPoll: Date.now() } });
  }

  async function handleCancelPost(id: string) {
    try {
      await cancelScheduledPost(id);
      setUpcoming((prev) => (prev ?? []).filter((p) => p.id !== id));
      bumpHistory();
      toast.success(t("sched.cancelled"));
    } catch {
      toast.error(t("sched.cancelError"));
    }
  }

  return (
    <>
      <TopBar title={t("nav.dashboard")} />

      <div className="page-content" style={{ padding: isMobile ? 12 : 16 }}>
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            width: "100%",
          }}
        >
          {/* ── Decorative ambient background ──────────────────────────────
              Soft glows tinted by the app's accent/success colors. Pure CSS,
              theme-aware (color-mix follows dark/light), inert (no events). */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              overflow: "hidden",
              pointerEvents: "none",
              zIndex: 0,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: -160,
                right: -120,
                width: 520,
                height: 520,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 68%)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 40,
                left: -180,
                width: 460,
                height: 460,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, color-mix(in srgb, var(--success) 6%, transparent) 0%, transparent 68%)",
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: -140,
                right: 80,
                width: 420,
                height: 420,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, color-mix(in srgb, var(--accent) 7%, transparent) 0%, transparent 70%)",
              }}
            />
          </div>

          {/* ── Content (above the glow layer) ───────────────────────────── */}
          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {/* ── Hero: greeting + date ─────────────────────────────────── */}
            <HeroBlock />

            {/* ── Error alert ───────────────────────────────────────────── */}
            {stats && stats.failed > 0 && (
              <ErrorBanner count={stats.failed} onClick={() => navigate("/history")} />
            )}

            {/* ── Quick actions ─────────────────────────────────────────── */}
            <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
              <Button
                variant="primary"
                size={isMobile ? "lg" : "md"}
                leftIcon={<PenLine size={15} />}
                onClick={() => setShowNewPostConfirm(true)}
              >
                {t("dashboard.newPost")}
              </Button>
              <Button
                variant="secondary"
                size={isMobile ? "lg" : "md"}
                leftIcon={<CalendarClock size={15} />}
                onClick={() => navigate("/schedule")}
              >
                {t("dashboard.openSchedule")}
              </Button>
              <Button
                variant="secondary"
                size={isMobile ? "lg" : "md"}
                leftIcon={<LayoutTemplate size={15} />}
                onClick={() => setShowChooser(true)}
              >
                {t("dashboard.fromTemplate")}
              </Button>
              <Button
                variant="secondary"
                size={isMobile ? "lg" : "md"}
                leftIcon={<BarChart2 size={15} />}
                onClick={newPoll}
              >
                {t("dashboard.newPoll")}
              </Button>
            </div>

            {/* ── Pipeline stats: scheduled vs sent ───────────────────────
                Fluid grid — cards reflow to fill the full window width on
                every resize (auto-fit stretches to the edges). */}
            <div>
              <p style={sectionTitleStyle}>{t("dashboard.stats")}</p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))",
                  gap: 12,
                }}
              >
                <StatCard
                  icon={CalendarClock}
                  color="var(--accent)"
                  value={upcoming === null ? "…" : scheduledCount}
                  label={t("dashboard.scheduled")}
                  onClick={() => navigate("/schedule")}
                />
                <StatCard
                  icon={CheckCircle2}
                  color="var(--success)"
                  value={stats === null ? "…" : stats.published}
                  label={t("dashboard.published")}
                  onClick={() => navigate("/history")}
                />
                <StatCard
                  icon={Send}
                  color="var(--success)"
                  value={sentTotal === null ? "…" : sentTotal}
                  label={t("dashboard.totalPublished")}
                  onClick={() => navigate("/history")}
                />
                <StatCard
                  icon={XCircle}
                  color={stats && stats.failed > 0 ? "var(--danger)" : "var(--text-muted)"}
                  value={stats === null ? "…" : stats.failed}
                  label={t("dashboard.failed")}
                  onClick={stats && stats.failed > 0 ? () => navigate("/history") : undefined}
                />
              </div>
            </div>

            {/* ── Next post + today's plan + recent drafts ────────────────
                Fluid grid — reflows from 3 columns on wide windows down to a
                single column as the window narrows. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
                gap: 16,
              }}
            >
              <NextPostCard upcoming={upcoming} onCancel={handleCancelPost} />
              <TodayPlanCard upcoming={upcoming} />
              <div style={cardStyle}>
                <p style={sectionTitleStyle}>{t("dashboard.recentDrafts")}</p>
                {drafts === null ? (
                  <div className="flex justify-center py-8">
                    <Spinner size={20} color="var(--text-muted)" />
                  </div>
                ) : recentDrafts.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.draftsEmpty")}</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {recentDrafts.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => navigate(`/editor/${d.id}`)}
                        className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-[var(--bg-hover)]"
                        style={{ background: "none", border: "none", cursor: "pointer" }}
                      >
                        <Files size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                        <div className="min-w-0 flex-1 truncate" style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
                          {d.postTitle?.trim() || t("drafts.untitled")}
                        </div>
                        <span className="flex-shrink-0" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          {fmtDateTime(d.updatedAt, language)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Activity chart + mini calendar + channels + analytics ─── */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
                gap: 16,
              }}
            >
              <ActivityChart history={history} />
              <MiniCalendarCard upcoming={upcoming} />
              <ChannelsCard history={history} />
              <AnalyticsCard />
            </div>
          </div>
        </div>
      </div>

      {showNewPostConfirm && (
        <ConfirmDialog
          title={t("editor.newPostConfirmTitle")}
          description={t("editor.newPostConfirmDesc")}
          confirmLabel={t("editor.newPostConfirmButton")}
          onConfirm={confirmNewPost}
          onClose={() => setShowNewPostConfirm(false)}
        />
      )}

      {showChooser && <NewPostChooserDialog onClose={() => setShowChooser(false)} />}
    </>
  );
}