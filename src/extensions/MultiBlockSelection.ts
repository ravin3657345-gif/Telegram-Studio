import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// Notion-style full-width highlight for a selection spanning several
// top-level blocks (drag-select or Shift+click across paragraphs/images/etc).
// A single-block text selection already gets the browser's native highlight,
// so this only kicks in once the selection actually crosses a block boundary.
export const MultiBlockSelection = Extension.create({
  name: "multiBlockSelection",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("multiBlockSelection"),
        props: {
          decorations(state) {
            const { selection, doc } = state;
            if (selection.empty) return null;
            const { from, to } = selection;

            let firstIdx = -1;
            let lastIdx = -1;
            let idx = 0;
            doc.forEach((node: PMNode, offset: number) => {
              const nodeEnd = offset + node.nodeSize;
              if (to > offset && from < nodeEnd) {
                if (firstIdx < 0) firstIdx = idx;
                lastIdx = idx;
              }
              idx++;
            });

            // Nothing selected, or the whole selection lives inside one block
            // — leave the native text highlight alone.
            if (firstIdx < 0 || firstIdx === lastIdx) return null;

            const decorations: Decoration[] = [];
            let i = 0;
            doc.forEach((node: PMNode, offset: number) => {
              if (i >= firstIdx && i <= lastIdx) {
                decorations.push(
                  Decoration.node(offset, offset + node.nodeSize, { class: "block-multi-selected" })
                );
              }
              i++;
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
