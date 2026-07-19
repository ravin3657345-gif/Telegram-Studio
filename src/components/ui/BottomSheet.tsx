import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { VisuallyHidden } from "./Dialog";

/**
 * Mobile counterpart to Dialog.tsx — same Radix primitive (focus trap,
 * Escape-to-close, outside-tap-to-close via Radix's own pointerdown
 * handling, not the mousedown-only pattern the desktop float-menus this
 * replaces used) but anchored to the bottom edge instead of centered, for
 * menus that need touch-sized rows and can't risk floating off-screen near
 * a tap/caret position on a narrow viewport (EditorContextMenu, SlashCommand,
 * EditorToolbar's overflow "Ещё" on mobile).
 */
interface BottomSheetProps {
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** For a11y only (Radix requires a Dialog.Title) — visually hidden, pass
   * something describing the sheet's contents ("Меню блока", "Форматирование"). */
  title: string;
  maxHeight?: string | number;
}

export function BottomSheet({ onOpenChange, children, title, maxHeight = "70vh" }: BottomSheetProps) {
  return (
    <RadixDialog.Root open onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="bottom-sheet-overlay" />
        <RadixDialog.Content className="bottom-sheet-content" style={{ maxHeight }}>
          <VisuallyHidden>
            <RadixDialog.Title>{title}</RadixDialog.Title>
          </VisuallyHidden>
          <div className="bottom-sheet-handle" />
          <div className="bottom-sheet-body">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
