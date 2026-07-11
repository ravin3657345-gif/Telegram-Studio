import StarterKit from "@tiptap/starter-kit";
import ListItem from "@tiptap/extension-list-item";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextStyle from "@tiptap/extension-text-style";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Spoiler } from "@/extensions/Spoiler";
import { BlockImage } from "@/extensions/BlockImage";
import { BlockVideo } from "@/extensions/BlockVideo";
import { BlockDocument } from "@/extensions/BlockDocument";
import { BlockFAQ } from "@/extensions/BlockFAQ";
import { BlockPoll } from "@/extensions/BlockPoll";
import { BlockCode } from "@/extensions/BlockCode";
import { BlockCheckItem } from "@/extensions/BlockCheckItem";
import { BlockCallout } from "@/extensions/BlockCallout";
import { BlockAnchor } from "@/extensions/BlockAnchor";
import { MediaPasteHandler } from "@/extensions/MediaPasteHandler";
import { SlashCommand } from "@/extensions/SlashCommand";
import { BlockMoveShortcuts } from "@/extensions/BlockMoveShortcuts";
import { MultiBlockSelection } from "@/extensions/MultiBlockSelection";
import { Blockquote } from "@/extensions/Blockquote";
import { MessageSplit } from "@/extensions/MessageSplit";
import { BlockTable, TableRow, TableCell } from "@/extensions/BlockTable";
import { BlockAudio } from "@/extensions/BlockAudio";
import { BlockMap } from "@/extensions/BlockMap";
import { BlockFormula } from "@/extensions/BlockFormula";

export function createTiptapExtensions() {
  return [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3],
        HTMLAttributes: { class: "tiptap-heading" },
      },
      codeBlock: false,
      horizontalRule: {
        HTMLAttributes: { class: "tiptap-hr" },
      },
      code: {
        HTMLAttributes: { class: "tiptap-code" },
      },
      bold:        { HTMLAttributes: { class: "tiptap-bold" } },
      italic:      { HTMLAttributes: { class: "tiptap-italic" } },
      strike:      { HTMLAttributes: { class: "tiptap-strike" } },
      blockquote:  false,
      bulletList:  { HTMLAttributes: { class: "tiptap-bullet-list" } },
      orderedList: { HTMLAttributes: { class: "tiptap-ordered-list" } },
      dropcursor:  { color: "var(--accent)", width: 2 },
      gapcursor:   false,
    }),

    // Overrides StarterKit's bundled ListItem (same `name`, later entry wins)
    // to drop Tab/Shift-Tab's default sub-list nesting — Rich mode's list
    // converter (extractRichText) only extracts inline text from a list item,
    // so a nested <ul>/<ol> inside it gets flattened into one run-on string
    // with no tags or separators at all. Tab still reports "handled" (returns
    // true) so it doesn't fall through to the browser's default focus-shift.
    ListItem.extend({
      addKeyboardShortcuts() {
        return { Tab: () => true, "Shift-Tab": () => true };
      },
    }),

    Underline.configure({ HTMLAttributes: { class: "tiptap-underline" } }),

    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
      HTMLAttributes: { class: "tiptap-link", rel: "noopener noreferrer", target: null },
    }),

    Placeholder.configure({
      placeholder: "Начните писать или нажмите / для вставки блока…",
      emptyEditorClass: "tiptap-empty",
      showOnlyCurrent: true,
    }),

    CharacterCount.configure(),

    TextStyle,

    Color.configure({ types: ["textStyle"] }),

    Highlight.configure({
      multicolor: true,
      HTMLAttributes: { class: "tiptap-highlight" },
    }),

    Subscript.configure({ HTMLAttributes: { class: "tiptap-subscript" } }),
    Superscript.configure({ HTMLAttributes: { class: "tiptap-superscript" } }),

    Spoiler,
    BlockImage,
    BlockVideo,
    BlockDocument,
    BlockFAQ,
    BlockPoll,
    BlockCode,
    BlockCheckItem,
    BlockCallout,
    BlockAnchor,
    Blockquote,
    BlockTable,
    TableRow,
    TableCell,
    BlockAudio,
    BlockMap,
    BlockFormula,
    MediaPasteHandler,
    SlashCommand,
    BlockMoveShortcuts,
    MultiBlockSelection,
    MessageSplit,
  ];
}
