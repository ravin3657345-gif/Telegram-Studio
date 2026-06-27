import { useMemo, useState, useRef, createContext, useContext } from "react";
import { Play, FileText, Search, MoreVertical, ArrowLeft, Eye } from "lucide-react";
import DOMPurify from "dompurify";
import { useEditorStore } from "@/store/editorStore";
import { useChannelsStore } from "@/store/channelsStore";
import { usePublishStore } from "@/store/publishStore";
import { useSettingsStore } from "@/store/settingsStore";
import { segmentDocument, type ContentSegment } from "@/lib/htmlConverter";
import { tiptapToRichHtml } from "@/lib/richMessageConverter";

// ─── DOMPurify config ────────────────────────────────────────────────────────

const TELEGRAM_TAGS = [
  "b", "strong", "i", "em", "u", "s", "strike", "del",
  "code", "pre", "a", "br", "blockquote",
  "h1", "h2", "h3", "ul", "ol", "li",
  "tg-spoiler", "mark", "sub", "sup",
  "img", "video", "span", "details", "summary",
];
const TELEGRAM_ATTRS = ["href", "src", "alt", "data-post-title", "class", "style", "loop", "preload", "playsInline", "expandable"];

function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: TELEGRAM_TAGS,
    ALLOWED_ATTR: TELEGRAM_ATTRS,
    ALLOW_DATA_ATTR: false,
  });
}

// ─── Theme palettes ───────────────────────────────────────────────────────────

interface TGPalette {
  chatBg: string;
  chatGradient: string;
  chatDotPattern: string;
  headerBg: string;
  headerBorder: string;
  headerText: string;
  headerTextMuted: string;
  headerIcon: string;
  bubbleBg: string;
  bubbleText: string;
  timeFg: string;
  checkFg: string;
  linkFg: string;
  codeBg: string;
  quoteBorder: string;
  quoteBg: string;
  quoteFade: string;
  mediaBg: string;
  videoOverlay: string;
  spoilerBg: string;
  datePillBg: string;
  datePillText: string;
  inputBg: string;
  inputBorder: string;
  inputPlaceholder: string;
  emptyText: string;
  titleColor: string;
  headingColor: string;
}

const DARK: TGPalette = {
  chatBg:           "#17212b",
  chatGradient:     `radial-gradient(ellipse at 15% 85%, rgba(28,55,80,0.6) 0%, transparent 55%),
                     radial-gradient(ellipse at 85% 15%, rgba(20,45,70,0.5) 0%, transparent 55%)`,
  chatDotPattern:   `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Ccircle cx='30' cy='30' r='1.5' fill='rgba(255,255,255,0.025)'/%3E%3Ccircle cx='0' cy='0' r='1.5' fill='rgba(255,255,255,0.025)'/%3E%3Ccircle cx='60' cy='0' r='1.5' fill='rgba(255,255,255,0.025)'/%3E%3Ccircle cx='0' cy='60' r='1.5' fill='rgba(255,255,255,0.025)'/%3E%3Ccircle cx='60' cy='60' r='1.5' fill='rgba(255,255,255,0.025)'/%3E%3C/svg%3E")`,
  headerBg:         "#1f2b38",
  headerBorder:     "rgba(255,255,255,0.06)",
  headerText:       "#ffffff",
  headerTextMuted:  "rgba(255,255,255,0.45)",
  headerIcon:       "rgba(255,255,255,0.5)",
  bubbleBg:         "#2b5278",
  bubbleText:       "rgba(255,255,255,0.92)",
  timeFg:           "rgba(255,255,255,0.45)",
  checkFg:          "#5ac8fa",
  linkFg:           "#6ab7f5",
  codeBg:           "rgba(0,0,0,0.28)",
  quoteBorder:      "#5b9bd5",
  quoteBg:          "rgba(91,155,213,0.10)",
  quoteFade:        "rgba(43,82,120,0.95)",
  mediaBg:          "#162330",
  videoOverlay:     "rgba(0,0,0,0.38)",
  spoilerBg:        "rgba(255,255,255,0.14)",
  datePillBg:       "rgba(0,0,0,0.35)",
  datePillText:     "rgba(255,255,255,0.7)",
  inputBg:          "rgba(255,255,255,0.06)",
  inputBorder:      "rgba(255,255,255,0.07)",
  inputPlaceholder: "rgba(255,255,255,0.25)",
  emptyText:        "rgba(255,255,255,0.22)",
  titleColor:       "#ffffff",
  headingColor:     "#ffffff",
};

const LIGHT: TGPalette = {
  chatBg:           "#dfe4ea",
  chatGradient:     `radial-gradient(ellipse at 20% 80%, rgba(180,200,220,0.5) 0%, transparent 55%),
                     radial-gradient(ellipse at 80% 20%, rgba(160,185,210,0.4) 0%, transparent 55%)`,
  chatDotPattern:   `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60'%3E%3Ccircle cx='30' cy='30' r='1.5' fill='rgba(0,0,0,0.04)'/%3E%3Ccircle cx='0' cy='0' r='1.5' fill='rgba(0,0,0,0.04)'/%3E%3Ccircle cx='60' cy='0' r='1.5' fill='rgba(0,0,0,0.04)'/%3E%3Ccircle cx='0' cy='60' r='1.5' fill='rgba(0,0,0,0.04)'/%3E%3Ccircle cx='60' cy='60' r='1.5' fill='rgba(0,0,0,0.04)'/%3E%3C/svg%3E")`,
  headerBg:         "#ffffff",
  headerBorder:     "rgba(0,0,0,0.08)",
  headerText:       "#111111",
  headerTextMuted:  "rgba(0,0,0,0.45)",
  headerIcon:       "rgba(0,0,0,0.4)",
  bubbleBg:         "#effdde",
  bubbleText:       "rgba(0,0,0,0.87)",
  timeFg:           "rgba(0,0,0,0.4)",
  checkFg:          "#4fab3e",
  linkFg:           "#1a73e8",
  codeBg:           "rgba(0,0,0,0.06)",
  quoteBorder:      "#6c9bc3",
  quoteBg:          "rgba(108,155,195,0.12)",
  quoteFade:        "rgba(239,253,222,0.95)",
  mediaBg:          "#c8d3de",
  videoOverlay:     "rgba(0,0,0,0.22)",
  spoilerBg:        "rgba(0,0,0,0.12)",
  datePillBg:       "rgba(0,0,0,0.22)",
  datePillText:     "rgba(255,255,255,0.9)",
  inputBg:          "rgba(0,0,0,0.05)",
  inputBorder:      "rgba(0,0,0,0.07)",
  inputPlaceholder: "rgba(0,0,0,0.3)",
  emptyText:        "rgba(0,0,0,0.3)",
  titleColor:       "#111111",
  headingColor:     "#111111",
};

// ─── Theme context ────────────────────────────────────────────────────────────

const TGCtx = createContext<TGPalette>(DARK);
function useTG() { return useContext(TGCtx); }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

function avatarColor(name: string): string {
  const palette = [
    "#FF6B6B","#FF8E53","#FFC542","#2ECC71","#1ABC9C",
    "#3498DB","#9B59B6","#E91E63","#00BCD4","#4CAF50",
  ];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff;
  return palette[Math.abs(h) % palette.length];
}

function nlToBr(html: string): string { return html.replace(/\n/g, "<br/>"); }

// ─── Dynamic CSS ──────────────────────────────────────────────────────────────

function previewStyles(tg: TGPalette): string { return `
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
        {expanded ? "▲ Свернуть" : "▼ Читать далее"}
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
  const withBreaks = useMemo(() => nlToBr(html), [html]);
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
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
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

// ─── Chat header ─────────────────────────────────────────────────────────────

function ChatHeader({ channelName }: { channelName: string }) {
  const tg = useTG();
  const bg      = avatarColor(channelName || "C");
  const letters = initials(channelName || "Канал");
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px 10px 8px",
      backgroundColor: tg.headerBg,
      borderBottom: `1px solid ${tg.headerBorder}`,
      flexShrink: 0,
    }}>
      <button style={{ background: "none", border: "none", color: tg.linkFg, padding: "2px 4px", cursor: "default" }}>
        <ArrowLeft size={20} />
      </button>
      <div style={{
        width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
        backgroundColor: bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, fontWeight: 700, color: "#fff", letterSpacing: "0.5px",
      }}>
        {letters}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15, fontWeight: 600, color: tg.headerText,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {channelName || "Ваш канал"}
        </div>
        <div style={{ fontSize: 12, color: tg.headerTextMuted, marginTop: 1 }}>
          канал
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, color: tg.headerIcon }}>
        <Search size={18} />
        <MoreVertical size={18} />
      </div>
    </div>
  );
}

// ─── Date separator ───────────────────────────────────────────────────────────

function DateSeparator() {
  const tg = useTG();
  const label = useMemo(() => {
    const d = new Date();
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  }, []);
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "6px 0 2px" }}>
      <div style={{
        backgroundColor: tg.datePillBg,
        color: tg.datePillText,
        fontSize: 12, fontWeight: 500,
        padding: "4px 12px", borderRadius: 12,
        backdropFilter: "blur(4px)",
      }}>
        {label}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function TelegramPreview() {
  const { contentJson, postTitle, includeTitle, publishMode } = useEditorStore();
  const channels           = useChannelsStore((s) => s.channels);
  const selectedChannelIds = usePublishStore((s) => s.selectedChannelIds);
  const appTheme           = useSettingsStore((s) => s.theme);

  // Resolve "system" to actual dark/light
  const isDark = appTheme === "dark" || (
    appTheme === "system" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  const tg = isDark ? DARK : LIGHT;

  const activeChannel =
    channels.find((c) => selectedChannelIds[0] && c.id === selectedChannelIds[0]) ??
    channels[0];
  const channelName = activeChannel?.title ?? "Предпросмотр";

  const effectiveTitle = includeTitle ? postTitle : "";

  const segments = useMemo<ContentSegment[]>(() => {
    if (!contentJson && !effectiveTitle) return [];
    return segmentDocument(contentJson || '{"type":"doc","content":[]}', effectiveTitle);
  }, [contentJson, effectiveTitle]);

  const richHtml = useMemo(() => {
    if (publishMode !== "rich") return "";
    return tiptapToRichHtml(contentJson || '{"type":"doc","content":[]}', effectiveTitle).html;
  }, [contentJson, effectiveTitle, publishMode]);

  const isEmpty = segments.length === 0 ||
    segments.every((s) => s.type === "text" && !s.html.trim());

  return (
    <TGCtx.Provider value={tg}>
      <style>{previewStyles(tg)}</style>

      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* Header */}
        <ChatHeader channelName={channelName} />

        {/* Chat area */}
        <div style={{
          flex: 1, overflowY: "auto", overflowX: "hidden",
          backgroundColor: tg.chatBg,
          backgroundImage: `${tg.chatDotPattern}, ${tg.chatGradient}`,
          padding: "8px 12px 12px",
          display: "flex", flexDirection: "column", justifyContent: "flex-end",
        }}>
          {isEmpty ? (
            <div style={{ textAlign: "center", color: tg.emptyText, fontSize: 13, padding: "32px 0" }}>
              Начните писать или прикрепите медиа
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <DateSeparator />
              {publishMode === "rich" ? (
                <RichBubble html={richHtml} segments={segments} />
              ) : (
                segments.map((seg, i) => {
                  if (seg.type === "text")  return <TextBubble  key={i} html={seg.html} />;
                  if (seg.type === "image") return <ImageBubble key={i} src={seg.src} />;
                  if (seg.type === "video") return <VideoBubble key={i} src={seg.src} />;
                  if (seg.type === "file")  return <FileBubble  key={i} fileName={seg.fileName} fileSize={seg.fileSize} />;
                  return null;
                })
              )}
            </div>
          )}
        </div>

        {/* Fake input bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 12px",
          backgroundColor: tg.headerBg,
          borderTop: `1px solid ${tg.headerBorder}`,
          flexShrink: 0,
        }}>
          <div style={{
            flex: 1, height: 36, borderRadius: 18,
            backgroundColor: tg.inputBg,
            border: `1px solid ${tg.inputBorder}`,
            display: "flex", alignItems: "center", paddingLeft: 14,
          }}>
            <span style={{ fontSize: 13, color: tg.inputPlaceholder }}>Сообщение…</span>
          </div>
        </div>
      </div>
    </TGCtx.Provider>
  );
}
