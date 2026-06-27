import { useEffect } from "react";
import { HashRouter } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Providers } from "./Providers";
import { AppRouter } from "./Router";
import { WindowControls } from "@/components/layout/WindowControls";
import { ToastContainer } from "@/components/ui/ToastContainer";

export default function App() {
  // Global handler: Rust asks us to upload a JPEG to Telegraph.
  // WebView2 (= real Chrome) makes the fetch so TLS fingerprint is accepted.
  useEffect(() => {
    const unlisten = listen<string>("telegraph-upload-req", async (event) => {
      const jpegBase64 = event.payload;
      try {
        const bin = atob(jpegBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: "image/jpeg" });
        const fd = new FormData();
        fd.append("file", blob, "photo.jpg");

        const resp = await fetch("https://telegra.ph/upload", {
          method: "POST",
          body: fd,
        });
        const json = await resp.json();

        if (Array.isArray(json) && json[0]?.src) {
          const url = "https://telegra.ph" + json[0].src;
          await invoke("telegraph_webview_result", { url, error: null });
        } else {
          await invoke("telegraph_webview_result", {
            url: null,
            error: JSON.stringify(json),
          });
        }
      } catch (e) {
        await invoke("telegraph_webview_result", {
          url: null,
          error: String(e),
        });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  return (
    <HashRouter>
      <Providers>
        <div className="app-root">
          <WindowControls />
          <AppRouter />
          <ToastContainer />
        </div>
      </Providers>
    </HashRouter>
  );
}
