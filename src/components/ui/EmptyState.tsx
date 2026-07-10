import type { LucideIcon } from "lucide-react";
import { Button } from "./Button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center flex-1 gap-3 py-20"
      style={{ animation: "pageFadeIn 0.25s ease-out both" }}
    >
      <div
        className="flex items-center justify-center w-16 h-16 rounded-2xl mb-2 soft-ui"
        style={{ background: "linear-gradient(135deg, var(--accent-subtle) 0%, var(--bg-elevated) 100%)" }}
      >
        <Icon size={28} strokeWidth={1.5} style={{ color: "var(--accent)" }} />
      </div>

      <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </p>

      {description && (
        <p
          className="text-sm text-center max-w-xs"
          style={{ color: "var(--text-muted)" }}
        >
          {description}
        </p>
      )}

      {action && (
        <Button variant="primary" size="md" onClick={action.onClick} className="mt-2">
          {action.label}
        </Button>
      )}
    </div>
  );
}
