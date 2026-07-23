import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./styles/globals.css";

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

// This is a desktop app, not a browser — clicking any <a href> (map tile
// attribution, a link a user typed into their own post while editing, etc.)
// must never navigate the webview itself away from the app. Blocked
// globally, once, rather than per component that happens to render a link.
document.addEventListener("click", (e) => {
  if ((e.target as HTMLElement)?.closest?.("a")) e.preventDefault();
}, true);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
