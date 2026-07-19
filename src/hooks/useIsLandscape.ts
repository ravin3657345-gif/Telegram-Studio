import { useEffect, useState } from "react";

// Paired with useIsMobileLayout() — that hook alone can't tell portrait from
// landscape (a real Android device is always "mobile layout" regardless of
// orientation, by design, see its own doc comment). This is only meaningful
// combined with isMobile: a wide desktop window matching `(orientation:
// landscape)` is just... a normal desktop window, not something to compact.
export function useIsLandscape(): boolean {
  const [isLandscape, setIsLandscape] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(orientation: landscape)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const handler = () => setIsLandscape(mq.matches);
    handler();
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isLandscape;
}
