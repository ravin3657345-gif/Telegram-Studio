import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

// Word-style arrow-key navigation past atom top-level blocks (image/video/
// audio/poll/faq/map/formula/document/message-split/anchor — anything
// registered with `atom: true`). ProseMirror's default behavior when the
// caret reaches one of these is to select the WHOLE block (NodeSelection,
// blue highlight) instead of continuing past it — a word processor never
// does this, it just glides the cursor around an inline object. This only
// intervenes in the narrow case where the caret is already at the very
// start/end of a TOP-LEVEL textblock's own content (depth === 1 — nested
// content inside a list item/quote/callout keeps native behavior, same
// conservative scoping BlockMoveShortcuts.ts's liftOneContainerLevel uses)
// and the adjacent top-level sibling is specifically an atom node; every
// other arrow press (inside text, between two textblocks, inside a table —
// which already has its own Tab/Enter/Arrow handling in BlockTable.tsx,
// and lives several levels deeper than depth 1 anyway) falls through to
// native/default handling unchanged.
//
// Deliberately does NOT try to replicate true visual-line-aware vertical
// movement — `parentOffset === 0`/`=== content.size` is true only at the
// literal start/end of a block's content, which is always the first/last
// visual line regardless of how the paragraph wraps, so this can't
// misfire mid-paragraph.

function isAtomBlock(node: import("@tiptap/pm/model").Node | null | undefined): boolean {
  return !!node && node.type.isAtom;
}

function skipForward(editor: Editor): boolean {
  const { state, view } = editor;
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;

  const { $from } = selection;
  if ($from.depth !== 1) return false;
  if ($from.parentOffset !== $from.parent.content.size) return false;

  const afterPos = $from.after(1);
  const nextNode = state.doc.nodeAt(afterPos);
  if (!isAtomBlock(nextNode)) return false;

  const targetPos = afterPos + nextNode!.nodeSize;
  if (targetPos > state.doc.content.size) return false;

  const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(targetPos), 1));
  view.dispatch(tr);
  return true;
}

function skipBackward(editor: Editor): boolean {
  const { state, view } = editor;
  const { selection } = state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;

  const { $from } = selection;
  if ($from.depth !== 1) return false;
  if ($from.parentOffset !== 0) return false;

  const beforePos = $from.before(1);
  if (beforePos <= 0) return false;
  const prevNode = state.doc.resolve(beforePos).nodeBefore;
  if (!isAtomBlock(prevNode)) return false;

  const targetPos = beforePos - prevNode!.nodeSize;
  if (targetPos < 0) return false;

  const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(targetPos), -1));
  view.dispatch(tr);
  return true;
}

export const AtomBlockNavigation = Extension.create({
  name: "atomBlockNavigation",

  addKeyboardShortcuts() {
    return {
      ArrowRight: () => skipForward(this.editor),
      ArrowDown:  () => skipForward(this.editor),
      ArrowLeft:  () => skipBackward(this.editor),
      ArrowUp:    () => skipBackward(this.editor),
    };
  },
});
