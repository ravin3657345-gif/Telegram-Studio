import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import {
  Heading1, Heading2, Heading3, Pilcrow, Quote, Code2,
  List, ListOrdered, Minus, Image, Film, HelpCircle, BarChart2,
  CheckSquare, Lightbulb, Table2, Music, MapPin, Sigma, MessageSquareQuote,
} from "lucide-react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import "tippy.js/dist/tippy.css";
import "tippy.js/animations/scale-subtle.css";
import { useEditorStore } from "@/store/editorStore";
import { useUiStore } from "@/store/uiStore";
import { t } from "@/lib/i18n";
import { buildTableNode } from "@/extensions/BlockTable";
import { isAndroidPlatform, MOBILE_BREAKPOINT } from "@/hooks/useIsMobileLayout";

// ─── Menu items ───────────────────────────────────────────────────────────────

// Language-independent identifier for what the block looks like once it's
// actually in the document — used by BlockPalette to render a drag-ghost
// that matches the editor's own typography (label text alone isn't enough,
// it doesn't say "this becomes a heading" vs "this becomes a quote").
export type BlockPreviewType =
  | "paragraph" | "h1" | "h2" | "h3" | "quote" | "pullquote" | "code"
  | "list" | "orderedList" | "checklist" | "callout" | "divider"
  | "image" | "video" | "audio" | "faq" | "poll" | "table" | "map" | "formula";

// Purely a grouping label for BlockPalette's collapsible sections — has no
// effect on slash-menu search/filtering (that stays a flat filtered list,
// grouping only matters once there's a fixed-order palette to scan).
export type BlockGroup = "text" | "lists" | "media" | "blocks" | "interactive";

export interface SlashItem {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
  label: string;
  description: string;
  previewType: BlockPreviewType;
  group: BlockGroup;
  command: (editor: import("@tiptap/core").Editor) => void;
  // True when the current app state (e.g. publish mode) means `command` will
  // just show a warning toast and bail instead of inserting anything. The
  // palette's drag/select-to-insert path checks this *before* touching the
  // document — without it, that path always creates a placeholder paragraph
  // first to give the command something to act on, and a bailed-out command
  // never cleans that placeholder up, leaving a permanent blank line behind.
  isBlocked?: () => boolean;
}

export function getSlashItems(): SlashItem[] {
  return [
    {
      icon: Pilcrow,
      label: t("slash.paragraph"),
      description: t("slash.paragraph.desc"),
      previewType: "paragraph",
      group: "text",
      command: (e) => e.chain().focus().setParagraph().run(),
    },
    {
      icon: Heading1,
      label: t("slash.h1"),
      description: t("slash.h1.desc"),
      previewType: "h1",
      group: "text",
      command: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
    },
    {
      icon: Heading2,
      label: t("slash.h2"),
      description: t("slash.h2.desc"),
      previewType: "h2",
      group: "text",
      command: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
      icon: Heading3,
      label: t("slash.h3"),
      description: t("slash.h3.desc"),
      previewType: "h3",
      group: "text",
      command: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
    },
    {
      icon: Quote,
      label: t("slash.quote"),
      description: t("slash.quote.desc"),
      previewType: "quote",
      group: "text",
      command: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      icon: MessageSquareQuote,
      label: t("slash.pullquote"),
      description: t("slash.pullquote.desc"),
      previewType: "pullquote",
      group: "text",
      isBlocked: () => useEditorStore.getState().publishMode !== "rich",
      command: (e) => {
        if (useEditorStore.getState().publishMode !== "rich") {
          useUiStore.getState().toast("warning", t("slash.pullquoteWarning"), t("slash.pullquoteHint"));
          return;
        }
        e.chain().focus().insertContent({ type: "pullquote" }).run();
      },
    },
    {
      icon: Code2,
      label: t("slash.code"),
      description: t("slash.code.desc"),
      previewType: "code",
      group: "text",
      command: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
    {
      icon: List,
      label: t("slash.list"),
      description: t("slash.list.desc"),
      previewType: "list",
      group: "lists",
      command: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      icon: ListOrdered,
      label: t("slash.orderedList"),
      description: t("slash.orderedList.desc"),
      previewType: "orderedList",
      group: "lists",
      command: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      icon: CheckSquare,
      label: t("slash.checklist"),
      description: t("slash.checklist.desc"),
      previewType: "checklist",
      group: "lists",
      command: (e) => e.chain().focus().insertContent({ type: "checkItem", attrs: { checked: false } }).run(),
    },
    {
      icon: Lightbulb,
      label: t("slash.callout"),
      description: t("slash.callout.desc"),
      previewType: "callout",
      group: "blocks",
      command: (e) =>
        e.chain().focus().insertContent({
          type: "callout",
          attrs: { emoji: "💡" },
          content: [{ type: "paragraph" }],
        }).run(),
    },
    {
      icon: Minus,
      label: t("slash.divider"),
      description: t("slash.divider.desc"),
      previewType: "divider",
      group: "blocks",
      command: (e) => e.chain().focus().setHorizontalRule().run(),
    },
    {
      icon: Image,
      label: t("slash.image"),
      description: t("slash.image.desc"),
      previewType: "image",
      group: "media",
      command: () => {
        document.getElementById("editor-image-input")?.click();
      },
    },
    {
      icon: Film,
      label: t("slash.video"),
      description: t("slash.video.desc"),
      previewType: "video",
      group: "media",
      command: () => {
        document.getElementById("editor-video-input")?.click();
      },
    },
    {
      icon: Music,
      label: t("slash.audio"),
      description: t("slash.audio.desc"),
      previewType: "audio",
      group: "media",
      isBlocked: () => useEditorStore.getState().publishMode !== "rich",
      command: () => {
        const mode = useEditorStore.getState().publishMode;
        if (mode !== "rich") {
          useUiStore.getState().toast("warning", t("slash.audioWarning"), t("slash.audioHint"));
          return;
        }
        document.getElementById("editor-audio-input")?.click();
      },
    },
    {
      icon: HelpCircle,
      label: t("slash.faq"),
      description: t("slash.faq.desc"),
      previewType: "faq",
      group: "blocks",
      command: (e) =>
        e.commands.insertContent({ type: "blockFaq", attrs: { question: "", answer: "" } }),
    },
    {
      icon: BarChart2,
      label: t("slash.poll"),
      description: t("slash.poll.desc"),
      previewType: "poll",
      group: "interactive",
      isBlocked: () => {
        const mode = useEditorStore.getState().publishMode;
        return mode === "rich";
      },
      command: (e) => {
        const mode = useEditorStore.getState().publishMode;
        if (mode === "rich") {
          useUiStore.getState().toast("warning", t("slash.pollWarning"), t("slash.pollHint"));
          return;
        }
        e.commands.insertContent({
          type: "blockPoll",
          attrs: { question: "", options: ["", ""], isAnonymous: true, allowsMultipleAnswers: false },
        });
      },
    },
    {
      icon: Table2,
      label: t("slash.table"),
      description: t("slash.table.desc"),
      previewType: "table",
      group: "interactive",
      isBlocked: () => useEditorStore.getState().publishMode !== "rich",
      command: (e) => {
        const mode = useEditorStore.getState().publishMode;
        if (mode !== "rich") {
          useUiStore.getState().toast("warning", t("slash.tableWarning"), t("slash.tableHint"));
          return;
        }
        const table = buildTableNode(e.schema, 2, 2);
        e.chain().focus().insertContent(table.toJSON()).run();
      },
    },
    {
      icon: MapPin,
      label: t("slash.map"),
      description: t("slash.map.desc"),
      previewType: "map",
      group: "interactive",
      isBlocked: () => useEditorStore.getState().publishMode !== "rich",
      command: (e) => {
        const mode = useEditorStore.getState().publishMode;
        if (mode !== "rich") {
          useUiStore.getState().toast("warning", t("slash.mapWarning"), t("slash.mapHint"));
          return;
        }
        e.commands.insertContent({ type: "blockMap", attrs: { lat: 55.7558, long: 37.6173, zoom: 15 } });
      },
    },
    {
      icon: Sigma,
      label: t("slash.formula"),
      description: t("slash.formula.desc"),
      previewType: "formula",
      group: "interactive",
      isBlocked: () => useEditorStore.getState().publishMode !== "rich",
      command: (e) => {
        const mode = useEditorStore.getState().publishMode;
        if (mode !== "rich") {
          useUiStore.getState().toast("warning", t("slash.formulaWarning"), t("slash.formulaHint"));
          return;
        }
        e.commands.insertContent({ type: "blockFormula", attrs: { expression: "" } });
      },
    },
  ];
}

// ─── Menu component ───────────────────────────────────────────────────────────

import React, { useState, useEffect, useImperativeHandle, forwardRef } from "react";

interface SlashMenuRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface SlashMenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
}

const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => setSelectedIndex(0), [items]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const selected = container.querySelector<HTMLElement>("[data-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useImperativeHandle(ref, () => ({
    onKeyDown({ event }) {
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return true;
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
        return true;
      }
      if (event.key === "Enter") {
        command(items[selectedIndex]);
        return true;
      }
      return false;
    },
  }));

  return (
    <div
      ref={containerRef}
      onWheel={(e) => e.stopPropagation()}
      style={{
        backgroundColor: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.12)",
        borderRadius: 10,
        minWidth: 210,
        maxHeight: 340,
        overflowY: "auto",
        padding: "4px 0",
      }}
    >
      {items.length === 0 ? (
        <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("slash.noResults")}
        </div>
      ) : (
        items.map((item, i) => (
          <button
            key={item.label}
            data-selected={i === selectedIndex ? "true" : undefined}
            onClick={() => command(item)}
            className="flex items-center gap-2.5 w-full px-2.5 py-1.5 text-left"
            style={{
              backgroundColor: i === selectedIndex ? "var(--bg-hover)" : "transparent",
              borderRadius: 6,
              margin: "0 4px",
              width: "calc(100% - 8px)",
              transition: "background-color 0.1s",
            }}
            onMouseEnter={() => setSelectedIndex(i)}
          >
            <item.icon
              size={14}
              strokeWidth={1.75}
              style={{ flexShrink: 0, color: i === selectedIndex ? "var(--accent)" : "var(--text-muted)" }}
            />
            <div>
              <p className="text-xs font-medium leading-snug" style={{ color: "var(--text-primary)" }}>
                {item.label}
              </p>
              <p className="text-2xs leading-snug" style={{ color: "var(--text-muted)" }}>
                {item.description}
              </p>
            </div>
          </button>
        ))
      )}
    </div>
  );
});

SlashMenu.displayName = "SlashMenu";

// ─── Mobile popup container ───────────────────────────────────────────────────
// `render()` below is a plain suggestion-lifecycle factory outside the React
// tree (no hooks allowed) — same platform/width check useIsMobileLayout()
// does, just called directly instead of as a hook.
function isMobileNow(): boolean {
  return isAndroidPlatform() || (typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT);
}

// On mobile, swaps the tippy-at-caret popup for a bottom sheet — a floating
// list anchored to wherever "/" was typed is routinely off-screen or under
// the keyboard on a phone. Built directly with the same `.bottom-sheet-*`
// classes BottomSheet.tsx uses (see globals.css) rather than mounting a
// second React root just to host `component.element`, which is already a
// plain DOM node from ReactRenderer by this point.
function createMobileSheet(content: HTMLElement, onDismiss: () => void) {
  const overlay = document.createElement("div");
  overlay.className = "bottom-sheet-overlay";
  overlay.setAttribute("data-state", "open");
  overlay.style.zIndex = "9998";

  const sheet = document.createElement("div");
  sheet.className = "bottom-sheet-content";
  sheet.setAttribute("data-state", "open");
  sheet.style.maxHeight = "60vh";
  sheet.style.zIndex = "9999";

  const handle = document.createElement("div");
  handle.className = "bottom-sheet-handle";

  const body = document.createElement("div");
  body.className = "bottom-sheet-body";
  body.appendChild(content);

  sheet.appendChild(handle);
  sheet.appendChild(body);
  overlay.appendChild(sheet);
  // Same "hide, don't force-cancel the suggestion" behavior the desktop
  // Escape handler below already had — see this function's call site.
  overlay.addEventListener("click", (e) => { if (e.target === overlay) onDismiss(); });
  document.body.appendChild(overlay);

  return { destroy: () => overlay.remove() };
}

// ─── Extension ────────────────────────────────────────────────────────────────

export const SlashCommand = Extension.create({
  name: "slashCommand",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        command: ({ editor, range, props }: { editor: import("@tiptap/core").Editor; range: import("@tiptap/core").Range; props: SlashItem }) => {
          editor.chain().focus().deleteRange(range).run();
          props.command(editor);
        },
        items: ({ query }: { query: string }): SlashItem[] => {
          const items = getSlashItems();
          const q = query.toLowerCase();
          if (!q) return items;
          return items.filter(
            (i) =>
              i.label.toLowerCase().includes(q) ||
              i.description.toLowerCase().includes(q)
          );
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        render: (): any => {
          let component: ReactRenderer<SlashMenuRef>;
          let popup: TippyInstance[] | undefined;
          let mobileSheet: { destroy: () => void } | undefined;

          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onStart(props: any) {
              component = new ReactRenderer(SlashMenu, {
                props,
                editor: props.editor,
              });

              if (isMobileNow()) {
                mobileSheet = createMobileSheet(component.element as HTMLElement, () => {
                  mobileSheet?.destroy();
                  mobileSheet = undefined;
                });
                return;
              }

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                arrow: false,
                offset: [0, 6],
                animation: "scale-subtle",
                duration: [140, 100],
                onMount(instance) {
                  const box = instance.popper.querySelector<HTMLElement>(".tippy-box");
                  if (box) box.style.cssText = "background:none;border:none;box-shadow:none;padding:0;max-width:none;border-radius:0;";
                  const content = instance.popper.querySelector<HTMLElement>(".tippy-content");
                  if (content) content.style.cssText = "padding:0;";
                },
              });
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onUpdate(props: any) {
              component.updateProps(props);
              popup?.[0].setProps({ getReferenceClientRect: props.clientRect });
            },
            onKeyDown(props: { event: KeyboardEvent }) {
              if (props.event.key === "Escape") {
                popup?.[0].hide();
                mobileSheet?.destroy();
                mobileSheet = undefined;
                return true;
              }
              return (component.ref as SlashMenuRef)?.onKeyDown(props) ?? false;
            },
            onExit() {
              popup?.[0].destroy();
              mobileSheet?.destroy();
              component.destroy();
            },
          };
        },
      } satisfies Partial<SuggestionOptions>,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
