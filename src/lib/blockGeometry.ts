import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface BlockRef {
  pos: number;
  el: HTMLElement;
}

// A "scope" is whatever node's direct children we're currently iterating —
// either the top-level document (the default everywhere) or, for the nested
// drag-into-quote feature, a blockquote/callout's own content. `start` is the
// document position of that scope's first child.
export interface BlockScope {
  parent: PMNode;
  start: number;
}

function docScope(view: EditorView): BlockScope {
  return { parent: view.state.doc, start: 0 };
}

/** Iterates a scope's direct children (top-level document by default), resolving each to its DOM element. */
export function forEachBlock(
  view: EditorView,
  cb: (pos: number, el: HTMLElement, node: PMNode) => boolean | void,
  scope?: BlockScope,
) {
  const { parent, start } = scope ?? docScope(view);
  let pos = start;
  for (let i = 0; i < parent.childCount; i++) {
    const node = parent.child(i);
    const raw = view.nodeDOM(pos);
    const el = raw instanceof HTMLElement
      ? raw
      : raw instanceof Node ? (raw as Node).parentElement : null;
    if (el && cb(pos, el, node) === true) break;
    pos += node.nodeSize;
  }
}

export function listBlocks(view: EditorView, scope?: BlockScope): BlockRef[] {
  const out: BlockRef[] = [];
  forEachBlock(view, (pos, el) => { out.push({ pos, el }); }, scope);
  return out;
}

/** Finds the top-level block position under the mouse (Y coordinate only). */
export function getBlockAtY(view: EditorView, clientY: number): number | null {
  let found: number | null = null;
  forEachBlock(view, (pos, el) => {
    const r = el.getBoundingClientRect();
    if (clientY >= r.top - 8 && clientY <= r.bottom + 8) {
      found = pos;
      return true;
    }
  });
  return found;
}

export function getBlockRect(view: EditorView, pos: number): DOMRect | null {
  let rect: DOMRect | null = null;
  forEachBlock(view, (p, el) => {
    if (p === pos) { rect = el.getBoundingClientRect(); return true; }
  });
  return rect;
}

export function getBlockEl(view: EditorView, pos: number): HTMLElement | null {
  let found: HTMLElement | null = null;
  forEachBlock(view, (p, el) => {
    if (p === pos) { found = el; return true; }
  });
  return found;
}

// Plain text-flow node types have no visible border/background of their own
// — their DOM element still spans the full editor width regardless of how
// short the actual text is. Boxed types (quote/poll/callout/image/etc.) DO
// visually render a border/background across their full rendered width, so
// anchoring UI to their own bounding rect looks connected either way.
const PLAIN_TEXT_NODE_TYPES = new Set(["paragraph", "heading", "bulletList", "orderedList"]);

/**
 * For plain text blocks, returns the actual rendered text's last-line rect
 * (via the Range API) instead of the block element's full-width bounding
 * rect — so UI anchored to "the end of this block" lands right after the
 * visible text instead of far out in blank space. Boxed block types (or a
 * block with no text yet) fall back to the block's own bounding rect.
 */
export function getBlockEndRect(view: EditorView, pos: number): DOMRect | null {
  const node = view.state.doc.nodeAt(pos);
  const el = getBlockEl(view, pos);
  if (!el) return null;
  if (!node || !PLAIN_TEXT_NODE_TYPES.has(node.type.name)) return el.getBoundingClientRect();

  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = range.getClientRects();
  if (rects.length === 0) return el.getBoundingClientRect();
  return rects[rects.length - 1];
}

export interface DropInfo {
  pos: number;
  gapIndex: number;
  /** Viewport position/extent of the seam between the two blocks the drop targets — for a visible insertion line. */
  lineY: number;
  lineLeft: number;
  lineWidth: number;
}

const INDICATOR_GAP = 8;

export interface BlockRect { top: number; bottom: number; left: number; right: number; width: number }
export type BlockRectSnapshot = Map<HTMLElement, BlockRect>;

/**
 * Captures every block's current layout rect — recursing into any
 * blockquote/callout's own children too — before a drag begins. Feed the
 * result into `getDropInfo`/`getNestedDropInfo` for the whole drag so the
 * drop-target decision always reads pristine, pre-drag layout instead of a
 * rect the drag's own reflow preview has since transformed.
 *
 * Two different bugs come from reading live rects during the drag instead:
 * a feedback loop (shifting a block moves its rect, which can flip the very
 * decision that shifted it) and, worse, a live rect read mid-transition
 * reflects whatever position the CSS animation has interpolated to *right
 * now*, not the shift's actual target — both show up as blocks visibly
 * blinking, especially on quick back-and-forth movements. A one-time
 * snapshot sidesteps both: nothing else changes real document layout while a
 * drag preview is active, so it stays valid for the whole gesture.
 */
export function snapshotBlockRects(view: EditorView): BlockRectSnapshot {
  const map: BlockRectSnapshot = new Map();
  function walk(scope: BlockScope) {
    forEachBlock(view, (pos, el, node) => {
      const r = el.getBoundingClientRect();
      map.set(el, { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width });
      if (NESTABLE_CONTAINER_TYPES.has(node.type.name)) {
        walk({ parent: node, start: pos + 1 });
      }
    }, scope);
  }
  walk(docScope(view));
  return map;
}

/**
 * Resolves a Y coordinate to both a drop-in position and a "gap index"
 * (0 = before the first block, N = after the last) — the gap index is what
 * the drag-reflow preview uses to decide which blocks should visually shift.
 * Top-level only — used for reordering an existing block via its grip handle,
 * which never targets a nested position. See `getNestedDropInfo` for the
 * block-palette insertion path, which can also target inside a quote.
 *
 * `snapshot` should be `snapshotBlockRects(view)` taken once at drag start —
 * see its doc comment for why a live rect isn't safe to use here.
 */
export function getDropInfo(view: EditorView, clientY: number, snapshot?: BlockRectSnapshot): DropInfo | null {
  const doc = view.state.doc;
  if (!doc.childCount) return null;

  let pos = 0;
  let resultPos: number | null = null;
  let resultGap = doc.childCount;
  let lineY = 0, lineLeft = 0, lineWidth = 0;
  let prevRect: { bottom: number; left: number; width: number } | null = null;

  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const raw = view.nodeDOM(pos);
    const el = raw instanceof HTMLElement
      ? raw
      : raw instanceof Node ? (raw as Node).parentElement : null;

    if (el) {
      const r = snapshot?.get(el) ?? el.getBoundingClientRect();

      if (clientY < r.top + (r.bottom - r.top) / 2) {
        resultPos = pos;
        resultGap = i;
        lineY = prevRect ? (prevRect.bottom + r.top) / 2 : r.top - INDICATOR_GAP;
        lineLeft = r.left;
        lineWidth = r.width;
        break;
      }
      resultPos = pos + node.nodeSize;
      resultGap = i + 1;
      prevRect = { bottom: r.bottom, left: r.left, width: r.width };
    }
    pos += node.nodeSize;
  }

  if (resultPos === null) return null;
  if (resultGap === doc.childCount && prevRect) {
    lineY = prevRect.bottom + INDICATOR_GAP;
    lineLeft = prevRect.left;
    lineWidth = prevRect.width;
  }

  return { pos: resultPos, gapIndex: resultGap, lineY, lineLeft, lineWidth };
}

// Container types whose interior is a valid, sensible drop target — every
// registered block type structurally fits (all are `group: "block"`, matching
// blockquote/callout's `content: "block+"`), but only these two are containers
// a user would actually want to drop something INTO (as opposed to a poll,
// image, etc., which are leaves). Also used by BlockMoveShortcuts.ts's
// one-level-at-a-time Backspace override for the same two container types.
export const NESTABLE_CONTAINER_TYPES = new Set(["blockquote", "callout"]);

export interface NestedDropInfo {
  pos: number;
  gapIndex: number;
  /** The container's own document position and DOM element, or null for a top-level drop. */
  container: { pos: number; el: HTMLElement } | null;
  scope: BlockScope;
  lineY: number;
  lineLeft: number;
  lineWidth: number;
}

/**
 * Like `getDropInfo`, but recurses into a blockquote/callout's interior when
 * the pointer is over its own box — used by the block-palette drag so a new
 * block can land INSIDE a quote, not just before/after it as a whole. Needs
 * `clientX` too (not just `clientY`) to confirm the pointer is actually over
 * the container's box (which is narrower than the full editor width) rather
 * than merely at the same height as some unrelated wide content.
 *
 * `snapshot` — see `getDropInfo`'s doc comment; same blinking fix.
 *
 * `excludeRange` — when repositioning a block that's *itself* a container
 * (dragging a quote-with-content via its grip), this stops the search from
 * recursing into the dragged node's own interior (dropping a quote inside
 * itself makes no sense and would corrupt the document). Pass the dragged
 * node's `[pos, pos + nodeSize)` range; irrelevant for the palette's
 * insert-a-new-block case, where nothing being inserted already exists in
 * the document, so it's left undefined there.
 */
export function getNestedDropInfo(
  view: EditorView, clientX: number, clientY: number,
  snapshot?: BlockRectSnapshot,
  excludeRange?: { from: number; to: number },
): NestedDropInfo | null {
  return resolveNestedDrop(view, docScope(view), clientX, clientY, null, snapshot, excludeRange);
}

function resolveNestedDrop(
  view: EditorView,
  scope: BlockScope,
  clientX: number,
  clientY: number,
  container: { pos: number; el: HTMLElement } | null,
  snapshot?: BlockRectSnapshot,
  excludeRange?: { from: number; to: number },
): NestedDropInfo | null {
  const { parent, start } = scope;
  let pos = start;
  let resultPos: number | null = null;
  let resultGap = parent.childCount;
  let lineY = 0, lineLeft = 0, lineWidth = 0;
  let prevRect: { bottom: number; left: number; width: number } | null = null;

  for (let i = 0; i < parent.childCount; i++) {
    const node = parent.child(i);
    const raw = view.nodeDOM(pos);
    const el = raw instanceof HTMLElement
      ? raw
      : raw instanceof Node ? (raw as Node).parentElement : null;

    if (el) {
      const r = snapshot?.get(el) ?? el.getBoundingClientRect();
      const isExcluded = excludeRange !== undefined && pos >= excludeRange.from && pos < excludeRange.to;

      if (
        !isExcluded &&
        NESTABLE_CONTAINER_TYPES.has(node.type.name) &&
        clientX >= r.left && clientX <= r.right &&
        clientY >= r.top && clientY <= r.bottom
      ) {
        const inner = resolveNestedDrop(
          view,
          { parent: node, start: pos + 1 },
          clientX, clientY,
          { pos, el },
          snapshot,
          excludeRange,
        );
        if (inner) return inner;
      }

      if (clientY < r.top + (r.bottom - r.top) / 2) {
        resultPos = pos;
        resultGap = i;
        lineY = prevRect ? (prevRect.bottom + r.top) / 2 : r.top - INDICATOR_GAP;
        lineLeft = r.left;
        lineWidth = r.width;
        break;
      }
      resultPos = pos + node.nodeSize;
      resultGap = i + 1;
      prevRect = { bottom: r.bottom, left: r.left, width: r.width };
    }
    pos += node.nodeSize;
  }

  if (resultPos === null) return null;
  if (resultGap === parent.childCount && prevRect) {
    lineY = prevRect.bottom + INDICATOR_GAP;
    lineLeft = prevRect.left;
    lineWidth = prevRect.width;
  }

  return { pos: resultPos, gapIndex: resultGap, container, scope, lineY, lineLeft, lineWidth };
}

/**
 * Real-reflow drag preview. Two approaches were tried and both failed the
 * same way: `transform: translateY` and `position: relative; top` are both
 * purely cosmetic — they repaint an element somewhere else without changing
 * how much space it reserves in the flow. Every *other* sibling still lays
 * out exactly as if the shifted block had never moved, so the "shifted"
 * blocks visually slide into/over content that hasn't (and can't, without
 * itself being cosmetically offset too) made room, while the true empty
 * space is left stranded whenever the reflowed group doesn't end exactly at
 * the tail of the document — showing up as blocks overlapping, fading
 * (translateY's compositing-layer/grayscale-AA issue), or a gap sized
 * nothing like how far the drag actually went.
 *
 * A margin is a real box-model property: setting one triggers genuine
 * reflow, so every later sibling moves on its own via the browser's normal
 * layout — no per-block bookkeeping, and it never leaves stray space or
 * overlap because the browser (not us) is the one deciding where everything
 * ends up.
 */
export interface GapRef { el: HTMLElement; side: "marginTop" | "marginBottom" }

/** CSS class (defined in tiptap.css) that animates margin-top/-bottom — added
 * to whichever block currently carries the drag-reflow gap so opening/closing
 * it reads as the block visibly sliding away rather than snapping instantly. */
const GAP_TRANSITION_CLASS = "tstudio-drag-gap";

/**
 * Opens a single gap of `amount` px right before `beforeEl` (or after the
 * last of `blocks` when `beforeEl` is null — dropping at the very end of the
 * scope), replacing whatever gap was previously open. Pass `amount <= 0` (or
 * `beforeEl: null` with an empty `blocks`) to just clear it.
 */
export function setGapBefore(
  prev: GapRef | null, beforeEl: HTMLElement | null, blocks: HTMLElement[], amount: number,
): GapRef | null {
  if (prev) prev.el.style[prev.side] = "";
  if (amount <= 0) return null;
  const target = beforeEl ?? blocks[blocks.length - 1];
  if (!target) return null;
  const side: GapRef["side"] = beforeEl ? "marginTop" : "marginBottom";
  target.classList.add(GAP_TRANSITION_CLASS);
  target.style[side] = `${amount}px`;
  return { el: target, side };
}

/** Instantly removes a gap opened by `setGapBefore` — call once on drop/cancel. */
export function clearGap(prev: GapRef | null) {
  if (prev) prev.el.style[prev.side] = "";
}

/**
 * Call once when a drag ends (alongside the final `clearGap`) — strips the
 * transition class off every block it was ever added to during this drag, so
 * a later, unrelated margin change (if any) never inherits an animation it
 * didn't ask for. Safe to call even if nothing was ever tagged.
 */
export function clearGapTransitions() {
  document.querySelectorAll(`.${GAP_TRANSITION_CLASS}`).forEach((el) => el.classList.remove(GAP_TRANSITION_CLASS));
}

/**
 * Collapses a block's own rendered footprint to nothing (real height/margin/
 * padding/border, not a cosmetic offset) so every later sibling reflows up
 * on its own — used to preview "removing" the block being dragged from its
 * origin while a reorder is in progress. `restoreBlockFootprint` undoes it.
 */
export function collapseBlockFootprint(el: HTMLElement) {
  el.style.overflow = "hidden";
  el.style.height = "0px";
  el.style.marginTop = "0px";
  el.style.marginBottom = "0px";
  el.style.paddingTop = "0px";
  el.style.paddingBottom = "0px";
  el.style.borderTopWidth = "0px";
  el.style.borderBottomWidth = "0px";
}

export function restoreBlockFootprint(el: HTMLElement) {
  el.style.overflow = "";
  el.style.height = "";
  el.style.marginTop = "";
  el.style.marginBottom = "";
  el.style.paddingTop = "";
  el.style.paddingBottom = "";
  el.style.borderTopWidth = "";
  el.style.borderBottomWidth = "";
}

const GHOST_CHASE_FACTOR = 0.35;

/**
 * Chases a target x/y with a lerp instead of snapping the dragged ghost
 * element directly onto the cursor every pointermove — gives dragging a
 * slight, deliberate "weight" (Craft/Linear/Notion-style) instead of feeling
 * glued 1:1 to the pointer. Purely feeds the same `left`/`top` fixed-position
 * styling the ghosts already use (see makeGhost in BlockHoverControls.tsx /
 * makeGhostShell in BlockPalette.tsx) — no CSS transform involved, so this
 * doesn't touch the antialiasing/compositing concerns documented on
 * collapseBlockFootprint above (those are about transforming live editor
 * text across many frames; a detached fixed-position clone has no such risk).
 */
export function createGhostFollower(apply: (x: number, y: number) => void, initial: { x: number; y: number }) {
  let targetX = initial.x, targetY = initial.y;
  let curX = initial.x, curY = initial.y;
  let raf: number | null = null;

  function tick() {
    curX += (targetX - curX) * GHOST_CHASE_FACTOR;
    curY += (targetY - curY) * GHOST_CHASE_FACTOR;
    apply(curX, curY);
    raf = requestAnimationFrame(tick);
  }

  return {
    setTarget(x: number, y: number) { targetX = x; targetY = y; },
    start() { if (raf === null) raf = requestAnimationFrame(tick); },
    stop() { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } },
    /** Snaps current position immediately with no chase lag — use once at drag start. */
    snap(x: number, y: number) { targetX = x; targetY = y; curX = x; curY = y; apply(x, y); },
  };
}

/**
 * FLIP-animates the "settle" moment right after a document mutation that
 * moves/removes/inserts a top-level block — e.g. finishing a drag-and-drop
 * reorder or a palette drop. The margin-based gap preview (setGapBefore)
 * only animates the OPENING of space while a drag is in progress; the
 * instant the real transaction lands, ProseMirror re-renders the true DOM
 * in one synchronous snap with no animation of its own — visible as a small
 * jump whenever the final layout doesn't match the drag preview's
 * approximation exactly (a media block's real height vs. the ghost's capped
 * preview height, for instance).
 *
 * Classic First-Last-Invert-Play, keyed by DOM element identity rather than
 * document position (position is exactly what's changing here, so it can't
 * be the key): `snapshotBlockRects` runs BEFORE `mutate()`; ProseMirror
 * reliably reuses the same DOM element for any block whose own content
 * didn't change (only unrelated siblings shifting around it) — which is
 * exactly the set of elements this needs to smooth, since the moved block
 * itself is what the user is already watching move. After `mutate()` runs
 * (real reflow, always correct immediately — nothing here can leave a block
 * in the wrong place even if the animation below is interrupted or
 * skipped), a rAF gives React NodeViews a chance to flush before any
 * element is re-measured, then every snapshotted element still in the
 * document gets inverted (translateY back to its old position, no
 * transition) and immediately released into a transition back to zero —
 * reading as a smooth slide from old position to new.
 *
 * Deliberately scoped to this one-shot settle window, not any live/
 * continuous drag — see collapseBlockFootprint's doc comment for why the
 * two cases are NOT the same antialiasing risk (that's about transforming
 * live, actively-edited text across many frames during interaction; this is
 * a single brief transition landing on already-final, unfocused content).
 */
export function flipSettle(view: EditorView, mutate: () => void) {
  const before = snapshotBlockRects(view);
  mutate();
  requestAnimationFrame(() => {
    before.forEach((oldRect, el) => {
      if (!el.isConnected) return;
      const newRect = el.getBoundingClientRect();
      const deltaY = oldRect.top - newRect.top;
      if (Math.abs(deltaY) < 1) return;
      el.style.transition = "none";
      el.style.transform = `translateY(${deltaY}px)`;
      // Forces layout so the inverted position actually applies before the
      // next frame asks the browser to animate away from it — otherwise
      // both style writes can coalesce into one frame and skip the transition.
      el.getBoundingClientRect();
      requestAnimationFrame(() => {
        el.style.transition = "transform var(--motion-duration-base) var(--motion-ease-spring)";
        el.style.transform = "";
        el.addEventListener("transitionend", () => { el.style.transition = ""; }, { once: true });
      });
    });
  });
}

/** The scrollable canvas around the editor content — `view.dom` itself only sizes to fit its content. */
export function getEditorScrollContainer(view: EditorView): HTMLElement {
  return view.dom.closest<HTMLElement>('[data-tour="editor-content"]') ?? (view.dom as HTMLElement);
}

const AUTO_SCROLL_EDGE = 56;
const AUTO_SCROLL_MAX_SPEED = 14;

/**
 * Keeps scrolling `scrollEl` while the last reported pointer Y stays near its
 * top/bottom edge — drives itself via rAF so it keeps going even while the
 * pointer holds still. `onScroll` re-runs drop-target/reflow calculations,
 * since scrolling moves the document under a fixed clientY without a pointermove event.
 */
export function createAutoScroller(scrollEl: HTMLElement, onScroll?: (clientY: number) => void) {
  let clientY = 0;
  let running = false;

  function tick() {
    if (!running) return;
    const rect = scrollEl.getBoundingClientRect();
    const topGap = clientY - rect.top;
    const bottomGap = rect.bottom - clientY;
    let scrolled = false;
    if (topGap < AUTO_SCROLL_EDGE && scrollEl.scrollTop > 0) {
      scrollEl.scrollTop -= AUTO_SCROLL_MAX_SPEED * (1 - Math.max(0, topGap) / AUTO_SCROLL_EDGE);
      scrolled = true;
    } else if (bottomGap < AUTO_SCROLL_EDGE && scrollEl.scrollTop + scrollEl.clientHeight < scrollEl.scrollHeight) {
      scrollEl.scrollTop += AUTO_SCROLL_MAX_SPEED * (1 - Math.max(0, bottomGap) / AUTO_SCROLL_EDGE);
      scrolled = true;
    }
    if (scrolled) onScroll?.(clientY);
    requestAnimationFrame(tick);
  }

  return {
    update(y: number) { clientY = y; },
    start() { if (!running) { running = true; requestAnimationFrame(tick); } },
    stop() { running = false; },
  };
}

/**
 * A thin accent-colored bar marking exactly where a dragged block will land —
 * positioned from `DropInfo`/`NestedDropInfo`'s `lineY`/`lineLeft`/`lineWidth`.
 * The block-shift preview alone left users guessing where the seam actually
 * was; this makes the drop point unambiguous the same way Notion/Linear do.
 */
export function createDropIndicatorLine() {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-subtle);
    pointer-events: none;
    z-index: 10000;
    display: none;
  `;
  document.body.appendChild(el);

  return {
    update(info: { lineY: number; lineLeft: number; lineWidth: number } | null) {
      if (!info) {
        el.style.display = "none";
        return;
      }
      el.style.display = "block";
      el.style.top = `${info.lineY - 1.5}px`;
      el.style.left = `${info.lineLeft}px`;
      el.style.width = `${info.lineWidth}px`;
    },
    remove() { el.remove(); },
  };
}

/**
 * Outlines whichever nestable container (blockquote/callout) the drag is
 * currently hovering over, so dropping *inside* it reads as an intentional
 * choice rather than a coincidence of cursor height — shared by the palette's
 * insert-new-block drag and the grip's reorder-existing-block drag.
 *
 * Deliberately NOT a background-color swap: a callout's own resting
 * background is already `var(--accent-subtle)` (see BlockCallout.tsx), so
 * tinting it the same color on hover was indistinguishable from "just a
 * callout sitting there" — impossible to tell "will drop inside" from "not
 * hovering it at all". A solid ring + drop shadow reads as an overlay on top
 * of whatever the block already looks like, regardless of its own colors.
 */
export function createContainerHighlighter() {
  let highlighted: HTMLElement | null = null;
  return {
    update(el: HTMLElement | null) {
      if (highlighted === el) return;
      if (highlighted) {
        highlighted.style.outline = "";
        highlighted.style.outlineOffset = "";
        highlighted.style.boxShadow = "";
      }
      if (el) {
        // Outline/box-shadow only — a transform here would blur any live
        // text inside the container (see collapseBlockFootprint's doc
        // comment for the same antialiasing issue), and this box isn't
        // being repositioned, just marked.
        el.style.transition = "outline-color 120ms ease, box-shadow 120ms ease";
        el.style.outline = "2.5px solid var(--accent)";
        el.style.outlineOffset = "3px";
        el.style.boxShadow = "0 0 0 6px color-mix(in srgb, var(--accent) 16%, transparent)";
      }
      highlighted = el;
    },
  };
}
