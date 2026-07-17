import clsx from "clsx";
import type { HTMLAttributes } from "react";

// Adapted from Watermelon UI's badge.tsx (registry.watermelon.sh) — named
// Tag, not Badge, since that name is already taken by the unread-count
// pill in Sidebar/BottomTabBar (a different component with a different
// job). Dropped `class-variance-authority` and `radix-ui`'s Slot/asChild
// polymorphism (nothing else in this codebase uses either pattern) and
// swapped shadcn's semantic color tokens (bg-primary, border-border,
// ring-ring, ...) for this project's own CSS variables, following the exact
// idiom already used in Button.tsx (clsx + Tailwind arbitrary-value var()
// classes) so this reads as a sibling component, not a foreign import.
export type TagVariant = "default" | "secondary" | "destructive" | "outline";

interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: TagVariant;
}

const VARIANT_STYLES: Record<TagVariant, string> = {
  default:     "bg-[var(--accent)] text-white",
  secondary:   "bg-[var(--bg-elevated)] text-[var(--text-secondary)]",
  destructive: "bg-[var(--danger)] text-white",
  outline:     "bg-transparent text-[var(--text-primary)] border border-[var(--border-default)]",
};

export function Tag({ variant = "default", className, children, ...props }: TagProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs font-medium whitespace-nowrap select-none",
        VARIANT_STYLES[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
