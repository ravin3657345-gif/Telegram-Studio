import type { ReactNode } from "react";
import { Spinner } from "./Spinner";

// Adapted from Watermelon UI's split-button.tsx (registry.watermelon.sh) —
// kept the single-pill shape and press micro-interaction, dropped its
// collapse/reveal behavior (main action morphs to hide the secondary one
// until clicked). That fits a rarely-used secondary action; here `secondary`
// is "Запланировать", used about as often as `primary`'s "Опубликовать" —
// burying it behind an extra click would be a regression, not a polish.
// Both stay one click away, side by side, instead of stacked full-width.
interface SplitButtonAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

interface SplitButtonProps {
  primary: SplitButtonAction;
  secondary: SplitButtonAction;
}

export function SplitButton({ primary, secondary }: SplitButtonProps) {
  return (
    <div
      className="flex w-full rounded-md overflow-hidden"
      style={{ height: 28, border: "1px solid var(--border-default)" }}
    >
      <button
        type="button"
        onClick={primary.onClick}
        disabled={primary.disabled}
        className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-white transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
        style={{ backgroundColor: "var(--accent)" }}
        onMouseEnter={(e) => { if (!primary.disabled) e.currentTarget.style.backgroundColor = "var(--accent-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--accent)"; }}
      >
        {primary.loading ? <Spinner size={13} /> : primary.icon}
        {primary.label}
      </button>

      {/* Slim segment, icon-only at rest — its label reveals on hover via a
          max-width transition (pure CSS, matches the app's existing
          press/hover idiom instead of pulling in framer-motion for a case
          this simple). */}
      <button
        type="button"
        onClick={secondary.onClick}
        disabled={secondary.disabled}
        className="group flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
        style={{
          backgroundColor: "var(--bg-elevated)",
          color: "var(--text-secondary)",
          borderLeft: "1px solid var(--border-default)",
        }}
        onMouseEnter={(e) => { if (!secondary.disabled) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-elevated)"; }}
      >
        {secondary.loading ? <Spinner size={13} /> : secondary.icon}
        <span
          className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[100px] group-hover:opacity-100"
        >
          {secondary.label}
        </span>
      </button>
    </div>
  );
}
