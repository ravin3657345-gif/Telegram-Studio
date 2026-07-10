import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app/App";
import "./styles/globals.css";

// Disable the browser's native context menu (Print / Save As / Inspect)
// everywhere EXCEPT inside the post editor, where the native Copy/Paste/Cut
// menu is exactly what's wanted (block-level actions now live in the
// hover-triggered "⋯" menu instead, see BlockHoverControls.tsx).
document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest(".tiptap-editor-root")) return;
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
