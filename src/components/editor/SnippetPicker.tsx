import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GripHorizontal, X, Plus, Pencil, Trash2, ArrowLeft } from "lucide-react";
import { getSnippets, saveSnippet, deleteSnippet } from "@/lib/tauriApi";
import type { Snippet } from "@/types/snippet";
import { t } from "@/lib/i18n";

interface SnippetPickerProps {
  onSelect: (content: string) => void;
  onClose: () => void;
  anchorRect?: DOMRect;
}

const PICKER_W = 320;
const PICKER_H = 380;

// Same floating/draggable/outside-click-close shell as EmojiPicker.tsx —
// kept as a near-duplicate rather than a shared abstraction since the two
// pickers' *content* (emoji grid vs. a CRUD list) barely overlaps; the only
// shared piece is this positioning boilerplate.
export function SnippetPicker({ onSelect, onClose, anchorRect }: SnippetPickerProps) {
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

  const resolvedTheme = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";

  // ── Data + form state ──────────────────────────────────────────────────
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formContent, setFormContent] = useState("");
  const [saving, setSaving] = useState(false);

  function loadSnippets() {
    setLoading(true);
    getSnippets().then(setSnippets).catch(() => {}).finally(() => setLoading(false));
  }

  useEffect(() => { loadSnippets(); }, []);

  function openCreateForm() {
    setEditingId(null);
    setFormName("");
    setFormContent("");
    setShowForm(true);
  }

  function openEditForm(snippet: Snippet) {
    setEditingId(snippet.id);
    setFormName(snippet.name);
    setFormContent(snippet.content);
    setShowForm(true);
  }

  async function handleSaveForm() {
    if (!formName.trim() || !formContent.trim() || saving) return;
    setSaving(true);
    try {
      await saveSnippet({ id: editingId ?? undefined, name: formName.trim(), content: formContent });
      setShowForm(false);
      loadSnippets();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
    await deleteSnippet(id).catch(() => loadSnippets());
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 60,
        width: PICKER_W,
        maxHeight: PICKER_H,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--bg-surface)",
        border: "1px solid var(--border-default)",
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
        <div className="flex items-center gap-1.5">
          {showForm && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowForm(false)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 0, color: "var(--text-muted)" }}
            >
              <ArrowLeft size={13} />
            </button>
          )}
          <GripHorizontal size={14} style={{ color: resolvedTheme === "light" ? "#888" : "#666" }} />
        </div>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 4px", lineHeight: 0, color: resolvedTheme === "light" ? "#888" : "#666" }}
        >
          <X size={13} />
        </button>
      </div>

      {showForm ? (
        <div className="flex flex-col gap-2 p-3">
          <input
            autoFocus
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder={t("snippets.namePlaceholder")}
            maxLength={60}
            className="h-8 px-2.5 rounded-md text-sm border"
            style={{ backgroundColor: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)", outline: "none" }}
          />
          <textarea
            value={formContent}
            onChange={(e) => setFormContent(e.target.value)}
            placeholder={t("snippets.contentPlaceholder")}
            rows={6}
            className="px-2.5 py-2 rounded-md text-sm border resize-none"
            style={{ backgroundColor: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)", outline: "none", fontFamily: "inherit" }}
          />
          <button
            onClick={handleSaveForm}
            disabled={!formName.trim() || !formContent.trim() || saving}
            className="h-8 rounded-md text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: "var(--accent)", color: "white" }}
          >
            {t("snippets.save")}
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto" style={{ minHeight: 120 }}>
          {loading ? (
            <div className="px-3 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              {t("snippets.loading")}
            </div>
          ) : snippets.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              {t("snippets.empty")}
            </div>
          ) : (
            snippets.map((s) => (
              <div
                key={s.id}
                className="group flex items-center gap-1 px-3 py-2 cursor-pointer"
                onClick={() => onSelect(s.content)}
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{s.name}</div>
                  <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{s.content}</div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditForm(s); }}
                    className="flex items-center justify-center w-6 h-6 rounded"
                    style={{ color: "var(--text-muted)" }}
                    title={t("snippets.edit")}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                    className="flex items-center justify-center w-6 h-6 rounded"
                    style={{ color: "var(--danger)" }}
                    title={t("snippets.delete")}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {!showForm && (
        <button
          onClick={openCreateForm}
          className="flex items-center justify-center gap-1.5 h-9 text-sm flex-shrink-0"
          style={{ borderTop: "1px solid var(--border-subtle)", color: "var(--accent)" }}
        >
          <Plus size={14} />
          {t("snippets.add")}
        </button>
      )}
    </div>
  );
}
