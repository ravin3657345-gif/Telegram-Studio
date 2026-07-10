import { useEffect, useRef, useState, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { Scissors, X, GripHorizontal } from "lucide-react";
import { ti, t } from "@/lib/i18n";
import { useEditorStore } from "@/store/editorStore";
import { resolveMessageLimit } from "@/lib/constants";
import { useSettingsStore } from "@/store/settingsStore";

interface Props {
  editor: Editor | null;
  scrollEl: HTMLElement | null;
  wrapperEl: HTMLElement | null;
}

// Y position of a gap in *wrapper-relative* viewport coordinates.
function getGapY(editor: Editor, gapIdx: number, wrapperEl: HTMLElement): number | null {
  const offsets: number[] = [];
  editor.state.doc.forEach((_, pos) => offsets.push(pos));

  if (gapIdx <= 0 || gapIdx >= offsets.length) return null;

  const prev = editor.view.nodeDOM(offsets[gapIdx - 1]);
  const next = editor.view.nodeDOM(offsets[gapIdx]);
  if (!(prev instanceof Element) || !(next instanceof Element)) return null;

  const wr = wrapperEl.getBoundingClientRect();
  const pb = prev.getBoundingClientRect().bottom;
  const nt = next.getBoundingClientRect().top;

  return (pb + nt) / 2 - wr.top;
}

// Char counts for the segments above and below a given gap
function segmentChars(
  editor: Editor,
  gapIdx: number,
  allGaps: number[],
): { above: number; below: number } {
  const chars: number[] = [];
  editor.state.doc.forEach((n) => chars.push(n.textContent.length));

  const sorted = [...allGaps].sort((a, b) => a - b);
  const pos    = sorted.indexOf(gapIdx);
  const start  = pos > 0 ? sorted[pos - 1] : 0;
  const end    = pos < sorted.length - 1 ? sorted[pos + 1] : chars.length;

  let above = 0;
  for (let i = start; i < gapIdx && i < chars.length; i++) above += chars[i];

  let below = 0;
  for (let i = gapIdx; i < end && i < chars.length; i++) below += chars[i];

  return { above, below };
}

function getLimit(editor: Editor, publishMode: "normal" | "rich" | "telegraph"): number {
  let hasMedia = false;
  editor.state.doc.forEach((n) => {
    if (n.type.name === "blockImage" || n.type.name === "blockVideo") hasMedia = true;
  });
  return resolveMessageLimit(publishMode, hasMedia);
}

// Small at-a-glance fill indicator — greener/calmer than a raw "4058/4096" count.
// The exact number still lives in the parent's tooltip for anyone who wants it.
function CapacityBar({ value, limit }: { value: number; limit: number }) {
  const ratio = limit > 0 ? value / limit : 0;
  const pct   = Math.max(0, Math.min(ratio, 1)) * 100;
  const color = ratio > 1 ? "var(--danger)" : ratio > 0.8 ? "var(--warning)" : "var(--success)";
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        width: 34,
        height: 4,
        borderRadius: 2,
        backgroundColor: "var(--border-default)",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: 0,
          width: `${pct}%`,
          backgroundColor: color,
          borderRadius: 2,
          transition: "width 0.2s ease, background-color 0.2s ease",
        }}
      />
    </span>
  );
}

export function SplitOverlay({ editor, scrollEl, wrapperEl }: Props) {
  const splitGaps    = useEditorStore((s) => s.splitGaps);
  const lockedGaps   = useEditorStore((s) => s.lockedGaps);
  const setSplitGaps = useEditorStore((s) => s.setSplitGaps);
  const publishMode  = useEditorStore((s) => s.publishMode);
  useSettingsStore((s) => s.language);

  // Stable refs for drag callbacks (never go stale)
  const splitGapsRef   = useRef(splitGaps);
  const lockedGapsRef  = useRef(lockedGaps);
  const setSplitRef    = useRef(setSplitGaps);
  splitGapsRef.current  = splitGaps;
  lockedGapsRef.current = lockedGaps;
  setSplitRef.current   = setSplitGaps;

  // Keep wrapperEl accessible in drag closures without stale capture
  const wrapperElRef = useRef<HTMLElement | null>(null);
  wrapperElRef.current = wrapperEl;

  // DOM refs to each divider element — used for direct style updates during drag
  const divRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [positions, setPositions] = useState<Map<number, number>>(new Map());
  const [hoveredGap, setHoveredGap] = useState<number | null>(null);
  const [draggingGap, setDraggingGap] = useState<number | null>(null);

  // Whether the *next* positions-state render should animate `top` (a smooth
  // settle after a drop/keyboard move) or snap instantly (scroll/resize/typing,
  // which must track 1:1 with no lag). Set right before the render that should
  // animate; read directly during render — a ref is enough since scroll/resize
  // recomputes reset it back to false before any further animated render.
  const animateNextRef = useRef(false);

  const recompute = useCallback((animate = false) => {
    if (!editor || !wrapperEl) return;
    animateNextRef.current = animate;
    setPositions((prev) => {
      const map = new Map<number, number>(prev);
      const gaps = splitGapsRef.current;
      for (const g of [...map.keys()]) {
        if (!gaps.includes(g)) map.delete(g);
      }
      // Keep old Y if getGapY returns null (DOM mid-transition) to avoid flicker
      for (const g of gaps) {
        const y = getGapY(editor, g, wrapperEl);
        if (y !== null) map.set(g, y);
      }
      return map;
    });
  }, [editor, wrapperEl]);

  useEffect(() => {
    if (!editor || !scrollEl || !wrapperEl) return;
    const instant = () => recompute(false);
    instant();
    editor.on("update", instant);
    scrollEl.addEventListener("scroll", instant);
    window.addEventListener("resize", instant);
    return () => {
      editor.off("update", instant);
      scrollEl.removeEventListener("scroll", instant);
      window.removeEventListener("resize", instant);
    };
  }, [editor, scrollEl, wrapperEl, recompute]);

  // Dividers moving because the split points themselves changed (drag drop,
  // keyboard nudge, delete) get a gentle spring-settle instead of a hard snap.
  useEffect(() => { recompute(true); }, [splitGaps, recompute]);

  if (!editor || splitGaps.length === 0 || !wrapperEl) return null;

  const limit = getLimit(editor, publishMode);

  // ── Drag ──────────────────────────────────────────────────────────────────────
  function startDrag(e: React.MouseEvent, gap: number) {
    e.preventDefault();
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();

    const editorDom  = editor!.view.dom as HTMLElement;
    const editorRect = editorDom.getBoundingClientRect();
    const startY     = e.clientY;
    let   dragging   = false;

    setDraggingGap(gap);

    // Track last valid hit during drag for use in onUp
    let lastDocPos: number | null = null;

    // Direct reference to this divider's DOM element for smooth animation
    const divEl = divRefs.current.get(gap) ?? null;

    function onMove(me: MouseEvent) {
      // Require ≥6 px of movement before treating as intentional drag
      if (!dragging) {
        if (Math.abs(me.clientY - startY) < 6) return;
        dragging = true;
        // Kill any leftover settle transition so the line tracks the mouse
        // 1:1 with zero lag — the transition only belongs to the drop moment.
        if (divEl) divEl.style.transition = "none";
      }

      const clampY = Math.max(editorRect.top + 2, Math.min(me.clientY, editorRect.bottom - 2));

      // Find the document character position at the cursor's Y (line-level precision)
      const hit = editor!.view.posAtCoords({
        left: editorRect.left + editorRect.width / 2,
        top:  clampY,
      });
      if (!hit) return;

      lastDocPos = hit.pos;

      // Get the visual Y of that text line and update divider DOM directly (no React re-render)
      if (divEl) {
        const coords = editor!.view.coordsAtPos(hit.pos);
        const wr     = wrapperElRef.current?.getBoundingClientRect();
        if (wr) {
          const lineY = (coords.top + coords.bottom) / 2 - wr.top;
          divEl.style.top = `${lineY}px`;
        }
      }
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setDraggingGap(null);

      if (!dragging || lastDocPos === null) return;

      const docSize = editor!.state.doc.content.size;
      const safePos = Math.min(lastDocPos, docSize - 1);
      const $p      = editor!.state.doc.resolve(safePos);

      if ($p.depth < 1) return;

      const blockStart = $p.before(1);
      let blockIdx = 0;
      editor!.state.doc.forEach((_, off) => { if (off < blockStart) blockIdx++; });

      const offsetInBlock = $p.parentOffset;
      const blockLen      = $p.parent.textContent.length;
      const isLeaf        = $p.parent.isLeaf;

      const currGaps   = splitGapsRef.current;
      const currLocked = lockedGapsRef.current;

      if (!isLeaf && offsetInBlock > 0 && offsetInBlock < blockLen) {
        // ── Dropped mid-paragraph → split the block at this exact character ──
        //
        // After splitBlock() the doc gains one more block; all gap indices
        // >= (blockIdx+1) shift right by 1.
        const newGapIdx = blockIdx + 1;

        const otherGaps = currGaps
          .filter((g) => g !== gap)
          .map((g) => (g >= newGapIdx ? g + 1 : g));
        const newLocked = currLocked
          .filter((g) => g !== gap)
          .map((g) => (g >= newGapIdx ? g + 1 : g));
        if (!newLocked.includes(newGapIdx)) newLocked.push(newGapIdx);

        const allGaps = [...new Set([...otherGaps, newGapIdx])].sort((a, b) => a - b);

        // splitBlock fires "update" → compute() runs (with briefly stale refs).
        // We call setSplitGaps immediately after, and React batches both state
        // updates into a single render, so the final visible state is correct.
        editor!.chain().setTextSelection(safePos).splitBlock().run();
        setSplitRef.current(allGaps, newLocked);
      } else {
        // ── Dropped at a block boundary (or on a leaf block) ──
        let newGapIdx = offsetInBlock <= 0 ? blockIdx : blockIdx + 1;

        let totalBlocks = 0;
        editor!.state.doc.forEach(() => totalBlocks++);
        newGapIdx = Math.max(1, Math.min(newGapIdx, totalBlocks - 1));

        if (newGapIdx === gap) {
          // No change — restore rendered position via recompute
          recompute();
          return;
        }

        const newGaps   = currGaps.map((g) => (g === gap ? newGapIdx : g)).sort((a, b) => a - b);
        const newLocked = currLocked.filter((g) => g !== gap);
        if (!newLocked.includes(newGapIdx)) newLocked.push(newGapIdx);

        setSplitRef.current(newGaps, newLocked);
      }
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ── Keyboard (accessibility) ──────────────────────────────────────────────────
  // Move the split point one block up/down, or delete it, without a mouse.
  function moveGapByBlocks(gap: number, delta: number) {
    let totalBlocks = 0;
    editor!.state.doc.forEach(() => totalBlocks++);

    const target = Math.max(1, Math.min(gap + delta, totalBlocks - 1));
    if (target === gap) return;

    const currGaps   = splitGapsRef.current;
    const currLocked = lockedGapsRef.current;

    // Don't collide with an existing divider
    if (currGaps.includes(target)) return;

    const newGaps   = currGaps.map((g) => (g === gap ? target : g)).sort((a, b) => a - b);
    const newLocked = currLocked.filter((g) => g !== gap);
    if (!newLocked.includes(target)) newLocked.push(target);

    setSplitRef.current(newGaps, newLocked);
    setHoveredGap(target); // keep the moved divider highlighted/focused-looking
  }

  function removeGap(gap: number) {
    const ng = splitGapsRef.current.filter((g) => g !== gap);
    const nl = lockedGapsRef.current.filter((g) => g !== gap);
    setSplitRef.current(ng, nl);
  }

  function onChipKeyDown(e: React.KeyboardEvent, gap: number) {
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        moveGapByBlocks(gap, -1);
        break;
      case "ArrowDown":
        e.preventDefault();
        moveGapByBlocks(gap, 1);
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        removeGap(gap);
        break;
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {splitGaps.map((gap, idx) => {
        const y = positions.get(gap);
        if (y === undefined) return null;

        const { above, below } = segmentChars(editor, gap, splitGaps);
        const overflow  = above > limit || below > limit;
        const msgNum    = idx + 2;
        const accent    = overflow ? "var(--danger)" : "var(--accent)";
        const hovered     = hoveredGap === gap;
        const showDetails = hovered || draggingGap === gap;

        return (
          <div
            key={idx}
            ref={(el) => {
              if (el) divRefs.current.set(gap, el as HTMLDivElement);
              else divRefs.current.delete(gap);
            }}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: y,
              transform: "translateY(-50%)",
              pointerEvents: "none",
              padding: "14px 4px 0",
              transition: animateNextRef.current ? "top 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)" : "none",
            }}
          >
            {/* ── Char counts — hidden until you hover/drag this divider ── */}
            <div
              aria-hidden={!showDetails}
              style={{
                position: "absolute",
                top: -2,
                left: 4,
                right: 4,
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1.2,
                opacity: showDetails ? 1 : 0,
                transform: showDetails ? "translateY(0)" : "translateY(2px)",
                pointerEvents: showDetails ? "auto" : "none",
                transition: "opacity 0.15s ease, transform 0.15s ease",
              }}
            >
              <span
                title={ti("split.charCountAboveHint", { n: msgNum - 1 }) + `: ${above.toLocaleString("ru")} / ${limit.toLocaleString("ru")}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 8px",
                  borderRadius: 6,
                  backgroundColor: above > limit ? "var(--danger-subtle)" : "var(--bg-surface)",
                  border: `1px solid ${above > limit ? "var(--danger)" : "var(--border-default)"}`,
                  color: above > limit ? "var(--danger)" : "var(--text-secondary)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                }}
              >
                <span aria-hidden="true" style={{ opacity: 0.55 }}>↑</span>
                {ti("split.msgLabel", { n: msgNum - 1 })}
                <CapacityBar value={above} limit={limit} />
              </span>
              <span
                title={ti("split.charCountBelowHint", { n: msgNum }) + `: ${below.toLocaleString("ru")} / ${limit.toLocaleString("ru")}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 8px",
                  borderRadius: 6,
                  backgroundColor: below > limit ? "var(--danger-subtle)" : "var(--bg-surface)",
                  border: `1px solid ${below > limit ? "var(--danger)" : "var(--border-default)"}`,
                  color: below > limit ? "var(--danger)" : "var(--text-secondary)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
                }}
              >
                {ti("split.msgLabel", { n: msgNum })}
                <CapacityBar value={below} limit={limit} />
                <span aria-hidden="true" style={{ opacity: 0.55 }}>↓</span>
              </span>
            </div>

            {/* ── Draggable divider line ─────────────────────────── */}
            <div
              title={t("split.dragHint")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                pointerEvents: "all",
                cursor: "ns-resize",
                userSelect: "none",
                transition: "filter 0.15s ease",
                filter: hovered ? "brightness(1.08) drop-shadow(0 1px 4px rgba(0,0,0,0.25))" : "none",
              }}
              onMouseDown={(e) => startDrag(e, gap)}
              onMouseEnter={() => setHoveredGap(gap)}
              onMouseLeave={() => setHoveredGap((g) => (g === gap ? null : g))}
            >
              <div
                style={{
                  flex: 1,
                  borderTop: `${hovered ? 3 : 2}px dashed ${accent}`,
                  opacity: hovered ? 0.9 : 0.55,
                  transition: "opacity 0.15s ease, border-top-width 0.15s ease",
                }}
              />

              <div
                role="button"
                tabIndex={0}
                aria-label={ti("split.ariaLabel", { n: msgNum })}
                onKeyDown={(e) => onChipKeyDown(e, gap)}
                onFocus={() => setHoveredGap(gap)}
                onBlur={() => setHoveredGap((g) => (g === gap ? null : g))}
                className={overflow ? "split-overflow-pulse" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "3px 10px",
                  borderRadius: 20,
                  flexShrink: 0,
                  cursor: "ns-resize",
                  outline: "none",
                  backgroundColor: overflow ? "var(--danger-subtle)" : "var(--accent-subtle)",
                  border: `1.5px solid ${accent}`,
                  color: accent,
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  boxShadow: hovered ? `0 0 0 3px var(--accent-subtle)` : "none",
                  transition: "box-shadow 0.15s ease",
                }}
              >
                {/* Grip appears on hover/focus to signal the chip is movable */}
                {hovered ? <GripHorizontal size={12} /> : <Scissors size={11} />}
                {ti("split.msgLabel", { n: msgNum })}
                {overflow && " ⚠"}
              </div>

              <div
                style={{
                  flex: 1,
                  borderTop: `${hovered ? 3 : 2}px dashed ${accent}`,
                  opacity: hovered ? 0.9 : 0.55,
                  transition: "opacity 0.15s ease, border-top-width 0.15s ease",
                }}
              />

              {/* Delete button — tucked away until you hover, to keep the calm state calm */}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => {
                  const ng = splitGapsRef.current.filter((g) => g !== gap);
                  const nl = lockedGapsRef.current.filter((g) => g !== gap);
                  setSplitRef.current(ng, nl);
                }}
                title={t("split.delete")}
                style={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 2,
                  borderRadius: 4,
                  color: "var(--text-muted)",
                  opacity: hovered ? 1 : 0,
                  transition: "opacity 0.15s ease, color 0.15s ease",
                }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.color = "var(--danger)")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")
                }
              >
                <X size={13} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
