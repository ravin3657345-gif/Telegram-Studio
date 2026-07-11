import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import { useMemo } from "react";
import { Sigma, X } from "lucide-react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { t } from "@/lib/i18n";

// Rich Messages only (Bot API 10.1's RichBlockMathematicalExpression — HTML
// tag <tg-math-block> for a standalone block, vs. inline <tg-math> inside a
// <p> for text-level formulas; see richMessageConverter.ts). Undocumented,
// confirmed live: sent `<tg-math-block>\frac{n(n+1)}{2}</tg-math-block>`,
// got back {type:"mathematical_expression", expression:"\frac{n(n+1)}{2}"}
// with the backslash intact — raw LaTeX source travels through as-is, no
// extra escaping needed on our end (JSON.stringify already handles it).
// This block only covers the standalone/block form, not inline formulas —
// keeps it consistent with the rest of the editor being block-based.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FormulaNodeView({ node, updateAttributes, deleteNode, selected }: any) {
  const { expression } = node.attrs as { expression: string };

  const { html, error } = useMemo(() => {
    if (!expression.trim()) return { html: "", error: null };
    try {
      return { html: katex.renderToString(expression, { throwOnError: true, displayMode: true }), error: null };
    } catch (e) {
      return { html: "", error: e instanceof Error ? e.message : String(e) };
    }
  }, [expression]);

  return (
    <NodeViewWrapper as="div" contentEditable={false} style={{ margin: "8px 0" }}>
      <div
        style={{
          display: "flex", flexDirection: "column", gap: 8,
          padding: "10px 12px", borderRadius: 8,
          border: `1.5px solid ${selected ? "var(--accent)" : "var(--border-default)"}`,
          backgroundColor: "var(--bg-surface)",
          transition: "border-color 0.1s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Sigma size={16} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: "var(--text-primary)", fontWeight: 500, flex: 1 }}>
            {t("block.formula")}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); deleteNode(); }}
            title={t("block.delete")}
            style={{
              flexShrink: 0, display: "flex", background: "none", border: "none",
              cursor: "pointer", padding: 2, borderRadius: 4, color: "var(--text-muted)",
            }}
          >
            <X size={14} />
          </button>
        </div>

        <input
          value={expression}
          onChange={(e) => updateAttributes({ expression: e.target.value })}
          placeholder={t("block.formulaPlaceholder")}
          spellCheck={false}
          style={{
            border: "1px solid var(--border-subtle)", borderRadius: 6,
            padding: "6px 8px", fontSize: 13, color: "var(--text-primary)",
            background: "var(--bg-elevated)", outline: "none",
            fontFamily: "var(--font-mono, monospace)",
          }}
        />

        {error && (
          <div style={{ fontSize: 11.5, color: "#e05252" }}>{t("block.formulaError")}: {error}</div>
        )}
        {html && (
          // eslint-disable-next-line react/no-danger
          <div style={{ overflowX: "auto", padding: "4px 0" }} dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const BlockFormula = Node.create({
  name: "blockFormula",
  group: "block",
  atom: true,
  draggable: false,
  selectable: true,

  addAttributes() {
    return {
      expression: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-block-formula]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-block-formula": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FormulaNodeView);
  },
});
