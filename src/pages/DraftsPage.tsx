import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Files, Plus, Trash2 } from "lucide-react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { useDraftsStore } from "@/store/draftsStore";
import { getDrafts, deleteDraft } from "@/lib/tauriApi";
import { toast } from "@/store/uiStore";
import { t, ti } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";

const DRAFT_LIMIT = 20;

export function DraftsPage() {
  const navigate   = useNavigate();
  const drafts     = useDraftsStore((s) => s.drafts);
  const isLoading  = useDraftsStore((s) => s.isLoading);
  const setDrafts  = useDraftsStore((s) => s.setDrafts);
  const removeDraft = useDraftsStore((s) => s.removeDraft);
  const setLoading = useDraftsStore((s) => s.setLoading);
  useSettingsStore((s) => s.language);

  useEffect(() => {
    setLoading(true);
    getDrafts()
      .then(setDrafts)
      .finally(() => setLoading(false));
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

  const count = drafts.length;
  const nearLimit = count >= DRAFT_LIMIT - 2;

  return (
    <>
      <TopBar
        actions={
          <div className="flex items-center gap-3">
            {nearLimit && (
              <span className="text-xs" style={{ color: count >= DRAFT_LIMIT ? "var(--danger)" : "var(--warning)" }}>
                {ti("drafts.counter", { count, limit: DRAFT_LIMIT })}
              </span>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate("/editor")}
              leftIcon={<Plus size={14} />}
            >
              {t("drafts.new")}
            </Button>
          </div>
        }
      />

      <div className="page-content">
        {isLoading ? (
          <div className="flex justify-center py-20">
            <Spinner size={24} color="var(--text-muted)" />
          </div>
        ) : drafts.length === 0 ? (
          <EmptyState
            icon={Files}
            title={t("drafts.empty")}
            description={t("drafts.emptyDesc")}
            action={{ label: `+ ${t("drafts.new")}`, onClick: () => navigate("/editor") }}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 max-w-4xl">
            {drafts.map((d) => (
              <DraftCard
                key={d.id}
                title={d.postTitle || d.title || t("drafts.untitled")}
                preview={d.contentText ?? ""}
                mediaCount={d.mediaCount}
                updatedAt={d.updatedAt}
                onClick={() => navigate(`/editor/${d.id}`)}
                onDelete={(e) => handleDelete(e, d.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

interface DraftCardProps {
  title: string;
  preview: string;
  mediaCount: number;
  updatedAt: string;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}

function DraftCard({ title, preview, mediaCount, updatedAt, onClick, onDelete }: DraftCardProps) {
  const [hovered, setHovered] = useState(false);
  useSettingsStore((s) => s.language);

  const date = new Date(updatedAt).toLocaleString("ru", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border p-4 transition-all hover:shadow-[var(--shadow-sm)] cursor-pointer relative"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: hovered ? "var(--border-default)" : "var(--border-subtle)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Delete button */}
      {hovered && (
        <button
          onClick={onDelete}
          className="absolute top-2 right-2 flex items-center justify-center w-6 h-6 rounded transition-colors"
          style={{
            backgroundColor: "var(--bg-elevated)",
            color: "var(--text-muted)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--danger)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          title={t("drafts.delete")}
        >
          <Trash2 size={12} />
        </button>
      )}

      <p
        className="text-sm font-semibold mb-1 truncate pr-7"
        style={{ color: "var(--text-primary)" }}
      >
        {title}
      </p>
      <p
        className="text-xs mb-3 overflow-hidden"
        style={{
          color: "var(--text-secondary)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          lineHeight: "18px",
          height: 36,
        }}
      >
        {preview || t("drafts.noText")}
      </p>

      {mediaCount > 0 && (
        <p className="text-2xs mb-2" style={{ color: "var(--text-muted)" }}>
          🖼 × {mediaCount}
        </p>
      )}

      <div
        className="flex items-center justify-between pt-2 border-t text-2xs"
        style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
      >
        <span>{ti("drafts.edited", { date })}</span>
      </div>
    </button>
  );
}
