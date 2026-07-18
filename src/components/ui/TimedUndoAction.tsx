import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Undo2 } from "lucide-react";

// Adapted from Watermelon UI's timed-undo-action.tsx (registry.watermelon.sh)
// — same idea (delete button morphs into an inline countdown + Undo instead
// of a blocking window.confirm()), rewritten without `react-use-measure`
// (not a project dependency; a fixed-width swap is enough here since both
// states render at the same size) and with the app's own danger/elevated
// CSS variables instead of hardcoded red-500 Tailwind classes.
interface TimedUndoActionProps {
  label: string;
  undoLabel: string;
  icon: ReactNode;
  seconds?: number;
  onConfirm: () => void;
  disabled?: boolean;
}

export function TimedUndoAction({ label, undoLabel, icon, seconds = 6, onConfirm, disabled }: TimedUndoActionProps) {
  const [armed, setArmed] = useState(false);
  const [remaining, setRemaining] = useState(seconds);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!armed) return;
    setRemaining(seconds);
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setArmed(false);
          onConfirm();
          return seconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    setArmed((v) => !v);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full text-xs font-medium tabular-nums"
      style={{
        padding: "5px 12px",
        border: "1px solid " + (armed ? "var(--border-default)" : "rgba(231,76,60,0.3)"),
        backgroundColor: armed ? "var(--bg-elevated)" : "rgba(231,76,60,0.07)",
        color: armed ? "var(--text-secondary)" : "var(--danger)",
        cursor: disabled ? "default" : "pointer",
        transition: "background-color 0.2s, border-color 0.2s, color 0.2s",
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={armed ? "undo" : "delete"}
          initial={{ opacity: 0, scale: 0.6, filter: "blur(3px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.6, filter: "blur(3px)" }}
          transition={{ type: "spring", duration: 0.25, bounce: 0 }}
          style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          {armed ? <Undo2 size={12} /> : icon}
          {armed ? `${undoLabel} · ${remaining}` : label}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
