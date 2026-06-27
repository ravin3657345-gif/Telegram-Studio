import { useState } from "react";
import { Copy, Check, X } from "lucide-react";
import { segmentDocument } from "@/lib/htmlConverter";
import { useEditorStore } from "@/store/editorStore";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";

interface HtmlViewPanelProps {
  onClose: () => void;
}

export function HtmlViewPanel({ onClose }: HtmlViewPanelProps) {
  const { contentJson, postTitle } = useEditorStore();
  const [copied, setCopied] = useState(false);
  useSettingsStore((s) => s.language);

  const segments = segmentDocument(contentJson || '{"type":"doc","content":[]}', postTitle);

  const html = segments.map((s) => {
    if (s.type === "text")  return (s as { html: string }).html.trim();
    if (s.type === "image") return `<img src="${(s as { fileName: string }).fileName}">`;
    if (s.type === "video") return `<video src="${(s as { fileName: string }).fileName}"></video>`;
    return "";
  }).filter(Boolean).join("\n\n").trim();

  async function copy() {
    await navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="flex flex-col border-l flex-shrink-0"
      style={{
        width: 340,
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b flex-shrink-0"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          {t("html.title")}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={copy}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors"
            style={{
              backgroundColor: copied ? "var(--success)" : "var(--bg-elevated)",
              color: copied ? "#fff" : "var(--text-muted)",
            }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? t("html.copied") : t("html.copy")}
          </button>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded transition-colors"
            style={{ color: "var(--text-muted)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Segment breakdown */}
      <div className="flex-1 overflow-auto p-3 flex flex-col gap-3">
        {segments.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("html.empty")}
          </p>
        ) : (
          segments.map((seg, i) => {
            if (seg.type === "image" || seg.type === "video") {
              const isVideo = seg.type === "video";
              const s = seg as { type: string; fileName: string };
              const tag = isVideo
                ? `<video src="${s.fileName}"></video>`
                : `<img src="${s.fileName}">`;
              return (
                <div key={i}>
                  <div
                    className="text-2xs font-semibold uppercase tracking-wide mb-1"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {isVideo ? t("html.video") : t("html.image")}
                  </div>
                  <pre
                    className="text-xs leading-relaxed whitespace-pre-wrap break-all font-mono select-all rounded-md p-2"
                    style={{
                      color: "var(--accent)",
                      backgroundColor: "var(--bg-elevated)",
                    }}
                  >
                    {tag}
                  </pre>
                </div>
              );
            }
            if (seg.type === "file" || seg.type === "poll") return null;
            const s = seg as { html: string };
            const trimmed = s.html.trim();
            if (!trimmed) return null;
            return (
              <div key={i}>
                <div
                  className="text-2xs font-semibold uppercase tracking-wide mb-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t("html.text")}
                </div>
                <pre
                  className="text-xs leading-relaxed whitespace-pre-wrap break-all font-mono select-all rounded-md p-2"
                  style={{
                    color: "var(--text-secondary)",
                    backgroundColor: "var(--bg-elevated)",
                  }}
                >
                  {trimmed}
                </pre>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
