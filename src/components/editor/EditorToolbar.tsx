import type { Editor } from "@tiptap/react";
import {
  Bold, Italic, Underline, Strikethrough, EyeOff,
  Quote, List, ListOrdered, Link, Smile, Image, Film,
  Heading1, Heading2, Heading3, Code2, Minus,
  Undo2, Redo2, Code, FileUp, Scissors,
  Subscript as SubscriptIcon, Superscript as SuperscriptIcon,
  Highlighter, ChevronsDownUp,
} from "lucide-react";
import { ToolbarButton, ToolbarSeparator } from "./ToolbarButton";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import { useEditorStore } from "@/store/editorStore";
import { useUiStore } from "@/store/uiStore";

interface EditorToolbarProps {
  editor: Editor;
  onLinkClick: () => void;
  onEmojiClick: () => void;
  onMediaClick: (type: "image" | "video" | "file") => void;
  onHtmlView: () => void;
  showHtmlView: boolean;
  onSplitClick?: () => void;
  splitActive?: boolean;
}

export function EditorToolbar({
  editor,
  onLinkClick,
  onEmojiClick,
  onMediaClick,
  onHtmlView,
  showHtmlView,
  onSplitClick,
  splitActive,
}: EditorToolbarProps) {
  useSettingsStore((s) => s.language);
  const publishMode = useEditorStore((s) => s.publishMode);
  const toast = useUiStore((s) => s.toast);

  // Translate vertical wheel scroll into horizontal so the toolbar can be
  // scrolled with a normal mouse wheel when its buttons overflow (compact mode).
  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollWidth <= el.clientWidth) return; // nothing to scroll
    // Ignore genuine horizontal scrolls (trackpads) — only remap vertical intent.
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
  }

  return (
    <div
      onWheel={handleWheel}
      className="flex items-center gap-0.5 px-2 flex-shrink-0 border-b overflow-x-auto toolbar-scroll"
      style={{
        height: 44,
        minHeight: 44,
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
        scrollbarWidth: "thin",
        scrollbarColor: "var(--border-default) transparent",
      }}
    >
      <ToolbarButton
        title={t("toolbar.undo")}
        icon={Undo2}
        isActive={false}
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      />
      <ToolbarButton
        title={t("toolbar.redo")}
        icon={Redo2}
        isActive={false}
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      />

      <ToolbarSeparator />

      <ToolbarButton
        title={t("toolbar.h1")}
        icon={Heading1}
        isActive={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      />
      <ToolbarButton
        title={t("toolbar.h2")}
        icon={Heading2}
        isActive={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <ToolbarButton
        title={t("toolbar.h3")}
        icon={Heading3}
        isActive={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />

      <ToolbarSeparator />

      <ToolbarButton title={t("toolbar.bold")} icon={Bold}
        isActive={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().toggleBold()}
      />
      <ToolbarButton title={t("toolbar.italic")} icon={Italic}
        isActive={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().toggleItalic()}
      />
      <ToolbarButton title={t("toolbar.underline")} icon={Underline}
        isActive={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}
        disabled={!editor.can().toggleUnderline()}
      />
      <ToolbarButton title={t("toolbar.strike")} icon={Strikethrough}
        isActive={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={!editor.can().toggleStrike()}
      />
      <ToolbarButton title={t("toolbar.code")} icon={Code}
        isActive={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}
        disabled={!editor.can().toggleCode()}
      />
      <ToolbarButton title={t("toolbar.spoiler")} icon={EyeOff}
        isActive={editor.isActive("spoiler")} onClick={() => editor.chain().focus().toggleSpoiler().run()}
        disabled={!editor.can().toggleMark("spoiler")}
      />
      <ToolbarButton title={t("toolbar.subscript")} icon={SubscriptIcon}
        isActive={editor.isActive("subscript")} onClick={() => editor.chain().focus().toggleSubscript().run()}
      />
      <ToolbarButton title={t("toolbar.superscript")} icon={SuperscriptIcon}
        isActive={editor.isActive("superscript")} onClick={() => editor.chain().focus().toggleSuperscript().run()}
      />
      <ToolbarButton title={t("toolbar.highlight")} icon={Highlighter}
        isActive={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}
      />

      <ToolbarSeparator />

      <ToolbarButton title={t("toolbar.quote")} icon={Quote}
        isActive={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}
        disabled={!editor.can().toggleBlockquote()}
      />
      {editor.isActive("blockquote") && (
        <ToolbarButton
          title={
            publishMode === "rich"
              ? t("toolbar.collapsibleUnavail")
              : editor.getAttributes("blockquote").expandable
                ? t("toolbar.makeNormal")
                : t("toolbar.makeCollapsible")
          }
          icon={ChevronsDownUp}
          isActive={!!editor.getAttributes("blockquote").expandable}
          disabled={publishMode === "rich"}
          onClick={() => {
            if (publishMode === "rich") {
              toast("warning", t("toolbar.collapsibleUnavail"), t("toolbar.collapsibleUnavailHint"));
              return;
            }
            (editor.commands as any).toggleBlockquoteExpandable();
          }}
        />
      )}
      <ToolbarButton title={t("toolbar.codeBlock")} icon={Code2}
        isActive={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        disabled={!editor.can().toggleCodeBlock()}
      />
      <ToolbarButton title={t("toolbar.list")} icon={List}
        isActive={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}
        disabled={!editor.can().toggleBulletList()}
      />
      <ToolbarButton title={t("toolbar.orderedList")} icon={ListOrdered}
        isActive={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}
        disabled={!editor.can().toggleOrderedList()}
      />
      <ToolbarButton title={t("toolbar.divider")} icon={Minus}
        isActive={false} onClick={() => editor.chain().focus().setHorizontalRule().run()}
      />

      <ToolbarSeparator />

      <ToolbarButton title={t("toolbar.link")} icon={Link}
        isActive={editor.isActive("link")} onClick={onLinkClick}
      />
      <ToolbarButton title={t("toolbar.emoji")} icon={Smile} isActive={false} onClick={onEmojiClick} />

      <ToolbarSeparator />

      <ToolbarButton title={t("toolbar.image")} icon={Image} isActive={false} onClick={() => onMediaClick("image")} />
      <ToolbarButton title={t("toolbar.video")} icon={Film} isActive={false} onClick={() => onMediaClick("video")} />
      <ToolbarButton title={t("toolbar.file")} icon={FileUp} isActive={false} onClick={() => onMediaClick("file")} />

      <ToolbarSeparator />

      <ToolbarButton
        title={t("toolbar.html")}
        icon={() => (
          <span className="text-2xs font-mono font-bold leading-none">&lt;/&gt;</span>
        )}
        isActive={showHtmlView}
        onClick={onHtmlView}
      />

      {onSplitClick && (
        <>
          <ToolbarSeparator />
          <ToolbarButton
            title={t("toolbar.split")}
            icon={Scissors}
            isActive={!!splitActive}
            onClick={onSplitClick}
          />
        </>
      )}
    </div>
  );
}
