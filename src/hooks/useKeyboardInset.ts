import { useEffect, useState } from "react";

// How much of the viewport's bottom edge is currently covered by the
// on-screen keyboard. `window.innerHeight` stays the full layout viewport
// even once a keyboard opens — `visualViewport.height` shrinks to just the
// visible portion — so the gap between the two is exactly the keyboard's
// height. Nothing in the app used visualViewport before this (checked
// during planning): the only existing viewport-height handling is the
// static `100dvh` on `.app-root` (safe-area insets), which doesn't react to
// a keyboard appearing/disappearing at all.
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function update() {
      const occluded = window.innerHeight - vv!.height - vv!.offsetTop;
      setInset(Math.max(0, Math.round(occluded)));
    }

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
