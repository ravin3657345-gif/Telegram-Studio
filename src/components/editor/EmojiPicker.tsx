import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Picker from "@emoji-mart/react";
import data from "@emoji-mart/data";
import { GripHorizontal, X } from "lucide-react";

interface EmojiPickerProps {
  onSelect: (native: string) => void;
  onClose: () => void;
  anchorRect?: DOMRect;
}

const PICKER_W = 352;
const PICKER_H = 400;

export function EmojiPicker({ onSelect, onClose, anchorRect }: EmojiPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  function calcInitial() {
    if (!anchorRect) {
      return {
        x: Math.max(8, (window.innerWidth  - PICKER_W) / 2),
        y: Math.max(8, (window.innerHeight - PICKER_H) / 2),
      };
    }
    let x = anchorRect.left;
    let y = anchorRect.bottom + 8;
    x = Math.min(x, window.innerWidth  - PICKER_W - 8);
    y = Math.min(y, window.innerHeight - PICKER_H - 8);
    x = Math.max(8, x);
    y = Math.max(8, y);
    return { x, y };
  }

  const [pos, setPos] = useState(calcInitial);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // After first render, check actual rendered size and clamp to viewport
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let { x, y } = pos;
    if (rect.right  > window.innerWidth  - 8) x = window.innerWidth  - rect.width  - 8;
    if (rect.bottom > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
    x = Math.max(8, x);
    y = Math.max(8, y);
    if (x !== pos.x || y !== pos.y) setPos({ x, y });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onHandleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      const nx = Math.max(0, Math.min(window.innerWidth  - PICKER_W, dragRef.current.origX + dx));
      const ny = Math.max(0, Math.min(window.innerHeight - PICKER_H - 40, dragRef.current.origY + dy));
      setPos({ x: nx, y: ny });
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const path = e.composedPath();
      if (containerRef.current && !path.includes(containerRef.current)) onClose();
    };
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", handler); };
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function handleEmojiSelect(emoji: { native: string }) {
    onSelect(emoji.native);
  }

  const resolvedTheme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 60,
        // Explicit width — without it the flex column shrinks to the header and
        // the emoji-mart web component (width:100%) collapses to a narrow strip.
        width: PICKER_W,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={onHandleMouseDown}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px 4px 10px",
          background: resolvedTheme === "light" ? "#f0f0f0" : "#2a2a2a",
          cursor: "grab",
          userSelect: "none",
          flexShrink: 0,
        }}
      >
        <GripHorizontal size={14} style={{ color: resolvedTheme === "light" ? "#888" : "#666" }} />
        <button
          onMouseDown={e => e.stopPropagation()}
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px 4px",
            lineHeight: 0,
            color: resolvedTheme === "light" ? "#888" : "#666",
          }}
        >
          <X size={13} />
        </button>
      </div>

      <Picker
        data={data}
        onEmojiSelect={handleEmojiSelect}
        theme={resolvedTheme}
        // "native" renders emojis with the OS font instead of fetching PNG
        // sprites from cdn.jsdelivr.net — the app's CSP blocks that (fully
        // local, no network), which was leaving the whole picker blank.
        set="native"
        // Any locale other than "en" also pulls its strings from the same
        // CDN at runtime; "en" is the only one bundled locally.
        previewPosition="none"
        skinTonePosition="none"
      />
    </div>
  );
}
