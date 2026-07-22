import type { ReactNode } from "react";
import { Spinner } from "./Spinner";

// Adapted from Watermelon UI's split-button.tsx (registry.watermelon.sh) —
// kept the single-pill shape and press micro-interaction, dropped its
// collapse/reveal behavior (main action morphs to hide the secondary one
// until clicked). That fits a rarely-used secondary action; here `secondary`
// is "Запланировать"/"Сохранить как шаблон" — used often enough that
// burying them behind an extra click would be a regression, not a polish.
// All stay one click away, side by side, instead of stacked full-width.
interface SplitButtonAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  // Skips the hover-reveal label entirely, showing `label` as a native
  // title tooltip instead — for a label too long to fit the reveal's
  // max-width without either clipping or blowing out the pill's layout in
  // this narrow sidebar column (live-reported: "Сохранить как шаблон"
  // didn't fit, unlike the shorter "Запланировать").
  iconOnly?: boolean;
}

interface SplitButtonProps {
  primary: SplitButtonAction;
  // Any number of slim icon-reveal segments, in display order — originally a
  // single action (just "Запланировать"), generalized to an array so a third
  // ("Сохранить как шаблон") could be added without a layout rewrite.
  secondary: SplitButtonAction[];
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

      {/* Slim segments, icon-only at rest — each label reveals on hover via a
          max-width transition (pure CSS, matches the app's existing
          press/hover idiom instead of pulling in framer-motion for a case
          this simple). */}
      {secondary.map((action, i) => (
        <button
          key={i}
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.iconOnly ? action.label : undefined}
          className="group flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
          style={{
            backgroundColor: "var(--bg-elevated)",
            color: "var(--text-secondary)",
            borderLeft: "1px solid var(--border-default)",
          }}
          onMouseEnter={(e) => { if (!action.disabled) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-elevated)"; }}
        >
          {action.loading ? <Spinner size={13} /> : action.icon}
          {!action.iconOnly && (
            <span
              className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[100px] group-hover:opacity-100"
            >
              {action.label}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
