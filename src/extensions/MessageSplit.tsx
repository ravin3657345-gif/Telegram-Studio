// Legacy stub — kept only so old saved drafts with messageSplit nodes load
// without schema errors. The overlay-based split system no longer inserts these.
import { Node, mergeAttributes } from "@tiptap/core";

export const MessageSplit = Node.create({
  name: "messageSplit",
  group: "block",
  atom: true,

  addAttributes() {
    return { manual: { default: false } };
  },

  parseHTML() {
    return [{ tag: "div[data-message-split]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-message-split": "", style: "display:none;height:0;overflow:hidden" })];
  },
});
