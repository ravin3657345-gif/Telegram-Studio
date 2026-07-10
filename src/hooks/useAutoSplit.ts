import { useEffect, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import { resolveMessageLimit } from "@/lib/constants";
import { useEditorStore } from "@/store/editorStore";
import { computeAutoGaps } from "@/lib/splitAlgorithm";

// computeAutoGaps only ever places a divider *between* top-level blocks — if
// someone just keeps typing one continuous paragraph past the limit (no
// Enter pressed anywhere), there's no block boundary to put a gap at, so
// nothing gets split no matter how far over the limit it goes. This splits
// any single block that's on its own bigger than the limit into multiple
// `limit`-sized paragraphs first, preserving the cursor's position, so the
// normal between-block gap logic always has something to work with.
function splitOversizedBlocks(editor: Editor, limit: number): boolean {
  const doc = editor.state.doc;
  const cuts: number[] = [];
  doc.forEach((node, offset) => {
    if (!node.isTextblock) return;
    const len = node.textContent.length;
    if (len <= limit) return;
    for (let c = limit; c < len; c += limit) cuts.push(offset + 1 + c);
  });
  if (cuts.length === 0) return false;

  const tr = editor.state.tr;
  const selFrom = editor.state.selection.from;
  // Apply from the last cut backwards so earlier cut positions stay valid
  // (a split only shifts positions *after* itself).
  for (let i = cuts.length - 1; i >= 0; i--) tr.split(cuts[i]);
  tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(selFrom))));
  editor.view.dispatch(tr);
  return true;
}

export function useAutoSplit(
  editor: Editor | null,
): { splitCount: number; recalculate: () => void; forceSplitAtCursor: () => void } {
  const setSplitGaps = useEditorStore((s) => s.setSplitGaps);
  const splitGaps    = useEditorStore((s) => s.splitGaps);
  const lockedGaps   = useEditorStore((s) => s.lockedGaps);
  const publishMode  = useEditorStore((s) => s.publishMode);

  // Stable refs — closures read .current so they never see stale values
  const splitGapsRef   = useRef(splitGaps);
  const lockedGapsRef  = useRef(lockedGaps);
  const publishModeRef = useRef(publishMode);
  splitGapsRef.current   = splitGaps;
  lockedGapsRef.current  = lockedGaps;
  publishModeRef.current = publishMode;

  const computeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!editor) return;

    function compute() {
      const pm      = publishModeRef.current;
      const locked  = lockedGapsRef.current;
      const current = splitGapsRef.current;

      let hasMedia = false;
      editor!.state.doc.forEach((n) => {
        if (n.type.name === "blockImage" || n.type.name === "blockVideo") hasMedia = true;
      });

      let charCount = 0;
      editor!.state.doc.forEach((n) => { charCount += n.textContent.length; });

      const limit = resolveMessageLimit(pm, hasMedia);

      if (charCount > limit && splitOversizedBlocks(editor!, limit)) {
        // Dispatched its own transaction — the resulting "update" event
        // re-enters compute() with a document whose blocks all fit, so bail
        // out of this stale pass instead of computing gaps against it.
        return;
      }

      const blocks: number[] = [];
      editor!.state.doc.forEach((n) => blocks.push(n.textContent.length));

      if (charCount <= limit) {
        const lockedSet = new Set(locked);
        const toKeep = current.filter((g) => lockedSet.has(g));
        if (JSON.stringify(toKeep) !== JSON.stringify(current)) {
          setSplitGaps(toKeep, locked);
        }
        return;
      }

      const allGaps = computeAutoGaps(blocks, limit, locked);
      if (JSON.stringify(allGaps) !== JSON.stringify(current)) {
        setSplitGaps(allGaps, locked);
      }
    }

    computeRef.current = compute;
    editor.on("update", compute);
    // Also run on "create" so content loaded via setContent() triggers a split
    editor.on("create", compute);
    compute();

    return () => {
      editor.off("update", compute);
      editor.off("create", compute);
    };
  }, [editor, publishMode, setSplitGaps]);

  const recalculate = useCallback(() => {
    if (!editor) return;

    let hasMedia = false;
    editor.state.doc.forEach((n) => {
      if (n.type.name === "blockImage" || n.type.name === "blockVideo") hasMedia = true;
    });

    const pm = publishModeRef.current;
    const limit = resolveMessageLimit(pm, hasMedia);

    let charCount = 0;
    editor.state.doc.forEach((n) => { charCount += n.textContent.length; });
    if (charCount > limit && splitOversizedBlocks(editor, limit)) return; // re-enters via "update"

    // Collect per-block char counts
    const blocks: number[] = [];
    editor.state.doc.forEach((n) => blocks.push(n.textContent.length));

    // Re-derive auto gaps for overflow, but keep any gap the user manually
    // placed ("Split message here" from the block menu) — this button used to
    // pass an empty locked set, silently deleting every manual split the
    // instant someone clicked it to re-check for overflow.
    const locked = lockedGapsRef.current;
    setSplitGaps(computeAutoGaps(blocks, limit, locked), locked);
  }, [editor, setSplitGaps]);

  // Forces a split divider right at the current cursor position, regardless
  // of length limits — same idea as the block menu's "Split message here",
  // but works from wherever the cursor actually is (including mid-paragraph,
  // splitting the text in two) instead of only "before this whole block".
  // Mirrors SplitOverlay.tsx's drag-to-a-mid-paragraph-position logic.
  const forceSplitAtCursor = useCallback(() => {
    if (!editor) return;

    const { $from } = editor.state.selection;
    if ($from.depth < 1) return;

    const blockStart = $from.before(1);
    let blockIdx = 0;
    editor.state.doc.forEach((_, off) => { if (off < blockStart) blockIdx++; });

    const offsetInBlock = $from.parentOffset;
    const blockLen = $from.parent.textContent.length;
    const isLeaf = $from.parent.isLeaf;

    const currGaps = splitGapsRef.current;
    const currLocked = lockedGapsRef.current;

    let totalBlocks = 0;
    editor.state.doc.forEach(() => totalBlocks++);

    if (!isLeaf && offsetInBlock > 0 && offsetInBlock < blockLen) {
      // Cursor sits mid-paragraph — split the text itself at this exact
      // character, then lock a gap at the new boundary between the halves.
      const newGapIdx = blockIdx + 1;
      const otherGaps = currGaps.map((g) => (g >= newGapIdx ? g + 1 : g));
      const newLocked = currLocked.map((g) => (g >= newGapIdx ? g + 1 : g));
      if (!newLocked.includes(newGapIdx)) newLocked.push(newGapIdx);
      const allGaps = [...new Set([...otherGaps, newGapIdx])].sort((a, b) => a - b);

      editor.chain().splitBlock().run();
      setSplitGaps(allGaps, newLocked);
      return;
    }

    // Cursor already sits at a block boundary — just lock a gap there.
    let newGapIdx = offsetInBlock <= 0 ? blockIdx : blockIdx + 1;
    newGapIdx = Math.max(1, Math.min(newGapIdx, totalBlocks - 1));
    if (newGapIdx <= 0 || currGaps.includes(newGapIdx)) return;

    const newLocked = [...currLocked, newGapIdx];
    const newGaps = [...new Set([...currGaps, newGapIdx])].sort((a, b) => a - b);
    setSplitGaps(newGaps, newLocked);
  }, [editor, setSplitGaps]);

  return { splitCount: splitGaps.length, recalculate, forceSplitAtCursor };
}
