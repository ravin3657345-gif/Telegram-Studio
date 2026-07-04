import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import { createTiptapExtensions } from "@/lib/tiptapConfig";
import { useEditorStore } from "@/store/editorStore";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useSettingsStore } from "@/store/settingsStore";
import { getDraft, getHistoryForEdit } from "@/lib/tauriApi";
import { fileRegistry } from "@/lib/fileRegistry";
import { EditorToolbar } from "./EditorToolbar";
import { PostTitleInput } from "./PostTitleInput";
import { LinkDialog } from "./LinkDialog";
import { EmojiPicker } from "./EmojiPicker";
import { CharCounter } from "./CharCounter";
import { InlineBubbleMenu } from "./InlineBubbleMenu";
import { HtmlViewPanel } from "./HtmlViewPanel";
import { AttachmentZone } from "./AttachmentZone";
import { EditorContextMenu } from "./EditorContextMenu";
import { toast } from "@/store/uiStore";
import { t, ti } from "@/lib/i18n";
import { useAttachmentStore } from "@/store/attachmentStore";
import { useAutoSplit } from "@/hooks/useAutoSplit";
import { SplitOverlay } from "./SplitOverlay";
import { Scissors, RefreshCw } from "lucide-react";
import {
  TELEGRAM_MAX_PHOTO_SIZE,
  TELEGRAM_MAX_VIDEO_SIZE,
} from "@/lib/constants";

interface HistoryNavState {
  _histId?: string;
}

const ALLOWED_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_VIDEO = ["video/mp4", "video/mpeg"];

interface PostEditorProps {
  draftId?: string | null;
}

export function PostEditor({ draftId: initialDraftId }: PostEditorProps) {
  const containerRef  = useRef<HTMLDivElement>(null);
  const draftLoadedRef = useRef(false);

  // Separate state refs for SplitOverlay — must be state (not useRef) so React
  // re-renders when the DOM nodes mount, passing non-null values to SplitOverlay.
  const [scrollEl, setScrollEl]   = useState<HTMLDivElement | null>(null);
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);

  const [showLinkDialog, setShowLinkDialog]   = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showHtmlView, setShowHtmlView]       = useState(false);
  const [emojiAnchor, setEmojiAnchor]         = useState<DOMRect | undefined>();
  const [isDraggingOver, setIsDraggingOver]   = useState(false);
  const [contextMenu, setContextMenu]         = useState<{ x: number; y: number } | null>(null);
  const tauriDropHandledRef = useRef(false);

  const { contentJson, setContentJson, setPostTitle, setDraftTitle, resetEditor, setDraftId } =
    useEditorStore();
  const setEditingHistoryId = useEditorStore((s) => s.setEditingHistoryId);
  const setPublishMode      = useEditorStore((s) => s.setPublishMode);
  const addRegistered       = useAttachmentStore((s) => s.addRegistered);
  const historyLoadedRef    = useRef(false);
  const autosaveEnabled = useSettingsStore((s) => s.autosaveInterval > 0);

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

  // ── Auto-split hook ───────────────────────────────────────────────────────
  const { splitCount, recalculate } = useAutoSplit(editor);
  const publishMode = useEditorStore((s) => s.publishMode);

  // ── Insert media block helper ──────────────────────────────────────────────
  const insertMedia = useCallback((file: File) => {
    if (!editor) return;

    const allowed = [...ALLOWED_IMAGE, ...ALLOWED_VIDEO];
    if (!allowed.includes(file.type)) {
      toast.error(ti("editor.unsupportedType", { type: file.type }));
      return;
    }

    const isVideo = ALLOWED_VIDEO.includes(file.type);
    const sizeLimit = isVideo ? TELEGRAM_MAX_VIDEO_SIZE : TELEGRAM_MAX_PHOTO_SIZE;
    if (file.size > sizeLimit) {
      const mb = (sizeLimit / (1024 * 1024)).toFixed(0);
      toast.error(ti("editor.fileTooBig", { mb }));
      return;
    }

    const { id, src } = fileRegistry.add(file);
    const nodeType = isVideo ? "blockVideo" : "blockImage";

    editor.commands.insertContent({
      type: nodeType,
      attrs: { src, fileId: id, fileName: file.name, mimeType: file.type, fileSize: file.size },
    });
  }, [editor]);

  // ── Load history post (mirrors draft loading pattern) ─────────────────────
  // histState._histId is set by HistoryPage via navigate("/editor", { state: {...} }).
  // We fetch full data from Rust here (not pre-loaded) so that StrictMode
  // double-invocation can safely re-run the fetch and re-add files to fileRegistry.
  useEffect(() => {
    if (!editor || !histState._histId || historyLoadedRef.current) return;
    historyLoadedRef.current = true;

    getHistoryForEdit(histState._histId).then((data) => {
      setEditingHistoryId(data.historyId);
      if (data.publishMode) setPublishMode(data.publishMode as "normal" | "rich" | "telegraph");
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
          editor.commands.setContent(JSON.parse(json), false);
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

      // Восстанавливаем вложения в fileRegistry и патчим blob-URL в contentJson
      let json = draft.contentJson;
      if (draft.attachments?.length) {
        const urlMap: Record<string, string> = {};
        for (const att of draft.attachments) {
          try {
            const byteStr = atob(att.dataBase64);
            const bytes = new Uint8Array(byteStr.length);
            for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
            const file = new File([bytes], att.fileName, { type: att.mimeType });
            const newSrc = fileRegistry.addWithId(att.fileId, file);
            urlMap[att.fileId] = newSrc;
          } catch { /* skip broken attachment */ }
        }
        // Patch all blob URLs in the JSON using the fileId
        if (Object.keys(urlMap).length) {
          try {
            const doc = JSON.parse(json);
            const patchNode = (node: Record<string, unknown>) => {
              if (node.attrs && typeof node.attrs === "object") {
                const attrs = node.attrs as Record<string, unknown>;
                if (typeof attrs.fileId === "string" && urlMap[attrs.fileId]) {
                  attrs.src = urlMap[attrs.fileId];
                }
              }
              if (Array.isArray(node.content)) {
                (node.content as Record<string, unknown>[]).forEach(patchNode);
              }
            };
            patchNode(doc);
            json = JSON.stringify(doc);
          } catch { /* ignore */ }
        }
      }

      if (json && json !== "{}" && json !== "") {
        try {
          editor.commands.setContent(JSON.parse(json), false);
          setContentJson(json);
        } catch { /* ignore */ }
      }
    }).catch(() => toast.error(t("editor.draftLoadError")));

  }, [editor, initialDraftId]);

  // ── Init & cleanup ─────────────────────────────────────────────────────────
  useEffect(() => {
    setDraftId(initialDraftId ?? null);
    return () => {
      resetEditor();
      clearAttachments();
      fileRegistry.clear();
      draftLoadedRef.current    = false;
      historyLoadedRef.current  = false;
    };
  }, [initialDraftId]);

  // ── Auto-save ──────────────────────────────────────────────────────────────
  useAutoSave(autosaveEnabled);

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
  function handleMediaClick(type: "image" | "video" | "file") {
    if (type === "image") imageInputRef.current?.click();
    else if (type === "video") videoInputRef.current?.click();
    else fileInputRef.current?.click();
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!editor || files.length === 0) return;

    const allowed = [...ALLOWED_IMAGE, ...ALLOWED_VIDEO];
    const nodes: object[] = [];

    for (const file of files) {
      if (!allowed.includes(file.type)) {
        toast.error(ti("editor.unsupportedType", { type: file.type }));
        continue;
      }
      const isVideo = ALLOWED_VIDEO.includes(file.type);
      const sizeLimit = isVideo ? TELEGRAM_MAX_VIDEO_SIZE : TELEGRAM_MAX_PHOTO_SIZE;
      if (file.size > sizeLimit) {
        const mb = (sizeLimit / (1024 * 1024)).toFixed(0);
        toast.error(ti("editor.fileTooBig", { mb }));
        continue;
      }
      const { id, src } = fileRegistry.add(file);
      nodes.push({
        type: isVideo ? "blockVideo" : "blockImage",
        attrs: { src, fileId: id, fileName: file.name, mimeType: file.type, fileSize: file.size },
      });
    }

    if (nodes.length === 1) {
      editor.commands.insertContent(nodes[0]);
    } else if (nodes.length > 1) {
      editor.commands.insertContent(nodes);
    }
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
    if (files.length > 0) {
      e.preventDefault();
      files.forEach(insertMedia);
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
    };

    async function insertFromPath(filePath: string) {
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      const name = filePath.split(/[\\/]/).pop() ?? "file";
      const ext  = name.split(".").pop()?.toLowerCase() ?? "";
      const type = MIME[ext] ?? "application/octet-stream";
      const url  = convertFileSrc(filePath);
      const res  = await fetch(url);
      if (!res.ok) return;
      const blob = await res.blob();
      insertMedia(new File([blob], name, { type: blob.type || type }));
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
        for (const p of paths) {
          try { await insertFromPath(p); } catch { /* skip unreadable */ }
        }
        setTimeout(() => { tauriDropHandledRef.current = false; }, 200);
      }).then(fn => unlisteners.push(fn)).catch(() => {});

      // Fallback: legacy Tauri 1 event name (only if drag-drop didn't fire)
      listen("tauri://file-drop", async (event: { payload: unknown }) => {
        if (!active || !editor || tauriDropHandledRef.current) return;
        setIsDraggingOver(false);
        tauriDropHandledRef.current = true;
        const paths = Array.isArray(event.payload) ? event.payload as string[] : [];
        for (const p of paths) {
          try { await insertFromPath(p); } catch { /* skip unreadable */ }
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
        onSplitClick={recalculate}
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
              className="h-full overflow-y-auto"
              style={{ backgroundColor: "var(--bg-app)", padding: "16px 20px" }}
            >
              <InlineBubbleMenu editor={editor} onLinkClick={() => setShowLinkDialog(true)} />
              {contextMenu && (
                <EditorContextMenu
                  editor={editor}
                  x={contextMenu.x}
                  y={contextMenu.y}
                  onClose={() => setContextMenu(null)}
                />
              )}
              <div
                style={{
                  minHeight: "100%",
                  backgroundColor: "var(--bg-surface)",
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY });
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
              background: "rgba(42,171,238,0.1)",
              border: "1px solid rgba(42,171,238,0.25)",
              backdropFilter: "blur(6px)",
            }}
          >
            {t("editor.dropHint")}
          </p>
        </div>
      )}

      {/* Hidden file inputs — IDs used by slash command */}
      <input id="editor-image-input" ref={imageInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleFileInputChange} />
      <input id="editor-video-input" ref={videoInputRef} type="file" multiple accept="video/mp4,video/mpeg"                       className="hidden" onChange={handleFileInputChange} />
      <input id="editor-file-input"  ref={fileInputRef}  type="file" multiple                                                      className="hidden" onChange={handleDocumentInputChange} />

      {showLinkDialog   && <LinkDialog editor={editor} onClose={() => setShowLinkDialog(false)} />}
      {showEmojiPicker  && <EmojiPicker editor={editor} onClose={() => setShowEmojiPicker(false)} anchorRect={emojiAnchor} savedPos={savedEmojiPos.current} />}
    </div>
  );
}
