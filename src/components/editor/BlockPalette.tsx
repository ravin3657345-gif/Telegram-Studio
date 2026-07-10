import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Editor } from "@tiptap/react";
import { GripVertical, Plus } from "lucide-react";
import { getSlashItems, type SlashItem, type BlockPreviewType } from "@/extensions/SlashCommand";
import {
  getNestedDropInfo, listBlocks, setGapBefore, clearGap,
  getEditorScrollContainer, createAutoScroller, createDropIndicatorLine,
  createContainerHighlighter, snapshotBlockRects, type NestedDropInfo, type GapRef,
} from "@/lib/blockGeometry";
import { useSettingsStore } from "@/store/settingsStore";
import { t } from "@/lib/i18n";

interface BlockPaletteProps {
  editor: Editor;
}

// Creates a fresh empty paragraph at `pos`, moves the selection into it, then
// runs the slash item's own command against that selection — mirrors exactly
// what already happens when a user types "/" inside a blank line, so every
// item (toggle-based like headings/quotes, or insertContent-based like
// polls/FAQ) behaves the same way here as it does from the "/" menu.
function insertBlockAt(editor: Editor, pos: number, item: SlashItem) {
  // Blocked items (audio/table in non-Rich mode, poll in Rich/Telegraph) only
  // show a warning toast and insert nothing — run the command as-is, WITHOUT
  // the placeholder paragraph below, so a blocked drop never leaves a blank
  // line behind with nothing to show for it.
  if (item.isBlocked?.()) {
    item.command(editor);
    return;
  }
  if (item.previewType === "quote") {
    // toggleBlockquote() is a *toggle* — if `pos` is already inside an
    // existing blockquote (dropping a quote nested inside another one),
    // it reads the insertion point as "already active" and lifts the fresh
    // paragraph back OUT instead of wrapping it in a new nested blockquote,
    // so nothing visibly gets inserted. Construct the wrapped node directly
    // instead of going through the ambiguous toggle command — works
    // identically at the top level too, so no special-casing by depth needed.
    const { schema } = editor.state;
    const node = schema.nodes.blockquote.create(null, schema.nodes.paragraph.create());
    const tr = editor.state.tr.insert(pos, node);
    editor.view.dispatch(tr);
    editor.commands.setTextSelection(pos + 2); // inside blockquote > paragraph
    editor.commands.focus();
    return;
  }
  const paragraph = editor.state.schema.nodes.paragraph.create();
  const tr = editor.state.tr.insert(pos, paragraph);
  editor.view.dispatch(tr);
  editor.commands.setTextSelection(pos + 1);
  item.command(editor);
  editor.commands.focus();
}

// Renders what a freshly-inserted, still-empty instance of this block type
// actually looks like in the document (real tag + real tiptap.css classes,
// under a `.tiptap-editor-root` wrapper so those scoped selectors apply) —
// undefined for block types with no simple CSS-only equivalent (image/video/
// FAQ/poll/variable have real interactive NodeViews, not just typography).
const PREVIEW_BUILDERS: Partial<Record<BlockPreviewType, (label: string) => HTMLElement>> = {
  paragraph: (label) => { const el = document.createElement("p"); el.textContent = label; return el; },
  h1: (label) => { const el = document.createElement("h1"); el.className = "tiptap-heading"; el.textContent = label; return el; },
  h2: (label) => { const el = document.createElement("h2"); el.className = "tiptap-heading"; el.textContent = label; return el; },
  h3: (label) => { const el = document.createElement("h3"); el.className = "tiptap-heading"; el.textContent = label; return el; },
  quote: (label) => { const el = document.createElement("blockquote"); el.textContent = label; return el; },
  code: (label) => {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = label;
    pre.appendChild(code);
    return pre;
  },
  list: (label) => {
    const ul = document.createElement("ul");
    const li = document.createElement("li");
    li.textContent = label;
    ul.appendChild(li);
    return ul;
  },
  orderedList: (label) => {
    const ol = document.createElement("ol");
    const li = document.createElement("li");
    li.textContent = label;
    ol.appendChild(li);
    return ol;
  },
  divider: () => { const el = document.createElement("hr"); el.className = "tiptap-hr"; return el; },
  checklist: (label) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:8px;";
    const box = document.createElement("span");
    box.style.cssText = "width:16px;height:16px;border:1.5px solid var(--border-strong);border-radius:4px;flex-shrink:0;display:inline-block;";
    const text = document.createElement("span");
    text.textContent = label;
    text.style.cssText = "font-size:14px;color:var(--text-primary);";
    row.append(box, text);
    return row;
  },
  callout: (label) => {
    const box = document.createElement("div");
    box.style.cssText = "display:flex;gap:8px;align-items:center;background:var(--accent-subtle);border-radius:8px;padding:8px 10px;";
    const emoji = document.createElement("span");
    emoji.textContent = "💡";
    const text = document.createElement("span");
    text.textContent = label;
    text.style.cssText = "font-size:14px;color:var(--text-primary);";
    box.append(emoji, text);
    return box;
  },
  // Mirrors BlockFAQ.tsx's collapsed row: bordered box, 🙈, question text.
  faq: (label) => {
    const box = document.createElement("div");
    box.style.cssText = "display:flex;align-items:center;gap:8px;border:1.5px solid var(--border-default);border-radius:8px;padding:10px 12px;background:var(--bg-elevated);";
    const emoji = document.createElement("span");
    emoji.textContent = "🙈";
    emoji.style.cssText = "font-size:15px;flex-shrink:0;";
    const text = document.createElement("span");
    text.textContent = label;
    text.style.cssText = "font-size:14px;color:var(--text-primary);";
    box.append(emoji, text);
    return box;
  },
  // Mirrors BlockPoll.tsx's header + question + a couple of option rows.
  poll: (label) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "border:1.5px solid var(--border-default);border-radius:8px;overflow:hidden;background:var(--bg-surface);";
    const header = document.createElement("div");
    header.style.cssText = "padding:6px 10px;background:var(--bg-elevated);border-bottom:1px solid var(--border-subtle);font-size:10px;font-weight:600;color:var(--text-muted);letter-spacing:0.05em;";
    header.textContent = `📊 ${t("poll.label")}`;
    const question = document.createElement("div");
    question.style.cssText = "padding:8px 10px 4px;font-size:13px;font-weight:500;color:var(--text-primary);";
    question.textContent = label;
    const opt1 = document.createElement("div");
    opt1.style.cssText = "margin:0 10px 4px;height:20px;border:1px solid var(--border-subtle);border-radius:5px;background:var(--bg-elevated);";
    const opt2 = document.createElement("div");
    opt2.style.cssText = "margin:0 10px 8px;height:20px;border:1px solid var(--border-subtle);border-radius:5px;background:var(--bg-elevated);";
    wrap.append(header, question, opt1, opt2);
    return wrap;
  },
  // A plain 2x2 grid — real column/row count is chosen after insertion via
  // the table's own resize widget, so the preview doesn't need to match it.
  // Wrapped in .tiptap-table-wrapper to match the real NodeView's DOM shape
  // (see BlockTable.tsx), since that's what the CSS actually targets.
  table: () => {
    const wrapper = document.createElement("div");
    wrapper.className = "tiptap-table-wrapper";
    const table = document.createElement("table");
    for (let r = 0; r < 2; r++) {
      const tr = document.createElement("tr");
      for (let c = 0; c < 2; c++) {
        const cell = document.createElement(r === 0 ? "th" : "td");
        cell.className = "tiptap-table-cell";
        cell.innerHTML = "&nbsp;";
        tr.appendChild(cell);
      }
      table.appendChild(tr);
    }
    wrapper.appendChild(table);
    return wrapper;
  },
};

// A single fixed-position shell whose CONTENT we swap between "looks like the
// panel row" and "looks like the real block" as the drag crosses into the
// editor — rather than juggling two separately-positioned elements.
function makeGhostShell(width: number): HTMLDivElement {
  const shell = document.createElement("div");
  shell.style.cssText = `
    position: fixed;
    width: ${width}px;
    pointer-events: none;
    z-index: 9999;
    border-radius: 8px;
    box-shadow: 0 8px 20px rgba(0,0,0,0.2);
  `;
  document.body.appendChild(shell);
  return shell;
}

function fillGhostAsRow(shell: HTMLDivElement, rowEl: HTMLElement) {
  shell.className = "";
  shell.innerHTML = "";
  shell.style.background = "var(--bg-elevated)";
  shell.style.border = "1px solid var(--border-default)";
  shell.style.opacity = "0.95";
  shell.style.padding = "0";
  const clone = rowEl.cloneNode(true) as HTMLElement;
  clone.style.pointerEvents = "none";
  clone.style.backgroundColor = "transparent";
  shell.appendChild(clone);
}

/** Returns false (and leaves the shell untouched) when this block type has no preview mapping. */
function fillGhostAsPreview(shell: HTMLDivElement, item: SlashItem): boolean {
  const build = PREVIEW_BUILDERS[item.previewType];
  if (!build) return false;
  shell.className = "tiptap-editor-root";
  shell.innerHTML = "";
  shell.style.background = "var(--bg-app)";
  shell.style.border = "1px solid var(--border-default)";
  shell.style.opacity = "0.95";
  shell.style.padding = "10px 16px";
  shell.appendChild(build(item.label));
  return true;
}

const DRAG_THRESHOLD = 4;

export function BlockPalette({ editor }: BlockPaletteProps) {
  useSettingsStore((s) => s.language); // реактивность при смене языка — getSlashItems() читает t()
  const items = getSlashItems();
  const [selected, setSelected] = useState<number | null>(null);

  function handleInsertSelected() {
    if (selected === null) return;
    insertBlockAt(editor, editor.state.doc.content.size, items[selected]);
    setSelected(null);
  }

  function beginDrag(item: SlashItem, rowEl: HTMLElement, startX: number, startY: number) {
    const view = editor.view;
    // `view.dom` (the ProseMirror content div) only sizes to fit its own
    // content — for a short/near-empty post that's much smaller than the
    // visible white canvas beneath it. Hit-test against the scrollable
    // canvas container instead, so dropping anywhere in that visible area
    // (including well below the last block) counts as "over the editor"
    // and resolves to inserting at the end, rather than being cancelled.
    const canvasEl = getEditorScrollContainer(view);
    const rowRect = rowEl.getBoundingClientRect();
    const grabOffsetX = startX - rowRect.left;
    const grabOffsetY = startY - rowRect.top;
    const ghostHeight = rowRect.height;

    const shell = makeGhostShell(rowRect.width);
    fillGhostAsRow(shell, rowEl);
    let usingPreview = false;

    let gapRef: GapRef | null = null;
    const dropLine = createDropIndicatorLine();
    const containerHighlighter = createContainerHighlighter();
    const snapshot = snapshotBlockRects(view);
    let dropInfo: NestedDropInfo | null = null;

    function positionGhost(x: number, y: number, nested: boolean) {
      shell.style.left = `${x - grabOffsetX + (nested ? 10 : 0)}px`;
      shell.style.top = `${y - grabOffsetY}px`;
      shell.style.transform = nested ? "scale(0.96)" : "";
    }
    positionGhost(startX, startY, false);

    function handleMove(clientX: number, clientY: number) {
      const editorRect = canvasEl.getBoundingClientRect();
      const overEditor =
        clientX >= editorRect.left && clientX <= editorRect.right &&
        clientY >= editorRect.top && clientY <= editorRect.bottom;

      // Swap the ghost's look right as it crosses into the editor — panel
      // chip outside, real block typography inside (falls back to the panel
      // look for block types with no simple CSS-only equivalent).
      if (overEditor && !usingPreview) {
        usingPreview = fillGhostAsPreview(shell, item);
      } else if (!overEditor && usingPreview) {
        fillGhostAsRow(shell, rowEl);
        usingPreview = false;
      }

      if (!overEditor) {
        clearGap(gapRef);
        gapRef = null;
        containerHighlighter.update(null);
        dropLine.update(null);
        dropInfo = null;
        positionGhost(clientX, clientY, false);
        return;
      }
      const info = getNestedDropInfo(view, clientX, clientY, snapshot);
      if (!info) {
        clearGap(gapRef);
        gapRef = null;
        containerHighlighter.update(null);
        dropLine.update(null);
        dropInfo = null;
        positionGhost(clientX, clientY, false);
        return;
      }
      dropInfo = info;
      containerHighlighter.update(info.container?.el ?? null);
      dropLine.update(info);
      positionGhost(clientX, clientY, info.container !== null);
      const blocks = listBlocks(view, info.scope).map((b) => b.el);
      const beforeEl = blocks[info.gapIndex] ?? null;
      gapRef = setGapBefore(gapRef, beforeEl, blocks, ghostHeight);
    }

    let lastClientX = startX;
    const scroller = createAutoScroller(canvasEl, (y) => handleMove(lastClientX, y));
    scroller.update(startY);

    function onPointerMove(ev: PointerEvent) {
      lastClientX = ev.clientX;
      scroller.update(ev.clientY);
      handleMove(ev.clientX, ev.clientY);
    }

    function onPointerUp() {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      scroller.stop();
      shell.remove();
      clearGap(gapRef);
      gapRef = null;
      containerHighlighter.update(null);
      dropLine.remove();
      if (dropInfo !== null) insertBlockAt(editor, dropInfo.pos, item);
    }

    scroller.start();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  // A single pointerdown on the whole row — grab anywhere, not just a grip
  // icon. Movement past DRAG_THRESHOLD hands off to the real drag; releasing
  // before that threshold is just a click (toggles the row's selection).
  function handleRowPointerDown(item: SlashItem, index: number, e: React.PointerEvent) {
    if (e.button !== 0) return;
    const rowEl = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    function onMove(ev: PointerEvent) {
      if (dragging) return;
      if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      beginDrag(item, rowEl, startX, startY);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!dragging) setSelected((s) => (s === index ? null : index));
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div
      className="flex flex-col border-l flex-shrink-0"
      style={{ width: 220, backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
    >
      <div
        className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide border-b flex-shrink-0"
        style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
      >
        {t("palette.title")}
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {items.map((item, i) => {
          const isSelected = selected === i;
          return (
            <div
              key={item.label}
              onPointerDown={(e) => handleRowPointerDown(item, i, e)}
              className="palette-row flex items-center gap-2 px-3 py-1.5 mx-1.5 rounded-md"
              style={{
                backgroundColor: isSelected ? "var(--accent-subtle)" : "transparent",
                transition: "background-color 0.1s",
                cursor: "grab",
              }}
              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = "transparent"; }}
            >
              <item.icon
                size={14}
                strokeWidth={1.75}
                style={{ flexShrink: 0, color: isSelected ? "var(--accent)" : "var(--text-muted)" }}
              />
              <span
                className="text-xs flex-1 truncate"
                style={{ color: isSelected ? "var(--accent)" : "var(--text-primary)" }}
              >
                {item.label}
              </span>
              <span title={t("palette.drag")} style={{ display: "flex", color: "var(--text-muted)", flexShrink: 0 }}>
                <GripVertical size={13} />
              </span>
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {selected !== null && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.12 }}
            className="p-2 border-t flex-shrink-0"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <button
              onClick={handleInsertSelected}
              className="flex items-center justify-center gap-1.5 w-full h-8 rounded-lg text-xs font-semibold"
              style={{ backgroundColor: "var(--accent)", color: "#fff", border: "none", cursor: "pointer" }}
            >
              <Plus size={13} />
              {t("palette.insert")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
