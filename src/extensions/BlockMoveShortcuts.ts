import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { NESTABLE_CONTAINER_TYPES } from "@/lib/blockGeometry";

// Move the top-level block containing the selection one slot up/down —
// keyboard equivalent of dragging it with the handle (Notion: Ctrl/Cmd+Shift+↑/↓).
function moveCurrentBlock(editor: Editor, dir: -1 | 1): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  if ($from.depth < 1) return false;

  const doc = state.doc;
  const blockStart = $from.before(1);
  const positions: number[] = [];
  doc.forEach((_, off) => positions.push(off));
  const idx = positions.indexOf(blockStart);
  if (idx < 0) return false;

  const targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= doc.childCount) return false;

  const node       = doc.child(idx);
  const targetNode = doc.child(targetIdx);
  const nodeSize   = node.nodeSize;

  // Moving up: target is before blockStart, so its position is unaffected by
  // deleting the (later) current block. Moving down: deleting the current
  // block first shifts the target back by nodeSize, landing it at blockStart.
  const insertAt = dir < 0 ? positions[targetIdx] : blockStart + targetNode.nodeSize;

  const tr = state.tr.delete(blockStart, blockStart + nodeSize).insert(insertAt, node);
  const $sel = tr.doc.resolve(Math.min(insertAt + 1, tr.doc.content.size));
  tr.setSelection(TextSelection.near($sel));
  view.dispatch(tr);
  editor.commands.focus();
  return true;
}

// Default ProseMirror Backspace (chainCommands(deleteSelection, joinBackward,
// selectNodeBackward)): when the cursor is at the very start of an empty
// textblock with truly nothing before it at any depth, joinBackward computes
// liftTarget(range) — the DEEPEST valid unwrap target — and jumps straight
// there in one transaction. For a quote nested inside a quote inside a quote,
// that means one Backspace unwraps every level at once instead of peeling
// them off one at a time, which reads as "everything fell apart". Intercept
// just this one case (empty textblock, sole child of a blockquote/callout)
// and lift exactly one level; every other Backspace scenario (mid-text
// deletion, top-level empty paragraph, non-container parents) falls through
// unchanged by returning false.
function liftOneContainerLevel(editor: Editor): boolean {
  const { state, view } = editor;
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;
  if ($from.parentOffset !== 0 || $from.parent.content.size !== 0) return false;
  if ($from.depth < 2) return false;

  const immediateParent = $from.node($from.depth - 1);
  if (!NESTABLE_CONTAINER_TYPES.has(immediateParent.type.name)) return false;
  // Only when it's the container's one and only child — keeps the operation
  // unambiguous (no sibling content to reflow around).
  if (immediateParent.childCount !== 1 || $from.index($from.depth - 1) !== 0) return false;

  const range = $from.blockRange();
  if (!range) return false;

  try {
    const tr = state.tr.lift(range, $from.depth - 2);
    view.dispatch(tr);
    return true;
  } catch {
    return false; // schema rejected the one-level target — let the default handler try instead
  }
}

// The visual hover controls (grip/add/menu buttons, drag-and-drop) live in
// BlockHoverControls.tsx as a plain React overlay — this extension only
// owns the keyboard-shortcut equivalent, which has nothing to do with DOM/mouse.
export const BlockMoveShortcuts = Extension.create({
  name: "blockMoveShortcuts",

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-ArrowUp":   () => moveCurrentBlock(this.editor, -1),
      "Mod-Shift-ArrowDown": () => moveCurrentBlock(this.editor, 1),
      Backspace: () => liftOneContainerLevel(this.editor),
    };
  },
});
