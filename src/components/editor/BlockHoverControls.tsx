import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { GripVertical, Plus, MoreHorizontal } from "lucide-react";
import {
  getBlockAtY, getBlockEl, getBlockRect, getBlockEndRect, getNestedDropInfo,
  listBlocks, setGapBefore, clearGap, collapseBlockFootprint, restoreBlockFootprint,
  getEditorScrollContainer, createAutoScroller, createDropIndicatorLine,
  createContainerHighlighter, snapshotBlockRects, type GapRef, type NestedDropInfo,
} from "@/lib/blockGeometry";
import { t } from "@/lib/i18n";

interface BlockHoverControlsProps {
  editor: Editor;
  onOpenMenu: (blockPos: number, x: number, y: number) => void;
}

const DRAG_THRESHOLD = 5;
const HIDE_DELAY = 350;

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

// Grabbing the real block's DOM node and cloning it gives a faithful "lifted
// card" ghost for any block type (heading, image, poll, …) without needing
// per-type preview logic — it's inert (contentEditable=false, no pointer
// events) so it never fights the real document for input.
function makeGhost(sourceEl: HTMLElement, rect: DOMRect): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = `
    position: fixed;
    left: ${rect.left}px;
    width: ${rect.width}px;
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
  document.body.appendChild(wrap);
  return wrap;
}

export function BlockHoverControls({ editor, onOpenMenu }: BlockHoverControlsProps) {
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

  // ── Track which block is hovered ────────────────────────────────────────
  useEffect(() => {
    const view = editor.view;

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
  }, [editor]);

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

  // ── "+" — insert an empty paragraph right after this block ─────────────
  function handleAddClick() {
    if (hoverPos === null) return;
    const view = editor.view;
    const node = view.state.doc.nodeAt(hoverPos);
    if (!node) return;
    const insertAt = hoverPos + node.nodeSize;
    const paragraph = view.state.schema.nodes.paragraph.create();
    const tr = view.state.tr.insert(insertAt, paragraph);
    tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)));
    view.dispatch(tr);
    view.focus();
  }

  // ── "⋯" — open the block actions menu (replaces the old right-click trigger) ─
  function handleMenuClick(e: React.MouseEvent) {
    if (hoverPos === null) return;
    onOpenMenu(hoverPos, e.currentTarget.getBoundingClientRect().right, e.currentTarget.getBoundingClientRect().top);
  }

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
    const grabOffsetY = e.clientY - originRect.top;
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
      dropLine.update(info);
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
      ghost.style.top = `${ev.clientY - grabOffsetY}px`;
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
              view.dispatch(view.state.tr.delete(fromPos, endPos).insert(insertAt, node));
              view.focus();
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

  return createPortal(
    <AnimatePresence>
      {visible && rect && (
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
            <button
              type="button"
              title={t("block.addBelow")}
              style={btnStyle}
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleAddClick}
            >
              <Plus size={13} />
            </button>
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
