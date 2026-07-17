import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Editor } from "@tiptap/react";
import { Plus, ChevronDown } from "lucide-react";
import { getSlashItems, type SlashItem, type BlockPreviewType, type BlockGroup } from "@/extensions/SlashCommand";
import {
  getNestedDropInfo, listBlocks, setGapBefore, clearGap, clearGapTransitions,
  getEditorScrollContainer, createAutoScroller, createDropIndicatorLine,
  createContainerHighlighter, snapshotBlockRects, createGhostFollower, flipSettle, type NestedDropInfo, type GapRef,
} from "@/lib/blockGeometry";
import { useSettingsStore } from "@/store/settingsStore";
import { t } from "@/lib/i18n";

interface BlockPaletteProps {
  editor: Editor;
  /** Rendered inside the right panel in place of the Telegram preview (when
   * the preview is toggled off) instead of docked next to the editor in its
   * own fixed-width, left-bordered column — the parent column already
   * supplies both. */
  fill?: boolean;
}

// Creates a fresh empty paragraph at `pos`, moves the selection into it, then
// runs the slash item's own command against that selection — mirrors exactly
// what already happens when a user types "/" inside a blank line, so every
// item (toggle-based like headings/quotes, or insertContent-based like
// polls/FAQ) behaves the same way here as it does from the "/" menu.
function insertBlockAt(editor: Editor, pos: number, item: SlashItem) {
  // Blocked items (audio/table in non-Rich mode, poll in Rich mode) only
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
  // Mirrors BlockMap.tsx's collapsed row: bordered box, pin emoji, label.
  map: (label) => {
    const box = document.createElement("div");
    box.style.cssText = "display:flex;align-items:center;gap:8px;border:1.5px solid var(--border-default);border-radius:8px;padding:10px 12px;background:var(--bg-elevated);";
    const emoji = document.createElement("span");
    emoji.textContent = "📍";
    emoji.style.cssText = "font-size:15px;flex-shrink:0;";
    const text = document.createElement("span");
    text.textContent = label;
    text.style.cssText = "font-size:14px;color:var(--text-primary);";
    box.append(emoji, text);
    return box;
  },
  // Mirrors BlockFormula.tsx's collapsed row: bordered box, sigma, label.
  formula: (label) => {
    const box = document.createElement("div");
    box.style.cssText = "display:flex;align-items:center;gap:8px;border:1.5px solid var(--border-default);border-radius:8px;padding:10px 12px;background:var(--bg-elevated);";
    const emoji = document.createElement("span");
    emoji.textContent = "∑";
    emoji.style.cssText = "font-size:15px;flex-shrink:0;color:var(--text-muted);";
    const text = document.createElement("span");
    text.textContent = label;
    text.style.cssText = "font-size:14px;color:var(--text-primary);";
    box.append(emoji, text);
    return box;
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

// Fixed display order for the palette's collapsible sections — getSlashItems()
// itself stays a flat array (unchanged for the slash-menu's search/filter use,
// which has no concept of sections), this is purely how BlockPalette buckets
// that array for display.
const GROUP_ORDER: { key: BlockGroup; labelKey: "palette.group.text" | "palette.group.lists" | "palette.group.media" | "palette.group.blocks" | "palette.group.interactive" }[] = [
  { key: "text", labelKey: "palette.group.text" },
  { key: "lists", labelKey: "palette.group.lists" },
  { key: "media", labelKey: "palette.group.media" },
  { key: "blocks", labelKey: "palette.group.blocks" },
  { key: "interactive", labelKey: "palette.group.interactive" },
];

// Collapse state is per-device UI preference, not app data — persisted to
// localStorage (not the settings store/DB) so it survives BlockPalette
// remounting (e.g. toggling the Telegram preview swaps it between two
// different mount points in EditorPage) without needing a backend round-trip.
const COLLAPSE_STORAGE_KEY = "tstudio.palette.collapsedGroups";

function loadCollapsedGroups(): Set<BlockGroup> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function BlockPalette({ editor, fill }: BlockPaletteProps) {
  useSettingsStore((s) => s.language); // реактивность при смене языка — getSlashItems() читает t()
  const items = getSlashItems();
  const [selected, setSelected] = useState<number | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<BlockGroup>>(loadCollapsedGroups);

  function toggleGroup(key: BlockGroup) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try { localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

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
    // Reflow gap should match what's actually about to land, not the small
    // palette chip being dragged — reassigned below once the ghost switches
    // to its real-block preview (a table/poll/callout preview is much taller
    // than its palette row), so the gap opens to the right size instead of a
    // sliver that doesn't match the block that then drops into it.
    let ghostHeight = rowRect.height;

    const shell = makeGhostShell(rowRect.width);
    fillGhostAsRow(shell, rowEl);
    let usingPreview = false;

    let gapRef: GapRef | null = null;
    const dropLine = createDropIndicatorLine();
    const containerHighlighter = createContainerHighlighter();
    const snapshot = snapshotBlockRects(view);
    let dropInfo: NestedDropInfo | null = null;

    // Ghost chases the cursor with a slight lag instead of snapping 1:1 —
    // see createGhostFollower's doc comment. The `nested` hover-scale stays
    // a direct, instant style toggle (independent of position chase).
    const ghostFollower = createGhostFollower(
      (x, y) => { shell.style.left = `${x}px`; shell.style.top = `${y}px`; },
      { x: startX - grabOffsetX, y: startY - grabOffsetY },
    );
    ghostFollower.start();

    function positionGhost(x: number, y: number, nested: boolean) {
      ghostFollower.setTarget(x - grabOffsetX + (nested ? 10 : 0), y - grabOffsetY);
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
        if (usingPreview) ghostHeight = shell.getBoundingClientRect().height;
      } else if (!overEditor && usingPreview) {
        fillGhostAsRow(shell, rowEl);
        usingPreview = false;
        ghostHeight = rowRect.height;
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
      // Mutually exclusive signals: the line means "between these two
      // top-level blocks", the container ring means "inside this one" —
      // showing both at once for a container drop was exactly what made it
      // unclear which one would actually happen.
      dropLine.update(info.container ? null : info);
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
      ghostFollower.stop();
      shell.remove();
      clearGap(gapRef);
      clearGapTransitions();
      gapRef = null;
      containerHighlighter.update(null);
      dropLine.remove();
      const finalDropInfo = dropInfo;
      if (finalDropInfo !== null) flipSettle(view, () => insertBlockAt(editor, finalDropInfo.pos, item));
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
      data-tour="block-palette"
      className={fill ? "flex flex-col flex-1 overflow-hidden" : "flex flex-col border-l flex-shrink-0"}
      style={fill
        ? { backgroundColor: "var(--bg-surface)" }
        : { width: 220, backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
    >
      <div
        className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide border-b flex-shrink-0"
        style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
      >
        {t("palette.title")}
      </div>

      {/* Same soft-ui tile styling in both modes — only the layout differs:
          fill (preview off, wider column) stays a 2-column grid with
          truncated labels; docked (preview on, narrow 220px column) is a
          single column so full labels always fit. Either way this scroll
          container handles overflow at a small window height. Items are
          bucketed into fixed collapsible sections (GROUP_ORDER) purely for
          display — a flat 19-item list was hard to scan at a glance. */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {GROUP_ORDER.map(({ key, labelKey }) => {
          const entries = items
            .map((item, i) => ({ item, i }))
            .filter((e) => e.item.group === key);
          if (entries.length === 0) return null;
          const isCollapsed = collapsedGroups.has(key);

          return (
            <div key={key} className="mb-1">
              <button
                type="button"
                onClick={() => toggleGroup(key)}
                className="flex items-center gap-1.5 w-full px-1 py-1.5 text-left"
                style={{ background: "none", border: "none", cursor: "pointer" }}
              >
                <ChevronDown
                  size={11}
                  style={{
                    color: "var(--text-muted)",
                    flexShrink: 0,
                    transform: isCollapsed ? "rotate(-90deg)" : "none",
                    transition: "transform 0.15s",
                  }}
                />
                <span
                  className="text-2xs font-semibold uppercase tracking-wide"
                  style={{ color: "var(--text-muted)", letterSpacing: "0.04em" }}
                >
                  {t(labelKey)}
                </span>
              </button>

              <AnimatePresence initial={false}>
                {!isCollapsed && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.15 }}
                    style={{ overflow: "hidden" }}
                  >
                    <div className={(fill ? "grid grid-cols-2 gap-2" : "flex flex-col gap-2") + " pb-2"}>
                      {entries.map(({ item, i }) => {
                        const isSelected = selected === i;
                        return (
                          <div
                            key={item.label}
                            onPointerDown={(e) => handleRowPointerDown(item, i, e)}
                            title={item.label}
                            className={"palette-tile flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl " + (isSelected ? "soft-ui-pressed" : "soft-ui-sm")}
                            style={{
                              // bg-elevated (not bg-surface) — the tile needs to read as
                              // a distinct raised card by color too, not rely on the
                              // shadow alone to separate it from an identically-colored
                              // parent panel.
                              backgroundColor: "var(--bg-elevated)",
                              cursor: "grab",
                            }}
                          >
                            <span
                              className="flex items-center justify-center rounded-lg flex-shrink-0"
                              style={{
                                width: 24,
                                height: 24,
                                backgroundColor: isSelected ? "var(--accent)" : "color-mix(in srgb, var(--accent) 12%, transparent)",
                                transition: "background-color 0.12s",
                              }}
                            >
                              <item.icon
                                size={12.5}
                                strokeWidth={1.85}
                                style={{ color: isSelected ? "#fff" : "var(--accent)" }}
                              />
                            </span>
                            <span
                              className={fill ? "text-2xs truncate" : "text-2xs whitespace-nowrap"}
                              style={{ color: isSelected ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: isSelected ? 600 : 500 }}
                            >
                              {item.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
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
              className="soft-ui-sm flex items-center justify-center gap-1.5 w-full h-8 rounded-lg text-xs font-semibold transition-transform active:scale-[0.97]"
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
