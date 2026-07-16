import { useState, useEffect } from "react";
import { KeyRound, Loader2, CheckCircle2 } from "lucide-react";
import { getLicenseStatus, activateLicense } from "@/lib/tauriApi";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";

interface Props {
  children: React.ReactNode;
}

export function LicenseGate({ children }: Props) {
  useSettingsStore((s) => s.language);
  const [checking, setChecking]   = useState(true);
  const [activated, setActivated] = useState(false);
  const [key, setKey]             = useState("");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [success, setSuccess]     = useState(false);

  useEffect(() => {
    getLicenseStatus()
      .then((ok) => { setActivated(ok); })
      .catch(() => { setActivated(false); })
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null;
  if (activated) return <>{children}</>;

  async function handleActivate() {
    const trimmed = key.trim();
    if (!trimmed) { setError(t("license.emptyError")); return; }
    setLoading(true);
    setError("");
    try {
      await activateLicense(trimmed);
      setSuccess(true);
      setTimeout(() => setActivated(true), 900);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleActivate();
  }

  // 10 random bytes, base32-encoded (see src-tauri/core/src/license.rs) —
  // always exactly 16 characters once dashes/whitespace are stripped,
  // however the key was formatted.
  const LICENSE_KEY_LEN = 16;

  // Re-inserts dashes every 4 characters (XXXX-XXXX-XXXX-XXXX) — the same
  // grouping format_for_display() in keygen/src/main.rs uses when the bot
  // hands the key to a buyer, so a pasted key looks the same here as it did
  // in Telegram instead of collapsing into one unbroken run of characters.
  function formatInput(raw: string) {
    const stripped = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, LICENSE_KEY_LEN);
    return stripped.replace(/(.{4})(?=.)/g, "$1-");
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        backgroundColor: "var(--bg-app)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: 24,
      }}
    >
      {/* Logo */}
      <div
        style={{
          width: 64, height: 64, borderRadius: 18, marginBottom: 24,
          backgroundColor: "var(--accent)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
        }}
      >
        <svg width="30" height="30" viewBox="0 0 16 16" fill="none">
          <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" fill="white" />
        </svg>
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
        Telegram Studio
      </h1>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 36, textAlign: "center" }}>
        {t("license.subtitle")}
      </p>

      {/* Card */}
      <div
        style={{
          width: "100%", maxWidth: 400,
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 16,
          padding: "28px 28px 24px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.1)",
        }}
      >
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          {t("license.keyLabel")}
        </label>

        <div style={{ position: "relative" }}>
          <KeyRound
            size={15}
            style={{
              position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
              color: "var(--text-muted)", pointerEvents: "none",
            }}
          />
          <input
            value={key}
            onChange={(e) => {
              setError("");
              setKey(formatInput(e.target.value));
            }}
            onKeyDown={handleKeyDown}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            // Generous headroom above LICENSE_KEY_LEN: a pasted key is often
            // dash-formatted, and those separators must survive to reach
            // formatInput's own stripping — a tight maxLength would let the
            // browser truncate raw characters (dashes included) first.
            maxLength={200}
            spellCheck={false}
            autoFocus
            style={{
              width: "100%", boxSizing: "border-box",
              paddingLeft: 36, paddingRight: 12,
              height: 42, borderRadius: 10,
              border: `1.5px solid ${error ? "var(--danger)" : "var(--border-default)"}`,
              backgroundColor: "var(--bg-elevated)",
              color: "var(--text-primary)",
              fontSize: 13, fontFamily: "monospace", letterSpacing: "0.02em",
              outline: "none",
              transition: "border-color 0.15s",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = error ? "var(--danger)" : "var(--accent)"; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = error ? "var(--danger)" : "var(--border-default)"; }}
          />
        </div>

        {error && (
          <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>{error}</p>
        )}

        <button
          onClick={handleActivate}
          disabled={loading || success}
          style={{
            marginTop: 16, width: "100%", height: 42, borderRadius: 10,
            border: "none", cursor: loading || success ? "default" : "pointer",
            backgroundColor: success ? "var(--success)" : "var(--accent)",
            color: "#fff", fontSize: 14, fontWeight: 600,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "background-color 0.2s, opacity 0.15s",
            opacity: loading ? 0.75 : 1,
          }}
        >
          {success ? (
            <><CheckCircle2 size={16} /> {t("license.activated")}</>
          ) : loading ? (
            <><Loader2 size={16} className="animate-spin" /> {t("license.checking")}</>
          ) : (
            t("license.activate")
          )}
        </button>
      </div>

      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 20, textAlign: "center" }}>
        {t("license.localNote")}
      </p>
    </div>
  );
}
