import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { FileText, X } from "lucide-react";
import { fileRegistry } from "@/lib/fileRegistry";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function DocumentNodeView({ node, deleteNode, selected }: any) {
  const { fileName, fileSize } = node.attrs;

  return (
    <NodeViewWrapper as="div" style={{ display: "block", margin: "8px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderRadius: 8,
          background: "var(--bg-surface)",
          border: `2px solid ${selected ? "var(--accent)" : "var(--border-subtle)"}`,
          transition: "border-color 0.1s",
          position: "relative",
          maxWidth: 340,
        }}
      >
        <FileText size={28} style={{ flexShrink: 0, color: "var(--accent)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--text-primary)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {fileName}
          </div>
          {fileSize > 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {formatFileSize(fileSize)}
            </div>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            fileRegistry.remove(node.attrs.fileId);
            deleteNode();
          }}
          contentEditable={false}
          style={{
            background: "var(--bg-hover)",
            border: "none",
            borderRadius: "50%",
            width: 24,
            height: 24,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-muted)",
            flexShrink: 0,
          }}
        >
          <X size={12} />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

export const BlockDocument = Node.create({
  name: "blockDocument",
  group: "block",
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      fileId:   { default: null },
      fileName: { default: "document" },
      mimeType: { default: "application/octet-stream" },
      fileSize: { default: 0 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-block-document]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block-document": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocumentNodeView);
  },
});
