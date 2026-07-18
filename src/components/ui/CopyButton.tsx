import { useState, type MouseEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, Check } from "lucide-react";

// Adapted from Watermelon UI's copy-confirm.tsx (registry.watermelon.sh) —
// kept the icon-swap blur+scale spring (a real upgrade over the app's
// existing instant Copy→Check flip in HtmlViewPanel.tsx), dropped the
// per-character animated label and pill/settings chrome: this is a compact
// inline icon button for dense card lists, not a standalone hero action.
interface CopyButtonProps {
  value: string;
  title?: string;
  size?: number;
}

export function CopyButton({ value, title, size = 11 }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title}
      className="inline-flex items-center justify-center"
      style={{
        background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 0,
        color: copied ? "var(--success)" : "var(--text-muted)",
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? "check" : "copy"}
          initial={{ opacity: 0, scale: 0.4, filter: "blur(3px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.4, filter: "blur(3px)" }}
          transition={{ type: "spring", duration: 0.25, bounce: 0 }}
          style={{ display: "flex" }}
        >
          {copied ? <Check size={size} /> : <Copy size={size} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
