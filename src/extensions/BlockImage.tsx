import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { X } from "lucide-react";
import { fileRegistry } from "@/lib/fileRegistry";
import { useEditorStore } from "@/store/editorStore";
import { isInMediaGroup, toggleMediaGroupLayout } from "./mediaGroupLayout";
import { MediaGroupLayoutToggle } from "./MediaGroupLayoutToggle";

function ImageNodeView({ node, deleteNode, selected, editor, getPos }: any) {
  const { src, alt, groupLayout } = node.attrs;
  const publishMode = useEditorStore((s) => s.publishMode);
  const pos = typeof getPos === "function" ? getPos() : null;
  const inGroup = publishMode === "rich" && pos !== null && isInMediaGroup(editor, pos);

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

        <button
          onClick={() => {
            fileRegistry.remove(node.attrs.fileId);
            deleteNode();
          }}
          contentEditable={false}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "rgba(0,0,0,0.55)",
            border: "none",
            borderRadius: "50%",
            width: 28,
            height: 28,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
          }}
        >
          <X size={14} />
        </button>
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
