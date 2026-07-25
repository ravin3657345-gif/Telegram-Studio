import type { ReactNode } from "react";
import { Spinner } from "./Spinner";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";

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

// Desktop: single pill, primary + slim hover-reveal icon segments side by side.
function DesktopSplitButton({ primary, secondary }: SplitButtonProps) {
  return (
    <div className="flex w-full rounded-md overflow-hidden" style={{ height: 28, border: "1px solid var(--border-default)" }}>
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

      {secondary.map((action, i) => (
        <button
          key={i}
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          title={action.iconOnly ? action.label : undefined}
          className="group flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
          style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-secondary)", borderLeft: "1px solid var(--border-default)" }}
          onMouseEnter={(e) => { if (!action.disabled) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-elevated)"; }}
        >
          {action.loading ? <Spinner size={13} /> : action.icon}
          {!action.iconOnly && (
            <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[100px] group-hover:opacity-100">
              {action.label}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// Mobile: no hover, so no reveal-on-hover to fall back on — and cramming
// every label into one row alongside the primary button doesn't fit on a
// phone (measured: "Опубликовать" + "Запланировать" + "Сохранить как
// шаблон" together want ~470px, well past a ~360px content width). Primary
// gets its own full-width row (finger-sized, 44px); secondary actions share
// a second row below, each with room to show icon + label instead of being
// unlabeled forever.
function MobileSplitButton({ primary, secondary }: SplitButtonProps) {
  return (
    <div className="flex flex-col gap-2 w-full">
      <button
        type="button"
        onClick={primary.onClick}
        disabled={primary.disabled}
        className="flex items-center justify-center gap-2 text-sm font-semibold text-white rounded-lg transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
        style={{ height: 44, backgroundColor: "var(--accent)" }}
      >
        {primary.loading ? <Spinner size={14} /> : primary.icon}
        {primary.label}
      </button>

      {secondary.length > 0 && (
        <div className="flex gap-2">
          {secondary.map((action, i) => (
            <button
              key={i}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className="flex-1 flex items-center justify-center gap-1.5 px-2 text-xs font-medium rounded-lg transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 min-w-0"
              style={{ height: 40, backgroundColor: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border-default)" }}
            >
              {action.loading ? <Spinner size={13} /> : action.icon}
              <span className="truncate">{action.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SplitButton(props: SplitButtonProps) {
  const isMobile = useIsMobileLayout();
  return isMobile ? <MobileSplitButton {...props} /> : <DesktopSplitButton {...props} />;
}
