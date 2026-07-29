// Android UI scale — the equivalent of Windows' display scaling set to 75%.
//
// The goal: fit more of the desktop-shaped UI onto a phone screen (the editor
// barely fits as it is, and once the on-screen keyboard opens there's almost
// nothing left).
//
// The tempting-but-wrong way to do this is WebView.setInitialScale(75) on the
// Kotlin side. That shrinks the *rendered output* to 75% while the layout
// viewport stays device-sized, so the page still lays itself out at 412x915
// CSS px and then gets drawn at three quarters of that — leaving a fat empty
// band down the bottom and right of the screen. (Android also ignores
// setInitialScale outright when the page declares its own initial-scale in the
// viewport meta, which ours did, so the two were fighting each other.)
//
// What actually mirrors Windows display scaling is the opposite: don't shrink
// the output, hand the page MORE CSS pixels. Declaring a fixed viewport width
// of deviceWidth / 0.75 makes the browser compute a fit-to-screen scale of
// exactly 0.75 — and because it derives the scale itself, the layout
// viewport's *height* grows by the same factor, so 100dvh keeps mapping to the
// full physical screen. No dead space, everything just gets smaller.
//
// Deliberately lives here in the web layer (tracked in git) rather than in
// gen/android/**/MainActivity.kt, which is gitignored and gets wiped by
// `tauri android init`.

const MOBILE_UI_SCALE = 0.75;

// Kept identical to isAndroidPlatform() in hooks/useIsMobileLayout.ts — this
// runs before React mounts, so it can't import from a hook module without
// pulling React in at the wrong time.
function isAndroid(): boolean {
  return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

export function applyMobileUiScale(): void {
  if (!isAndroid()) return;

  const meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;

  // viewport-fit=cover is required for env(safe-area-inset-*) to report real
  // values — globals.css relies on those to keep content clear of the status
  // bar and gesture nav under enableEdgeToEdge(). No initial-scale here on
  // purpose: the browser must derive the scale from the width itself, which is
  // the whole mechanism described above.
  const FLAGS = "user-scalable=no, viewport-fit=cover";

  const apply = () => {
    // Measure at 1:1 first — once a fixed width is in place, clientWidth
    // reports that fixed width instead of the device's real one, so each
    // recompute has to reset before it can measure.
    meta.setAttribute("content", `width=device-width, initial-scale=1.0, ${FLAGS}`);
    const deviceWidth = document.documentElement.clientWidth;
    if (!deviceWidth) return;

    meta.setAttribute("content", `width=${Math.round(deviceWidth / MOBILE_UI_SCALE)}, ${FLAGS}`);
  };

  apply();

  // Rotating changes the device width, and a fixed width computed for portrait
  // would scale to something other than 0.75 in landscape. The delay lets the
  // WebView settle on its new dimensions first — it reports stale values if
  // read synchronously from the event.
  window.addEventListener("orientationchange", () => {
    window.setTimeout(apply, 150);
  });
}
