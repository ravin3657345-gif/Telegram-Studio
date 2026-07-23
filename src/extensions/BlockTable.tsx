import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Grid3x3, PaintBucket } from "lucide-react";
import { TableSizePicker } from "@/components/editor/TableSizePicker";
import { t } from "@/lib/i18n";

// Rich Messages only (Bot API 10.1's RichBlockTable/RichBlockTableCell) —
// normal publish mode has no table concept at all and drops this block on
// convert (see htmlConverter.ts).

function cellContentAt(table: PMNode | undefined, r: number, c: number) {
  if (!table || r >= table.childCount) return undefined;
  const row = table.child(r);
  if (c >= row.childCount) return undefined;
  return row.child(c).content;
}

export function buildTableNode(
  schema: Editor["schema"],
  rows: number,
  cols: number,
  existing?: PMNode,
): PMNode {
  const rowNodes: PMNode[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: PMNode[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push(schema.nodes.tableCell.create({ header: r === 0 }, cellContentAt(existing, r, c)));
    }
    rowNodes.push(schema.nodes.tableRow.create(null, cells));
  }
  return schema.nodes.blockTable.create(null, rowNodes);
}

function resizeTable(editor: Editor, pos: number, node: PMNode, rows: number, cols: number) {
  const newNode = buildTableNode(editor.state.schema, rows, cols, node);
  editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + node.nodeSize, newNode));
}

// Resolves a DOM <td>/<th> element back to its tableCell node's own document
// position (not just a position inside its text content).
function findCellPos(editor: Editor, el: HTMLElement): number | null {
  let pos: number;
  try {
    pos = editor.view.posAtDOM(el, 0);
  } catch {
    return null;
  }
  const $pos = editor.state.doc.resolve(pos);
  for (let d = $pos.depth; d >= 0; d--) {
    if ($pos.node(d).type.name === "tableCell") return $pos.before(d);
  }
  return null;
}

function toggleCellHeader(editor: Editor, cellPos: number) {
  const node = editor.state.doc.nodeAt(cellPos);
  if (!node) return;
  const tr = editor.state.tr.setNodeMarkup(cellPos, undefined, { ...node.attrs, header: !node.attrs.header });
  editor.view.dispatch(tr);
}

// Per-cell gray/normal toggle, as a floating overlay button rather than a
// NodeView on tableCell itself. A React NodeView always wraps its content in
// ReactRenderer's own `<div class="react-renderer">` — harmless for a
// top-level block (an extra div around a div), but fatal for a table cell:
// that div ends up as a DIRECT CHILD OF <tr>, which browsers don't recognize
// as a table cell, breaking the whole grid layout. Keeping tableCell a plain
// schema node (real <td>/<th> straight under <tr>) and overlaying the button
// via the same hover-tracking + portal technique as BlockHoverControls.tsx
// sidesteps the problem entirely.
const TOGGLE_HIDE_DELAY = 250;

function TableCellToggle({ editor, tableEl }: { editor: Editor; tableEl: HTMLElement }) {
  const [hover, setHover] = useState<{ el: HTMLElement; rect: DOMRect } | null>(null);
  const overButtonRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelHide() {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
  }
  // The button is a portal, not a DOM descendant of tableEl — the instant the
  // cursor moves off the cell and onto the button itself, tableEl's own
  // mousemove/mouseleave stop firing (browser hit-testing resolves to the
  // button), so clearing `hover` immediately on every non-cell event made the
  // button vanish right as the user tried to reach it. A short delay (that
  // the button's own onMouseEnter cancels) fixes the flicker — same pattern
  // as BlockHoverControls.tsx's HIDE_DELAY.
  function scheduleHide() {
    cancelHide();
    hideTimerRef.current = setTimeout(() => {
      if (!overButtonRef.current) setHover(null);
    }, TOGGLE_HIDE_DELAY);
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const target = (e.target as HTMLElement)?.closest?.("td, th");
      if (target && tableEl.contains(target)) {
        cancelHide();
        setHover({ el: target as HTMLElement, rect: target.getBoundingClientRect() });
      } else {
        scheduleHide();
      }
    }
    function onLeave() { scheduleHide(); }
    tableEl.addEventListener("mousemove", onMove);
    tableEl.addEventListener("mouseleave", onLeave);
    return () => {
      tableEl.removeEventListener("mousemove", onMove);
      tableEl.removeEventListener("mouseleave", onLeave);
      cancelHide();
    };
  }, [tableEl]);

  if (!hover) return null;
  const isHeader = hover.el.tagName === "TH";

  return createPortal(
    <button
      type="button"
      contentEditable={false}
      title={t("table.toggleHeader")}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => { overButtonRef.current = true; cancelHide(); }}
      onMouseLeave={() => { overButtonRef.current = false; scheduleHide(); }}
      onClick={() => {
        const pos = findCellPos(editor, hover.el);
        if (pos !== null) toggleCellHeader(editor, pos);
      }}
      style={{
        position: "fixed",
        top: hover.rect.top + 2,
        left: hover.rect.right - 17,
        width: 15, height: 15, padding: 0, zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: isHeader ? "var(--accent)" : "var(--bg-surface)",
        border: "1px solid var(--border-default)",
        borderRadius: 3, cursor: "pointer",
        color: isHeader ? "#fff" : "var(--text-muted)",
      }}
    >
      <PaintBucket size={9} />
    </button>,
    document.body,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TableView({ node, editor, getPos }: any) {
  const [showPicker, setShowPicker] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [tableEl, setTableEl] = useState<HTMLElement | null>(null);
  const rows = node.childCount;
  const cols = node.firstChild?.childCount ?? 0;

  useEffect(() => {
    setTableEl(wrapperRef.current?.querySelector("table") ?? null);
  });

  function withPos(fn: (pos: number) => void) {
    const pos = getPos();
    if (typeof pos === "number") fn(pos);
  }

  return (
    <NodeViewWrapper as="div" ref={wrapperRef} style={{ position: "relative", margin: "14px 0 10px" }}>
      <div
        contentEditable={false}
        style={{ position: "absolute", top: -26, left: 0, zIndex: 5 }}
      >
        <button
          type="button"
          onClick={() => setShowPicker((v) => !v)}
          title={t("table.resize")}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            fontSize: 11, color: "var(--text-muted)",
            background: "var(--bg-elevated)", border: "1px solid var(--border-subtle)",
            borderRadius: 6, padding: "2px 7px", cursor: "pointer",
          }}
        >
          <Grid3x3 size={11} /> {rows}×{cols}
        </button>
        {showPicker && (
          <div
            style={{
              position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 30,
              backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-subtle)",
              borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
            }}
          >
            <TableSizePicker
              onPick={(r, c) => {
                withPos((pos) => resizeTable(editor, pos, node, r, c));
                setShowPicker(false);
              }}
            />
          </div>
        )}
      </div>

      {/* Not `as="table"` — the real contentDOM ProseMirror inserts <tr>
          children into is a separate element nested inside whatever this
          renders (see contentDOMElementTag below); making this a <table>
          too would double up the tag. */}
      <NodeViewContent className="tiptap-table-wrapper" />

      {tableEl && <TableCellToggle editor={editor} tableEl={tableEl} />}
    </NodeViewWrapper>
  );
}

// ── Excel-like cell navigation (Tab/Shift-Tab/arrows/Enter) ────────────────
// This table is a from-scratch schema (no @tiptap/extension-table), so none
// of that extension's built-in goToNextCell/arrow handling applies here —
// without this, Tab/arrows just fell through to ProseMirror's generic
// document-order caret movement, which doesn't know about rows/columns at
// all (Tab did nothing, and Up/Down skipped whole cells unpredictably).

interface CellInfo {
  tablePos: number;
  table: PMNode;
  rowIndex: number;
  colIndex: number;
  cellPos: number;
  cellNode: PMNode;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findCurrentCell(state: any): CellInfo | null {
  const { $from } = state.selection;
  let cellDepth = -1;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === "tableCell") { cellDepth = d; break; }
  }
  if (cellDepth < 2) return null;
  const rowDepth = cellDepth - 1;
  const tableDepth = cellDepth - 2;
  if ($from.node(rowDepth).type.name !== "tableRow" || $from.node(tableDepth).type.name !== "blockTable") {
    return null;
  }
  return {
    tablePos: $from.before(tableDepth),
    table: $from.node(tableDepth),
    rowIndex: $from.index(tableDepth),
    colIndex: $from.index(rowDepth),
    cellPos: $from.before(cellDepth),
    cellNode: $from.node(cellDepth),
  };
}

// Document position of the start of (row, col) within a table at tablePos —
// walks sibling node sizes rather than re-resolving through the doc, so it
// works against a table node read from an in-progress transaction too.
function cellAt(tablePos: number, table: PMNode, row: number, col: number): { cellPos: number; cellNode: PMNode } | null {
  if (row < 0 || row >= table.childCount) return null;
  const rowNode = table.child(row);
  if (col < 0 || col >= rowNode.childCount) return null;
  let pos = tablePos + 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  pos += 1;
  for (let c = 0; c < col; c++) pos += rowNode.child(c).nodeSize;
  return { cellPos: pos, cellNode: rowNode.child(col) };
}

// Selects the whole cell's text (not just a caret) — matches how Excel
// highlights a cell's full value when you Tab/arrow into it, ready to
// overtype.
function selectCell(tr: Transaction, cellPos: number, cellNode: PMNode) {
  const start = cellPos + 1;
  tr.setSelection(TextSelection.create(tr.doc, start, start + cellNode.content.size));
}

function createEmptyRow(editor: Editor, cols: number): PMNode {
  const { schema } = editor.state;
  const cells = Array.from({ length: cols }, () => schema.nodes.tableCell.create({ header: false }));
  return schema.nodes.tableRow.create(null, cells);
}

// Moves the selection to just outside the table (above/below), inserting an
// empty paragraph there first if the table is the first/last node in the
// doc — mirrors how other atom-ish blocks in this editor let you escape by
// arrowing past their edge instead of getting stuck inside forever.
//
// Two tables stacked back to back (no paragraph between them — reachable via
// the block-insert "+" button) are a special case within that same "outside
// the table" neighbor check: `before`/`after` isn't a textblock, so the
// generic branch would've inserted a pointless blank paragraph wedged
// between two tables instead of just continuing straight into the next
// table's nearest cell, the same way exiting toward a paragraph continues
// straight into it.
function exitTable(editor: Editor, tr: Transaction, tablePos: number, table: PMNode, dir: 1 | -1) {
  const { schema } = editor.state;
  if (dir === -1) {
    const before = tr.doc.resolve(tablePos).nodeBefore;
    if (before?.type.name === "blockTable") {
      const otherPos = tablePos - before.nodeSize;
      const otherCols = before.child(0).childCount;
      const target = cellAt(otherPos, before, before.childCount - 1, otherCols - 1);
      if (target) { selectCell(tr, target.cellPos, target.cellNode); return; }
    }
    if (before?.isTextblock) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos), -1));
    } else {
      tr.insert(tablePos, schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 1), 1));
    }
  } else {
    const afterPos = tablePos + table.nodeSize;
    const after = tr.doc.resolve(afterPos).nodeAfter;
    if (after?.type.name === "blockTable") {
      const target = cellAt(afterPos, after, 0, 0);
      if (target) { selectCell(tr, target.cellPos, target.cellNode); return; }
    }
    if (after?.isTextblock) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(afterPos), 1));
    } else {
      tr.insert(afterPos, schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve(afterPos + 1), 1));
    }
  }
}

// Reverse of exitTable: approaching the table from an adjacent paragraph via
// Up/Down. Same isolating-boundary problem as handleHorizontal above (see
// its comment) but on the table's own edge instead of a cell's — without
// this, gapcursor parks a visible line next to the table instead of putting
// the caret in the nearest row. Always lands in column 0 — there's no
// "remembered column" to restore when entering fresh from outside.
//
// atEdge used to be a plain `parentOffset === 0/size` check — purely a
// logical-text-position test, blind to how the paragraph actually wraps
// on screen. Live-reported 2026-07-22: arrowing Up from partway through
// (not the literal first character of) a paragraph below the table missed
// this check entirely, so the press fell through to the browser's own
// native caret placement — which isn't ProseMirror-mediated and isn't
// stopped by `isolating`, letting it land the caret at some x-matched spot
// inside the table's rendered DOM instead of a real cell.
// `view.endOfTextblock(dir)` is the ProseMirror-correct fix — it measures
// actual rendered line layout, so it's true only when the caret is on the
// visual first/last line of the block, exactly the condition that should
// trigger "escape to whatever's above/below" regardless of *logical* offset.
//
// Confirmed by a jsdom test crash while building this fix (not just theory):
// `endOfTextblock`'s coordinate measurement can throw outright
// (`getClientRects is not a function` in jsdom's incomplete DOM; some real
// browser edge case near this file's non-standard table NodeView — custom
// contentDOMElementTag, isolating cells — is exactly the kind of DOM shape
// that trips this sort of measurement up) rather than degrading gracefully.
// An uncaught throw inside a keydown handler is a very plausible source of
// the reported corruption itself, not just a missed case — wrapped so a
// measurement failure falls back to the same safe absolute-offset check
// instead of blowing up the keystroke.
function enterTable(editor: Editor, dir: -1 | 1): boolean {
  const { state, view } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1) return false;
  const absoluteEdge = dir === -1 ? $from.parentOffset === 0 : $from.parentOffset === $from.parent.content.size;
  let visualEdge = false;
  try {
    visualEdge = view.endOfTextblock(dir === -1 ? "up" : "down");
  } catch {
    // Measurement failed — fall back to absoluteEdge only, see comment above.
  }
  const atEdge = absoluteEdge || visualEdge;
  if (!atEdge) return false;

  const boundaryPos = dir === -1 ? $from.before(1) : $from.after(1);
  const $boundary = state.doc.resolve(boundaryPos);
  const table = dir === -1 ? $boundary.nodeBefore : $boundary.nodeAfter;
  if (!table || table.type.name !== "blockTable") return false;

  const tablePos = dir === -1 ? boundaryPos - table.nodeSize : boundaryPos;
  const targetRow = dir === -1 ? table.childCount - 1 : 0;
  const target = cellAt(tablePos, table, targetRow, 0);
  if (!target) return false;

  const tr = state.tr;
  selectCell(tr, target.cellPos, target.cellNode);
  editor.view.dispatch(tr);
  return true;
}

// Horizontal counterpart to enterTable above — approaching the table via
// Left/Right from an adjacent paragraph instead of Up/Down. Missed in the
// original fix (live-reported 2026-07-22: ArrowLeft in the paragraph right
// below the table misbehaved the same way Up/Down used to): handleHorizontal
// only ever handles the case where the selection is already inside a cell
// (findCurrentCell), so a press starting outside the table fell straight
// through to gapcursor/the browser default, same isolating-boundary problem
// as the vertical case.
// No endOfTextblock measurement needed here — unlike vertical movement,
// "start of paragraph" (offset 0) and "end of paragraph" (offset ===
// content.size) are unambiguous regardless of visual line-wrapping, so a
// plain parentOffset check is already the correct edge test.
// Landing spot mirrors reading order: Left (dir -1, coming from below) lands
// in the LAST cell of the LAST row — the table's own last position in
// document order; Right (dir 1, coming from above) lands in the FIRST cell
// of the FIRST row.
function enterTableHorizontal(editor: Editor, dir: -1 | 1): boolean {
  const { state } = editor;
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1) return false;
  const atEdge = dir === -1 ? $from.parentOffset === 0 : $from.parentOffset === $from.parent.content.size;
  if (!atEdge) return false;

  const boundaryPos = dir === -1 ? $from.before(1) : $from.after(1);
  const $boundary = state.doc.resolve(boundaryPos);
  const table = dir === -1 ? $boundary.nodeBefore : $boundary.nodeAfter;
  if (!table || table.type.name !== "blockTable") return false;

  const tablePos = dir === -1 ? boundaryPos - table.nodeSize : boundaryPos;
  const cols = table.child(0).childCount;
  const targetRow = dir === -1 ? table.childCount - 1 : 0;
  const targetCol = dir === -1 ? cols - 1 : 0;
  const target = cellAt(tablePos, table, targetRow, targetCol);
  if (!target) return false;

  const tr = state.tr;
  selectCell(tr, target.cellPos, target.cellNode);
  editor.view.dispatch(tr);
  return true;
}

// Tab / Shift-Tab: next/previous cell, row-major, wrapping at row edges.
// Tabbing past the last cell of the last row grows the table by one row
// (finite table, so there's no "next row" to land on already like a real
// spreadsheet — matches the same convention Google Docs/Notion tables use).
// Shift-Tab at the very first cell is a no-op (nothing to move to).
function handleTab(editor: Editor, reverse: boolean): boolean {
  const info = findCurrentCell(editor.state);
  if (!info) return false;
  const { tablePos, table, rowIndex, colIndex } = info;
  const cols = table.child(0).childCount;

  let targetRow = rowIndex;
  let targetCol = colIndex + (reverse ? -1 : 1);
  if (targetCol >= cols) { targetCol = 0; targetRow += 1; }
  if (targetCol < 0) { targetCol = cols - 1; targetRow -= 1; }

  if (targetRow < 0) return true; // Shift-Tab at the first cell — swallow, stay put

  const tr = editor.state.tr;
  if (targetRow >= table.childCount) {
    const insertPos = tablePos + table.nodeSize - 1; // end of table content, after the last row
    tr.insert(insertPos, createEmptyRow(editor, cols));
    const newTable = tr.doc.nodeAt(tablePos);
    const target = newTable && cellAt(tablePos, newTable, targetRow, 0);
    if (target) selectCell(tr, target.cellPos, target.cellNode);
  } else {
    const target = cellAt(tablePos, table, targetRow, targetCol);
    if (!target) return true;
    selectCell(tr, target.cellPos, target.cellNode);
  }
  editor.view.dispatch(tr);
  return true;
}

// ArrowUp/ArrowDown/Enter: move one row up/down, same column — cells are
// single-line (inline* content, no hardBreak paragraphs), so unlike a
// regular textblock there's no "middle of a wrapped line" case to special-
// case; any Up/Down press always means "change row," exactly like Excel.
// At the top/bottom edge it exits the table instead of doing nothing.
function handleVertical(editor: Editor, dir: 1 | -1): boolean {
  const info = findCurrentCell(editor.state);
  if (!info) return false;
  const { tablePos, table, rowIndex, colIndex } = info;
  const targetRow = rowIndex + dir;

  const tr = editor.state.tr;
  if (targetRow < 0 || targetRow >= table.childCount) {
    exitTable(editor, tr, tablePos, table, dir);
  } else {
    const target = cellAt(tablePos, table, targetRow, colIndex);
    if (!target) return false;
    selectCell(tr, target.cellPos, target.cellNode);
  }
  editor.view.dispatch(tr);
  return true;
}

// ArrowLeft/ArrowRight: normal caret movement within a cell's single-line
// text; only at the very start/end of that text does it jump to the
// previous/next cell (same row-major traversal as Tab/Shift-Tab, reusing
// its cell math). Needed because tableCell is `isolating: true` — the
// browser/ProseMirror can't glide the caret across that boundary on their
// own, and without an explicit handler here gapcursor (re-enabled in
// tiptapConfig.ts for atom-block navigation) claims the boundary instead,
// parking a visible gap-cursor line there rather than moving into the next
// cell.
//
// Deliberately doesn't require `empty`: handleVertical/handleTab/Enter all
// land via selectCell(), which selects the *whole* cell's text (Excel-
// style), not a collapsed caret — bailing out on a non-empty selection here
// meant the first Left/Right press after any Up/Down/Tab/Enter skipped this
// handler entirely and fell through to the browser's default range-collapse
// behavior, which doesn't know about the isolating cell boundary and could
// land the caret in an unrelated cell ("sticks to the cell above", live-
// reported 2026-07-22). $from is the selection's left edge and $to its
// right edge — for a collapsed caret they're the same position, so this
// still behaves identically to before in that case.
function handleHorizontal(editor: Editor, dir: 1 | -1): boolean {
  const { $from, $to } = editor.state.selection;
  const edge = dir === -1 ? $from : $to;
  const atEdge = dir === -1 ? edge.parentOffset === 0 : edge.parentOffset === edge.parent.content.size;
  if (!atEdge) return false;

  const info = findCurrentCell(editor.state);
  if (!info) return false;
  const { tablePos, table, rowIndex, colIndex } = info;
  const cols = table.child(0).childCount;

  let targetRow = rowIndex;
  let targetCol = colIndex + dir;
  if (targetCol >= cols) { targetCol = 0; targetRow += 1; }
  if (targetCol < 0) { targetCol = cols - 1; targetRow -= 1; }

  const tr = editor.state.tr;
  if (targetRow < 0 || targetRow >= table.childCount) {
    exitTable(editor, tr, tablePos, table, dir);
  } else {
    const target = cellAt(tablePos, table, targetRow, targetCol);
    if (!target) return false;
    selectCell(tr, target.cellPos, target.cellNode);
  }
  editor.view.dispatch(tr);
  return true;
}

// `header` toggles per-cell gray/bold styling (rendered as <th> vs <td>) —
// independent of row position, via the floating TableCellToggle overlay
// above (tableCell itself stays a plain schema node, no NodeView — see that
// component's comment for why a NodeView here would break table layout).
// New/resized tables still default the first row to header cells (see
// buildTableNode).
export const TableCell = Node.create({
  name: "tableCell",
  content: "inline*",
  isolating: true,
  // Same reasoning as BlockTable's `allowGapCursor: false` — cell-to-cell
  // movement is fully handled by handleTab/handleVertical/handleHorizontal
  // above, gapcursor has no business placing anything at a cell boundary.
  allowGapCursor: false,
  // MUST stay exactly 1000 — do not "round up" this number, see the
  // regression this caused (live-reported 2026-07-22, from a since-reverted
  // 1001): `priority` feeds TWO separate orderings from the SAME sorted
  // list (@tiptap/core's `this.extensions`, priority-descending, ties keep
  // tiptapConfig.ts's array order) — the schema's node registration order
  // (used by ProseMirror to pick a fallback node when auto-filling required
  // content, e.g. a brand-new document's `content: "block+"`) AND, via
  // `.plugins` reversing that same list before a second sort, the keymap
  // plugin order. For a genuine TIE, those two orderings resolve
  // *oppositely* relative to array position; for any two DIFFERENT
  // priorities they agree completely (the reverse cancels out).
  // @tiptap/extension-paragraph also sets `priority: 1000` (not the
  // default 100!) and @tiptap/extension-link's `exitable: true` does too
  // (see below) — 1000 here is a deliberate three-way TIE with both:
  //   - vs paragraph: tiptapConfig.ts registers Paragraph (inside
  //     StarterKit) before BlockTable/TableCell, so the tie's stable sort
  //     keeps paragraph earlier in the SCHEMA's node list — exactly what a
  //     blank document needs to default to a paragraph, not a table.
  //   - vs link: tiptapConfig.ts registers Link before BlockTable/
  //     TableCell too, but the KEYMAP order reverses that same list first,
  //     flipping the tie's relative order — so TableCell's own ArrowRight
  //     handler still runs before Link's `Mark.handleExit` (which
  //     otherwise unconditionally inserts a space and claims the key at
  //     the end of linked text, e.g. a hyperlinked table cell).
  // Bumping this above 1000 breaks the paragraph tie (this extension then
  // unambiguously outranks paragraph in the schema regardless of array
  // position) without meaningfully improving the link race, which the tie
  // already wins. Verified directly — see BlockTable.test.tsx's "doesn't
  // conflict with Link mark's own ArrowRight" describe block AND "a blank
  // document defaults to an empty paragraph, not a table".
  priority: 1000,

  addAttributes() {
    return {
      header: {
        default: false,
        parseHTML: (el) => el.tagName === "TH",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "td" }, { tag: "th", attrs: { header: true } }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [node.attrs.header ? "th" : "td", mergeAttributes({ class: "tiptap-table-cell" }, HTMLAttributes), 0];
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => handleTab(editor, false),
      "Shift-Tab": ({ editor }) => handleTab(editor, true),
      // handleVertical/enterTable both live here (not split across TableCell
      // and BlockTable) on purpose. Each extension's addKeyboardShortcuts
      // becomes its OWN separate ProseMirror keymap() plugin (see
      // @tiptap/core's ExtensionManager `get plugins()`) — there is no single
      // merged keymap object as previously assumed. Two extensions binding
      // the same key are two independent PM plugins whose relative order
      // (and therefore which one gets first refusal) is an unobvious function
      // of extension array position (reversed) + priority-stable-sort +
      // interleaving with StarterKit's bundled Gapcursor plugin — not
      // something worth depending on. Trying both functions from one handler
      // removes the inter-extension race entirely: handleVertical covers
      // "already inside a cell", enterTable covers "approaching from an
      // adjacent block", and they're mutually exclusive by construction
      // (findCurrentCell vs $from.depth === 1) so trying both in sequence is
      // safe.
      ArrowUp: ({ editor }) => handleVertical(editor, -1) || enterTable(editor, -1),
      ArrowDown: ({ editor }) => handleVertical(editor, 1) || enterTable(editor, 1),
      ArrowLeft: ({ editor }) => handleHorizontal(editor, -1) || enterTableHorizontal(editor, -1),
      ArrowRight: ({ editor }) => handleHorizontal(editor, 1) || enterTableHorizontal(editor, 1),
      Enter: ({ editor }) => handleVertical(editor, 1),
      "Shift-Enter": ({ editor }) => handleVertical(editor, -1),
    };
  },
});

export const TableRow = Node.create({
  name: "tableRow",
  content: "tableCell+",

  parseHTML() {
    return [{ tag: "tr" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["tr", mergeAttributes(HTMLAttributes), 0];
  },
});

export const BlockTable = Node.create({
  name: "blockTable",
  group: "block",
  content: "tableRow+",
  isolating: true,
  // `allowGapCursor: false` (a real ProseMirror NodeSpec field, passed
  // through by Node.create same as `isolating` above) tells gapcursor this
  // node is never a valid landing spot. `enterTable`'s own ArrowUp/Down
  // handling now lives on TableCell, not here — see the long comment on
  // TableCell's addKeyboardShortcuts for why splitting it across two
  // extensions was the actual bug.
  //
  // Mechanics of `priority` worth recording, since assumptions about it were
  // wrong on two separate occasions (live debugging, 2026-07-22): each
  // extension's addKeyboardShortcuts becomes its OWN separate ProseMirror
  // keymap() plugin, not one shared merged keymap (see @tiptap/core's
  // ExtensionManager `get plugins()`) — priority governs which plugin wins
  // when several bind the same key. But priority ALSO governs the SCHEMA's
  // node registration order (`this.extensions`, built once, shared by both
  // `.plugins` and `.schema`) — a value that outranks paragraph's own
  // (also non-default!) priority there makes ProseMirror pick THIS node as
  // the fallback when auto-filling a required-but-empty content slot, e.g.
  // a brand-new document. Bumping this past 1000 to "win" the keymap race
  // against @tiptap/extension-link more forcefully caused exactly that: new
  // posts started auto-inserting a 1×1 table instead of an empty paragraph.
  // MUST stay exactly 1000 (a deliberate three-way tie with paragraph AND
  // link) — see TableCell's `priority: 1000` for the full mechanics of why
  // one tie value satisfies both constraints at once.
  allowGapCursor: false,
  priority: 1000,

  parseHTML() {
    return [{ tag: "table" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["table", mergeAttributes({ class: "tiptap-table" }, HTMLAttributes), 0];
  },

  addNodeView() {
    // `NodeViewContent as="table"` only styles the React placeholder — the
    // REAL contentDOM element ProseMirror inserts <tr> children into
    // defaults to a plain <div> unless contentDOMElementTag says otherwise.
    // Without this, the <tr>/<td> elements end up rendered outside of any
    // actual <table>, so the browser gives up on grid/row layout entirely
    // and every cell just stacks as its own full-width block. tableRow/
    // tableCell have no NodeView of their own, so they render as plain real
    // <tr>/<td>/<th> straight from the schema — no extra wrapping divs.
    return ReactNodeViewRenderer(TableView, { contentDOMElementTag: "table" });
  },
});
