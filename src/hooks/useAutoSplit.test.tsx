// @vitest-environment jsdom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, it, expect, beforeEach } from "vitest";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useAutoSplit } from "@/hooks/useAutoSplit";
import { useEditorStore } from "@/store/editorStore";

function Harness({ onReady }: { onReady: (editor: Editor, recalculate: () => void) => void }) {
  const editor = useEditor({ extensions: [StarterKit], content: "<p></p>" });
  const { recalculate } = useAutoSplit(editor);
  const recalcRef = useRef(recalculate);
  recalcRef.current = recalculate;
  useEffect(() => {
    if (editor) onReady(editor, () => recalcRef.current());
  }, [editor]);
  return editor ? <EditorContent editor={editor} /> : null;
}

describe("useAutoSplit — real editor, real ProseMirror transactions", () => {
  let editor: Editor;
  let recalculate: () => void;

  beforeEach(async () => {
    useEditorStore.setState({ splitGaps: [], lockedGaps: [], publishMode: "normal" });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Harness onReady={(e, r) => { editor = e; recalculate = r; }} />);
    });
  });

  // setContent's 2nd arg forces it to emit "update" (default: false) — real
  // typing/erasing always fires "update" via normal transaction dispatch, so
  // this just makes setContent behave the same way for the test.
  function setParas(lengths: number[]) {
    const html = lengths.map((n) => `<p>${"a".repeat(n)}</p>`).join("");
    act(() => { editor.commands.setContent(html, true); });
  }

  it("auto-splits once normal-mode's 4096 limit is exceeded", () => {
    setParas([3000, 3000]);
    const { splitGaps, lockedGaps } = useEditorStore.getState();
    expect(splitGaps.length).toBeGreaterThan(0);
    expect(lockedGaps.length).toBe(0);
  });

  it("clears the auto gap once content shrinks back under the limit", () => {
    setParas([3000, 3000]);
    expect(useEditorStore.getState().splitGaps.length).toBeGreaterThan(0);
    setParas([10, 10]);
    expect(useEditorStore.getState().splitGaps.length).toBe(0);
  });

  it("keeps a manually-locked gap (block menu's 'Split message here') even once content shrinks under the limit", () => {
    setParas([1000, 1000, 1000]);
    act(() => { useEditorStore.getState().setSplitGaps([1], [1]); });
    setParas([5, 5, 5]);
    expect(useEditorStore.getState().splitGaps).toEqual([1]);
    expect(useEditorStore.getState().lockedGaps).toEqual([1]);
  });

  it("auto-splits a single oversized paragraph (no Enter pressed anywhere) into limit-sized pieces so a gap has somewhere to go", () => {
    setParas([9000]); // ONE block, over normal's 4096, no other block to put a gap next to
    const { splitGaps, lockedGaps } = useEditorStore.getState();
    expect(splitGaps.length).toBeGreaterThan(0);
    expect(lockedGaps.length).toBe(0);
    // the paragraph itself must have actually been broken into multiple blocks
    let blockCount = 0;
    editor.state.doc.forEach(() => { blockCount++; });
    expect(blockCount).toBeGreaterThan(1);
  });

  it("switching to Rich mode (32768 limit) drops auto gaps sized for normal mode but keeps locked ones", () => {
    setParas([3000, 3000]); // over normal's 4096, under rich's 32768
    expect(useEditorStore.getState().splitGaps.length).toBeGreaterThan(0);
    act(() => { useEditorStore.getState().setSplitGaps([1], [1]); });
    act(() => { useEditorStore.getState().setPublishMode("rich"); });
    expect(useEditorStore.getState().lockedGaps).toEqual([1]);
  });

  it("still auto-splits in Rich mode once text exceeds its own 32768 limit", () => {
    act(() => { useEditorStore.getState().setPublishMode("rich"); });
    setParas([20000, 20000]);
    expect(useEditorStore.getState().splitGaps.length).toBeGreaterThan(0);
  });

  it("regression: the toolbar Scissors button (recalculate()) must not silently delete a manually-locked split", () => {
    setParas([1000, 1000, 1000]);
    act(() => { useEditorStore.getState().setSplitGaps([1], [1]); }); // manual split via block menu
    act(() => { recalculate(); }); // toolbar Scissors button
    expect(useEditorStore.getState().lockedGaps).toContain(1);
    expect(useEditorStore.getState().splitGaps).toContain(1);
  });

  it("regression: a manually-locked gap left pointing past the end of a now-shorter document (blocks actually deleted, not just shrunk) is dropped instead of lingering forever", () => {
    setParas([1000, 1000, 1000]); // 3 blocks — gap 2 sits between block 1 and block 2
    act(() => { useEditorStore.getState().setSplitGaps([2], [2]); });
    expect(useEditorStore.getState().lockedGaps).toEqual([2]);
    setParas([10, 10]); // block(s) deleted — only 2 blocks left, gap 2 is now out of range
    expect(useEditorStore.getState().lockedGaps).toEqual([]);
    expect(useEditorStore.getState().splitGaps).toEqual([]);
  });
});
