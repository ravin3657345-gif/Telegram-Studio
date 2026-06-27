import { useState, useRef, useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { Baseline, Highlighter } from "lucide-react";

const TEXT_COLORS = [
  { label: "Стандартный", value: null },
  { label: "Красный",     value: "#e53e3e" },
  { label: "Оранжевый",   value: "#dd6b20" },
  { label: "Жёлтый",      value: "#d69e2e" },
  { label: "Зелёный",     value: "#38a169" },
  { label: "Синий",       value: "#3182ce" },
  { label: "Фиолетовый",  value: "#805ad5" },
  { label: "Серый",       value: "#718096" },
];

const HIGHLIGHT_COLORS = [
  { label: "Нет",          value: null },
  { label: "Жёлтый",       value: "#fef08a" },
  { label: "Зелёный",      value: "#bbf7d0" },
  { label: "Синий",        value: "#bfdbfe" },
  { label: "Розовый",      value: "#fecdd3" },
  { label: "Оранжевый",    value: "#fed7aa" },
  { label: "Фиолетовый",   value: "#e9d5ff" },
  { label: "Серый",        value: "#e5e7eb" },
];

interface ColorPickerProps {
  editor: Editor;
}

export function ColorPicker({ editor }: ColorPickerProps) {
  const [open, setOpen] = useState<"text" | "highlight" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const currentColor = editor.getAttributes("textStyle").color as string | null;
  const currentHighlight = editor.getAttributes("highlight").color as string | null;

  return (
    <div ref={ref} className="flex items-center gap-0.5">
      {/* Text color button */}
      <div className="relative">
        <button
          title="Цвет текста"
          onClick={() => setOpen(open === "text" ? null : "text")}
          className="flex items-center justify-center w-6 h-6 rounded transition-colors flex-col gap-0"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <Baseline size={11} />
          <div
            className="w-4 h-0.5 rounded-full"
            style={{ backgroundColor: currentColor ?? "var(--text-primary)" }}
          />
        </button>

        {open === "text" && (
          <ColorGrid
            colors={TEXT_COLORS}
            onSelect={(v) => {
              if (v) editor.chain().focus().setColor(v).run();
              else editor.chain().focus().unsetColor().run();
              setOpen(null);
            }}
            current={currentColor}
          />
        )}
      </div>

      {/* Highlight button */}
      <div className="relative">
        <button
          title="Выделение цветом"
          onClick={() => setOpen(open === "highlight" ? null : "highlight")}
          className="flex items-center justify-center w-6 h-6 rounded transition-colors"
          style={{ color: "var(--text-secondary)" }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <Highlighter size={12} />
        </button>

        {open === "highlight" && (
          <ColorGrid
            colors={HIGHLIGHT_COLORS}
            onSelect={(v) => {
              if (v) editor.chain().focus().setHighlight({ color: v }).run();
              else editor.chain().focus().unsetHighlight().run();
              setOpen(null);
            }}
            current={currentHighlight}
          />
        )}
      </div>
    </div>
  );
}

function ColorGrid({
  colors,
  onSelect,
  current,
}: {
  colors: { label: string; value: string | null }[];
  onSelect: (v: string | null) => void;
  current: string | null | undefined;
}) {
  return (
    <div
      className="absolute left-0 top-full mt-1 rounded-lg z-50 p-1.5 grid gap-1"
      style={{
        backgroundColor: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
        gridTemplateColumns: "repeat(4, 1fr)",
        width: 120,
      }}
    >
      {colors.map(({ label, value }) => (
        <button
          key={label}
          title={label}
          onClick={() => onSelect(value)}
          className="w-6 h-6 rounded-md border-2 transition-transform hover:scale-110"
          style={{
            backgroundColor: value ?? "transparent",
            borderColor: current === value ? "var(--accent)" : "var(--border-default)",
            backgroundImage: value ? undefined : "linear-gradient(135deg, transparent 45%, var(--border-default) 45%, var(--border-default) 55%, transparent 55%)",
          }}
        />
      ))}
    </div>
  );
}
