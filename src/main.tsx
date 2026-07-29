import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./styles/globals.css";
import { applyMobileUiScale } from "./lib/mobileScale";

// Android only — shrinks the whole UI to 75% (Windows display-scaling style)
// so more of the desktop-shaped layout fits a phone. Runs before the first
// render so the app never paints at the wrong scale. Must stay in a module
// script rather than an inline <script> in index.html: the app's CSP is
// script-src 'self' with no 'unsafe-inline', so an inline script would be
// blocked outright in the packaged build.
applyMobileUiScale();

// Disable the browser's native context menu (Print / Save As / Inspect)
// everywhere EXCEPT inside the post editor (native Copy/Paste/Cut there is
// exactly what's wanted — block-level actions live in the hover-triggered
// "⋯" menu instead, see BlockHoverControls.tsx) and plain text inputs
// (license key field, settings fields, etc.), which need native
// Cut/Copy/Paste since they have no custom menu of their own.
document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest(".tiptap-editor-root")) return;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
  e.preventDefault();
});

// This is a desktop app, not a browser — clicking any <a href> pointing
// OUTSIDE the app (map tile attribution, a link a user typed into their own
// post while editing, etc.) must never navigate the webview away. Blocked
// globally, once, rather than per component that happens to render a link.
//
// Must NOT touch same-origin links: react-router's <NavLink> (Sidebar,
// BottomTabBar — every "Settings"/"Templates"/etc. nav item) renders as a
// real <a>, and internally only calls its own preventDefault()+navigate()
// when `!event.defaultPrevented`. This listener runs in the capture phase,
// ahead of NavLink's own bubble-phase handler — calling preventDefault()
// unconditionally here made every in-app nav link silently do nothing
// (regression, live-reported 2026-07-23: "nothing opens except the editor").
document.addEventListener("click", (e) => {
  const anchor = (e.target as HTMLElement)?.closest?.("a") as HTMLAnchorElement | null;
  if (!anchor || !anchor.href) return;
  if (new URL(anchor.href, window.location.href).origin === window.location.origin) return;
  e.preventDefault();
}, true);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
