import { useRef, useEffect } from "react";
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
  const btnRef   = useRef<HTMLButtonElement>(null);
  const wasActive = useRef(isActive);

  // Pulse ring fires once when the button transitions to active
  useEffect(() => {
    if (isActive && !wasActive.current) {
      const el = btnRef.current;
      if (el) {
        el.classList.remove("toolbar-btn-pulse");
        void el.offsetWidth; // force reflow to restart animation
        el.classList.add("toolbar-btn-pulse");
        const t = setTimeout(() => el.classList.remove("toolbar-btn-pulse"), 500);
        return () => clearTimeout(t);
      }
    }
    wasActive.current = isActive;
  }, [isActive]);

  const btn = (
    <button
      ref={btnRef}
      type="button"
      aria-label={title}
      aria-pressed={isActive}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={clsx(
        "toolbar-btn relative flex items-center justify-center w-8 h-8 rounded-md select-none flex-shrink-0",
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

  // Wrapped in a plain (never-disabled) span so the tooltip still shows on a
  // disabled button — native <button disabled> elements don't reliably fire
  // mouseenter/mouseleave in Chromium/WebView2, but a span around it always
  // does, since the pointer still enters ITS box regardless of the child's
  // disabled state. This is what lets a disabled button explain *why* it's
  // disabled instead of going silent (e.g. "only available in Rich mode").
  return (
    <Tooltip content={title}>
      <span className="inline-flex">{btn}</span>
    </Tooltip>
  );
}

export function ToolbarSeparator() {
  return (
    <div
      className="w-px h-5 mx-1 flex-shrink-0"
      style={{ backgroundColor: "var(--border-default)" }}
    />
  );
}
