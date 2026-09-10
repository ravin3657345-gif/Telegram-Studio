import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search } from "lucide-react";
import { useCommandPaletteItems } from "@/hooks/useCommandPaletteItems";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { t } from "@/lib/i18n";

// Adapted from Watermelon UI's command-search-base.tsx (registry.watermelon.sh)
// — kept the sectioned filtered list, arrow-key nav, and entrance motion;
// dropped its own visible trigger button/layoutId-morph (this one is invoked
// purely via the global shortcut below, nothing sits in the layout waiting
// to be clicked) and rebuilt the panel as a plain fixed overlay instead of
// wrapping Dialog.tsx — arrow keys need to drive list selection here, not
// Radix's own roving-focus, and this app already has that plain-overlay
// pattern (see LicenseGate.tsx).
//
// Global Ctrl/Cmd+K is a first here — every other keyboard shortcut in this
// app is a component-local `window.addEventListener` scoped by an `isFocused`
// check (PostEditor.tsx, EmojiPicker.tsx, EditorContextMenu.tsx). This one is
// mounted once by AppShell so it works from anywhere — except it explicitly
// backs off when focus is inside an editable element, since Ctrl+K inside
// the post editor already means "insert link" (PostEditor.tsx's own Ctrl+K
// handler, guarded by `editor?.isFocused`). Without that guard both would
// fire on the same keystroke.
function isEditableFocus(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const items = useCommandPaletteItems();
  const isMobile = useIsMobileLayout();
  const keyboardInset = useKeyboardInset();

  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "k") {
        if (!open && isEditableFocus()) return;
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [open]);

  // Mobile: the TopBar search button opens the palette via this custom event
  // (no keyboard shortcut exists on a phone).
  useEffect(() => {
    function handleOpen() { setOpen(true); }
    window.addEventListener("telegramstudio:open-palette", handleOpen);
    return () => window.removeEventListener("telegramstudio:open-palette", handleOpen);
  }, []);

  useEffect(() => {
    if (!open) { setQuery(""); setActiveIndex(0); return; }
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      i.title.toLowerCase().includes(q) || i.subtitle?.toLowerCase().includes(q));
  }, [items, query]);

  const sections = useMemo(() => {
    const groups = new Map<string, typeof filtered>();
    for (const item of filtered) {
      const list = groups.get(item.section) ?? [];
      list.push(item);
      groups.set(item.section, list);
    }
    return [...groups.entries()];
  }, [filtered]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  function select(item: (typeof filtered)[number]) {
    item.onSelect();
    setOpen(false);
  }

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) select(item);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 100, backgroundColor: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }}
          />
          <motion.div
            initial={isMobile ? { opacity: 0, y: "100%" } : { opacity: 0, scale: 0.97, y: -8 }}
            animate={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={isMobile ? { opacity: 0, y: "100%" } : { opacity: 0, scale: 0.97, y: -8 }}
            transition={{ type: "spring", duration: 0.25, bounce: isMobile ? 0 : 0.15 }}
            onClick={(e) => e.stopPropagation()}
            style={
              isMobile
                ? {
                    position: "fixed", left: 0, right: 0, bottom: 0, top: "auto",
                    zIndex: 101, width: "100%", maxWidth: "none",
                    backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-default)", borderBottom: "none",
                    borderRadius: "16px 16px 0 0", boxShadow: "0 -8px 32px rgba(0,0,0,0.3)",
                    display: "flex", flexDirection: "column", maxHeight: "80vh", overflow: "hidden",
                    paddingBottom: keyboardInset,
                  }
                : {
                    position: "fixed", top: "18%", left: "50%", transform: "translateX(-50%)",
                    zIndex: 101, width: "100%", maxWidth: 480,
                    backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-default)",
                    borderRadius: 12, boxShadow: "0 24px 48px rgba(0,0,0,0.28)",
                    display: "flex", flexDirection: "column", maxHeight: "60vh", overflow: "hidden",
                  }
            }
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
              <Search size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={t("palette.placeholder")}
                spellCheck={false}
                style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 14, color: "var(--text-primary)" }}
              />
              <kbd className="text-2xs" style={{ padding: "2px 6px", borderRadius: 5, border: "1px solid var(--border-default)", color: "var(--text-muted)" }}>
                Esc
              </kbd>
            </div>

            <div style={{ overflowY: "auto", padding: 6 }}>
              {filtered.length === 0 ? (
                <p className="text-sm" style={{ padding: "24px 12px", textAlign: "center", color: "var(--text-muted)" }}>
                  {t("palette.noResults")}
                </p>
              ) : (
                sections.map(([section, sectionItems]) => (
                  <div key={section} style={{ marginBottom: 4 }}>
                    <p className="text-2xs font-semibold uppercase" style={{ padding: "6px 10px 4px", color: "var(--text-muted)", letterSpacing: "0.04em" }}>
                      {section}
                    </p>
                    {sectionItems.map((item) => {
                      const globalIndex = filtered.indexOf(item);
                      const isActive = globalIndex === activeIndex;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onMouseEnter={() => setActiveIndex(globalIndex)}
                          onClick={() => select(item)}
                          className="flex items-center gap-2.5 w-full text-left text-sm rounded-lg"
                          style={{
                            padding: "8px 10px",
                            backgroundColor: isActive ? "var(--accent)" : "transparent",
                            color: isActive ? "#fff" : "var(--text-primary)",
                          }}
                        >
                          <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex" }}>{item.icon}</span>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.title}
                          </span>
                          {item.subtitle && (
                            <span className="text-2xs" style={{ flexShrink: 0, color: isActive ? "rgba(255,255,255,0.75)" : "var(--text-muted)" }}>
                              {item.subtitle}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
