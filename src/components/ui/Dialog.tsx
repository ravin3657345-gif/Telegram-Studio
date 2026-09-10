import * as RadixDialog from "@radix-ui/react-dialog";
import type { ComponentProps, ReactNode, CSSProperties } from "react";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";

/**
 * Thin wrapper around Radix's Dialog primitive, styled to match this app's
 * existing hand-rolled modals (same overlay/card look) while getting focus
 * trap, Escape-to-close, and return-focus-to-trigger for free.
 *
 * Callers keep their existing conditional-mount pattern (`{show && <X/>}`) —
 * `open` is always true while mounted, and `onOpenChange(false)` (fired by
 * Radix on Escape/outside-click) is wired to the caller's own onClose.
 */
interface DialogProps {
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** Card width/etc — same inline-style convention every dialog already used. */
  style?: CSSProperties;
  className?: string;
  /** A couple of dialogs used a darker/blurred backdrop instead of the usual
   * flat rgba(0,0,0,0.5) — override per-dialog instead of forcing one look. */
  overlayStyle?: CSSProperties;
  /** On phones, anchor to the bottom edge as a sheet instead of a centered
   * card. Form/chooser dialogs (schedule, save-template, confirm, add-bot)
   * opt in; small inline popups (link, pickers) keep the centered card. */
  mobileSheet?: boolean;
}

export function Dialog({ onOpenChange, children, style, className, overlayStyle, mobileSheet }: DialogProps) {
  const isMobile = useIsMobileLayout();
  const asSheet = !!(mobileSheet && isMobile);

  // Overrides applied over the caller's own style so a dialog written for a
  // centered card (width, radius, shadow) still reads as a bottom sheet.
  const sheetStyle: CSSProperties = {
    top: "auto",
    bottom: 0,
    left: 0,
    right: 0,
    transform: "none",
    width: "100%",
    maxWidth: "none",
    borderRadius: "16px 16px 0 0",
    borderBottom: "none",
    boxShadow: "0 -8px 32px rgba(0,0,0,0.3)",
    maxHeight: "88vh",
    overflow: "auto",
  };

  return (
    <RadixDialog.Root open onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" style={overlayStyle} />
        <RadixDialog.Content
          className={(asSheet ? "bottom-sheet-content" : "dialog-content") + (className ? " " + className : "")}
          style={asSheet ? { ...style, ...sheetStyle } : style}
        >
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogClose = RadixDialog.Close;
export const DialogTitle = RadixDialog.Title;
export const DialogDescription = RadixDialog.Description;

/** For dialogs whose visible heading isn't naturally a single text node, or
 * that have no natural description — Radix wants both wired for a11y, this
 * keeps them out of the visual flow without an extra dependency. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
        overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0,
      }}
    >
      {children}
    </span>
  );
}

export type { ComponentProps };
