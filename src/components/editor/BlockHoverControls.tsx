import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import type { Editor } from "@tiptap/react";
import { GripVertical, Plus, MoreHorizontal, ChevronUp, ChevronDown } from "lucide-react";
import {
  getBlockAtY, getBlockEl, getBlockRect, getBlockEndRect, getNestedDropInfo,
  listBlocks, setGapBefore, clearGap, clearGapTransitions, collapseBlockFootprint, restoreBlockFootprint,
  getEditorScrollContainer, createAutoScroller, createDropIndicatorLine,
  createContainerHighlighter, snapshotBlockRects, createGhostFollower, flipSettle, type GapRef, type NestedDropInfo,
} from "@/lib/blockGeometry";
import { t } from "@/lib/i18n";
import { Tooltip } from "@/components/ui/Tooltip";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { moveCurrentBlock } from "@/extensions/BlockMoveShortcuts";

interface BlockHoverControlsProps {
  editor: Editor;
  onOpenMenu: (blockPos: number, x: number, y: number) => void;
  /** False while this editor instance is hidden behind another mobile tab.
   * The controls portal to document.body, so they must be torn down
   * explicitly here instead of relying on a display:none ancestor. */
  active?: boolean;
}

const DRAG_THRESHOLD = 5;
const HIDE_DELAY = 350;
// Caps how tall/wide the drag ghost can render — an image/video (or a
// multi-image collage) block clones at its full natural size otherwise,
// which can easily span several hundred px in both directions and blot out
// the exact drop-target area the user is trying to look at while dragging.
// Cropped, not scaled: shrinking a wide image proportionally would also
// shrink its on-screen footprint unevenly (aspect ratio vs. the cap), so
// each axis is clipped independently instead — same fade treatment on
// whichever edge(s) actually get cut.
const MAX_GHOST_HEIGHT = 120;
const MAX_GHOST_WIDTH = 260;

const btnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  borderRadius: 5,
  color: "var(--text-muted)",
  background: "transparent",
  border: "none",
  cursor: "pointer",
};

// Mobile tap targets — 22px (desktop) is well under the ~40px minimum a
// finger can reliably hit; also gets a visible background (not just an
// icon on transparent) since there's no hover state to reveal a button's
// clickable bounds on touch.
const mobileBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 40,
  height: 40,
  borderRadius: 8,
  color: "var(--text-secondary)",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-subtle)",
  cursor: "pointer",
};

// Grabbing the real block's DOM node and cloning it gives a faithful "lifted
// card" ghost for any block type (heading, image, poll, …) without needing
// per-type preview logic — it's inert (contentEditable=false, no pointer
// events) so it never fights the real document for input.
function makeGhost(sourceEl: HTMLElement, rect: DOMRect): HTMLDivElement {
  const ghostWidth = Math.min(rect.width, MAX_GHOST_WIDTH);
  const wrap = document.createElement("div");
  wrap.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    width: ${ghostWidth}px;
    max-height: ${MAX_GHOST_HEIGHT}px;
    overflow: hidden;
    pointer-events: none;
    z-index: 9999;
    opacity: 0.92;
    background: var(--bg-surface);
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0,0,0,0.22);
    padding: 2px 10px;
  `;
  const clone = sourceEl.cloneNode(true) as HTMLElement;
  clone.contentEditable = "false";
  clone.style.pointerEvents = "none";
  wrap.appendChild(clone);

  // A hard clip (via overflow:hidden above) looks like the content is
  // abruptly cut off mid-block for anything taller than the cap — a soft
  // fade at the bottom reads as "there's more below" instead of "this is
  // broken", and costs nothing when the block is already shorter than the
  // cap (rect.height <= MAX_GHOST_HEIGHT just leaves empty space it fades
  // into).
  if (rect.height > MAX_GHOST_HEIGHT) {
    const fade = document.createElement("div");
    fade.style.cssText = `
      position: absolute;
      left: 0; right: 0; bottom: 0;
      height: 32px;
      background: linear-gradient(to bottom, transparent, var(--bg-surface));
      pointer-events: none;
    `;
    wrap.appendChild(fade);
  }

  // Same soft-edge treatment as the bottom fade above, but for a block wide
  // enough to clip horizontally (a full-width banner image, a wide table…).
  if (rect.width > MAX_GHOST_WIDTH) {
    const fadeRight = document.createElement("div");
    fadeRight.style.cssText = `
      position: absolute;
      top: 0; right: 0; bottom: 0;
      width: 32px;
      background: linear-gradient(to right, transparent, var(--bg-surface));
      pointer-events: none;
    `;
    wrap.appendChild(fadeRight);
  }

  document.body.appendChild(wrap);
  return wrap;
}

export function BlockHoverControls({ editor, onOpenMenu, active = true }: BlockHoverControlsProps) {
  const isMobile = useIsMobileLayout();
  const keyboardInset = useKeyboardInset();
  const [hoverPos, setHoverPos] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Right-side "⋯" trigger only: the actual rendered text's end (Range API)
  // for plain-text blocks, so it lands next to the visible text instead of
  // the block's full-width invisible bounding box. `rect` (block bounding
  // box) still drives the left grip/add controls and drag/reflow sizing.
  const [endRect, setEndRect] = useState<DOMRect | null>(null);
  const hoverPosRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const overControlsRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setHover(pos: number | null, r: DOMRect | null, er: DOMRect | null) {
    hoverPosRef.current = pos;
    setHoverPos(pos);
    setRect(r);
    setEndRect(er);
  }

  function cancelHide() {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
  }
  function scheduleHide() {
    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      if (!draggingRef.current && !overControlsRef.current) setHover(null, null, null);
    }, HIDE_DELAY);
  }

  // ── Track which block is hovered (desktop) / tapped (mobile) ───────────────
  // Mouse hover has no touch equivalent at all — mousemove/mouseleave simply
  // never fire on a real tap. Mobile gets its own branch: a tap resolves the
  // block the same way (getBlockAtY on the tap's Y), but the panel then
  // stays open (no HIDE_DELAY timer — nothing to "leave") until the next tap
  // either selects a different block or lands outside any block (closes).
  useEffect(() => {
    // Not the visible tab (mobile Editor/Preview/Publish switcher) — nothing
    // to track, and any stale hover from before the tab switch must be
    // cleared since the portal would otherwise keep floating over whichever
    // tab is now showing.
    if (!active) { setHover(null, null, null); return; }

    const view = editor.view;

    if (isMobile) {
      function onClick(e: MouseEvent) {
        const pos = getBlockAtY(view, e.clientY);
        if (pos === null) { setHover(null, null, null); return; }
        setHover(pos, getBlockRect(view, pos), getBlockEndRect(view, pos));
      }
      view.dom.addEventListener("click", onClick);
      return () => view.dom.removeEventListener("click", onClick);
    }

    function onMouseMove(e: MouseEvent) {
      if (draggingRef.current) return;
      const pos = getBlockAtY(view, e.clientY);
      if (pos === null) { scheduleHide(); return; }
      cancelHide();
      setHover(pos, getBlockRect(view, pos), getBlockEndRect(view, pos));
    }
    function onMouseLeave() {
      if (!draggingRef.current) scheduleHide();
    }

    view.dom.addEventListener("mousemove", onMouseMove);
    view.dom.addEventListener("mouseleave", onMouseLeave);
    return () => {
      view.dom.removeEventListener("mousemove", onMouseMove);
      view.dom.removeEventListener("mouseleave", onMouseLeave);
      cancelHide();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, isMobile, active]);

  // ── Keep the controls glued to the hovered block as it grows/shrinks —
  // without this, typing into a block (without moving the mouse) leaves the
  // "⋯"/grip stuck at their pre-edit position, drifting away from the text
  // the user is actually looking at.
  useEffect(() => {
    function onUpdate() {
      if (hoverPosRef.current === null || draggingRef.current) return;
      const r = getBlockRect(editor.view, hoverPosRef.current);
      if (r) {
        setRect(r);
        setEndRect(getBlockEndRect(editor.view, hoverPosRef.current));
      } else {
        setHover(null, null, null); // the hovered block no longer exists (e.g. deleted)
      }
    }
    editor.on("update", onUpdate);
    return () => { editor.off("update", onUpdate); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ── "+" — duplicate this block, inserting the copy right after it ──────
  // Was "insert an empty paragraph below"; same insertion point, but now
  // clones the hovered block's own content instead (matches the "⋯" menu's
  // duplicateBlock in EditorContextMenu.tsx).
  function handleAddClick() {
    if (hoverPos === null) return;
    const view = editor.view;
    const node = view.state.doc.nodeAt(hoverPos);
    if (!node) return;
    const insertAt = hoverPos + node.nodeSize;
    editor.chain().focus().insertContentAt(insertAt, node.toJSON()).run();
  }

  // ── "⋯" — open the block actions menu (replaces the old right-click trigger) ─
  function handleMenuClick(e: React.MouseEvent) {
    if (hoverPos === null) return;
    onOpenMenu(hoverPos, e.currentTarget.getBoundingClientRect().right, e.currentTarget.getBoundingClientRect().top);
  }

  // ── Mobile move up/down — replaces the grip/drag entirely on touch (see
  // this file's tap-tracking effect above: the grip is invisible without
  // hover in the first place, and a touch-drag would have the finger
  // covering the exact drop target it's aiming for). Reuses
  // moveCurrentBlock's existing selection-based move — tapping a block
  // already placed the text cursor there via native contentEditable
  // behavior, so no extra positioning logic is needed here.
  function handleMoveUp() { moveCurrentBlock(editor, -1); }
  function handleMoveDown() { moveCurrentBlock(editor, 1); }

  // ── Grip — drag to reorder ───────────────────────────────────────────────
  function handleGripPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || hoverPos === null) return;
    e.preventDefault();
    e.stopPropagation();

    const view = editor.view;
    const fromPos = hoverPos;
    const originEl = getBlockEl(view, fromPos);
    if (!originEl) return;

    const originRect = originEl.getBoundingClientRect();
    // Clamped to the ghost's own visual cap (see makeGhost/MAX_GHOST_HEIGHT)
    // — grabbing low on a tall image and using the UNCLAMPED offset would
    // position the now-shorter ghost far from the cursor instead of under it.
    // draggedHeight stays the block's real height: it drives the reflow gap
    // opened elsewhere in this drag, which must match what's actually moving.
    const grabOffsetY = Math.min(e.clientY - originRect.top, MAX_GHOST_HEIGHT);
    const draggedHeight = originRect.height;
    const draggedNode = view.state.doc.nodeAt(fromPos);
    const endPos = fromPos + (draggedNode?.nodeSize ?? 0);
    // Dropping inside the dragged node's own interior (e.g. a quote
    // containing other blocks) makes no sense and would corrupt the
    // document — resolveNestedDrop skips recursing into this range.
    const excludeRange = { from: fromPos, to: endPos };

    const startX = e.clientX;
    const startY = e.clientY;
    let hasMoved = false;
    draggingRef.current = true;

    const ghost = makeGhost(originEl, originRect);
    ghost.style.top = `${originRect.top}px`;
    // Ghost chases the cursor with a slight lag instead of snapping 1:1 —
    // see createGhostFollower's doc comment.
    const ghostFollower = createGhostFollower((_x, y) => { ghost.style.top = `${y}px`; }, { x: 0, y: originRect.top });
    ghostFollower.start();

    // Collapsing the origin's real footprint (not just fading it) makes every
    // later block reflow up on its own via the browser's normal layout — see
    // `collapseBlockFootprint`'s doc comment for why a cosmetic offset can't
    // do this correctly. Snapshotting rects *after* collapsing means every
    // drop-target decision for the rest of this drag is based on the layout
    // with the origin already gone, matching what the user actually sees.
    collapseBlockFootprint(originEl);
    const snapshot = snapshotBlockRects(view);

    const dropLine = createDropIndicatorLine();
    const containerHighlighter = createContainerHighlighter();
    let gapRef: GapRef | null = null;

    function applyShift(clientX: number, clientY: number) {
      const info = getNestedDropInfo(view, clientX, clientY, snapshot, excludeRange);
      // Mutually exclusive signals: the line means "between these two
      // top-level blocks", the container ring means "inside this one" —
      // showing both at once for a container drop was exactly what made it
      // unclear which one would actually happen.
      dropLine.update(info?.container ? null : info);
      containerHighlighter.update(info?.container?.el ?? null);
      if (!info || info.pos === fromPos || info.pos === endPos) {
        clearGap(gapRef);
        gapRef = null;
        return;
      }
      const blocks = listBlocks(view, info.scope).map((b) => b.el);
      const beforeEl = blocks[info.gapIndex] ?? null;
      gapRef = setGapBefore(gapRef, beforeEl, blocks, draggedHeight);
    }

    function clearShifts() {
      clearGap(gapRef);
      clearGapTransitions();
      gapRef = null;
      dropLine.update(null);
      containerHighlighter.update(null);
    }

    const scrollEl = getEditorScrollContainer(view);
    let lastClientX = startX;
    const scroller = createAutoScroller(scrollEl, (y) => applyShift(lastClientX, y));

    function onPointerMove(ev: PointerEvent) {
      if (!hasMoved) {
        if (Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
        hasMoved = true;
        document.body.style.cursor = "grabbing";
        scroller.start();
      }
      ghostFollower.setTarget(0, ev.clientY - grabOffsetY);
      lastClientX = ev.clientX;
      scroller.update(ev.clientY);
      applyShift(ev.clientX, ev.clientY);
    }

    function onPointerUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "";
      draggingRef.current = false;
      scroller.stop();
      ghostFollower.stop();

      clearShifts();
      dropLine.remove();
      ghost.remove();
      restoreBlockFootprint(originEl!);

      if (hasMoved) {
        const info: NestedDropInfo | null = getNestedDropInfo(view, ev.clientX, ev.clientY, undefined, excludeRange);
        const node = draggedNode;
        if (info && node) {
          const nodeSize = node.nodeSize;
          if (info.pos !== fromPos && info.pos !== endPos) {
            let insertAt = info.pos > fromPos ? info.pos - nodeSize : info.pos;
            const maxInsert = view.state.doc.content.size - nodeSize;
            insertAt = Math.max(0, Math.min(insertAt, maxInsert));
            try {
              flipSettle(view, () => {
                view.dispatch(view.state.tr.delete(fromPos, endPos).insert(insertAt, node));
                view.focus();
              });
            } catch { /* invalid position, doc changed mid-drag — skip */ }
          }
        }
      }

      setHover(null, null, null);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  const visible = hoverPos !== null && rect !== null;

  // Mobile: one row (duplicate/move-up/move-down/menu) instead of desktop's
  // two mouse-anchored clusters — clamped inside the viewport instead of
  // `left: rect.left - 52`, which routinely put the desktop cluster
  // off-screen to the left on a narrow phone.
  const MOBILE_PANEL_WIDTH = 4 * 40 + 3 * 6 + 12;
  const MOBILE_PANEL_HEIGHT = 40 + 12;
  const mobileLeft = rect
    ? Math.max(8, Math.min(rect.left, window.innerWidth - MOBILE_PANEL_WIDTH - 8))
    : 0;
  // Clamped against the keyboard-occluded bottom edge too, not just the top —
  // `rect.top` is a layout-viewport coordinate that knows nothing about the
  // on-screen keyboard shrinking the visible area, so tapping a block near
  // the bottom of a short document used to place this panel half-hidden
  // behind the keyboard instead of above it.
  const visibleBottom = window.innerHeight - keyboardInset;
  const MOBILE_GAP = 8;
  // Fully above or fully below the tapped block, never overlapping it — the
  // old fixed "-48px" offset covered the top few px of short blocks (single
  // line of text) instead of floating clear of them. Falls back to below
  // the block when there isn't room above (block sits near the top edge).
  const mobileTop = rect
    ? rect.top - MOBILE_PANEL_HEIGHT - MOBILE_GAP >= 8
      ? Math.max(8, rect.top - MOBILE_PANEL_HEIGHT - MOBILE_GAP)
      : Math.min(rect.bottom + MOBILE_GAP, visibleBottom - MOBILE_PANEL_HEIGHT - 8)
    : 0;

  return createPortal(
    <AnimatePresence>
      {visible && rect && isMobile && (
        <motion.div
          key="block-tap-controls"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.12 }}
          style={{
            position: "fixed",
            top: mobileTop,
            left: mobileLeft,
            display: "flex",
            gap: 6,
            padding: 6,
            borderRadius: 10,
            backgroundColor: "var(--bg-surface)",
            border: "1px solid var(--border-default)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            zIndex: 200,
          }}
        >
          <button type="button" title={t("context.duplicate")} style={mobileBtnStyle} onClick={handleAddClick}>
            <Plus size={17} />
          </button>
          <button type="button" title={t("block.moveUp")} style={mobileBtnStyle} onClick={handleMoveUp}>
            <ChevronUp size={17} />
          </button>
          <button type="button" title={t("block.moveDown")} style={mobileBtnStyle} onClick={handleMoveDown}>
            <ChevronDown size={17} />
          </button>
          <button type="button" title={t("block.actions")} style={mobileBtnStyle} onClick={handleMenuClick}>
            <MoreHorizontal size={17} />
          </button>
        </motion.div>
      )}

      {visible && rect && !isMobile && (
        <motion.div
          key="block-hover-controls"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.12 }}
          onMouseEnter={() => { overControlsRef.current = true; cancelHide(); }}
          onMouseLeave={() => { overControlsRef.current = false; scheduleHide(); }}
        >
          <div
            style={{
              position: "fixed",
              top: rect.top + Math.max(0, (rect.height - 22) / 2),
              left: rect.left - 52,
              display: "flex",
              gap: 2,
              zIndex: 200,
            }}
          >
            <Tooltip content={t("context.duplicate")} delay={300}>
              <button
                type="button"
                style={btnStyle}
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleAddClick}
              >
                <Plus size={13} />
              </button>
            </Tooltip>
            <button
              type="button"
              title={t("block.drag")}
              style={{ ...btnStyle, cursor: "grab" }}
              onPointerDown={handleGripPointerDown}
            >
              <GripVertical size={14} />
            </button>
          </div>

          {/* Anchored to the END of the actual rendered content, not the
              block's full-width bounding box: for plain text (paragraph/
              heading/lists) endRect is the real text's last line (Range
              API), so a short line doesn't leave the trigger stranded far
              to the right in empty space. Boxed blocks (quote/poll/etc.)
              keep using the block rect, since their visible border already
              spans that width. Also bottom-anchored, not vertically
              centered, so it tracks the end of a growing block instead of
              the visual middle. */}
          <div
            style={{
              position: "fixed",
              top: (endRect ?? rect).bottom - 22,
              left: (endRect ?? rect).right + 6,
              zIndex: 200,
            }}
          >
            <button
              type="button"
              title={t("block.actions")}
              style={btnStyle}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleMenuClick}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
