import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const HANDLE_SIZE = 20;
const HANDLE_OFFSET = 28;
const HIDE_TIMEOUT = 500;
const DRAG_THRESHOLD = 5;

function createHandleEl(): HTMLElement {
  const el = document.createElement("div");
  el.className = "editor-drag-handle";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <circle cx="6" cy="4" r="1.5" fill="currentColor"/>
    <circle cx="10" cy="4" r="1.5" fill="currentColor"/>
    <circle cx="6" cy="8" r="1.5" fill="currentColor"/>
    <circle cx="10" cy="8" r="1.5" fill="currentColor"/>
    <circle cx="6" cy="12" r="1.5" fill="currentColor"/>
    <circle cx="10" cy="12" r="1.5" fill="currentColor"/>
  </svg>`;
  return el;
}

// Iterate the document's top-level nodes by position — works for all node types including atoms.
function forEachBlock(
  view: EditorView,
  cb: (pos: number, el: HTMLElement) => boolean | void
) {
  const doc = view.state.doc;
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const raw = view.nodeDOM(pos);
    const el = raw instanceof HTMLElement
      ? raw
      : raw instanceof Node ? (raw as Node).parentElement : null;
    if (el && cb(pos, el) === true) break;
    pos += node.nodeSize;
  }
}

// Find the top-level block position under the mouse.
function getBlockAtY(view: EditorView, clientY: number): number | null {
  let found: number | null = null;
  forEachBlock(view, (pos, el) => {
    const r = el.getBoundingClientRect();
    if (clientY >= r.top - 8 && clientY <= r.bottom + 8) {
      found = pos;
      return true;
    }
  });
  return found;
}

// Find where to insert based on mouse Y — returns position BEFORE a block or at doc end.
function getDropPos(view: EditorView, clientY: number): number | null {
  const doc = view.state.doc;
  if (!doc.childCount) return null;

  let pos = 0;
  let result: number | null = null;

  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const raw = view.nodeDOM(pos);
    const el = raw instanceof HTMLElement
      ? raw
      : raw instanceof Node ? (raw as Node).parentElement : null;

    if (el) {
      const r = el.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        result = pos; // insert BEFORE this block
        break;
      }
      result = pos + node.nodeSize; // insert AFTER this block (updated each iteration)
    }
    pos += node.nodeSize;
  }

  return result;
}

function css(el: HTMLElement, s: Partial<CSSStyleDeclaration>) {
  Object.assign(el.style, s);
}

export const BlockDragHandle = Extension.create({
  name: "blockDragHandle",

  addProseMirrorPlugins() {
    let handle: HTMLElement | null = null;
    let dropLine: HTMLElement | null = null;
    let currentPos = -1;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let isDragging = false;
    let dragFromPos = -1;
    let mouseStartY = 0;

    function scheduleHide() {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (handle && !isDragging) {
          css(handle, { display: "none", opacity: "0" });
          currentPos = -1;
        }
      }, HIDE_TIMEOUT);
    }

    function showHandle(view: EditorView, pos: number) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (!handle) return;
      // Get DOM element for this position via document traversal
      const doc = view.state.doc;
      let domEl: HTMLElement | null = null;
      let p = 0;
      for (let i = 0; i < doc.childCount; i++) {
        if (p === pos) {
          const raw = view.nodeDOM(p);
          domEl = raw instanceof HTMLElement
            ? raw
            : raw instanceof Node ? (raw as Node).parentElement : null;
          break;
        }
        p += doc.child(i).nodeSize;
      }
      if (!domEl) { scheduleHide(); return; }
      const rect = domEl.getBoundingClientRect();
      css(handle, {
        display: "flex",
        opacity: "0.55",
        top: `${rect.top + Math.max(0, (rect.height - HANDLE_SIZE) / 2)}px`,
        left: `${rect.left - HANDLE_OFFSET}px`,
      });
      currentPos = pos;
    }

    return [
      new Plugin({
        key: new PluginKey("blockDragHandle"),

        view(view) {
          handle = createHandleEl();
          css(handle, {
            position: "fixed",
            display: "none",
            alignItems: "center",
            justifyContent: "center",
            width: `${HANDLE_SIZE}px`,
            height: `${HANDLE_SIZE}px`,
            borderRadius: "4px",
            cursor: "grab",
            color: "var(--text-muted)",
            background: "transparent",
            transition: "opacity 0.15s, background 0.12s",
            zIndex: "200",
            userSelect: "none",
            pointerEvents: "auto",
            opacity: "0",
          });
          document.body.appendChild(handle);

          // Track hover over editor
          function onEditorMouseMove(e: MouseEvent) {
            if (isDragging) return;
            const pos = getBlockAtY(view, e.clientY);
            if (pos === null) { scheduleHide(); return; }
            showHandle(view, pos);
          }
          function onEditorMouseLeave() { if (!isDragging) scheduleHide(); }
          view.dom.addEventListener("mousemove", onEditorMouseMove);
          view.dom.addEventListener("mouseleave", onEditorMouseLeave);

          // Handle hover
          handle.addEventListener("mouseenter", () => {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            css(handle!, { opacity: "1", background: "var(--bg-elevated)", color: "var(--text-secondary)" });
          });
          handle.addEventListener("mouseleave", () => {
            if (!isDragging) {
              css(handle!, { background: "transparent", color: "var(--text-muted)" });
              scheduleHide();
            }
          });

          // Mouse-based drag
          handle.addEventListener("mousedown", (e) => {
            if (e.button !== 0 || currentPos < 0) return;
            e.preventDefault();
            e.stopPropagation();

            dragFromPos = currentPos;
            mouseStartY = e.clientY;
            isDragging = false;

            dropLine = document.createElement("div");
            css(dropLine, {
              position: "fixed",
              height: "2px",
              background: "var(--accent, #0a84ff)",
              borderRadius: "1px",
              pointerEvents: "none",
              zIndex: "9001",
              display: "none",
              boxShadow: "0 0 6px var(--accent, #0a84ff)",
            });
            document.body.appendChild(dropLine);

            function updateDropLine(clientY: number) {
              if (!dropLine) return;
              const doc = view.state.doc;
              let lineY = -1, lineL = 0, lineR = 0;
              let p = 0;
              for (let i = 0; i < doc.childCount; i++) {
                const raw = view.nodeDOM(p);
                const el = raw instanceof HTMLElement
                  ? raw
                  : raw instanceof Node ? (raw as Node).parentElement : null;
                if (el) {
                  const r = el.getBoundingClientRect();
                  lineL = r.left; lineR = r.right;
                  if (clientY < r.top + r.height / 2) {
                    lineY = r.top - 1;
                    break;
                  }
                  lineY = r.bottom + 1;
                }
                p += doc.child(i).nodeSize;
              }
              if (lineY >= 0) {
                css(dropLine, {
                  display: "block",
                  top: `${lineY}px`,
                  left: `${lineL}px`,
                  width: `${lineR - lineL}px`,
                });
              }
            }

            function onMouseMove(ev: MouseEvent) {
              if (!isDragging && Math.abs(ev.clientY - mouseStartY) > DRAG_THRESHOLD) {
                isDragging = true;
                css(handle!, { cursor: "grabbing", opacity: "1" });
                document.body.style.cursor = "grabbing";
              }
              if (isDragging) updateDropLine(ev.clientY);
            }

            function onMouseUp(ev: MouseEvent) {
              document.removeEventListener("mousemove", onMouseMove);
              document.removeEventListener("mouseup", onMouseUp);
              document.body.style.cursor = "";
              if (dropLine) { dropLine.remove(); dropLine = null; }

              const wasDragging = isDragging;
              const fromPos = dragFromPos;
              isDragging = false;
              dragFromPos = -1;
              css(handle!, { cursor: "grab" });

              if (!wasDragging || fromPos < 0) return;

              const toPos = getDropPos(view, ev.clientY);
              if (toPos === null) return;

              const { doc } = view.state;
              const node = doc.nodeAt(fromPos);
              if (!node) return;

              const nodeSize = node.nodeSize;
              const endPos = fromPos + nodeSize;

              if (toPos === fromPos || toPos === endPos) return;

              let insertAt = toPos > fromPos ? toPos - nodeSize : toPos;
              if (insertAt < 0) insertAt = 0;
              const maxInsert = doc.content.size - nodeSize;
              if (insertAt > maxInsert) insertAt = maxInsert;
              if (insertAt < 0) return;

              try {
                view.dispatch(
                  view.state.tr.delete(fromPos, endPos).insert(insertAt, node)
                );
              } catch { /* invalid position */ }
            }

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
          });

          return {
            destroy() {
              view.dom.removeEventListener("mousemove", onEditorMouseMove);
              view.dom.removeEventListener("mouseleave", onEditorMouseLeave);
              handle?.remove(); handle = null;
              dropLine?.remove(); dropLine = null;
              if (hideTimer) clearTimeout(hideTimer);
            },
          };
        },
      }),
    ];
  },
});
