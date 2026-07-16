import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { X, RefreshCw } from "lucide-react";
import { useRef } from "react";
import { fileRegistry } from "@/lib/fileRegistry";
import { useEditorStore } from "@/store/editorStore";
import { ALLOWED_IMAGE_TYPES, TELEGRAM_MAX_PHOTO_SIZE } from "@/lib/constants";
import { t, ti } from "@/lib/i18n";
import { toast } from "@/store/uiStore";
import { isInMediaGroup, toggleMediaGroupLayout } from "./mediaGroupLayout";
import { MediaGroupLayoutToggle } from "./MediaGroupLayoutToggle";

const plateBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 22,
  height: 22,
  borderRadius: 6,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "white",
};

function ImageNodeView({ node, deleteNode, selected, editor, getPos }: any) {
  const { src, alt, groupLayout } = node.attrs;
  const publishMode = useEditorStore((s) => s.publishMode);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  // getPos() can return undefined (not just be absent) when the node's
  // position is transiently unresolvable mid-transaction — `!== null` let
  // that slip through into isInMediaGroup, which then crashed on
  // doc.resolve(undefined). See mediaGroupLayout.ts for the matching guard.
  const rawPos = typeof getPos === "function" ? getPos() : null;
  const pos = typeof rawPos === "number" ? rawPos : null;
  const inGroup = publishMode === "rich" && pos !== null && isInMediaGroup(editor, pos);

  function handleReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error(ti("editor.unsupportedType", { type: file.type }));
      return;
    }
    if (file.size > TELEGRAM_MAX_PHOTO_SIZE) {
      const mb = (TELEGRAM_MAX_PHOTO_SIZE / (1024 * 1024)).toFixed(0);
      toast.error(ti("editor.fileTooBig", { mb }));
      return;
    }
    if (pos === null) return;

    const oldFileId = node.attrs.fileId;
    const { id, src: newSrc } = fileRegistry.add(file);
    const tr = editor.state.tr;
    tr.setNodeAttribute(pos, "src", newSrc);
    tr.setNodeAttribute(pos, "fileId", id);
    tr.setNodeAttribute(pos, "fileName", file.name);
    tr.setNodeAttribute(pos, "mimeType", file.type);
    tr.setNodeAttribute(pos, "fileSize", file.size);
    editor.view.dispatch(tr);
    if (oldFileId) fileRegistry.remove(oldFileId);
  }

  return (
    <NodeViewWrapper
      as="div"
      style={{ display: "block", margin: "8px 0", position: "relative" }}
    >
      <div
        style={{
          borderRadius: 8,
          overflow: "hidden",
          outline: selected ? "2px solid var(--accent)" : "2px solid transparent",
          transition: "outline 0.1s",
          backgroundColor: "var(--bg-surface)",
          position: "relative",
        }}
        className="block-image-container"
      >
        <img
          src={src}
          alt={alt ?? ""}
          draggable={false}
          style={{
            width: "100%",
            maxHeight: 400,
            objectFit: "contain",
            display: "block",
          }}
        />

        {inGroup && (
          <MediaGroupLayoutToggle
            layout={groupLayout || "collage"}
            onClick={() => pos !== null && toggleMediaGroupLayout(editor, pos)}
          />
        )}

        <div
          contentEditable={false}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            display: "flex",
            alignItems: "center",
            gap: 1,
            padding: 2,
            borderRadius: 8,
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(2px)",
          }}
        >
          <button
            onClick={() => replaceInputRef.current?.click()}
            title={t("block.replaceImage")}
            style={plateBtnStyle}
          >
            <RefreshCw size={12} />
          </button>
          <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.25)" }} />
          <button
            onClick={() => {
              fileRegistry.remove(node.attrs.fileId);
              deleteNode();
            }}
            title={t("common.delete")}
            style={plateBtnStyle}
          >
            <X size={13} />
          </button>
        </div>

        <input
          ref={replaceInputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          className="hidden"
          onChange={handleReplaceFile}
        />
      </div>
    </NodeViewWrapper>
  );
}

export const BlockImage = Node.create({
  name: "blockImage",
  group: "block",
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      src:      { default: null },
      alt:      { default: null },
      fileId:   { default: null },
      fileName: { default: "image.jpg" },
      mimeType: { default: "image/jpeg" },
      fileSize: { default: 0 },
      // "collage" (grid) or "slideshow" (carousel) — only matters in Rich
      // mode, and only once this block is part of a run of 2+ adjacent
      // images/videos (see mediaGroupLayout.ts).
      groupLayout: { default: "collage" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-block-image]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block-image": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});
