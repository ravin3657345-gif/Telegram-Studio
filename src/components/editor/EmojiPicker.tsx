import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

interface EmojiPickerProps {
  editor: Editor;
  onClose: () => void;
  anchorRect?: DOMRect;
  savedPos?: { from: number; to: number } | null;
}

const EMOJI_CATEGORIES = [
  {
    name: "Смайлы",
    emojis: ["😀","😃","😄","😁","😅","😂","🤣","😊","😇","🙂","😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥴","😵","🤯","🥳","🥺","😢","😭","😤","😠","😡","🤬","😈","👿","💀","☠️","💩","🤡","👹","👺","👻","👽","👾","🤖","😺","😸","😹","😻","😼","😽","🙀","😿","😾"],
  },
  {
    name: "Жесты",
    emojis: ["👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🫰","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✍️","💅","🤳","💪","🦵","🦶","👂","🦻","👃","🧠","🫀","🫁","🦷","🦴","👀","👁️","👅","👄"],
  },
  {
    name: "Сердца",
    emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💕","💞","💓","💗","💖","💘","💝","💟","❣️","💔","❤️‍🔥","❤️‍🩹","♥️","💌"],
  },
  {
    name: "Природа",
    emojis: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🐣","🐥","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐌","🐞","🐜","🦟","🦗","🕷️","🦂","🐢","🐍","🦎","🦖","🦕","🐙","🦑","🦐","🦞","🦀","🐡","🐠","🐟","🐬","🐳","🐋","🦈","🐊","🐅","🐆","🦓","🦍","🦧","🐘","🦛","🦏","🐪","🐫","🦒","🦘","🦬","🐃","🐂","🐄","🐎","🐖","🐏","🐑","🦙","🐐","🦌","🐕","🐩","🦮","🐕‍🦺","🐈","🐈‍⬛","🪶","🐓","🦃","🦤","🦚","🦜","🦢","🦩","🕊️","🐇","🦝","🦨","🦡","🦫","🦦","🦥","🐁","🐀","🐿️","🦔","🐾","🐉","🐲","🌵","🎄","🌲","🌳","🌴","🌱","🌿","☘️","🍀","🎍","🪴","🎋","🍃","🍂","🍁","🪺","🪹","🍄","🐚","💐","🌸","💮","🪷","🌹","🥀","🌺","🌻","🌼","🌷","🌾","🌻"],
  },
  {
    name: "Еда",
    emojis: ["🍇","🍈","🍉","🍊","🍋","🍌","🍍","🥭","🍎","🍏","🍐","🍑","🍒","🍓","🫐","🥝","🍅","🫒","🥥","🥑","🍆","🥔","🥕","🌽","🌶️","🫑","🥒","🥬","🥦","🧄","🧅","🍄","🥜","🫘","🌰","🍞","🥐","🥖","🫓","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🦴","🌭","🍔","🍟","🍕","🫓","🥪","🥙","🧆","🌮","🌯","🫔","🥗","🥘","🫕","🥫","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍩","🍪","🎂","🍰","🧁","🥧","🍫","🍬","🍭","🍮","🍯","🍼","🥛","☕","🫖","🍵","🍶","🍾","🍷","🍸","🍹","🍺","🍻","🥂","🥃","🫗","🧊"],
  },
  {
    name: "Предметы",
    emojis: ["⌚️","📱","💻","⌨️","🖥️","🖨️","🖱️","🖲️","🕹️","🗜️","💽","💾","💿","📀","📼","📷","📸","📹","🎥","📽️","🎞️","📞","☎️","📟","📠","📺","📻","🎙️","🎚️","🎛️","🧭","⏱️","⏲️","⏰","🕰️","⌛️","📡","🔋","🪫","🔌","💡","🔦","🕯️","🪔","🧯","🗑️","🛢️","💸","💵","💴","💶","💷","🪙","💰","💳","💎","⚖️","🧰","🪛","🔧","🔨","⚒️","🛠️","⛏️","🪚","🔩","⚙️","🪤","🧱","⛓️","🧲","🔫","💣","🧨","🪓","🔪","🗡️","⚔️","🛡️","🚬","⚰️","🪦","⚱️","🏺","🔮","📿","🧿","🪬","💈","⚗️","🔭","🔬","🕳️","💊","💉","🩸","🩹","🩺","🚽","🪠","🧹","🪣","🧴","🪥","🪒","🧽","🪣","🧼","🫧","🪞","🪟","🗝️","🔑","🔐","🔒","🔓"],
  },
];

export function EmojiPicker({ editor, onClose, anchorRect, savedPos }: EmojiPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(savedPos ?? null);
  const [activeCategory, setActiveCategory] = useState(0);
  const [search, setSearch] = useState("");

  // Позиционирование пикера
  const style: React.CSSProperties = { position: "fixed", zIndex: 60 };
  if (anchorRect) {
    const pickerHeight = 420;
    const pickerWidth = 320;
    style.top = Math.min(anchorRect.bottom + 8, window.innerHeight - pickerHeight - 8);
    style.left = Math.min(anchorRect.left, window.innerWidth - pickerWidth - 8);
    if (style.top < 0) style.top = 8;
    if (style.left < 0) style.left = 8;
  } else {
    style.top = "50%";
    style.left = "50%";
    style.transform = "translate(-50%, -50%)";
  }

  // Закрытие по клику вне пикера
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const path = e.composedPath();
      if (!path.includes(containerRef.current!)) {
        onClose();
      }
    };
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Закрытие по Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  function insertEmoji(emoji: string) {
    let chain = editor.chain().focus();
    if (posRef.current) {
      chain = chain.setTextSelection(posRef.current);
    }
    chain.insertContent(emoji).run();
    const nextFrom = editor.state.selection.from;
    posRef.current = { from: nextFrom, to: nextFrom };
  }

  // Фильтрация эмодзи по поиску
  const allEmojis = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
  const filteredEmojis = search
    ? allEmojis.filter((e) => e.includes(search))
    : EMOJI_CATEGORIES[activeCategory]?.emojis ?? [];

  const displayEmojis = search ? filteredEmojis : EMOJI_CATEGORIES[activeCategory]?.emojis ?? [];

  return (
    <div
      ref={containerRef}
      style={{
        ...style,
        width: 320,
        background: "var(--bg-elevated, #1f1f23)",
        border: "1px solid var(--border-default, #2f2f35)",
        borderRadius: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        overflow: "hidden",
        fontSize: 13,
      }}
    >
      {/* Поиск */}
      <div style={{ padding: "8px 8px 0" }}>
        <input
          type="text"
          placeholder="Поиск эмодзи..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
          style={{
            width: "100%",
            height: 32,
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid var(--border-subtle, #3f3f45)",
            background: "var(--bg-input, #2a2a30)",
            color: "var(--text-primary, #e0e0e0)",
            outline: "none",
            fontSize: 13,
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Категории (только если нет поиска) */}
      {!search && (
        <div
          style={{
            display: "flex",
            gap: 2,
            padding: "6px 8px",
            overflowX: "auto",
            scrollbarWidth: "none",
            borderBottom: "1px solid var(--border-subtle, #2f2f35)",
          }}
        >
          {EMOJI_CATEGORIES.map((cat, i) => (
            <button
              key={cat.name}
              onClick={() => setActiveCategory(i)}
              title={cat.name}
              style={{
                flexShrink: 0,
                width: 36,
                height: 36,
                border: "none",
                borderRadius: 8,
                background: i === activeCategory ? "var(--bg-active, rgba(255,255,255,0.08))" : "transparent",
                cursor: "pointer",
                fontSize: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.15s",
              }}
            >
              {cat.emojis[0]}
            </button>
          ))}
        </div>
      )}

      {/* Сетка эмодзи */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(8, 1fr)",
          gap: 1,
          padding: 6,
          maxHeight: 280,
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {displayEmojis.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            onClick={() => insertEmoji(emoji)}
            title={emoji}
            style={{
              width: "100%",
              aspectRatio: "1",
              border: "none",
              borderRadius: 6,
              background: "transparent",
              cursor: "pointer",
              fontSize: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "background 0.1s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover, rgba(255,255,255,0.06))")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Инфо */}
      {displayEmojis.length === 0 && (
        <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted, #888)" }}>
          Эмодзи не найдены
        </div>
      )}
    </div>
  );
}