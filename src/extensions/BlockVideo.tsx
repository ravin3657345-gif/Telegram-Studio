import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { X, Play } from "lucide-react";
import { useState, useRef } from "react";
import { fileRegistry } from "@/lib/fileRegistry";
import { useEditorStore } from "@/store/editorStore";
import { isInMediaGroup, toggleMediaGroupLayout } from "./mediaGroupLayout";
import { MediaGroupLayoutToggle } from "./MediaGroupLayoutToggle";

function VideoNodeView({ node, deleteNode, selected, editor, getPos }: any) {
  const { src, groupLayout } = node.attrs;
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const publishMode = useEditorStore((s) => s.publishMode);
  // getPos() can return undefined (not just be absent) when the node's
  // position is transiently unresolvable mid-transaction — `!== null` let
  // that slip through into isInMediaGroup, which then crashed on
  // doc.resolve(undefined). See mediaGroupLayout.ts for the matching guard.
  const rawPos = typeof getPos === "function" ? getPos() : null;
  const pos = typeof rawPos === "number" ? rawPos : null;
  const inGroup = publishMode === "rich" && pos !== null && isInMediaGroup(editor, pos);

  function toggle() {
    const v = ref.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    else          { v.play();  setPlaying(true);  }
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
          cursor: "pointer",
        }}
        onClick={toggle}
      >
        <video
          ref={ref}
          src={src}
          loop
          playsInline
          preload="metadata"
          style={{ width: "100%", maxHeight: 400, objectFit: "contain", display: "block" }}
          onEnded={() => setPlaying(false)}
        />

        {!playing && (
          <div
            style={{
              position: "absolute", inset: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(0,0,0,0.3)",
            }}
          >
            <div
              style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "rgba(0,0,0,0.5)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <Play size={22} fill="white" color="white" style={{ marginLeft: 3 }} />
            </div>
          </div>
        )}

        {inGroup && (
          <MediaGroupLayoutToggle
            layout={groupLayout || "collage"}
            onClick={() => pos !== null && toggleMediaGroupLayout(editor, pos)}
          />
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            fileRegistry.remove(node.attrs.fileId);
            deleteNode();
          }}
          contentEditable={false}
          style={{
            position: "absolute", top: 8, right: 8,
            background: "rgba(0,0,0,0.55)", border: "none",
            borderRadius: "50%", width: 28, height: 28,
            cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center", color: "white",
          }}
        >
          <X size={14} />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

export const BlockVideo = Node.create({
  name: "blockVideo",
  group: "block",
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      src:      { default: null },
      fileId:   { default: null },
      fileName: { default: "video.mp4" },
      mimeType: { default: "video/mp4" },
      fileSize: { default: 0 },
      groupLayout: { default: "collage" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-block-video]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block-video": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoNodeView);
  },
});
