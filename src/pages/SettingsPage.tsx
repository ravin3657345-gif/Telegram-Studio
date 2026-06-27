import { Sun, Moon, Monitor } from "lucide-react";
import { useState } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { useSettingsStore } from "@/store/settingsStore";
import { telegraphOpenLogin } from "@/lib/tauriApi";
import { t, setI18nLanguage } from "@/lib/i18n";
import type { Theme, Language } from "@/types/settings";
import clsx from "clsx";

export function SettingsPage() {
  return (
    <>
      <TopBar />
      <div className="page-content max-w-2xl space-y-8">
        <AppearanceSection />
        <EditorSection />
        <PublishSection />
        <TelegraphSection />
        <AboutSection />
      </div>
    </>
  );
}

/* ── Sections ───────────────────────────────────────────── */

function AppearanceSection() {
  const theme       = useSettingsStore((s) => s.theme);
  const setTheme    = useSettingsStore((s) => s.setTheme);
  const language    = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  const themeOptions: { value: Theme; labelKey: string; icon: React.ReactNode }[] = [
    { value: "dark",   labelKey: "settings.theme.dark",   icon: <Moon size={14} /> },
    { value: "light",  labelKey: "settings.theme.light",  icon: <Sun  size={14} /> },
    { value: "system", labelKey: "settings.theme.system", icon: <Monitor size={14} /> },
  ];

  const langOptions: { value: Language; label: string; flag: string }[] = [
    { value: "ru", label: "Русский",    flag: "🇷🇺" },
    { value: "en", label: "English",    flag: "🇬🇧" },
    { value: "fr", label: "Français",   flag: "🇫🇷" },
    { value: "pl", label: "Polski",     flag: "🇵🇱" },
    { value: "es", label: "Español",    flag: "🇪🇸" },
  ];

  return (
    <Section title={t("settings.appearance")}>
      <Field label={t("settings.theme")}>
        <div
          className="flex rounded-lg border overflow-hidden"
          style={{ borderColor: "var(--border-default)", width: "fit-content" }}
        >
          {themeOptions.map(({ value, labelKey, icon }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className={clsx("flex items-center gap-1.5 px-4 h-8 text-sm transition-colors")}
              style={{
                backgroundColor: theme === value ? "var(--bg-active)"   : "var(--bg-elevated)",
                color:           theme === value ? "var(--accent)"       : "var(--text-secondary)",
                borderRight: "1px solid var(--border-default)",
              }}
            >
              {icon}
              {t(labelKey as any)}
            </button>
          ))}
        </div>
      </Field>

      <Field label={t("settings.language")}>
        <div className="flex gap-1.5 flex-wrap justify-end">
          {langOptions.map(({ value, label, flag }) => (
            <button
              key={value}
              onClick={() => { setLanguage(value); setI18nLanguage(value); }}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-sm transition-colors border"
              style={{
                backgroundColor: language === value ? "var(--bg-active)"   : "var(--bg-elevated)",
                color:           language === value ? "var(--accent)"       : "var(--text-secondary)",
                borderColor:     language === value ? "var(--accent)"       : "var(--border-default)",
                fontWeight:      language === value ? 600                   : 400,
              }}
            >
              <span>{flag}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </Field>
    </Section>
  );
}

function EditorSection() {
  const showCharCounter      = useSettingsStore((s) => s.showCharCounter);
  const setShowCharCounter   = useSettingsStore((s) => s.setShowCharCounter);
  const autosaveInterval     = useSettingsStore((s) => s.autosaveInterval);
  const setAutosaveInterval  = useSettingsStore((s) => s.setAutosaveInterval);

  return (
    <Section title={t("settings.editor")}>
      <Field label={t("settings.charCounter")}>
        <Toggle checked={showCharCounter} onChange={setShowCharCounter} />
      </Field>

      <Field label={t("settings.autosave")}>
        <select
          value={autosaveInterval}
          onChange={(e) => setAutosaveInterval(Number(e.target.value))}
          className="h-8 rounded-md border px-2 text-sm"
          style={{
            backgroundColor: "var(--bg-input)",
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
          }}
        >
          {[1000, 2000, 3000, 5000].map((ms) => (
            <option key={ms} value={ms}>{ms / 1000} с</option>
          ))}
        </select>
      </Field>
    </Section>
  );
}

function PublishSection() {
  const confirmBeforePublish    = useSettingsStore((s) => s.confirmBeforePublish);
  const setConfirmBeforePublish = useSettingsStore((s) => s.setConfirmBeforePublish);

  return (
    <Section title={t("settings.publish")}>
      <Field label={t("settings.confirmPublish")}>
        <Toggle checked={confirmBeforePublish} onChange={setConfirmBeforePublish} />
      </Field>
    </Section>
  );
}

function TelegraphSection() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus]   = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setStatus(null);
    try {
      await telegraphOpenLogin();
      setStatus(t("settings.telegraphOpened"));
    } catch (e) {
      setStatus(`${t("common.error")}: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title={t("settings.telegraph")}>
      <Field label={t("settings.telegraphLogin")}>
        <div className="flex items-center gap-3">
          {status && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>{status}</span>
          )}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="h-8 px-3 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)", color: "#fff" }}
          >
            {loading ? t("settings.telegraphLoading") : t("settings.telegraphConnect")}
          </button>
        </div>
      </Field>
      <div className="px-4 py-2">
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {t("settings.telegraphNote")}
        </p>
      </div>
    </Section>
  );
}

function AboutSection() {
  return (
    <Section title={t("settings.about")}>
      <div className="flex flex-col items-center gap-2 py-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: "var(--accent)" }}
        >
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
            <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" fill="white" />
          </svg>
        </div>
        <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
          Telegram Studio
        </p>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("settings.version")} 0.5.0
        </p>
      </div>
    </Section>
  );
}

/* ── Primitives ─────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2
        className="text-xs font-semibold uppercase tracking-widest mb-3"
        style={{ color: "var(--text-muted)" }}
      >
        {title}
      </h2>
      <div
        className="rounded-xl border divide-y overflow-hidden"
        style={{ backgroundColor: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
      >
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <span className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</span>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative w-10 h-6 rounded-full transition-colors flex-shrink-0"
      style={{ backgroundColor: checked ? "var(--accent)" : "var(--bg-active)" }}
      role="switch"
      aria-checked={checked}
    >
      <span
        className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm"
        style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}
