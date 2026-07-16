import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { AnimatePresence } from "framer-motion";
import { createTiptapExtensions } from "@/lib/tiptapConfig";
import { useEditorStore } from "@/store/editorStore";
import { useAutoSave } from "@/hooks/useAutoSave";
import { getDraft, getHistoryForEdit } from "@/lib/tauriApi";
import { fileRegistry } from "@/lib/fileRegistry";
import { restoreAttachmentsIntoJson } from "@/lib/attachmentRestore";
import { EditorToolbar } from "./EditorToolbar";
import { PostTitleInput } from "./PostTitleInput";
import { LinkDialog } from "./LinkDialog";
import { EmojiPicker } from "./EmojiPicker";
import { CharCounter } from "./CharCounter";
import { InlineBubbleMenu } from "./InlineBubbleMenu";
import { HtmlViewPanel } from "./HtmlViewPanel";
import { AttachmentZone } from "./AttachmentZone";
import { EditorContextMenu } from "./EditorContextMenu";
import { BlockHoverControls } from "./BlockHoverControls";
import { toast } from "@/store/uiStore";
import { t, ti } from "@/lib/i18n";
import { useAttachmentStore } from "@/store/attachmentStore";
import { useAutoSplit } from "@/hooks/useAutoSplit";
import { SplitOverlay } from "./SplitOverlay";
import { Scissors, RefreshCw } from "lucide-react";
import {
  TELEGRAM_MAX_PHOTO_SIZE,
  TELEGRAM_MAX_VIDEO_SIZE,
  TELEGRAM_MAX_AUDIO_SIZE,
} from "@/lib/constants";

// `messageSplit` was a real block-level TipTap node from the pre-overlay
// split system (MessageSplit.tsx is now a load-only compatibility stub —
// nothing inserts these anymore). It renders invisibly (display:none,
// height:0), but it's still a genuine top-level node that every block-index
// calculation (SplitOverlay's divider positioning, computeAutoGaps,
// splitJsonAtGaps) counts — a leftover one in an old draft silently shifts
// every gap index after it by one, so the divider visually renders next to
// the wrong line while still splitting the actual document one block off
// from where it looks. Stripped on load so an affected draft self-heals
// permanently the moment it's opened (the next autosave persists it clean).
function stripLegacyMessageSplitNodes<T>(node: T): T {
  const n = node as Record<string, unknown>;
  if (Array.isArray(n?.content)) {
    n.content = (n.content as Record<string, unknown>[])
      .filter((c) => c.type !== "messageSplit")
      .map((c) => stripLegacyMessageSplitNodes(c));
  }
  return node;
}

interface HistoryNavState {
  _histId?: string;
  _newPost?: boolean;
  _createTemplate?: boolean;
}

const ALLOWED_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO = ["video/mp4", "video/mpeg"];
const ALLOWED_AUDIO = ["audio/mpeg", "audio/ogg", "audio/mp4", "audio/wav"];
// Same `accept` on all three media inputs — each picked file is routed to the
// right block type by its own MIME type in `insertMedia` regardless of which
// button opened the dialog, so there's no reason the OS file picker should
// stop the user mixing photos/videos/audio into one selection.
const ALLOWED_MEDIA = [...ALLOWED_IMAGE, ...ALLOWED_VIDEO, ...ALLOWED_AUDIO].join(",");

interface PostEditorProps {
  draftId?: string | null;
  /** Lets EditorPage render the block palette in its own right panel (in
   * place of the Telegram preview when it's toggled off) — the editor
   * instance itself is only ever created here. */
  onEditorReady?: (editor: Editor | null) => void;
}

export function PostEditor({ draftId: initialDraftId, onEditorReady }: PostEditorProps) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const draftLoadedRef = useRef(false);

  // Separate state refs for SplitOverlay — must be state (not useRef) so React
  // re-renders when the DOM nodes mount, passing non-null values to SplitOverlay.
  const [scrollEl, setScrollEl]   = useState<HTMLDivElement | null>(null);
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);

  const [showLinkDialog, setShowLinkDialog]   = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showHtmlView, setShowHtmlView]       = useState(false);
  const [emojiAnchor, setEmojiAnchor]         = useState<DOMRect | undefined>();
  const [isDraggingOver, setIsDraggingOver]   = useState(false);
  const [contextMenu, setContextMenu]         = useState<{ x: number; y: number; blockPos: number | null } | null>(null);
  const tauriDropHandledRef = useRef(false);

  const { contentJson, setContentJson, setPostTitle, setDraftTitle, resetEditor, setDraftId } =
    useEditorStore();
  const setEditingHistoryId = useEditorStore((s) => s.setEditingHistoryId);
  const setTemplateName     = useEditorStore((s) => s.setTemplateName);
  const setPublishMode      = useEditorStore((s) => s.setPublishMode);
  const setDraftStatus      = useEditorStore((s) => s.setDraftStatus);
  const addRegistered       = useAttachmentStore((s) => s.addRegistered);
  const historyLoadedRef    = useRef(false);

  // Router state set by HistoryPage when opening a post for editing
  const location   = useLocation();
  const histState  = (location.state ?? {}) as HistoryNavState;
  const addAttachments  = useAttachmentStore((s) => s.addFiles);
  const clearAttachments = useAttachmentStore((s) => s.clearAll);

  // ── TipTap editor ──────────────────────────────────────────────────────────
  // Parse contentJson to object — TipTap treats plain strings as HTML, not ProseMirror JSON.
  const initialContent = (() => {
    if (!contentJson) return undefined;
    try { return JSON.parse(contentJson); } catch { return undefined; }
  })();

  const editor = useEditor({
    extensions: createTiptapExtensions(),
    content: initialContent,
    autofocus: "end",
    onUpdate({ editor: e }) {
      setContentJson(JSON.stringify(e.getJSON()));
    },
  });

  useEffect(() => {
    onEditorReady?.(editor ?? null);
    return () => onEditorReady?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // ── Auto-split hook ───────────────────────────────────────────────────────
  const { splitCount, recalculate, forceSplitAtCursor } = useAutoSplit(editor);
  const publishMode = useEditorStore((s) => s.publishMode);

  // ── Insert media block helper ──────────────────────────────────────────────
  // Takes an explicit insertion position and returns where the NEXT insert
  // should go (current position + however much the doc just grew). Inserting
  // several files in a row via the ambient current selection (plain
  // `editor.commands.insertContent`, no position) is broken for atom nodes:
  // after inserting one image, TipTap leaves the selection as a NodeSelection
  // wrapping that same image (there's no adjacent text position to place a
  // cursor), so the *next* insertContent call reads that NodeSelection as its
  // target range and REPLACES the image just inserted instead of adding a new
  // one after it — picking 3 files this way silently keeps only the last one.
  const insertMedia = useCallback((file: File, atPos: number): number => {
    if (!editor) return atPos;

    const isAudio = ALLOWED_AUDIO.includes(file.type);
    const allowed = [...ALLOWED_IMAGE, ...ALLOWED_VIDEO, ...ALLOWED_AUDIO];
    if (!allowed.includes(file.type)) {
      toast.error(ti("editor.unsupportedType", { type: file.type }));
      return atPos;
    }
    // Audio blocks only convert to anything in Rich mode (real <audio> tag —
    // Bot API 10.1) — silently accepting the drop/paste elsewhere would just
    // create a block that vanishes on publish with no explanation.
    if (isAudio && publishMode !== "rich") {
      toast.warning(t("slash.audioWarning"), t("slash.audioHint"));
      return atPos;
    }

    const isVideo = ALLOWED_VIDEO.includes(file.type);
    const sizeLimit = isAudio ? TELEGRAM_MAX_AUDIO_SIZE : isVideo ? TELEGRAM_MAX_VIDEO_SIZE : TELEGRAM_MAX_PHOTO_SIZE;
    if (file.size > sizeLimit) {
      const mb = (sizeLimit / (1024 * 1024)).toFixed(0);
      toast.error(ti("editor.fileTooBig", { mb }));
      return atPos;
    }

    const { id, src } = fileRegistry.add(file);
    const nodeType = isAudio ? "blockAudio" : isVideo ? "blockVideo" : "blockImage";

    const sizeBefore = editor.state.doc.content.size;
    editor.commands.insertContentAt(atPos, {
      type: nodeType,
      attrs: { src, fileId: id, fileName: file.name, mimeType: file.type, fileSize: file.size },
    });
    return atPos + (editor.state.doc.content.size - sizeBefore);
  }, [editor, publishMode]);

  // Rich doesn't support expandable (collapsible) quotes — force any
  // already-expandable blockquotes back to normal the moment it's selected,
  // so stale data from a mode switch can't silently break on publish.
  useEffect(() => {
    if (!editor || publishMode === "normal") return;
    const { doc } = editor.state;
    let hasExpandable = false;
    doc.descendants((node) => {
      if (node.type.name === "blockquote" && node.attrs.expandable) hasExpandable = true;
    });
    if (!hasExpandable) return;
    const tr = editor.state.tr;
    doc.descendants((node, pos) => {
      if (node.type.name === "blockquote" && node.attrs.expandable) {
        tr.setNodeAttribute(pos, "expandable", false);
      }
    });
    editor.view.dispatch(tr);
  }, [editor, publishMode]);

  // ── Load history post (mirrors draft loading pattern) ─────────────────────
  // histState._histId is set by HistoryPage via navigate("/editor", { state: {...} }).
  // We fetch full data from Rust here (not pre-loaded) so that StrictMode
  // double-invocation can safely re-run the fetch and re-add files to fileRegistry.
  useEffect(() => {
    if (!editor || !histState._histId || historyLoadedRef.current) return;
    historyLoadedRef.current = true;

    getHistoryForEdit(histState._histId).then((data) => {
      setEditingHistoryId(data.historyId);
      if (data.publishMode) setPublishMode(data.publishMode as "normal" | "rich");
      if (data.postTitle) setPostTitle(data.postTitle);

      // Restore each file into fileRegistry → get fresh blob URLs
      let json = data.contentJson;
      const urlMap: Record<string, string> = {};
      const restoredFiles: { id: string; name: string; size: number; mimeType: string }[] = [];

      for (const att of data.attachments) {
        try {
          const byteStr = atob(att.dataBase64);
          const bytes   = new Uint8Array(byteStr.length);
          for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
          const file   = new File([bytes], att.fileName, { type: att.mimeType });
          const src    = fileRegistry.addWithId(att.fileId, file);
          urlMap[att.fileId] = src;
          restoredFiles.push({ id: att.fileId, name: att.fileName, size: file.size, mimeType: att.mimeType });
        } catch { /* skip corrupt file */ }
      }

      // Patch TipTap JSON blob URLs
      if (Object.keys(urlMap).length && json) {
        try {
          const doc = JSON.parse(json);
          const patch = (node: Record<string, unknown>) => {
            const a = node.attrs as Record<string, unknown> | undefined;
            if (a && typeof a.fileId === "string" && urlMap[a.fileId]) a.src = urlMap[a.fileId];
            if (Array.isArray(node.content)) (node.content as Record<string, unknown>[]).forEach(patch);
          };
          patch(doc);
          json = JSON.stringify(doc);
        } catch { /* ignore */ }
      }

      // Load content into TipTap
      if (json && json !== "" && json !== "{}") {
        try {
          editor.commands.setContent(stripLegacyMessageSplitNodes(JSON.parse(json)), false);
        } catch {
          editor.commands.setContent(json, false); // HTML fallback
        }
        setContentJson(JSON.stringify(editor.getJSON()));
      }

      // Restore bottom-panel files (those not embedded as TipTap inline nodes)
      const inlineIds = new Set<string>();
      try {
        const scan = (node: Record<string, unknown>) => {
          const a = node.attrs as Record<string, unknown> | undefined;
          if (a && typeof a.fileId === "string") inlineIds.add(a.fileId);
          if (Array.isArray(node.content)) (node.content as Record<string, unknown>[]).forEach(scan);
        };
        scan(JSON.parse(json));
      } catch { /* html content — all files go to bottom panel */ }

      for (const f of restoredFiles) {
        if (!inlineIds.has(f.id)) addRegistered(f.id, f.name, f.size, f.mimeType);
      }

    }).catch(() => toast.error(t("editor.postLoadError")));
  }, [editor, histState._histId]);

  // ── Load existing draft ────────────────────────────────────────────────────
  useEffect(() => {
    if (!editor || !initialDraftId || draftLoadedRef.current) return;
    draftLoadedRef.current = true;

    getDraft(initialDraftId).then((draft) => {
      setPostTitle(draft.postTitle ?? "");
      if (draft.title) setDraftTitle(draft.title);
      setTemplateName(draft.templateName ?? null);
      if (draft.publishMode) setPublishMode(draft.publishMode as "normal" | "rich");
      setDraftStatus(draft.status);

      // Восстанавливаем вложения в fileRegistry и патчим blob-URL в contentJson
      const json = restoreAttachmentsIntoJson(draft.contentJson, draft.attachments ?? []);

      if (json && json !== "{}" && json !== "") {
        try {
          const parsed = stripLegacyMessageSplitNodes(JSON.parse(json));
          editor.commands.setContent(parsed, false);
          setContentJson(JSON.stringify(parsed));
        } catch { /* ignore */ }
      }
    }).catch(() => toast.error(t("editor.draftLoadError")));

  }, [editor, initialDraftId]);

  // ── Init & cleanup ─────────────────────────────────────────────────────────
  // Only reset when the mount actually represents a DIFFERENT thing to edit
  // (a specific draft/history post by id, an explicit "new post", or "new
  // template") — plain re-mounts of bare /editor (e.g. clicking the Editor
  // sidebar tab after visiting Settings) must resume whatever was already in
  // the store, not wipe it. Resetting unconditionally on every unmount used
  // to mean navigating away and back always lost the in-progress post,
  // sometimes even before autosave's debounce had a chance to persist it.
  const isFreshSession = Boolean(initialDraftId) || Boolean(histState._histId) ||
    Boolean(histState._newPost) || Boolean(histState._createTemplate);
  useEffect(() => {
    if (!isFreshSession) return;
    resetEditor();
    clearAttachments();
    fileRegistry.clear();
    draftLoadedRef.current   = false;
    historyLoadedRef.current = false;
    setDraftId(initialDraftId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraftId, histState._histId, histState._newPost, histState._createTemplate]);

  // ── Auto-save ──────────────────────────────────────────────────────────────
  useAutoSave();

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!editor?.isFocused) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "k") {
        e.preventDefault();
        const { from, to } = editor.state.selection;
        let hasMedia = false;
        editor.state.doc.nodesBetween(from, to, (node) => {
          if (node.type.name === "blockImage" || node.type.name === "blockVideo") hasMedia = true;
        });
        if (!hasMedia) setShowLinkDialog(true);
      }
      // Heading shortcuts
      if (ctrl && e.shiftKey && e.key === "1") { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 1 }).run(); }
      if (ctrl && e.shiftKey && e.key === "2") { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 2 }).run(); }
      if (ctrl && e.shiftKey && e.key === "3") { e.preventDefault(); editor.chain().focus().toggleHeading({ level: 3 }).run(); }
      // Blockquote Ctrl+Shift+B
      if (ctrl && e.shiftKey && e.key === "B") { e.preventDefault(); editor.chain().focus().toggleBlockquote().run(); }
      // Monospace Ctrl+E
      if (ctrl && !e.shiftKey && e.key === "e") { e.preventDefault(); editor.chain().focus().toggleCode().run(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editor]);

  // ── Document file input → attachment store (no longer inserted into editor) ──
  function handleDocumentInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (picked.length === 0) return;
    const oversized = addAttachments(picked);
    if (oversized.length > 0) {
      toast.error(ti("attach.tooLarge", { name: oversized.join(", ") }));
    }
  }

  // ── Toolbar media buttons ──────────────────────────────────────────────────
  function handleMediaClick(type: "image" | "video" | "file" | "audio") {
    if (type === "image") imageInputRef.current?.click();
    else if (type === "video") videoInputRef.current?.click();
    else if (type === "audio") audioInputRef.current?.click();
    else fileInputRef.current?.click();
  }

  // Shares insertMedia's validation/mode-check/size-limit logic (including
  // audio) rather than re-implementing it here. Each file's insert position
  // is tracked explicitly and advanced by the previous one's real size (see
  // insertMedia's doc comment) so picking several files inserts all of them
  // in order, instead of each one replacing the last.
  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!editor) return;
    let pos = editor.state.selection.to;
    for (const file of files) pos = insertMedia(file, pos);
  }

  // ── Container drag-over highlight ─────────────────────────────────────────
  function onDragEnter(e: React.DragEvent) {
    const hasFiles = Array.from(e.dataTransfer.types).some(t => t.toLowerCase() === "files");
    if (hasFiles) setIsDraggingOver(true);
  }
  function onDragLeave(e: React.DragEvent) {
    if (!containerRef.current?.contains(e.relatedTarget as Node)) setIsDraggingOver(false);
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function onDrop(e: React.DragEvent) {
    setIsDraggingOver(false);
    // If the Tauri native event already handled this drop, skip to avoid double insertion
    if (tauriDropHandledRef.current) { tauriDropHandledRef.current = false; return; }
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0 && editor) {
      e.preventDefault();
      let pos = editor.state.selection.to;
      for (const file of files) pos = insertMedia(file, pos);
    }
  }

  // ── Tauri native drag-drop (works when WebView2 doesn't populate dataTransfer.files) ──
  useEffect(() => {
    let active = true;
    const unlisteners: Array<() => void> = [];

    const MIME: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", webp: "image/webp",
      mp4: "video/mp4", mpeg: "video/mpeg",
      mp3: "audio/mpeg", ogg: "audio/ogg", m4a: "audio/mp4", wav: "audio/wav",
    };

    async function insertFromPath(filePath: string, atPos: number): Promise<number> {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      const name = filePath.split(/[\\/]/).pop() ?? "file";
      const ext  = name.split(".").pop()?.toLowerCase() ?? "";
      const type = MIME[ext] ?? "application/octet-stream";
      const url  = convertFileSrc(filePath);
      const res  = await fetch(url);
      if (!res.ok) return atPos;
      const blob = await res.blob();
      return insertMedia(new File([blob], name, { type: blob.type || type }), atPos);
    }

    import("@tauri-apps/api/event").then(({ listen }) => {
      if (!active) return;

      // Visual feedback: show overlay when files are dragged over the window
      listen("tauri://drag-enter", () => { if (active) setIsDraggingOver(true); })
        .then(fn => unlisteners.push(fn)).catch(() => {});
      listen("tauri://drag-leave", () => { if (active) setIsDraggingOver(false); })
        .then(fn => unlisteners.push(fn)).catch(() => {});

      // Tauri 2: payload = { paths: string[], position: {...} }
      // Tauri 1 compat: payload = string[]
      listen("tauri://drag-drop", async (event: { payload: unknown }) => {
        if (!active || !editor) return;
        setIsDraggingOver(false);
        tauriDropHandledRef.current = true;
        const payload = event.payload as { paths?: string[] } | string[];
        const paths = Array.isArray(payload) ? payload : (payload.paths ?? []);
        let pos = editor.state.selection.to;
        for (const p of paths) {
          try { pos = await insertFromPath(p, pos); } catch { /* skip unreadable */ }
        }
        setTimeout(() => { tauriDropHandledRef.current = false; }, 200);
      }).then(fn => unlisteners.push(fn)).catch(() => {});

      // Fallback: legacy Tauri 1 event name (only if drag-drop didn't fire)
      listen("tauri://file-drop", async (event: { payload: unknown }) => {
        if (!active || !editor || tauriDropHandledRef.current) return;
        setIsDraggingOver(false);
        tauriDropHandledRef.current = true;
        const paths = Array.isArray(event.payload) ? event.payload as string[] : [];
        let pos = editor.state.selection.to;
        for (const p of paths) {
          try { pos = await insertFromPath(p, pos); } catch { /* skip unreadable */ }
        }
        setTimeout(() => { tauriDropHandledRef.current = false; }, 200);
      }).then(fn => unlisteners.push(fn)).catch(() => {});

    }).catch(() => {});

    return () => { active = false; unlisteners.forEach(fn => fn()); };
  }, [editor, insertMedia]);

  // ── Emoji picker ──────────────────────────────────────────────────────────
  const savedEmojiPos = useRef<{ from: number; to: number } | null>(null);

  function handleEmojiClick() {
    // Save cursor before picker opens (editor loses focus when picker renders)
    if (editor) {
      savedEmojiPos.current = {
        from: editor.state.selection.from,
        to:   editor.state.selection.to,
      };
    }
    const btnEl = document.querySelector<HTMLButtonElement>(`[aria-label="${t('toolbar.emoji')}"]`);
    setEmojiAnchor(btnEl?.getBoundingClientRect());
    setShowEmojiPicker((prev) => !prev);
  }

  function handleEmojiInsert(native: string) {
    if (!editor) return;
    let chain = editor.chain().focus();
    if (savedEmojiPos.current) chain = chain.setTextSelection(savedEmojiPos.current);
    chain.insertContent(native).run();
    const nextFrom = editor.state.selection.from;
    savedEmojiPos.current = { from: nextFrom, to: nextFrom };
  }

  if (!editor) return null;

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: "var(--bg-app)" }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <PostTitleInput />

      <EditorToolbar
        editor={editor}
        onLinkClick={() => setShowLinkDialog(true)}
        onEmojiClick={handleEmojiClick}
        onMediaClick={handleMediaClick}
        onHtmlView={() => setShowHtmlView((v) => !v)}
        showHtmlView={showHtmlView}
        onSplitClick={forceSplitAtCursor}
        splitActive={splitCount > 0}
      />

      {/* Split banner */}
      {splitCount > 0 && publishMode !== "rich" && (
        <div
          className="split-banner-pulse"
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "9px 14px",
            backgroundColor: "var(--accent)",
            borderBottom: "2px solid var(--accent)",
            fontSize: 13, fontWeight: 600, color: "#ffffff",
            boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
              width: 22, height: 22, borderRadius: "50%",
              backgroundColor: "rgba(255,255,255,0.22)",
            }}
          >
            <Scissors size={13} color="#ffffff" />
          </span>
          <span style={{ flex: 1, lineHeight: 1.35 }}>
            {ti("split.banner", { n: splitCount + 1 })}
          </span>
          <button
            onClick={recalculate}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              background: "rgba(255,255,255,0.16)",
              border: "1px solid rgba(255,255,255,0.55)",
              borderRadius: 6, padding: "4px 10px",
              color: "#ffffff", fontSize: 12, fontWeight: 600, cursor: "pointer",
              flexShrink: 0,
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.3)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.16)")}
          >
            <RefreshCw size={11} />
            {t("split.recalc")}
          </button>
        </div>
      )}

      {/* Main row: editor + optional HTML panel */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        <div className="flex flex-col flex-1 overflow-hidden" style={{ minWidth: 0 }}>
          {/*
           * Wrapper: clips SplitOverlay to the visible editor area.
           * SplitOverlay is a SIBLING of the scroll container (not inside it)
           * so it never conflicts with ProseMirror's direct DOM mutations.
           */}
          <div
            ref={(el) => setWrapperEl(el)}
            className="flex-1 overflow-hidden"
            style={{ minHeight: 0, position: "relative" }}
          >
            <SplitOverlay editor={editor} scrollEl={scrollEl} wrapperEl={wrapperEl} />

            <div
              ref={(el) => setScrollEl(el)}
              data-tour="editor-content"
              className="editor-scroll-area h-full overflow-y-auto"
              style={{ backgroundColor: "var(--bg-app)", padding: "16px 20px" }}
            >
              <InlineBubbleMenu editor={editor} onLinkClick={() => setShowLinkDialog(true)} />
              <BlockHoverControls
                editor={editor}
                onOpenMenu={(blockPos, x, y) => {
                  const node = editor.state.doc.nodeAt(blockPos);
                  if (node) {
                    if (node.isAtom) editor.commands.setNodeSelection(blockPos);
                    else editor.commands.setTextSelection(blockPos + 1);
                  }
                  setContextMenu({ x, y, blockPos: node ? blockPos : null });
                }}
              />
              <AnimatePresence>
                {contextMenu && (
                  <EditorContextMenu
                    key="editor-context-menu"
                    editor={editor}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    blockPos={contextMenu.blockPos}
                    onClose={() => setContextMenu(null)}
                  />
                )}
              </AnimatePresence>
              <div
                className="post-content-card"
                style={{
                  minHeight: "100%",
                  backgroundColor: "var(--bg-surface)",
                }}
              >
                <EditorContent editor={editor} className="tiptap-editor-root" />
              </div>
            </div>
          </div>
          <AttachmentZone onAddClick={() => fileInputRef.current?.click()} />
          <CharCounter editor={editor} />
        </div>

        {showHtmlView && <HtmlViewPanel onClose={() => setShowHtmlView(false)} />}
      </div>

      {/* Drop overlay */}
      {isDraggingOver && (
        <div
          className="editor-drop-overlay absolute inset-0 flex items-center justify-center pointer-events-none z-10"
          style={{ border: "2px dashed var(--accent)", borderRadius: 8 }}
        >
          <p
            className="text-sm font-semibold px-4 py-2 rounded-lg"
            style={{
              color: "var(--accent)",
              background: "color-mix(in srgb, var(--accent) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
              backdropFilter: "blur(6px)",
            }}
          >
            {t("editor.dropHint")}
          </p>
        </div>
      )}

      {/* Hidden file inputs — IDs used by slash command */}
      <input id="editor-image-input" ref={imageInputRef} type="file" multiple accept={ALLOWED_MEDIA} className="hidden" onChange={handleFileInputChange} />
      <input id="editor-video-input" ref={videoInputRef} type="file" multiple accept={ALLOWED_MEDIA} className="hidden" onChange={handleFileInputChange} />
      <input id="editor-audio-input" ref={audioInputRef} type="file" multiple accept={ALLOWED_MEDIA} className="hidden" onChange={handleFileInputChange} />
      <input id="editor-file-input"  ref={fileInputRef}  type="file" multiple                                                      className="hidden" onChange={handleDocumentInputChange} />

      {showLinkDialog   && <LinkDialog editor={editor} onClose={() => setShowLinkDialog(false)} />}
      {showEmojiPicker  && <EmojiPicker onSelect={handleEmojiInsert} onClose={() => setShowEmojiPicker(false)} anchorRect={emojiAnchor} />}
    </div>
  );
}
