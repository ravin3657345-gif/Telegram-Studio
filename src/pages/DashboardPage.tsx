import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PenLine,
  CalendarClock,
  Files,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { getTodayStats, getScheduledPosts, getDrafts } from "@/lib/tauriApi";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";
import type { TodayStats, ScheduledPostInfo } from "@/types/publish";
import type { DraftSummary } from "@/types/draft";

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

// ─── Dashboard ───────────────────────────────────────────────────────────────

export function DashboardPage() {
  const isMobile = useIsMobileLayout();
  const language = useSettingsStore((s) => s.language);
  const navigate = useNavigate();

  const [stats, setStats] = useState<TodayStats | null>(null);
  const [upcoming, setUpcoming] = useState<ScheduledPostInfo[] | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [showNewPostConfirm, setShowNewPostConfirm] = useState(false);

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
    return () => { active = false; };
  }, []);

  const upcomingSorted = (upcoming ?? [])
    .filter((p) => new Date(p.scheduledAt).getTime() > Date.now())
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, 5);

  const recentDrafts = [...(drafts ?? [])]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(language ?? "ru", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

  function confirmNewPost() {
    setShowNewPostConfirm(false);
    navigate("/editor", { state: { _newPost: Date.now() } });
  }

  return (
    <>
      <TopBar title={t("nav.dashboard")} />

      <div className="page-content" style={{ padding: isMobile ? 12 : 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 860, margin: "0 auto" }}>
          {/* ── CTA row ─────────────────────────────────────────────────── */}
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
          </div>

          {/* ── Today stats ────────────────────────────────────────────── */}
          <div>
            <p style={sectionTitleStyle}>{t("dashboard.today")}</p>
            <div className="flex gap-3" style={{ flexWrap: "wrap" }}>
              <div style={{ ...cardStyle, flex: "1 1 160px", display: "flex", alignItems: "center", gap: 12 }}>
                <CheckCircle2 size={20} style={{ color: "var(--success)" }} />
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1 }}>
                    {stats === null ? "…" : stats.published}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                    {t("dashboard.published")}
                  </div>
                </div>
              </div>
              <div style={{ ...cardStyle, flex: "1 1 160px", display: "flex", alignItems: "center", gap: 12 }}>
                <XCircle size={20} style={{ color: stats && stats.failed > 0 ? "var(--danger)" : "var(--text-muted)" }} />
                <div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: stats && stats.failed > 0 ? "var(--danger)" : "var(--text-primary)",
                    }}
                  >
                    {stats === null ? "…" : stats.failed}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                    {t("dashboard.failed")}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Upcoming + recent drafts ───────────────────────────────── */}
          <div
            style={
              isMobile
                ? { display: "flex", flexDirection: "column", gap: 16 }
                : { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }
            }
          >
            <div style={cardStyle}>
              <p style={sectionTitleStyle}>{t("dashboard.upcoming")}</p>
              {upcoming === null ? (
                <div className="flex justify-center py-8">
                  <Spinner size={20} color="var(--text-muted)" />
                </div>
              ) : upcomingSorted.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.upcomingEmpty")}</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {upcomingSorted.map((p) => (
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
                        {fmt(p.scheduledAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

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
                        {fmt(d.updatedAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
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
    </>
  );
}
