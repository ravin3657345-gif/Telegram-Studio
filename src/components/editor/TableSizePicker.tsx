import { useState } from "react";
import { t } from "@/lib/i18n";

interface TableSizePickerProps {
  maxRows?: number;
  maxCols?: number;
  onPick: (rows: number, cols: number) => void;
}

// Notion/Google Docs-style hover grid: hover to preview an RxC size, click to
// confirm. Used both right after a table is inserted (default size) and any
// time later via the table's own resize button.
export function TableSizePicker({ maxRows = 8, maxCols = 8, onPick }: TableSizePickerProps) {
  const [hover, setHover] = useState({ r: 1, c: 1 });

  return (
    <div style={{ padding: 10 }} onMouseLeave={() => setHover({ r: 1, c: 1 })}>
      <div style={{ fontSize: 12, marginBottom: 6, color: "var(--text-muted)", textAlign: "center" }}>
        {hover.r} × {hover.c}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${maxCols}, 16px)`,
          gridTemplateRows: `repeat(${maxRows}, 16px)`,
          gap: 3,
        }}
      >
        {Array.from({ length: maxRows * maxCols }, (_, i) => {
          const r = Math.floor(i / maxCols) + 1;
          const c = (i % maxCols) + 1;
          const active = r <= hover.r && c <= hover.c;
          return (
            <div
              key={i}
              onMouseEnter={() => setHover({ r, c })}
              onClick={() => onPick(hover.r, hover.c)}
              title={t("table.pickSize")}
              style={{
                width: 16, height: 16, borderRadius: 3,
                border: `1px solid ${active ? "var(--accent)" : "var(--border-default)"}`,
                backgroundColor: active ? "var(--accent-subtle)" : "transparent",
                cursor: "pointer",
                transition: "background-color 60ms ease, border-color 60ms ease",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
