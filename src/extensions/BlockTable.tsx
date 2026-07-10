import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Grid3x3, PaintBucket } from "lucide-react";
import { TableSizePicker } from "@/components/editor/TableSizePicker";
import { t } from "@/lib/i18n";

// Rich Messages only (Bot API 10.1's RichBlockTable/RichBlockTableCell) —
// normal/Telegraph publish modes have no table concept at all and drop this
// block on convert (see htmlConverter.ts / telegraphConverter.ts).

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
