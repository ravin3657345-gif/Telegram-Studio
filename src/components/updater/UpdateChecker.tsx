import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export function UpdateChecker() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Silent check, 3 seconds after start to not slow down launch
    const t = setTimeout(async () => {
      try {
        const result = await check();
        if (result?.available) setUpdate(result);
      } catch {
        // No internet or endpoint not configured — silently ignore
      }
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  if (!update) return null;

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch {
      setInstalling(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        background: "#1e293b",
        border: "1px solid #334155",
        borderRadius: 12,
        padding: "14px 18px",
        zIndex: 9999,
        color: "#e2e8f0",
        maxWidth: 320,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        Доступно обновление {update.version}
      </div>
      <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>
        {update.body || "Новая версия готова к установке"}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleInstall}
          disabled={installing}
          style={{
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "6px 16px",
            cursor: installing ? "wait" : "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {installing ? "Установка…" : "Обновить сейчас"}
        </button>
        <button
          onClick={() => setUpdate(null)}
          style={{
            background: "transparent",
            color: "#64748b",
            border: "1px solid #334155",
            borderRadius: 8,
            padding: "6px 14px",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Позже
        </button>
      </div>
    </div>
  );
}
