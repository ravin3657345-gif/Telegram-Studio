// @vitest-environment jsdom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, it, expect, beforeEach } from "vitest";
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

  it("Tab at the very last cell grows the table by one row", () => {
    const rowsBefore = (editor.state.doc.firstChild as import("@tiptap/pm/model").Node).childCount;
    act(() => press(editor, "Tab")); // r0c0 -> r0c1
    act(() => press(editor, "Tab")); // -> r1c0
    act(() => press(editor, "Tab")); // -> r1c1 (last cell)
    act(() => press(editor, "Tab")); // -> grows a new row, lands on its first cell
    const table = editor.state.doc.firstChild as import("@tiptap/pm/model").Node;
    expect(table.childCount).toBe(rowsBefore + 1);
    expect(selectedText(editor)).toBe(""); // new cell is empty
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
});
