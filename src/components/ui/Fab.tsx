import type { LucideIcon } from "lucide-react";

interface FabProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

// Mobile-only floating action button — bottom-right, thumb-reachable,
// sitting above the fixed BottomTabBar instead of requiring a reach up to a
// header button. Only used where the page's "new" action opens something
// (a dialog, a navigation) — Channels/Bots have an always-visible inline
// add-form instead of a dialog, so they don't get one (see Canvas.dc port
// notes: forcing a FAB onto a pattern that doesn't have anything to open
// would just be a confusing extra button).
export function Fab({ icon: Icon, label, onClick }: FabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex items-center justify-center transition-transform active:scale-95"
      style={{
        position: "fixed",
        right: 18,
        bottom: 74, // clears the 56px BottomTabBar + margin
        width: 52,
        height: 52,
        borderRadius: "50%",
        backgroundColor: "var(--accent)",
        color: "#fff",
        border: "none",
        boxShadow: "0 6px 16px color-mix(in srgb, var(--accent) 45%, transparent)",
        zIndex: 40,
      }}
    >
      <Icon size={22} strokeWidth={2} />
    </button>
  );
}
