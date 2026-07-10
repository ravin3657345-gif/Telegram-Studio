// @vitest-environment jsdom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react-dom/test-utils";
import { createRoot } from "react-dom/client";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { createTiptapExtensions } from "@/lib/tiptapConfig";
import { getNestedDropInfo, type BlockRectSnapshot } from "@/lib/blockGeometry";
import { useEffect } from "react";

function Harness({ onReady }: { onReady: (editor: Editor) => void }) {
  const editor = useEditor({ extensions: createTiptapExtensions(), content: "<p></p>" });
  useEffect(() => { if (editor) onReady(editor); }, [editor]);
  return editor ? <EditorContent editor={editor} /> : null;
}

// jsdom never computes real layout (getBoundingClientRect is always zeroed),
// so this hands getNestedDropInfo a fully hand-built snapshot instead of
// relying on real geometry — it never falls back to a live measurement as
// long as every element it visits has an entry here.
function fakeRect(top: number, bottom: number, left: number, right: number) {
  return { top, bottom, left, right, width: right - left };
}

describe("getNestedDropInfo — excludeRange (dragging a container over its own interior)", () => {
  let editor: Editor;

  beforeEach(async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness onReady={(e) => { editor = e; }} />);
    });
  });

  it("recurses into a quote's interior when nothing is excluded", () => {
    act(() => {
      editor.commands.setContent(
        { type: "doc", content: [
          { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
          { type: "paragraph", content: [{ type: "text", text: "b" }] },
        ] },
        true,
      );
    });

    const quoteEl = editor.view.nodeDOM(0) as HTMLElement;
    const innerParaEl = editor.view.nodeDOM(1) as HTMLElement;
    // second top-level block starts right after the quote (quote nodeSize = inner paragraph nodeSize + 2)
    const quoteNode = editor.state.doc.child(0);
    const secondBlockPos = quoteNode.nodeSize;
    const paraBEl = editor.view.nodeDOM(secondBlockPos) as HTMLElement;

    const snapshot: BlockRectSnapshot = new Map([
      [quoteEl,     fakeRect(0, 50, 0, 300)],
      [innerParaEl, fakeRect(10, 40, 10, 290)],
      [paraBEl,     fakeRect(60, 100, 0, 300)],
    ]);

    const info = getNestedDropInfo(editor.view, 150, 25, snapshot);
    expect(info).not.toBeNull();
    expect(info!.container?.pos).toBe(0); // resolved inside the quote
  });

  it("does NOT recurse into the dragged quote's own interior — falls back to a top-level position", () => {
    act(() => {
      editor.commands.setContent(
        { type: "doc", content: [
          { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
          { type: "paragraph", content: [{ type: "text", text: "b" }] },
        ] },
        true,
      );
    });

    const quoteEl = editor.view.nodeDOM(0) as HTMLElement;
    const innerParaEl = editor.view.nodeDOM(1) as HTMLElement;
    const quoteNode = editor.state.doc.child(0);
    const secondBlockPos = quoteNode.nodeSize;
    const paraBEl = editor.view.nodeDOM(secondBlockPos) as HTMLElement;

    const snapshot: BlockRectSnapshot = new Map([
      [quoteEl,     fakeRect(0, 50, 0, 300)],
      [innerParaEl, fakeRect(10, 40, 10, 290)],
      [paraBEl,     fakeRect(60, 100, 0, 300)],
    ]);

    // Same coordinates as the previous test (over the quote's own interior),
    // but this time we're "dragging" the quote itself.
    const excludeRange = { from: 0, to: quoteNode.nodeSize };
    const info = getNestedDropInfo(editor.view, 150, 25, snapshot, excludeRange);
    expect(info).not.toBeNull();
    expect(info!.container).toBeNull(); // must NOT resolve inside the excluded quote
  });
});
