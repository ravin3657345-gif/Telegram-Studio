import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { Plus, X, BarChart2 } from "lucide-react";
import { t, ti } from "@/lib/i18n";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PollView({ node, updateAttributes, deleteNode, selected }: any) {
  const {
    question = "",
    options = ["", ""],
    allowsMultipleAnswers = false,
  } = node.attrs as {
    question: string;
    options: string[];
    isAnonymous: boolean;
    allowsMultipleAnswers: boolean;
  };

  const opts: string[] = Array.isArray(options) ? options : ["", ""];

  function setOption(i: number, v: string) {
    const next = [...opts];
    next[i] = v;
    updateAttributes({ options: next });
  }
  function addOption() {
    if (opts.length >= 10) return;
    updateAttributes({ options: [...opts, ""] });
  }
  function removeOption(i: number) {
    if (opts.length <= 2) return;
    updateAttributes({ options: opts.filter((_, idx) => idx !== i) });
  }

  return (
    <NodeViewWrapper as="div" contentEditable={false} style={{ margin: "6px 0" }}>
      <div
        style={{
          border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-default)"}`,
          borderRadius: 8,
          overflow: "hidden",
          transition: "border-color 0.15s",
          backgroundColor: "var(--bg-surface)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            backgroundColor: "var(--bg-elevated)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <BarChart2 size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", flex: 1, letterSpacing: "0.05em" }}>
            {t("poll.label")}
          </span>
          <button
            onClick={deleteNode}
            title={t("poll.delete")}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-muted)", display: "flex", padding: 2,
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "#e05252")}
            onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}
          >
            <X size={13} />
          </button>
        </div>

        {/* Question */}
        <div style={{ padding: "10px 12px 6px" }}>
          <input
            value={question}
            onChange={e => updateAttributes({ question: e.target.value })}
            placeholder={t("poll.question")}
            onKeyDown={e => e.stopPropagation()}
            style={{
              width: "100%", border: "none", background: "transparent",
              color: "var(--text-primary)", fontSize: 14, fontWeight: 500, outline: "none",
            }}
          />
        </div>

        {/* Options */}
        <div style={{ padding: "0 12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
          {opts.map((opt, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span
                style={{
                  width: 16, height: 16, flexShrink: 0,
                  border: "1.5px solid var(--border-default)",
                  borderRadius: allowsMultipleAnswers ? 3 : 8,
                }}
              />
              <input
                value={opt}
                onChange={e => setOption(i, e.target.value)}
                placeholder={ti("poll.option", { n: i + 1 })}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); addOption(); }
                  e.stopPropagation();
                }}
                style={{
                  flex: 1, border: "none", background: "transparent",
                  color: "var(--text-secondary)", fontSize: 13, outline: "none",
                }}
              />
              {opts.length > 2 && (
                <button
                  onClick={() => removeOption(i)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex", padding: 1 }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "#e05252")}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
          {opts.length < 10 && (
            <button
              onClick={addOption}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                background: "none", border: "none", cursor: "pointer",
                color: "var(--accent)", fontSize: 12, padding: "2px 0", marginTop: 2,
              }}
            >
              <Plus size={12} /> {t("poll.addOption")}
            </button>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const BlockPoll = Node.create({
  name: "blockPoll",
  group: "block",
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      question:             { default: "" },
      options:              { default: ["", ""] },
      isAnonymous:          { default: true },
      allowsMultipleAnswers:{ default: false },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-block-poll]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block-poll": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PollView);
  },
});
