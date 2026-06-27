import StarterKit from "@tiptap/starter-kit";
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
import { MediaPasteHandler } from "@/extensions/MediaPasteHandler";
import { SlashCommand } from "@/extensions/SlashCommand";
import { BlockDragHandle } from "@/extensions/BlockDragHandle";
import { Blockquote } from "@/extensions/Blockquote";
import { TELEGRAM_MAX_TEXT_LENGTH } from "./constants";

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

    CharacterCount.configure({ limit: TELEGRAM_MAX_TEXT_LENGTH }),

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
    Blockquote,
    MediaPasteHandler,
    SlashCommand,
    BlockDragHandle,
  ];
}
