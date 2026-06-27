import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Trash2, RefreshCw } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { toast } from "@/store/uiStore";
import { getScheduledPosts, cancelScheduledPost } from "@/lib/tauriApi";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import type { ScheduledPostInfo } from "@/types/publish";

export function SchedulePage() {
  const navigate  = useNavigate();
  const [posts, setPosts]     = useState<ScheduledPostInfo[]>([]);
  const [loading, setLoading] = useState(true);
  useSettingsStore((s) => s.language);

  const load = () => {
    setLoading(true);
    getScheduledPosts()
      .then(setPosts)
      .catch(() => toast.error(t("sched.loadError")))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  async function handleCancel(id: string) {
    try {
      await cancelScheduledPost(id);
      setPosts((prev) => prev.filter((p) => p.id !== id));
      toast.success(t("sched.cancelled"));
    } catch {
      toast.error(t("sched.cancelError"));
    }
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
      <div className="page-content">
        {loading ? (
          <div className="flex justify-center py-20">
            <Spinner size={24} color="var(--text-muted)" />
          </div>
        ) : posts.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={t("sched.empty")}
            description={t("sched.emptyDesc")}
            action={{ label: t("sched.createPost"), onClick: () => navigate("/editor") }}
          />
        ) : (
          <div className="flex flex-col gap-2 max-w-2xl">
            {posts.map((post) => (
              <ScheduledCard key={post.id} post={post} onCancel={() => handleCancel(post.id)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ScheduledCard({
  post,
  onCancel,
}: {
  post: ScheduledPostInfo;
  onCancel: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  useSettingsStore((s) => s.language);

  const schedDate = new Date(post.scheduledAt).toLocaleString("ru", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const isPast = new Date(post.scheduledAt) < new Date();

  return (
    <div
      className="rounded-lg border p-3 flex items-center gap-3"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: hovered ? "var(--border-default)" : "var(--border-subtle)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <CalendarClock
        size={16}
        style={{ color: isPast ? "var(--warning, #f59e0b)" : "var(--accent)", flexShrink: 0 }}
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {schedDate}
        </p>
        <p className="text-2xs truncate" style={{ color: "var(--text-muted)" }}>
          {ti("sched.channel", { id: post.channelId })}
          {post.draftId && ` · ${ti("sched.draft", { id: post.draftId.slice(0, 8) })}`}
        </p>
      </div>

      <div
        className="flex items-center gap-1.5 px-2 py-0.5 rounded text-2xs flex-shrink-0"
        style={{
          backgroundColor: isPast ? "rgba(245,158,11,0.12)" : "rgba(42,171,238,0.1)",
          color: isPast ? "var(--warning, #f59e0b)" : "var(--accent)",
        }}
      >
        {isPast ? t("sched.pending") : t("sched.scheduled")}
      </div>

      {hovered && (
        <button
          onClick={onCancel}
          className="flex items-center justify-center w-6 h-6 rounded transition-colors flex-shrink-0"
          style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          title={t("sched.cancel")}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}
