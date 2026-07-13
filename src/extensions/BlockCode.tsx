import { CodeBlock } from "@tiptap/extension-code-block";
import { ReactNodeViewRenderer, NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { ChevronDown } from "lucide-react";

const LANGUAGES = [
  { value: "",           label: "" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python",     label: "Python" },
  { value: "rust",       label: "Rust" },
  { value: "go",         label: "Go" },
  { value: "bash",       label: "Bash / Shell" },
  { value: "json",       label: "JSON" },
  { value: "html",       label: "HTML" },
  { value: "css",        label: "CSS" },
  { value: "sql",        label: "SQL" },
  { value: "java",       label: "Java" },
  { value: "c",          label: "C" },
  { value: "cpp",        label: "C++" },
  { value: "php",        label: "PHP" },
  { value: "ruby",       label: "Ruby" },
  { value: "swift",      label: "Swift" },
  { value: "kotlin",     label: "Kotlin" },
  { value: "xml",        label: "XML" },
  { value: "yaml",       label: "YAML" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CodeView({ node, updateAttributes }: any) {
  const language = (node.attrs?.language as string) ?? "";
  const [open, setOpen] = useState(false);
  const rawLabel = LANGUAGES.find((l) => l.value === language)?.label ?? "";
  const label = rawLabel || t("code.text");

  return (
    <NodeViewWrapper as="div" style={{ margin: "10px 0", position: "relative" }}>
      <div
        style={{
          backgroundColor: "var(--bg-elevated)",
          border: "1px solid var(--border-default)",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          contentEditable={false}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 12px",
            borderBottom: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-surface)",
            userSelect: "none",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
            {label}
          </span>

          {/* Language picker */}
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setOpen((v) => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                background: "none", border: "none", cursor: "pointer",
                color: "var(--text-muted)", fontSize: 11, padding: "2px 4px",
                borderRadius: 4,
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              {t("code.language")} <ChevronDown size={10} />
            </button>

            {open && (
              <div
                style={{
                  position: "absolute", right: 0, top: "100%", marginTop: 2,
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
                  zIndex: 50,
                  minWidth: 140,
                  maxHeight: 220,
                  overflowY: "auto",
                }}
              >
                {LANGUAGES.map((l) => (
                  <button
                    key={l.value}
                    onClick={() => { updateAttributes({ language: l.value }); setOpen(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "5px 10px", fontSize: 12,
                      color: l.value === language ? "var(--accent)" : "var(--text-secondary)",
                      backgroundColor: l.value === language ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent",
                      border: "none", cursor: "pointer",
                    }}
                    onMouseEnter={e => { if (l.value !== language) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
                    onMouseLeave={e => { e.currentTarget.style.backgroundColor = l.value === language ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent"; }}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Code content — editable */}
        <pre
          style={{
            margin: 0,
            padding: "14px 18px",
            overflowX: "auto",
            fontFamily: '"Geist Mono Variable", "JetBrains Mono", "Fira Code", monospace',
            fontSize: "12.5px",
            lineHeight: 1.7,
            whiteSpace: "pre",
            color: "var(--text-primary)",
          }}
        >
          <NodeViewContent as="code" />
        </pre>
      </div>
    </NodeViewWrapper>
  );
}

export const BlockCode = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeView);
  },
});
