import * as RadixDialog from "@radix-ui/react-dialog";
import type { ComponentProps, ReactNode, CSSProperties } from "react";

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
}

export function Dialog({ onOpenChange, children, style, className, overlayStyle }: DialogProps) {
  return (
    <RadixDialog.Root open onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" style={overlayStyle} />
        <RadixDialog.Content className={"dialog-content" + (className ? " " + className : "")} style={style}>
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
