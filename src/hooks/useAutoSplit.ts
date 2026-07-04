import { useEffect, useRef, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import {
  TELEGRAM_MAX_TEXT_LENGTH,
  TELEGRAM_MAX_CAPTION_LENGTH,
  TELEGRAM_MAX_RICH_LENGTH,
} from "@/lib/constants";
import { useEditorStore } from "@/store/editorStore";
import { computeAutoGaps } from "@/lib/splitAlgorithm";

export function useAutoSplit(editor: Editor | null): { splitCount: number; recalculate: () => void } {
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

      const limit = hasMedia
        ? TELEGRAM_MAX_CAPTION_LENGTH
        : pm === "rich"
        ? TELEGRAM_MAX_RICH_LENGTH
        : TELEGRAM_MAX_TEXT_LENGTH;

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
    const limit = hasMedia
      ? TELEGRAM_MAX_CAPTION_LENGTH
      : pm === "rich"
      ? TELEGRAM_MAX_RICH_LENGTH
      : TELEGRAM_MAX_TEXT_LENGTH;

    // Collect per-block char counts
    const blocks: number[] = [];
    editor.state.doc.forEach((n) => blocks.push(n.textContent.length));

    // Place dividers exactly where the limit ends — no locked gaps, clean slate
    setSplitGaps(computeAutoGaps(blocks, limit, []), []);
  }, [editor, setSplitGaps]);

  return { splitCount: splitGaps.length, recalculate };
}
