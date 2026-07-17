import { useState, useCallback, useEffect, useRef, type KeyboardEvent } from "react";

// Excel/file-explorer-style keyboard navigation for a flat, ordered list of
// rows/cards: ↑/↓ moves a "current" row (clamped, no wrap — wrapping reads
// as the list looping unexpectedly when you're just trying to reach the
// top/bottom), Enter activates it, Delete removes it.
//
// Scoped to whichever element actually has focus (spread `containerProps`
// onto a `tabIndex={0}` wrapper around the list) rather than a global
// document keydown listener — so this never fires while the user is typing
// in an unrelated search box or a modal/dialog is open elsewhere on the
// page; the browser's own focus model handles that for free, no need to
// track "is a modal open" state by hand.
//
// Rows must carry `data-nav-id={id}` (matching `getId(item)`) so the hook
// can scroll a newly-selected row into view when it's off-screen.
export function useListKeyboardNav<T>(
  items: T[],
  getId: (item: T) => string,
  handlers: { onOpen?: (item: T) => void; onDelete?: (item: T) => void },
) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId || !containerRef.current) return;
    containerRef.current
      .querySelector(`[data-nav-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  // Selected row can vanish out from under the selection (deleted elsewhere,
  // filtered out by a search/category change) — drop a stale id rather than
  // silently pointing nowhere.
  useEffect(() => {
    if (selectedId && !items.some((i) => getId(i) === selectedId)) setSelectedId(null);
  }, [items, getId, selectedId]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (items.length === 0) return;
    const idx = selectedId ? items.findIndex((i) => getId(i) === selectedId) : -1;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedId(getId(items[Math.min(idx + 1, items.length - 1)]));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedId(getId(items[Math.max(idx - 1, 0)]));
    } else if (e.key === "Enter") {
      if (idx >= 0) { e.preventDefault(); handlers.onOpen?.(items[idx]); }
    } else if (e.key === "Delete") {
      if (idx >= 0 && handlers.onDelete) { e.preventDefault(); handlers.onDelete(items[idx]); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedId, getId, handlers.onOpen, handlers.onDelete]);

  return { selectedId, setSelectedId, containerRef, containerProps: { tabIndex: 0, onKeyDown } };
}
