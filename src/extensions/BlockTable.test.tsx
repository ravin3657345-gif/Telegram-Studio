// @vitest-environment jsdom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, it, expect, beforeEach } from "vitest";

// jsdom does no real layout and doesn't implement Range.getClientRects /
// getBoundingClientRect at all (confirmed: `"getClientRects" in Range.prototype`
// is false) — calling either throws "not a function" instead of returning an
// empty/zeroed result like a real browser would for an unlaid-out node.
// prosemirror-view's EditorView.endOfTextblock (used by both our own
// enterTable and prosemirror-gapcursor's arrow-key handler) measures via
// exactly these APIs, so without this stub every test touching it crashes
// with an uncaught exception instead of exercising the real "am I on the
// first/last visual line" branch logic.
const zeroRect: DOMRect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() { return this; } };
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => zeroRect;
}
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { useEffect } from "react";
import { createTiptapExtensions } from "@/lib/tiptapConfig";

function Harness({ onReady }: { onReady: (editor: Editor) => void }) {
  const editor = useEditor({ extensions: createTiptapExtensions(), content: "<p></p>" });
  useEffect(() => { if (editor) onReady(editor); }, [editor]);
  return editor ? <EditorContent editor={editor} /> : null;
}

// No `content` option at all — mirrors exactly how PostEditor.tsx calls
// useEditor for a brand-new post (`content: initialContent`, undefined when
// there's nothing to load yet), unlike Harness above which always passes an
// explicit "<p></p>". This is the ONLY way to exercise ProseMirror's
// auto-fill-required-content fallback (doc's `content: "block+"` with
// nothing given), which is precisely what picked `blockTable` over
// `paragraph` in the regression this guards against.
function NoContentHarness({ onReady }: { onReady: (editor: Editor) => void }) {
  const editor = useEditor({ extensions: createTiptapExtensions() });
  useEffect(() => { if (editor) onReady(editor); }, [editor]);
  return editor ? <EditorContent editor={editor} /> : null;
}

// Dispatches a real keydown on the editor's DOM — ProseMirror's keymap plugin
// listens natively, so this exercises the exact same path a real keypress
// takes, rather than calling the handler functions directly.
function press(editor: Editor, key: string, shiftKey = false) {
  editor.view.dom.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
}

// 2x2 table, each cell containing its own label (r0c0, r0c1, r1c0, r1c1) so
// assertions can identify "where am I" from the selected text alone.
function build2x2() {
  return {
    type: "doc",
    content: [{
      type: "blockTable",
      content: [
        { type: "tableRow", content: [
          { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "r0c0" }] },
          { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "r0c1" }] },
        ] },
        { type: "tableRow", content: [
          { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "r1c0" }] },
          { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "r1c1" }] },
        ] },
      ],
    }],
  };
}

function selectedText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to);
}

// Locates a text node by its exact content and returns the position right
// before it — used instead of hand-computed offsets for tables that aren't
// at doc position 0. Manual nodeSize arithmetic for a cell's own position
// (as opposed to a fully-inside-the-content position) turned out to have
// direction-dependent snapping behavior in ProseMirror's TextSelection
// resolution that isn't safe to assume — safer to just ask the doc directly.
function findTextPos(editor: Editor, text: string): number {
  let found: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) found = pos;
  });
  if (found === null) throw new Error(`text not found in doc: ${text}`);
  return found;
}

// Same 2x2 table, sandwiched between two real paragraphs — for exercising
// enter/exit against pre-existing adjacent content, as opposed to the
// table-at-doc-edge cases (where exitTable has to insert a fresh paragraph)
// covered by the describe block above.
function build2x2WithParagraphs() {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "before text" }] },
      {
        type: "blockTable",
        content: [
          { type: "tableRow", content: [
            { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "r0c0" }] },
            { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "r0c1" }] },
          ] },
          { type: "tableRow", content: [
            { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "r1c0" }] },
            { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "r1c1" }] },
          ] },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "after text" }] },
    ],
  };
}

describe("BlockTable — Excel-like cell navigation", () => {
  let editor: Editor;

  beforeEach(async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness onReady={(e) => { editor = e; }} />);
    });
    act(() => {
      editor.commands.setContent(build2x2(), true);
      // Put the caret inside the first cell (r0c0): pos 2 = doc(0) table(1) row(2) cell content start
      editor.commands.setTextSelection(2);
    });
  });

  it("Tab moves to the next cell, selecting its full text", () => {
    act(() => press(editor, "Tab"));
    expect(selectedText(editor)).toBe("r0c1");
  });

  it("Tab at the end of a row wraps to the first cell of the next row", () => {
    act(() => press(editor, "Tab")); // r0c0 -> r0c1
    act(() => press(editor, "Tab")); // r0c1 -> r1c0 (wraps)
    expect(selectedText(editor)).toBe("r1c0");
  });

  it("Shift-Tab moves to the previous cell", () => {
    act(() => press(editor, "Tab")); // r0c0 -> r0c1
    act(() => press(editor, "Tab", true)); // back to r0c0
    expect(selectedText(editor)).toBe("r0c0");
  });

  it("Tab at the very last cell stays put (no-op, doesn't grow the table)", () => {
    const rowsBefore = (editor.state.doc.firstChild as import("@tiptap/pm/model").Node).childCount;
    act(() => press(editor, "Tab")); // r0c0 -> r0c1
    act(() => press(editor, "Tab")); // -> r1c0
    act(() => press(editor, "Tab")); // -> r1c1 (last cell)
    act(() => press(editor, "Tab")); // no-op, stays at r1c1
    const table = editor.state.doc.firstChild as import("@tiptap/pm/model").Node;
    expect(table.childCount).toBe(rowsBefore);
    expect(selectedText(editor)).toBe("r1c1");
  });

  it("ArrowDown moves to the same column, one row down", () => {
    act(() => press(editor, "ArrowDown"));
    expect(selectedText(editor)).toBe("r1c0");
  });

  it("ArrowUp at the top row exits the table into a paragraph above it", () => {
    act(() => press(editor, "ArrowUp"));
    const firstNode = editor.state.doc.firstChild!;
    expect(firstNode.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("ArrowDown at the bottom row exits the table into a paragraph below it", () => {
    act(() => press(editor, "ArrowDown")); // r0c0 -> r1c0 (still inside)
    act(() => press(editor, "ArrowDown")); // r1c0 -> exits below
    const lastNode = editor.state.doc.lastChild!;
    expect(lastNode.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("Enter behaves like ArrowDown (move to the cell below)", () => {
    act(() => press(editor, "Enter"));
    expect(selectedText(editor)).toBe("r1c0");
  });

  it("Shift-Enter behaves like ArrowUp (move to the cell above)", () => {
    act(() => press(editor, "ArrowDown")); // r0c0 -> r1c0
    act(() => press(editor, "Enter", true)); // Shift-Enter back to r0c0
    expect(selectedText(editor)).toBe("r0c0");
  });

  // Regression (live-reported 2026-07-22): ArrowDown/Up/Tab/Enter all land
  // via selectCell(), which selects the whole cell's text — not a collapsed
  // caret. handleHorizontal used to bail out on any non-empty selection, so
  // the first Left/Right press right after a vertical move skipped its own
  // logic entirely and fell through to the browser's default range-collapse
  // behavior, landing the caret in an unrelated cell instead of the
  // intended neighbor.
  it("ArrowRight right after ArrowDown moves to the next cell in the new row, not a stale one", () => {
    act(() => press(editor, "ArrowDown")); // r0c0 -> r1c0 (whole-cell selection)
    act(() => press(editor, "ArrowRight")); // should move r1c0 -> r1c1
    expect(selectedText(editor)).toBe("r1c1");
  });

  it("ArrowLeft right after ArrowDown moves to the previous cell in the new row, not a stale one", () => {
    act(() => press(editor, "Tab"));      // r0c0 -> r0c1
    act(() => press(editor, "ArrowDown")); // r0c1 -> r1c1 (whole-cell selection)
    act(() => press(editor, "ArrowLeft")); // should move r1c1 -> r1c0
    expect(selectedText(editor)).toBe("r1c0");
  });

  // ArrowLeft/Right at the very first/last cell of a row shouldn't just
  // silently do nothing or misplace the caret — same exitTable path as
  // vertical, just from a horizontal press.
  it("ArrowLeft at the very first cell (col 0, row 0) exits the table upward", () => {
    act(() => press(editor, "ArrowLeft"));
    const firstNode = editor.state.doc.firstChild!;
    expect(firstNode.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("ArrowRight at the very last cell (bottom-right) exits the table downward", () => {
    act(() => press(editor, "ArrowDown")); // r0c0 -> r1c0
    act(() => press(editor, "Tab"));       // r1c0 -> r1c1 (collapses selection start; still last col)
    act(() => press(editor, "ArrowRight")); // r1c1, end of row+table -> exits below
    const lastNode = editor.state.doc.lastChild!;
    expect(lastNode.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("ArrowRight at the end of a row (not the last row) wraps to the next row's first cell", () => {
    act(() => press(editor, "Tab"));        // r0c0 -> r0c1
    act(() => press(editor, "ArrowRight")); // end of r0c1 -> wraps to r1c0
    expect(selectedText(editor)).toBe("r1c0");
  });
});

// Real adjacent paragraphs (not the doc-edge, paragraph-gets-inserted case
// above) — this is the exact shape a table "in the middle of a post" has,
// and what live testing 2026-07-22 exercised: arrowing between an existing
// paragraph and the table right next to it, from various caret positions
// within that paragraph's text, not just its literal first/last character.
describe("BlockTable — entering/exiting through existing adjacent paragraphs", () => {
  let editor: Editor;

  beforeEach(async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness onReady={(e) => { editor = e; }} />);
    });
    act(() => {
      editor.commands.setContent(build2x2WithParagraphs(), true);
    });
  });

  it("ArrowDown from the end of the paragraph above enters the table at row 0, col 0", () => {
    act(() => editor.commands.setTextSelection(1 + "before text".length)); // end of "before text"
    act(() => press(editor, "ArrowDown"));
    expect(selectedText(editor)).toBe("r0c0");
  });

  it("ArrowDown from the START of the paragraph above ALSO enters the table (single-line block, no line below within it)", () => {
    act(() => editor.commands.setTextSelection(1)); // start of "before text"
    act(() => press(editor, "ArrowDown"));
    expect(selectedText(editor)).toBe("r0c0");
  });

  it("ArrowDown from the MIDDLE of the paragraph above still enters the table (single line, nowhere else for it to go)", () => {
    act(() => editor.commands.setTextSelection(1 + 3)); // partway into "before text"
    act(() => press(editor, "ArrowDown"));
    expect(selectedText(editor)).toBe("r0c0");
  });

  it("ArrowUp from the START of the paragraph below enters the table at the last row, col 0", () => {
    const doc = editor.state.doc;
    const afterParaStart = doc.content.size - "after text".length - 1;
    act(() => editor.commands.setTextSelection(afterParaStart));
    act(() => press(editor, "ArrowUp"));
    expect(selectedText(editor)).toBe("r1c0");
  });

  it("ArrowUp from the MIDDLE of the paragraph below still enters the table (single line, nowhere else for it to go)", () => {
    const doc = editor.state.doc;
    const afterParaMiddle = doc.content.size - "after text".length - 1 + 3;
    act(() => editor.commands.setTextSelection(afterParaMiddle));
    act(() => press(editor, "ArrowUp"));
    expect(selectedText(editor)).toBe("r1c0");
  });

  it("ArrowUp at the top-left cell exits back into the end of the paragraph above (not a fresh empty one)", () => {
    act(() => editor.commands.setTextSelection(1 + "before text".length + 1 + 1 + 1 + 1)); // r0c0 content start
    act(() => press(editor, "ArrowUp"));
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.textContent).toBe("before text");
    // Exactly two top-level paragraphs total (before/after) — confirms
    // exitTable didn't insert a redundant third one when a real paragraph
    // was already sitting right there.
    expect(editor.state.doc.childCount).toBe(3); // paragraph, table, paragraph
  });

  it("ArrowDown at the bottom-right cell exits forward into the start of the paragraph below (not a fresh empty one)", () => {
    act(() => press(editor, "ArrowDown")); // r0c0 -> r1c0
    act(() => press(editor, "Tab"));       // r1c0 -> r1c1
    act(() => press(editor, "ArrowDown")); // exits below
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.textContent).toBe("after text");
    expect(editor.state.doc.childCount).toBe(3);
  });

  // Horizontal counterpart to the ArrowUp/Down entry tests above (live-
  // reported 2026-07-22: ArrowLeft in the paragraph right below the table
  // misbehaved the same way — enterTable only ever covered Up/Down, Left/
  // Right approaching from outside had no handler at all). Unlike vertical
  // movement, horizontal has exactly ONE unambiguous trigger position per
  // direction: Left only exits/enters at logical offset 0 (there's nowhere
  // left to go within the text), Right only at offset === content.size —
  // anywhere else, Left/Right is just normal within-block caret movement
  // and must NOT enter the table. Landing spot mirrors document/reading
  // order: Left from below lands in the LAST cell, Right from above lands
  // in the FIRST cell.
  it("ArrowLeft from the START (offset 0) of the paragraph below enters the table at the last cell", () => {
    const doc = editor.state.doc;
    const afterParaStart = doc.content.size - "after text".length - 1;
    act(() => editor.commands.setTextSelection(afterParaStart));
    act(() => press(editor, "ArrowLeft"));
    expect(selectedText(editor)).toBe("r1c1");
  });

  it("ArrowLeft from the END of the paragraph below does NOT enter the table — that's still normal within-text movement", () => {
    const doc = editor.state.doc;
    const afterParaEnd = doc.content.size - 1;
    act(() => editor.commands.setTextSelection(afterParaEnd));
    act(() => press(editor, "ArrowLeft"));
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.textContent).toBe("after text");
  });

  it("ArrowLeft from the MIDDLE of the paragraph below does NOT enter the table — normal caret movement only", () => {
    const doc = editor.state.doc;
    const afterParaMiddle = doc.content.size - "after text".length - 1 + 3;
    act(() => editor.commands.setTextSelection(afterParaMiddle));
    act(() => press(editor, "ArrowLeft"));
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.textContent).toBe("after text");
    // jsdom dispatches the keydown but doesn't simulate the browser's native
    // fallback caret movement for a key no plugin claims — the only thing
    // under test here is that our own handlers correctly declined to act
    // (didn't jump into the table), not the resulting offset.
    expect(editor.state.selection.$from.parentOffset).toBe(3);
  });

  it("ArrowRight from the END (offset === length) of the paragraph above enters the table at the first cell", () => {
    act(() => editor.commands.setTextSelection(1 + "before text".length));
    act(() => press(editor, "ArrowRight"));
    expect(selectedText(editor)).toBe("r0c0");
  });

  it("ArrowRight from the START of the paragraph above does NOT enter the table — that's still normal within-text movement", () => {
    act(() => editor.commands.setTextSelection(1)); // start of "before text"
    act(() => press(editor, "ArrowRight"));
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.textContent).toBe("before text");
  });

  it("ArrowRight from the MIDDLE of the paragraph above does NOT enter the table — normal caret movement only", () => {
    act(() => editor.commands.setTextSelection(1 + 3));
    act(() => press(editor, "ArrowRight"));
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.textContent).toBe("before text");
    expect(editor.state.selection.$from.parentOffset).toBe(3);
  });

  it("ArrowLeft at the top-left cell exits back into the end of the paragraph above, same as ArrowUp (not a fresh empty one)", () => {
    act(() => editor.commands.setTextSelection(1 + "before text".length + 1 + 1 + 1 + 1)); // r0c0 content start
    act(() => press(editor, "ArrowLeft"));
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.textContent).toBe("before text");
    expect(editor.state.doc.childCount).toBe(3);
  });

  it("ArrowRight at the bottom-right cell exits forward into the paragraph below, same as ArrowDown (not a fresh empty one)", () => {
    act(() => press(editor, "ArrowDown")); // r0c0 -> r1c0
    act(() => press(editor, "Tab"));       // r1c0 -> r1c1 (last cell)
    act(() => press(editor, "ArrowRight")); // exits below
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.parent.textContent).toBe("after text");
    expect(editor.state.doc.childCount).toBe(3);
  });

  it("entering via ArrowLeft then continuing ArrowLeft moves normally within the table (no re-trigger, no stuck caret)", () => {
    const doc = editor.state.doc;
    const afterParaStart = doc.content.size - "after text".length - 1;
    act(() => editor.commands.setTextSelection(afterParaStart));
    act(() => press(editor, "ArrowLeft")); // enters at r1c1
    act(() => press(editor, "ArrowLeft")); // r1c1 -> r1c0
    expect(selectedText(editor)).toBe("r1c0");
  });

  it("entering via ArrowRight then continuing ArrowRight moves normally within the table", () => {
    act(() => editor.commands.setTextSelection(1 + "before text".length));
    act(() => press(editor, "ArrowRight")); // enters at r0c0
    act(() => press(editor, "ArrowRight")); // r0c0 -> r0c1
    expect(selectedText(editor)).toBe("r0c1");
  });
});

// Two tables stacked directly back to back (no paragraph between them —
// reachable via the block-insert "+" button). Without special-casing this,
// exitTable's generic "neighbor isn't a textblock" branch would wedge a
// pointless blank paragraph between the two tables instead of continuing
// straight into the next one, unlike every other exit case which lands
// directly in real adjacent content.
describe("BlockTable — two tables stacked back to back", () => {
  let editor: Editor;

  function buildTwoTables() {
    const table = (label: string) => ({
      type: "blockTable",
      content: [
        { type: "tableRow", content: [
          { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: `${label}r0c0` }] },
          { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: `${label}r0c1` }] },
        ] },
        { type: "tableRow", content: [
          { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: `${label}r1c0` }] },
          { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: `${label}r1c1` }] },
        ] },
      ],
    });
    return { type: "doc", content: [table("A"), table("B")] };
  }

  beforeEach(async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness onReady={(e) => { editor = e; }} />);
    });
    act(() => {
      editor.commands.setContent(buildTwoTables(), true);
    });
  });

  it("ArrowDown out of the bottom of table A lands directly in table B's first cell — no blank paragraph inserted", () => {
    act(() => editor.commands.setTextSelection(2)); // Ar0c0
    act(() => press(editor, "ArrowDown")); // Ar0c0 -> Ar1c0
    act(() => press(editor, "ArrowDown")); // exits A, should land in B
    expect(selectedText(editor)).toBe("Br0c0");
    expect(editor.state.doc.childCount).toBe(2); // still just the two tables
  });

  it("ArrowUp out of the top of table B lands directly in table A's last cell — no blank paragraph inserted", () => {
    act(() => editor.commands.setTextSelection(findTextPos(editor, "Br0c0")));
    act(() => press(editor, "ArrowUp"));
    expect(selectedText(editor)).toBe("Ar1c1");
    expect(editor.state.doc.childCount).toBe(2);
  });

  it("ArrowRight out of the last cell of table A lands directly in table B's first cell", () => {
    act(() => editor.commands.setTextSelection(2)); // Ar0c0
    act(() => press(editor, "ArrowDown")); // -> Ar1c0
    act(() => press(editor, "Tab"));       // -> Ar1c1 (last cell)
    act(() => press(editor, "ArrowRight")); // exits A -> B
    expect(selectedText(editor)).toBe("Br0c0");
    expect(editor.state.doc.childCount).toBe(2);
  });

  it("ArrowLeft out of the first cell of table B lands directly in table A's last cell", () => {
    act(() => editor.commands.setTextSelection(findTextPos(editor, "Br0c0")));
    act(() => press(editor, "ArrowLeft"));
    expect(selectedText(editor)).toBe("Ar1c1");
    expect(editor.state.doc.childCount).toBe(2);
  });
});

// @tiptap/extension-link registers `exitable: true`, which makes
// @tiptap/core generate ANOTHER independent ArrowRight keymap plugin (see
// Mark.handleExit in @tiptap/core/dist/index.js) — a second, completely
// unrelated extension binding the very same key our own table code binds.
// When the caret sits at the end of a mark-carrying run of text, that
// handler unconditionally inserts a literal space character and claims the
// keydown (returns true) *before* checking anything about tables. If it runs
// before TableCell's own ArrowRight handler, pressing Right at the end of a
// linked cell would silently corrupt the cell's text instead of moving to
// the next cell. TableCell's `priority: 1000` (vs Link's default 100) is
// supposed to guarantee our handler's plugin sorts first — asserted here
// directly rather than trusted, since two earlier assumptions about
// TipTap's plugin-ordering mechanics turned out wrong this same session.
describe("BlockTable — doesn't conflict with Link mark's own ArrowRight exit handling", () => {
  let editor: Editor;

  function linkedCellText(editor: Editor): string {
    let text = "";
    editor.state.doc.descendants((node) => {
      if (node.type.name === "tableCell" && node.textContent.startsWith("click")) text = node.textContent;
    });
    return text;
  }

  // "click" (linked) is col 0 in the first test doc — a mid-table cell, not
  // the table's last — and the table's actual last cell in the second, so
  // both "move to next cell" and "exit the table" paths get exercised
  // against the Link conflict.
  function buildWithLinkedCell(linkedIsLastCell: boolean) {
    const clickCell = { type: "tableCell", attrs: { header: false }, content: [
      { type: "text", text: "click", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
    ] };
    const plainCell = { type: "tableCell", attrs: { header: false }, content: [{ type: "text", text: "r0c1" }] };
    return {
      type: "doc",
      content: [{
        type: "blockTable",
        content: [
          { type: "tableRow", content: linkedIsLastCell ? [plainCell, clickCell] : [clickCell, plainCell] },
        ],
      }],
    };
  }

  async function setup(linkedIsLastCell: boolean) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness onReady={(e) => { editor = e; }} />);
    });
    act(() => {
      editor.commands.setContent(buildWithLinkedCell(linkedIsLastCell), true);
    });
  }

  it("ArrowRight at the end of a linked cell moves to the next cell, not inserts a space", async () => {
    await setup(false); // click, r0c1
    act(() => editor.commands.setTextSelection(findTextPos(editor, "click") + "click".length));
    act(() => press(editor, "ArrowRight"));
    expect(selectedText(editor)).toBe("r0c1");
    expect(linkedCellText(editor)).toBe("click"); // not "click " — no stray space inserted
  });

  it("ArrowRight at the end of the linked LAST cell exits the table below, not inserts a space", async () => {
    await setup(true); // r0c1, click
    act(() => editor.commands.setTextSelection(findTextPos(editor, "click") + "click".length));
    act(() => press(editor, "ArrowRight"));
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(linkedCellText(editor)).toBe("click");
  });
});

// Regression guard (live-reported 2026-07-22, shipped in a real installer
// before being caught): TableCell/BlockTable's `priority` briefly outranked
// paragraph's own non-default priority, which made ProseMirror pick
// `blockTable` — not `paragraph` — as the fallback content for a brand-new,
// genuinely empty document. Every brand-new post silently started with an
// auto-inserted 1×1 table instead of an empty paragraph. See the long
// `priority: 1000` comments on TableCell/BlockTable for the full mechanics.
describe("BlockTable — does not hijack a blank document's default content", () => {
  it("a genuinely new editor (no content given at all) starts with an empty paragraph, not a table", async () => {
    let editor!: Editor;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<NoContentHarness onReady={(e) => { editor = e; }} />);
    });

    const doc = editor.state.doc;
    expect(doc.childCount).toBe(1);
    expect(doc.firstChild?.type.name).toBe("paragraph");
    expect(doc.firstChild?.textContent).toBe("");
  });
});
