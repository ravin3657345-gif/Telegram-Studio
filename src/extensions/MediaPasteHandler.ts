import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { fileRegistry } from "@/lib/fileRegistry";

const ALLOWED_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO = ["video/mp4", "video/mpeg"];

function insertMediaBlock(view: any, file: File) {
  const { id, src } = fileRegistry.add(file);
  const isVideo = ALLOWED_VIDEO.includes(file.type);

  const nodeType = isVideo
    ? view.state.schema.nodes.blockVideo
    : view.state.schema.nodes.blockImage;

  if (!nodeType) return;

  const node = nodeType.create({
    src,
    fileId: id,
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
  });

  const tr = view.state.tr.replaceSelectionWith(node);
  view.dispatch(tr);
  view.focus();
}

// Same idea as insertMediaBlock, but takes/returns an explicit position
// instead of relying on the current selection — needed for inserting several
// dropped files in a row. After replaceSelectionWith inserts an atom node,
// ProseMirror leaves the selection as a NodeSelection wrapping that same
// node (no adjacent text position to place a cursor at), so a second
// replaceSelectionWith call would replace the just-inserted file instead of
// adding another one after it — silently keeping only the last dropped file.
function insertMediaBlockAt(view: any, file: File, atPos: number): number {
  const { id, src } = fileRegistry.add(file);
  const isVideo = ALLOWED_VIDEO.includes(file.type);

  const nodeType = isVideo
    ? view.state.schema.nodes.blockVideo
    : view.state.schema.nodes.blockImage;

  if (!nodeType) return atPos;

  const node = nodeType.create({
    src,
    fileId: id,
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
  });

  view.dispatch(view.state.tr.insert(atPos, node));
  return atPos + node.nodeSize;
}

export const MediaPasteHandler = Extension.create({
  name: "mediaPasteHandler",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // Ctrl+V with image in clipboard
          handlePaste(view, event) {
            const items = Array.from(event.clipboardData?.items ?? []);
            const mediaItem = items.find(
              (i) => ALLOWED_IMAGE.includes(i.type) || ALLOWED_VIDEO.includes(i.type)
            );
            if (!mediaItem) return false;

            const file = mediaItem.getAsFile();
            if (!file) return false;

            event.preventDefault();
            insertMediaBlock(view, file);
            return true;
          },

          // Drag & drop files onto editor
          handleDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files ?? []).filter(
              (f) => ALLOWED_IMAGE.includes(f.type) || ALLOWED_VIDEO.includes(f.type)
            );
            if (files.length === 0) return false;

            event.preventDefault();

            // Move cursor to drop position
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (pos) {
              const resolved = view.state.doc.resolve(pos.pos);
              const sel = TextSelection.near(resolved);
              view.dispatch(view.state.tr.setSelection(sel));
            }

            let insertPos = view.state.selection.to;
            for (const file of files) insertPos = insertMediaBlockAt(view, file, insertPos);
            view.focus();
            return true;
          },
        },
      }),
    ];
  },
});
