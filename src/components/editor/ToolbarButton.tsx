import clsx from "clsx";
import { Tooltip } from "@/components/ui/Tooltip";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IconType = React.ComponentType<any>;

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  icon?: IconType;
  label?: string;
  size?: number;
}

export function ToolbarButton({
  onClick,
  isActive = false,
  disabled = false,
  title,
  icon: Icon,
  label,
  size = 15,
}: ToolbarButtonProps) {
  const btn = (
    <button
      type="button"
      aria-label={title}
      aria-pressed={isActive}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={clsx(
        "relative flex items-center justify-center w-8 h-8 rounded-md transition-all select-none",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        isActive
          ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      )}
    >
      {isActive && (
        <span
          className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
          style={{ backgroundColor: "var(--accent)" }}
        />
      )}
      {Icon ? (
        <Icon size={size} strokeWidth={isActive ? 2.25 : 1.75} />
      ) : (
        <span className="text-sm font-semibold leading-none">{label}</span>
      )}
    </button>
  );

  if (disabled) return btn;
  return <Tooltip content={title}>{btn}</Tooltip>;
}

export function ToolbarSeparator() {
  return (
    <div
      className="w-px h-5 mx-1 flex-shrink-0"
      style={{ backgroundColor: "var(--border-default)" }}
    />
  );
}
