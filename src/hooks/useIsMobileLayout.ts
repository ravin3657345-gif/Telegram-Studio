import { useEffect, useState } from "react";

// Below this viewport width the app switches from the desktop sidebar/columns
// layout to a stacked mobile one (bottom tab bar, single-column editor tabs).
// Width-based on purpose, not platform-based — a narrow desktop window (or a
// tablet split-screen) gets the same treatment as a phone.
export const MOBILE_BREAKPOINT = 680;

export function useIsMobileLayout(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => isAndroidPlatform() || (typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT)
  );

  useEffect(() => {
    // A real Android device is always the mobile layout, in any orientation —
    // rotating to landscape must not fall back to the desktop sidebar/columns
    // layout, which assumes far more vertical space than a phone has to give.
    if (isAndroidPlatform()) return;

    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

// Actual OS platform check (unrelated to window width) — used only for things
// that are meaningless regardless of size, like desktop window-chrome buttons.
export function isAndroidPlatform(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}
