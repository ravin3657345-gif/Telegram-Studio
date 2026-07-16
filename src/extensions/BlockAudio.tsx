import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { X, Music } from "lucide-react";
import { fileRegistry } from "@/lib/fileRegistry";

// Rich Messages only (Bot API 10.1's RichBlockAudio/RichBlockVoiceNote, both
// the HTML tag <audio> — see richMessageConverter.ts). Normal mode has no
// equivalent "real playable audio" concept (attach as a generic file there
// instead), so this block converts to nothing outside Rich mode — see
// htmlConverter.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function AudioNodeView({ node, deleteNode, selected }: any) {
  const { src, fileName } = node.attrs;

  return (
    <NodeViewWrapper as="div" style={{ margin: "8px 0", position: "relative" }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 8,
          border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-default)"}`,
          backgroundColor: "var(--bg-surface)",
          transition: "border-color 0.1s",
        }}
      >
        <Music size={18} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, color: "var(--text-primary)", fontWeight: 500, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {fileName}
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            src={src}
            controls
            controlsList="nodownload noplaybackrate"
            preload="metadata"
            style={{ width: "100%", height: 32, display: "block" }}
          />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            fileRegistry.remove(node.attrs.fileId);
            deleteNode();
          }}
          contentEditable={false}
          style={{
            background: "none", border: "none", cursor: "pointer",
            color: "var(--text-muted)", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <X size={16} />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

export const BlockAudio = Node.create({
  name: "blockAudio",
  group: "block",
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      src:      { default: null },
      fileId:   { default: null },
      fileName: { default: "audio.mp3" },
      mimeType: { default: "audio/mpeg" },
      fileSize: { default: 0 },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-block-audio]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block-audio": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioNodeView);
  },
});
