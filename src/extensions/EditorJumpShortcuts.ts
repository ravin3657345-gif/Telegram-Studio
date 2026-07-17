import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

// Mod+Home/Mod+End jump the caret to the very start/end of the post — a
// Word convention with no native browser equivalent inside contenteditable
// (Ctrl+Home there is either a no-op or scrolls the whole window, not the
// editor's own scroll container). `scrollIntoView()` on the transaction lets
// ProseMirror figure out which ancestor is actually scrollable and scroll
// that one, so this works regardless of which layout wraps the editor.
export const EditorJumpShortcuts = Extension.create({
  name: "editorJumpShortcuts",

  addKeyboardShortcuts() {
    return {
      "Mod-Home": () => {
        const { state, view } = this.editor;
        const tr = state.tr.setSelection(TextSelection.atStart(state.doc)).scrollIntoView();
        view.dispatch(tr);
        return true;
      },
      "Mod-End": () => {
        const { state, view } = this.editor;
        const tr = state.tr.setSelection(TextSelection.atEnd(state.doc)).scrollIntoView();
        view.dispatch(tr);
        return true;
      },
    };
  },
});
