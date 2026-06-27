import React, { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: string;
  children: React.ReactElement;
  delay?: number;
  placement?: "top" | "bottom";
}

export function Tooltip({ content, children, delay = 500, placement = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCoords({
        x: rect.left + rect.width / 2,
        y: placement === "top" ? rect.top - 6 : rect.bottom + 6,
      });
      setVisible(true);
    }, delay);
  }, [delay, placement]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const clone = React.cloneElement(children, {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
      const origRef = (children as React.ReactElement & { ref?: React.Ref<HTMLElement> }).ref;
      if (origRef) {
        if (typeof origRef === "function") origRef(el);
        else (origRef as React.MutableRefObject<HTMLElement | null>).current = el;
      }
    },
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      show();
      children.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      hide();
      children.props.onMouseLeave?.(e);
    },
  });

  return (
    <>
      {clone}
      {visible && content && createPortal(
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: coords.x,
            top: placement === "top" ? coords.y : undefined,
            bottom: placement === "bottom" ? `calc(100vh - ${coords.y}px)` : undefined,
            transform: "translateX(-50%) translateY(-100%)",
            whiteSpace: "nowrap",
            backgroundColor: "var(--bg-elevated)",
            color: "var(--text-primary)",
            fontSize: 11,
            fontWeight: 500,
            padding: "4px 9px",
            borderRadius: 6,
            border: "1px solid var(--border-subtle)",
            boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
            pointerEvents: "none",
            zIndex: 9999,
            lineHeight: 1.4,
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}
