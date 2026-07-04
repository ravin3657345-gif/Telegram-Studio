import { useMemo, useState, useRef, useEffect, createContext, useContext } from "react";
import { Play, FileText, Eye } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { useSettingsStore } from "@/store/settingsStore";
import { splitIntoMessagesAtGaps, type ContentSegment } from "@/lib/htmlConverter";
import { tiptapToRichHtml } from "@/lib/richMessageConverter";
import { t, ti } from "@/lib/i18n";
import { sanitizeTelegramHtml as sanitize } from "@/lib/telegramSanitize";
import { type TGPalette, DARK, LIGHT } from "@/lib/telegramTheme";

// ─── Theme context ────────────────────────────────────────────────────────────

const TGCtx = createContext<TGPalette>(DARK);
function useTG() { return useContext(TGCtx); }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nlToBr(html: string): string { return html.replace(/\n/g, "<br/>"); }

// ─── Dynamic CSS ──────────────────────────────────────────────────────────────

function previewStyles(tg: TGPalette): string { return `
  @keyframes tgBubbleIn {
    from { opacity: 0; transform: translateY(6px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0)   scale(1);    }
  }
  @keyframes tgModeSwitch {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .tg-bubble-enter {
    animation: tgBubbleIn 0.2s cubic-bezier(0.34, 1.2, 0.64, 1) both;
  }
  .tg-mode-content {
    animation: tgModeSwitch 0.2s ease-out both;
  }
  .tg-preview-text b, .tg-preview-text strong { font-weight: 600 }
  .tg-preview-text i, .tg-preview-text em     { font-style: italic }
  .tg-preview-text u                           { text-decoration: underline }
  .tg-preview-text s                           { text-decoration: line-through }
  .tg-preview-text b[data-post-title] {
    display: block; font-size: 15.5px; font-weight: 700;
    line-height: 1.3; letter-spacing: -0.1px; margin-bottom: 4px; color: ${tg.titleColor};
  }
  .tg-preview-text h1 { font-size: 18px; font-weight: 700; line-height: 1.25; margin: 2px 0 6px; color: ${tg.headingColor}; }
  .tg-preview-text h2 { font-size: 16px; font-weight: 700; line-height: 1.25; margin: 2px 0 5px; color: ${tg.headingColor}; }
  .tg-preview-text h3 { font-size: 14.5px; font-weight: 600; line-height: 1.3; margin: 2px 0 4px; color: ${tg.headingColor}; }
  .tg-preview-text code {
    font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.83em;
    background: ${tg.codeBg}; padding: 1px 5px; border-radius: 4px;
  }
  .tg-preview-text pre {
    font-family: 'JetBrains Mono', monospace; font-size: 0.82em;
    background: ${tg.codeBg}; padding: 8px 10px; border-radius: 6px;
    white-space: pre-wrap; word-break: break-all; margin: 4px 0;
  }
  .tg-preview-text a { color: ${tg.linkFg}; text-decoration: none }
  .tg-preview-text a:hover { text-decoration: underline }
  .tg-preview-text blockquote {
    border-left: 3px solid ${tg.quoteBorder}; background: ${tg.quoteBg};
    margin: 4px 0; padding: 5px 10px; border-radius: 0 6px 6px 0;
  }
  .tg-preview-text p { margin: 0 0 4px 0; }
  .tg-preview-text p:last-child { margin-bottom: 0; }
  .tg-preview-text br { display: block; content: ""; margin: 2px 0 }
  .tg-preview-text mark {
    background: rgba(255,220,0,0.25); color: inherit; border-radius: 2px; padding: 0 2px;
  }
`; }

// ─── Spoiler ──────────────────────────────────────────────────────────────────

function Spoiler({ html }: { html: string }) {
  const tg = useTG();
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={() => setRevealed(true)}
      style={{
        backgroundColor: revealed ? "transparent" : tg.spoilerBg,
        color:  revealed ? "inherit" : "transparent",
        filter: revealed ? "none" : "blur(4px)",
        borderRadius: 4,
        cursor: revealed ? "default" : "pointer",
        userSelect: revealed ? "text" : "none",
        transition: "all 0.22s",
        display: "inline",
        padding: "0 2px",
      }}
      dangerouslySetInnerHTML={{ __html: sanitize(html) }}
    />
  );
}

// ─── Expandable blockquote ───────────────────────────────────────────────────

function ExpandableBlockquote({ html }: { html: string }) {
  const tg = useTG();
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ margin: "4px 0" }}>
      <div
        style={{
          borderLeft: `3px solid ${tg.quoteBorder}`,
          background: tg.quoteBg,
          padding: "5px 10px",
          borderRadius: "0 6px 6px 0",
          overflow: "hidden",
          maxHeight: expanded ? "none" : "4.5em",
          position: "relative",
          transition: "max-height 0.25s ease",
        }}
      >
        <span dangerouslySetInnerHTML={{ __html: sanitize(html) }} />
        {!expanded && (
          <div style={{
            position: "absolute", bottom: 0, left: 3, right: 0, height: "2em",
            background: `linear-gradient(transparent, ${tg.quoteFade})`,
            pointerEvents: "none",
          }} />
        )}
      </div>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 3,
          marginTop: 3,
          background: "none", border: "none",
          color: tg.linkFg,
          cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1.4,
        }}
      >
        {expanded ? t("preview.collapse") : t("preview.readMore")}
      </button>
    </div>
  );
}

// ─── Text renderer ────────────────────────────────────────────────────────────

type TextPart = { type: "html" | "spoiler" | "expandable-quote"; content: string };

function splitSpoilers(segment: string): TextPart[] {
  const result: TextPart[] = [];
  const re = /<tg-spoiler>([\s\S]*?)<\/tg-spoiler>/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    if (m.index > last) result.push({ type: "html", content: segment.slice(last, m.index) });
    result.push({ type: "spoiler", content: m[1] });
    last = re.lastIndex;
  }
  if (last < segment.length) result.push({ type: "html", content: segment.slice(last) });
  return result;
}

function TelegramText({ html }: { html: string }) {
  const withBreaks = useMemo(() => {
    // <p> tags → inline: strip opening tag, closing tag becomes line break
    const inlined = html
      .replace(/<p>/gi, "")
      .replace(/<\/p>/gi, "<br/>");
    return nlToBr(inlined);
  }, [html]);
  const parts = useMemo((): TextPart[] => {
    const result: TextPart[] = [];
    const bqRe = /<blockquote expandable>([\s\S]*?)<\/blockquote>/gi;
    let last = 0, m: RegExpExecArray | null;
    while ((m = bqRe.exec(withBreaks)) !== null) {
      if (m.index > last) result.push(...splitSpoilers(withBreaks.slice(last, m.index)));
      result.push({ type: "expandable-quote", content: m[1] });
      last = bqRe.lastIndex;
    }
    if (last < withBreaks.length) result.push(...splitSpoilers(withBreaks.slice(last)));
    return result;
  }, [withBreaks]);

  return (
    <span className="tg-preview-text">
      {parts.map((p, i) => {
        if (p.type === "spoiler")          return <Spoiler key={i} html={p.content} />;
        if (p.type === "expandable-quote") return <ExpandableBlockquote key={i} html={p.content} />;
        return <span key={i} dangerouslySetInnerHTML={{ __html: sanitize(p.content) }} />;
      })}
    </span>
  );
}

// ─── Timestamp + views ────────────────────────────────────────────────────────

function MetaRow({ inMedia = false }: { inMedia?: boolean }) {
  const tg = useTG();
  const time = useMemo(
    () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    []
  );
  return (
    <div
      className="flex items-center gap-1.5"
      style={{
        justifyContent: "flex-end",
        color: inMedia ? "rgba(255,255,255,0.85)" : tg.timeFg,
        fontSize: 12, lineHeight: 1,
        ...(inMedia
          ? { position: "absolute", bottom: 8, right: 10, background: "rgba(0,0,0,0.42)", borderRadius: 10, padding: "3px 6px" }
          : { marginTop: 3, paddingBottom: 1 }),
      }}
    >
      <Eye size={11} style={{ opacity: 0.8 }} />
      <span style={{ letterSpacing: "0.2px" }}>2</span>
      <span style={{ opacity: 0.6, margin: "0 1px" }}>·</span>
      <span>{time}</span>
      <svg width="15" height="11" viewBox="0 0 15 11" fill="none" style={{ marginLeft: 1 }}>
        <path d="M1 5.5L4.5 9L10 2" stroke={tg.checkFg} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M5 5.5L8.5 9L14 2" stroke={tg.checkFg} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

// ─── Text bubble ─────────────────────────────────────────────────────────────

function TextBubble({ html }: { html: string }) {
  const tg = useTG();
  return (
    <div style={{
      alignSelf: "flex-end",
      backgroundColor: tg.bubbleBg,
      borderRadius: "16px 4px 16px 16px",
      maxWidth: 300, minWidth: 72,
      boxShadow: "0 1px 3px rgba(0,0,0,0.2), 0 0 0 0.5px rgba(0,0,0,0.08)",
      padding: "8px 12px 4px",
      color: tg.bubbleText,
      fontSize: 14.5, lineHeight: "1.55", wordBreak: "break-word",
    }}>
      <TelegramText html={html} />
      <MetaRow />
    </div>
  );
}

// ─── Image bubble ─────────────────────────────────────────────────────────────

function ImageBubble({ src }: { src: string }) {
  const tg = useTG();
  return (
    <div style={{
      alignSelf: "flex-end",
      borderRadius: "16px 4px 16px 16px",
      overflow: "hidden", maxWidth: 300,
      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      backgroundColor: tg.mediaBg, position: "relative",
    }}>
      <img src={src} alt="" draggable={false}
        style={{ width: "100%", maxHeight: 320, objectFit: "cover", display: "block" }} />
      <MetaRow inMedia />
    </div>
  );
}

// ─── Video bubble ─────────────────────────────────────────────────────────────

function VideoBubble({ src }: { src: string }) {
  const tg = useTG();
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <div
      style={{
        alignSelf: "flex-end",
        borderRadius: "16px 4px 16px 16px",
        overflow: "hidden", maxWidth: 300,
        boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
        backgroundColor: tg.mediaBg, position: "relative", cursor: "pointer",
      }}
      onClick={() => {
        const v = ref.current;
        if (!v) return;
        if (playing) { v.pause(); setPlaying(false); }
        else          { v.play();  setPlaying(true);  }
      }}
    >
      <video ref={ref} src={src} loop playsInline preload="metadata"
        style={{ width: "100%", maxHeight: 320, objectFit: "cover", display: "block" }}
        onEnded={() => setPlaying(false)} />
      {!playing && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          backgroundColor: tg.videoOverlay,
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: "50%",
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}>
            <Play size={24} fill="white" color="white" style={{ marginLeft: 3 }} />
          </div>
        </div>
      )}
      <MetaRow inMedia />
    </div>
  );
}

// ─── File bubble ─────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${t("unit.b")}`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${t("unit.kb")}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${t("unit.mb")}`;
}

function FileBubble({ fileName, fileSize }: { fileName: string; fileSize: number }) {
  const tg = useTG();
  const ext = fileName.split(".").pop()?.toUpperCase() ?? "FILE";
  return (
    <div style={{
      alignSelf: "flex-end",
      backgroundColor: tg.bubbleBg,
      borderRadius: "16px 4px 16px 16px",
      maxWidth: 300,
      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
      padding: "10px 12px 4px",
      color: tg.bubbleText, fontSize: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <div style={{
          width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
          background: "linear-gradient(135deg, rgba(106,183,245,0.35), rgba(106,183,245,0.15))",
          border: `1.5px solid rgba(106,183,245,0.3)`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <FileText size={20} color={tg.linkFg} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: 14 }}>
            {fileName}
          </div>
          <div style={{ fontSize: 12, color: tg.timeFg, marginTop: 2 }}>
            {fileSize > 0 ? `${formatFileSize(fileSize)} · ${ext}` : ext}
          </div>
        </div>
      </div>
      <MetaRow />
    </div>
  );
}

// ─── Rich message bubble ──────────────────────────────────────────────────────

type RichPart =
  | { type: "text";  html: string }
  | { type: "img";   src: string }
  | { type: "video"; src: string };

function RichBubble({ html, segments }: { html: string; segments: ContentSegment[] }) {
  const tg = useTG();
  const parts = useMemo<RichPart[]>(() => {
    const imgSrcs = segments.filter(s => s.type === "image").map(s => (s as any).src as string);
    const vidSrcs = segments.filter(s => s.type === "video").map(s => (s as any).src as string);
    let imgIdx = 0, vidIdx = 0;
    const re = /<(img|video)\s[^>]*src="([^"]+)"[^>]*\/?>/g;
    const result: RichPart[] = [];
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      if (m.index > last) result.push({ type: "text", html: html.slice(last, m.index) });
      result.push(m[1] === "img"
        ? { type: "img",   src: imgSrcs[imgIdx++] ?? "" }
        : { type: "video", src: vidSrcs[vidIdx++] ?? "" });
      last = re.lastIndex;
    }
    if (last < html.length) result.push({ type: "text", html: html.slice(last) });
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  return (
    <div style={{
      alignSelf: "flex-end",
      backgroundColor: tg.bubbleBg,
      borderRadius: "16px 4px 16px 16px",
      maxWidth: 300,
      boxShadow: "0 1px 3px rgba(0,0,0,0.2), 0 0 0 0.5px rgba(0,0,0,0.08)",
      color: tg.bubbleText, fontSize: 14.5, lineHeight: "1.55", overflow: "hidden",
    }}>
      {parts.map((p, i) => {
        if (p.type === "img")  return p.src ? <img  key={i} src={p.src} alt="" draggable={false} style={{ width: "100%", maxHeight: 280, objectFit: "cover", display: "block" }} /> : null;
        if (p.type === "video") return p.src ? <video key={i} src={p.src} preload="metadata" style={{ width: "100%", maxHeight: 280, objectFit: "cover", display: "block" }} /> : null;
        const trimmed = p.html.trim();
        return trimmed ? <div key={i} style={{ padding: "8px 12px 4px", wordBreak: "break-word" }}><TelegramText html={trimmed} /></div> : null;
      })}
      <div style={{ padding: "0 12px 4px" }}><MetaRow /></div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function TelegramPreview() {
  const { contentJson, postTitle, includeTitle, publishMode } = useEditorStore();
  const splitGaps = useEditorStore((s) => s.splitGaps);
  const appTheme = useSettingsStore((s) => s.theme);

  const isDark = appTheme === "dark" || (
    appTheme === "system" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const tg = isDark ? DARK : LIGHT;

  const effectiveTitle = includeTitle ? postTitle : "";

  const messages = useMemo<ContentSegment[][]>(() => {
    if (!contentJson && !effectiveTitle) return [[]];
    return splitIntoMessagesAtGaps(
      contentJson || '{"type":"doc","content":[]}',
      splitGaps,
      effectiveTitle,
    );
  }, [contentJson, effectiveTitle, splitGaps]);

  const segments = messages.flat();

  const richHtml = useMemo(() => {
    if (publishMode !== "rich") return "";
    return tiptapToRichHtml(contentJson || '{"type":"doc","content":[]}', effectiveTitle).html;
  }, [contentJson, effectiveTitle, publishMode]);

  const isEmpty = segments.length === 0 ||
    segments.every((s) => s.type === "text" && !s.html.trim());

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); });
  }, [segments.length, publishMode]);

  return (
    <TGCtx.Provider value={tg}>
      <style>{previewStyles(tg)}</style>

      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: "auto", overflowX: "hidden",
          backgroundColor: tg.chatBg,
          backgroundImage: tg.chatGradient,
          padding: "16px 12px",
          display: "flex", flexDirection: "column", gap: 6,
        }}
      >
        {isEmpty ? (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: tg.emptyText, fontSize: 13, textAlign: "center", padding: "32px 16px",
          }}>
            {t("preview.placeholder")}
          </div>
        ) : (
          <div key={publishMode} className="tg-mode-content" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {publishMode === "rich" ? (
              <RichBubble html={richHtml} segments={segments} />
            ) : messages.length <= 1 ? (
              messages[0]?.map((seg, i) => {
                if (seg.type === "text")  return <TextBubble  key={i} html={seg.html} />;
                if (seg.type === "image") return <ImageBubble key={i} src={seg.src} />;
                if (seg.type === "video") return <VideoBubble key={i} src={seg.src} />;
                if (seg.type === "file")  return <FileBubble  key={i} fileName={seg.fileName} fileSize={seg.fileSize} />;
                return null;
              })
            ) : (
              messages.map((msgSegs, mi) => (
                <div key={mi} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {mi > 0 && (
                    <div style={{
                      textAlign: "center", fontSize: 11,
                      color: tg.datePillText,
                      backgroundColor: tg.datePillBg,
                      borderRadius: 10, padding: "2px 10px",
                      alignSelf: "center",
                    }}>
                      {ti("split.previewLabel", { n: mi + 1 })}
                    </div>
                  )}
                  {msgSegs.map((seg, i) => {
                    if (seg.type === "text")  return <TextBubble  key={i} html={seg.html} />;
                    if (seg.type === "image") return <ImageBubble key={i} src={seg.src} />;
                    if (seg.type === "video") return <VideoBubble key={i} src={seg.src} />;
                    if (seg.type === "file")  return <FileBubble  key={i} fileName={seg.fileName} fileSize={seg.fileSize} />;
                    return null;
                  })}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </TGCtx.Provider>
  );
}
