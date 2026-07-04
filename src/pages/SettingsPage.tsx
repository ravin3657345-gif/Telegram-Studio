import { Sun, Moon, Monitor, User, Send, Palette, Bell } from "lucide-react";
import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";

import { TopBar } from "@/components/layout/TopBar";
import { useSettingsStore } from "@/store/settingsStore";
import { telegraphOpenLogin } from "@/lib/tauriApi";
import { t, setI18nLanguage, type TranslationKey } from "@/lib/i18n";
import type { Theme, Language } from "@/types/settings";

// ── Local nav definition ──────────────────────────────────────────────────────

type NavSection = "profile" | "publish" | "appearance" | "notifications";

const NAV_ITEMS: Array<{ key: NavSection; icon: React.ReactNode; labelKey: string }> = [
  { key: "profile",       icon: <User    size={15} />, labelKey: "settings.nav.profile"       },
  { key: "publish",       icon: <Send    size={15} />, labelKey: "settings.nav.publish"       },
  { key: "appearance",   icon: <Palette size={15} />, labelKey: "settings.nav.appearance"   },
  { key: "notifications", icon: <Bell    size={15} />, labelKey: "settings.nav.notifications" },
];

// ── Accent color presets ──────────────────────────────────────────────────────

const ACCENT_PRESETS: Array<{ color: string; labelKey: TranslationKey }> = [
  { color: "#2c87c9", labelKey: "settings.color.blue" },
  { color: "#7a4fe0", labelKey: "settings.color.purple" },
  { color: "#3f9d5f", labelKey: "settings.color.green" },
  { color: "#c77d33", labelKey: "settings.color.orange" },
  { color: "#e03e8a", labelKey: "settings.color.pink" },
  { color: "#37352f", labelKey: "settings.color.black" },
];

// ── Main page ─────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState<NavSection>("appearance");
  useSettingsStore((s) => s.language); // реактивность при смене языка

  return (
    <>
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {/* ── Local nav ──────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 border-r overflow-y-auto"
          style={{
            width: 220,
            backgroundColor: "var(--bg-sidebar)",
            borderColor: "var(--border-subtle)",
          }}
        >
          <div className="py-4 px-2">
            {NAV_ITEMS.map(({ key, icon, labelKey }) => {
              const isActive = activeSection === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveSection(key)}
                  className="flex items-center gap-2.5 w-full px-3 h-8 rounded-md mb-0.5 text-sm transition-colors text-left"
                  style={{
                    backgroundColor: isActive ? "var(--bg-active)" : "transparent",
                    color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
                    fontWeight: isActive ? 500 : 400,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                  }}
                >
                  <span style={{ color: isActive ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 }}>
                    {icon}
                  </span>
                  {t(labelKey as any)}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Section content ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="page-content max-w-2xl space-y-8">
            {activeSection === "appearance" && <AppearanceSection />}
            {activeSection === "publish" && (
              <>
                <PublishSection />
                <TelegraphSection />
              </>
            )}
            {activeSection === "profile"  && <ProfileStub />}
            {activeSection === "notifications" && <NotificationsStub />}
            <AboutSection />
          </div>
        </div>
      </div>
    </>
  );
}

// ── About section (version read here, not in parent) ─────────────────────────



function AppearanceSection() {
  const theme              = useSettingsStore((s) => s.theme);
  const setTheme           = useSettingsStore((s) => s.setTheme);
  const language           = useSettingsStore((s) => s.language);
  const setLanguage        = useSettingsStore((s) => s.setLanguage);
  const accentColor        = useSettingsStore((s) => s.accentColor);
  const setAccentColor     = useSettingsStore((s) => s.setAccentColor);
  const largeFontEditor    = useSettingsStore((s) => s.largeFontEditor);
  const setLargeFontEditor = useSettingsStore((s) => s.setLargeFontEditor);
  const showPreview        = useSettingsStore((s) => s.showTelegramPreview);
  const setShowPreview     = useSettingsStore((s) => s.setShowTelegramPreview);
  const showCharCounter    = useSettingsStore((s) => s.showCharCounter);
  const setShowCharCounter = useSettingsStore((s) => s.setShowCharCounter);

  const themeOptions: Array<{ value: Theme; labelKey: string; icon: React.ReactNode }> = [
    { value: "light",  labelKey: "settings.theme.light",  icon: <Sun     size={18} strokeWidth={1.75} /> },
    { value: "dark",   labelKey: "settings.theme.dark",   icon: <Moon    size={18} strokeWidth={1.75} /> },
    { value: "system", labelKey: "settings.theme.system", icon: <Monitor size={18} strokeWidth={1.75} /> },
  ];

  const langOptions: Array<{ value: Language; label: string; flag: string }> = [
    { value: "ru", label: "Русский",  flag: "🇷🇺" },
    { value: "en", label: "English",  flag: "🇬🇧" },
    { value: "fr", label: "Français", flag: "🇫🇷" },
    { value: "pl", label: "Polski",   flag: "🇵🇱" },
    { value: "es", label: "Español",  flag: "🇪🇸" },
  ];

  return (
    <>
      <Section title={t("settings.appearance")}>
        {/* ── Theme cards ─────────────────────────────────────────── */}
        <Field label={t("settings.theme")}>
          <div className="flex gap-3 flex-wrap">
            {themeOptions.map(({ value, labelKey, icon }) => {
              const isActive = theme === value;
              return (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border transition-all"
                  style={{
                    width: 88,
                    backgroundColor: isActive ? "var(--accent-subtle)" : "var(--bg-elevated)",
                    borderColor: isActive ? "var(--accent)" : "var(--border-default)",
                  }}
                >
                  <span style={{ color: isActive ? "var(--accent)" : "var(--text-secondary)" }}>
                    {icon}
                  </span>
                  <span className="text-xs font-medium" style={{ color: isActive ? "var(--accent)" : "var(--text-secondary)" }}>
                    {t(labelKey as any)}
                  </span>
                  <span
                    className="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center"
                    style={{ borderColor: isActive ? "var(--accent)" : "var(--border-strong)" }}
                  >
                    {isActive && (
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--accent)" }} />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </Field>

        {/* ── Accent color ─────────────────────────────────────────── */}
        <Field label={t("settings.accentColor")}>
          <div className="flex items-center gap-2">
            {ACCENT_PRESETS.map(({ color, labelKey }) => {
              const isSelected = accentColor === color;
              return (
                <button
                  key={color}
                  onClick={() => setAccentColor(color)}
                  title={t(labelKey)}
                  className="w-7 h-7 rounded-full transition-transform"
                  style={{
                    backgroundColor: color,
                    outline: isSelected ? `2px solid ${color}` : "none",
                    outlineOffset: isSelected ? 3 : 0,
                    transform: isSelected ? "scale(1.15)" : "scale(1)",
                    boxShadow: isSelected ? `0 0 0 1px var(--bg-surface)` : "none",
                  }}
                />
              );
            })}
          </div>
        </Field>

        {/* ── Language ─────────────────────────────────────────────── */}
        <Field label={t("settings.language")}>
          <div className="flex gap-1.5 flex-wrap justify-end">
            {langOptions.map(({ value, label, flag }) => (
              <button
                key={value}
                onClick={() => { setLanguage(value); setI18nLanguage(value); }}
                className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-sm transition-colors border"
                style={{
                  backgroundColor: language === value ? "var(--bg-active)"  : "var(--bg-elevated)",
                  color:           language === value ? "var(--accent)"      : "var(--text-secondary)",
                  borderColor:     language === value ? "var(--accent)"      : "var(--border-default)",
                  fontWeight:      language === value ? 600                  : 400,
                }}
              >
                <span>{flag}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </Field>
      </Section>

      {/* ── Display toggles ──────────────────────────────────────────── */}
      <Section title={t("settings.editor")}>
        <Field label={t("settings.showPreview")}>
          <Toggle checked={showPreview} onChange={setShowPreview} />
        </Field>
        <Field label={t("settings.largeFontEditor")}>
          <Toggle checked={largeFontEditor} onChange={setLargeFontEditor} />
        </Field>
        <Field label={t("settings.charCounter")}>
          <Toggle checked={showCharCounter} onChange={setShowCharCounter} />
        </Field>
        <Field label={t("settings.autosave")}>
          <AutosaveControl />
        </Field>
      </Section>
    </>
  );
}

function AutosaveControl() {
  const autosaveInterval    = useSettingsStore((s) => s.autosaveInterval);
  const setAutosaveInterval = useSettingsStore((s) => s.setAutosaveInterval);
  return (
    <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--border-default)" }}>
      {[1000, 2000, 3000, 5000].map((ms, i, arr) => (
        <button
          key={ms}
          onClick={() => setAutosaveInterval(ms)}
          className="flex items-center justify-center px-3 h-8 text-sm transition-colors"
          style={{
            backgroundColor: autosaveInterval === ms ? "var(--bg-active)"  : "var(--bg-elevated)",
            color:           autosaveInterval === ms ? "var(--accent)"      : "var(--text-secondary)",
            fontWeight:      autosaveInterval === ms ? 600 : 400,
            borderRight: i < arr.length - 1 ? "1px solid var(--border-default)" : "none",
            minWidth: 40,
          }}
        >
          {ms / 1000}с
        </button>
      ))}
    </div>
  );
}

// ── Publish section ───────────────────────────────────────────────────────────

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

// ── Telegraph section ─────────────────────────────────────────────────────────

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

// ── About section ─────────────────────────────────────────────────────────────

function AboutSection() {
  const [appVersion, setAppVersion] = useState("...");
  useEffect(() => { getVersion().then(setAppVersion).catch(() => setAppVersion("1.0.0")); }, []);
  return (
    <Section title={t("settings.about")}>
      <div
        className="flex flex-col items-center gap-3 py-6 px-4"
        style={{
          background: "linear-gradient(160deg, var(--accent-subtle) 0%, transparent 60%)",
        }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-md"
          style={{ backgroundColor: "var(--accent)" }}
        >
          <svg width="26" height="26" viewBox="0 0 16 16" fill="none">
            <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" fill="white" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            Telegram Studio
          </p>
          <p className="text-sm mt-0.5" style={{ color: "var(--text-muted)" }}>
            {t("settings.version")} {appVersion}
          </p>
        </div>
        <p className="text-xs text-center max-w-xs" style={{ color: "var(--text-muted)" }}>
          {t("settings.aboutDesc")}
        </p>
        <div
          className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full"
          style={{
            backgroundColor: "var(--success-subtle)",
            color: "var(--success)",
            border: "1px solid var(--success-subtle)",
          }}
        >
          <span>●</span>
          <span>{t("settings.localMode")}</span>
        </div>
      </div>
    </Section>
  );
}

// ── Stub sections for other nav items ────────────────────────────────────────

function ProfileStub() {
  return (
    <Section title={t("settings.nav.profile")}>
      <div className="px-4 py-6 text-center" style={{ color: "var(--text-muted)", fontSize: 13 }}>
        {t("settings.profileNote")}
      </div>
    </Section>
  );
}


function NotificationsStub() {
  return (
    <Section title={t("settings.nav.notifications")}>
      <div className="px-4 py-6 text-center" style={{ color: "var(--text-muted)", fontSize: 13 }}>
        {t("settings.notificationsStub")}
      </div>
    </Section>
  );
}

// ── Primitives ────────────────────────────────────────────────────────────────

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
      className="relative flex-shrink-0 transition-colors"
      style={{
        width: 38,
        height: 22,
        borderRadius: 11,
        backgroundColor: checked ? "var(--accent)" : "var(--bg-active)",
      }}
      role="switch"
      aria-checked={checked}
    >
      <span
        className="absolute bg-white rounded-full shadow-sm transition-transform"
        style={{
          width: 18,
          height: 18,
          top: 2,
          left: 2,
          transform: checked ? "translateX(16px)" : "translateX(0)",
        }}
      />
    </button>
  );
}
