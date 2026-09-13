import { Sun, Moon, Monitor, User, Send, Palette, Bell, Smile, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getVersion } from "@tauri-apps/api/app";

import { TopBar } from "@/components/layout/TopBar";
import { useSettingsStore } from "@/store/settingsStore";
import { EmojiPicker } from "@/components/editor/EmojiPicker";
import { t, ti, setI18nLanguage, type TranslationKey } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { isInAppUpdateSupported } from "@/lib/updates";
// Aliased: the local `setAutostart` state setter below would otherwise shadow
// the API call, and `await setAutostart(next)` would quietly become "pass the
// result of setting state into setting state".
import { getAutostartEnabled, setAutostart as writeAutostart } from "@/lib/tauriApi";
import { toast } from "@/store/uiStore";
import { useUpdateStore } from "@/store/updateStore";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";
import type { Theme, Language, DesignTheme } from "@/types/settings";
import { Dialog, DialogTitle, DialogDescription, VisuallyHidden } from "@/components/ui/Dialog";

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
  { color: "#3b6fe0", labelKey: "settings.color.blue" },
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
  const isMobile = useIsMobileLayout();

  const navButtons = NAV_ITEMS.map(({ key, icon, labelKey }) => {
    const isActive = activeSection === key;
    return (
      <button
        key={key}
        onClick={() => setActiveSection(key)}
        className={
          isMobile
            ? "flex items-center gap-1.5 px-3 h-8 rounded-md text-sm transition-colors flex-shrink-0"
            : "flex items-center gap-2.5 w-full px-3 h-8 rounded-md mb-0.5 text-sm transition-colors text-left"
        }
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
  });

  return (
    <>
      <TopBar />
      <div className={isMobile ? "flex flex-col flex-1 overflow-hidden" : "flex flex-1 overflow-hidden"}>
        {/* ── Local nav: left rail on desktop, horizontal scroll row on mobile ── */}
        {isMobile ? (
          <div
            className="flex gap-1 overflow-x-auto flex-shrink-0 border-b px-2 py-2"
            style={{ backgroundColor: "var(--bg-sidebar)", borderColor: "var(--border-subtle)" }}
          >
            {navButtons}
          </div>
        ) : (
          <div
            className="flex-shrink-0 border-r overflow-y-auto"
            style={{
              width: 220,
              backgroundColor: "var(--bg-sidebar)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="py-4 px-2">{navButtons}</div>
          </div>
        )}

        {/* ── Section content ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          <div className="page-content max-w-2xl space-y-8">
            {activeSection === "appearance" && <AppearanceSection />}
            {activeSection === "publish" && <PublishSection />}
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
  const isMobile            = useIsMobileLayout();
  const theme              = useSettingsStore((s) => s.theme);
  const setTheme           = useSettingsStore((s) => s.setTheme);
  const language           = useSettingsStore((s) => s.language);
  const setLanguage        = useSettingsStore((s) => s.setLanguage);
  const accentColor        = useSettingsStore((s) => s.accentColor);
  const setAccentColor     = useSettingsStore((s) => s.setAccentColor);
  const designTheme        = useSettingsStore((s) => s.designTheme);
  const setDesignTheme     = useSettingsStore((s) => s.setDesignTheme);
  const [showDesignPicker, setShowDesignPicker] = useState(false);
  const largeFontEditor    = useSettingsStore((s) => s.largeFontEditor);
  const setLargeFontEditor = useSettingsStore((s) => s.setLargeFontEditor);
  const anchorLinkText     = useSettingsStore((s) => s.anchorLinkText);
  const setAnchorLinkText  = useSettingsStore((s) => s.setAnchorLinkText);
  const showPreview        = useSettingsStore((s) => s.showTelegramPreview);
  const setShowPreview     = useSettingsStore((s) => s.setShowTelegramPreview);
  const showCharCounter    = useSettingsStore((s) => s.showCharCounter);
  const setShowCharCounter = useSettingsStore((s) => s.setShowCharCounter);
  const setHasSeenOnboardingTour = useSettingsStore((s) => s.setHasSeenOnboardingTour);
  const navigate = useNavigate();

  // Настройки обновлений живут на этой вкладке, а не в блоке «О приложении»:
  // это настройки приложения, а не сведения о нём. Раньше они показывались на
  // каждой вкладке сразу, потому что блок «О приложении» рисуется всегда.
  const supported           = isInAppUpdateSupported();
  const autoCheckUpdates    = useSettingsStore((s) => s.autoCheckUpdates);
  const setAutoCheckUpdates = useSettingsStore((s) => s.setAutoCheckUpdates);
  const updateStatus        = useUpdateStore((s) => s.status);
  const updateInfo          = useUpdateStore((s) => s.info);
  const updateError         = useUpdateStore((s) => s.error);
  const checkForUpdates     = useUpdateStore((s) => s.check);
  const openUpdateDialog    = useUpdateStore((s) => s.openDialog);
  const checking            = updateStatus === "checking";

  // ── Emoji insertion for the anchor-link-text input ──────────────────────
  const anchorInputRef = useRef<HTMLInputElement>(null);
  const savedCursorPos = useRef(0);
  const [showAnchorEmojiPicker, setShowAnchorEmojiPicker] = useState(false);
  const [anchorEmojiAnchor, setAnchorEmojiAnchor] = useState<DOMRect | undefined>();

  function handleAnchorEmojiClick() {
    const input = anchorInputRef.current;
    savedCursorPos.current = input?.selectionStart ?? anchorLinkText.length;
    setAnchorEmojiAnchor(input?.getBoundingClientRect());
    setShowAnchorEmojiPicker((prev) => !prev);
  }

  function handleAnchorEmojiInsert(native: string) {
    const pos = savedCursorPos.current;
    const next = anchorLinkText.slice(0, pos) + native + anchorLinkText.slice(pos);
    setAnchorLinkText(next);
    savedCursorPos.current = pos + native.length;
    const nextPos = savedCursorPos.current;
    requestAnimationFrame(() => {
      const input = anchorInputRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(nextPos, nextPos);
      }
    });
  }

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

        {/* ── Design skin ──────────────────────────────────────────── */}
        <Field label={t("settings.designTheme")}>
          <button
            onClick={() => setShowDesignPicker(true)}
            className="flex items-center gap-2 px-3 h-8 rounded-lg text-sm border transition-colors"
            style={{ backgroundColor: "var(--bg-elevated)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
          >
            <span
              className="w-3.5 h-3.5 rounded-full flex-shrink-0"
              style={{ background: designTheme === "standard" ? "var(--accent)" : "var(--accent)", boxShadow: "0 0 0 2px var(--bg-surface), 0 0 0 3px var(--border-default)" }}
            />
            {t(`settings.design.${designTheme}` as any)}
          </button>
        </Field>

        {/* ── Accent color ─────────────────────────────────────────── */}
        <Field label={t("settings.accentColor")}>
          <div className={isMobile ? "flex items-center gap-3" : "flex items-center gap-2"}>
            {ACCENT_PRESETS.map(({ color, labelKey }) => {
              const isSelected = accentColor === color;
              return (
                <button
                  key={color}
                  onClick={() => setAccentColor(color)}
                  title={t(labelKey)}
                  className={(isMobile ? "w-9 h-9" : "w-7 h-7") + " rounded-full transition-transform"}
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
          <select
            value={language}
            onChange={(e) => { const v = e.target.value as Language; setLanguage(v); setI18nLanguage(v); }}
            className="h-8 pl-3 pr-7 rounded-lg text-sm border cursor-pointer"
            style={{
              backgroundColor: "var(--bg-elevated)",
              borderColor: "var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            {langOptions.map(({ value, label, flag }) => (
              <option key={value} value={value}>{flag} {label}</option>
            ))}
          </select>
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
        <Field label={t("settings.replayTour")}>
          <button
            onClick={() => { navigate("/editor"); setHasSeenOnboardingTour(false); }}
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-sm transition-colors border"
            style={{
              backgroundColor: "var(--bg-elevated)",
              color: "var(--text-secondary)",
              borderColor: "var(--border-default)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
          >
            {t("settings.replayTourButton")}
          </button>
        </Field>
        <Field label={t("settings.anchorLinkText")}>
          <div className="flex items-center gap-1.5">
            <input
              ref={anchorInputRef}
              type="text"
              value={anchorLinkText}
              onChange={(e) => setAnchorLinkText(e.target.value)}
              placeholder={t("anchor.linkText")}
              maxLength={60}
              className="h-8 px-3 rounded-lg text-sm border"
              style={{
                backgroundColor: "var(--bg-input)",
                borderColor: "var(--border-default)",
                color: "var(--text-primary)",
                outline: "none",
                width: 180,
              }}
            />
            <button
              type="button"
              aria-label={t("toolbar.emoji")}
              title={t("toolbar.emoji")}
              onClick={handleAnchorEmojiClick}
              className="flex items-center justify-center h-8 w-8 rounded-lg border transition-colors"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderColor: "var(--border-default)",
                color: "var(--text-secondary)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
            >
              <Smile size={15} strokeWidth={1.75} />
            </button>
          </div>
          {showAnchorEmojiPicker && (
            <EmojiPicker
              onSelect={handleAnchorEmojiInsert}
              onClose={() => setShowAnchorEmojiPicker(false)}
              anchorRect={anchorEmojiAnchor}
            />
          )}
        </Field>
      </Section>

      {/* ── Обновления ────────────────────────────────────────────────
          Внутри приложения они возможны только на десктопе — плагина
          апдейтера для мобильных не существует вовсе (см. lib/updates.ts,
          commands/app_updates.rs), поэтому на телефоне эти строки не
          показываем вместо обещания «у вас последняя версия», которое там
          нечем проверить. */}
      {supported && (
        <Section title={t("settings.updates")}>
          <Field label={t("update.autoCheck")}>
            <Toggle checked={autoCheckUpdates} onChange={setAutoCheckUpdates} />
          </Field>

          <Field label={t("update.checkNow")}>
            <div className="flex items-center gap-2.5">
              {!checking && updateStatus === "up-to-date" && (
                <span style={{ fontSize: 12, color: "var(--success)" }}>{t("update.upToDate")}</span>
              )}
              {!checking && updateStatus === "error" && (
                <span style={{ fontSize: 12, color: "var(--danger)", maxWidth: 240, textAlign: "right" }}>
                  {updateError ?? t("update.error")}
                </span>
              )}
              {updateStatus === "available" && updateInfo ? (
                // Показываем именно то, что уже предложено диалогом: клик
                // возвращает пользователя к нему, а не запускает вторую проверку.
                <Button variant="primary" size="sm" onClick={openUpdateDialog}>
                  {ti("update.newVersion", { version: updateInfo.version })}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={checking}
                  disabled={checking}
                  onClick={() => void checkForUpdates()}
                >
                  {checking ? t("update.checking") : t("update.checkNow")}
                </Button>
              )}
            </div>
          </Field>
        </Section>
      )}

      {showDesignPicker && (
        <DesignThemeDialog
          current={designTheme}
          onSelect={(d) => { setDesignTheme(d); setShowDesignPicker(false); }}
          onClose={() => setShowDesignPicker(false)}
        />
      )}
    </>
  );
}

// ── Design theme picker (separate window) ────────────────────────────────
// Deliberately its own dialog rather than another row of inline cards like
// Theme/Accent above — a bigger visual commitment (structure, not just a
// color swap), so it gets room to show a real preview swatch instead of a
// tiny dot.

const DESIGN_OPTIONS: Array<{ id: DesignTheme; nameKey: TranslationKey; swatch: [string, string, string] }> = [
  { id: "standard", nameKey: "settings.design.standard", swatch: ["#ffffff", "#3b6fe0", "#37352f"] },
  { id: "soft",     nameKey: "settings.design.soft",     swatch: ["#f7f5f1", "#3b6fe0", "#37352f"] },
];

function DesignThemeDialog({
  current, onSelect, onClose,
}: {
  current: DesignTheme;
  onSelect: (d: DesignTheme) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      mobileSheet
      onOpenChange={(open) => !open && onClose()}
      style={{
        width: 460, maxWidth: "calc(100vw - 32px)", borderRadius: 16,
        backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-default)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.4)", overflow: "hidden",
      }}
    >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px 12px" }}>
          <DialogTitle asChild>
            <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text-primary)" }}>{t("settings.designTheme")}</span>
          </DialogTitle>
          <VisuallyHidden><DialogDescription>{t("settings.designTheme")}</DialogDescription></VisuallyHidden>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "var(--text-muted)", lineHeight: 0 }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, padding: "0 18px 18px" }}>
          {DESIGN_OPTIONS.map(({ id, nameKey, swatch }) => {
            const isActive = current === id;
            return (
              <button
                key={id}
                onClick={() => onSelect(id)}
                style={{
                  display: "flex", flexDirection: "column", gap: 8, padding: 10, borderRadius: 12,
                  border: `1.5px solid ${isActive ? "var(--accent)" : "var(--border-default)"}`,
                  backgroundColor: isActive ? "var(--accent-subtle)" : "var(--bg-elevated)",
                  textAlign: "left", cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", height: 40, borderRadius: 7, overflow: "hidden" }}>
                  {swatch.map((c, i) => <div key={i} style={{ flex: 1, background: c }} />)}
                </div>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: isActive ? "var(--accent)" : "var(--text-primary)" }}>
                  {t(nameKey)}
                </span>
              </button>
            );
          })}
        </div>
    </Dialog>
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
  const isMobile                = useIsMobileLayout();

  // Autostart lives in the Windows registry, not in our settings table — the
  // registry is the only thing that actually decides whether Windows starts
  // us, so mirroring it into SQLite would just create a second source of truth
  // to drift out of sync. That makes the backend the owner of this value: read
  // it on mount, and trust what it reports back after a write.
  const [autostart, setAutostart] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);

  useEffect(() => {
    getAutostartEnabled().then(setAutostart).catch(() => setAutostart(false));
  }, []);

  async function applyAutostart(next: boolean) {
    setAutostartBusy(true);
    try {
      // Trust the returned state rather than the click: the write can fail,
      // and the toggle must then snap back instead of lying about it.
      setAutostart(await writeAutostart(next));
    } catch (e) {
      toast.error(t("settings.autostartError"), String(e));
    } finally {
      setAutostartBusy(false);
    }
  }

  return (
    <Section title={t("settings.publish")}>
      <Field label={t("settings.confirmPublish")}>
        <Toggle checked={confirmBeforePublish} onChange={setConfirmBeforePublish} />
      </Field>

      {/* The row that makes the scheduler trustworthy overnight: a hidden
          launch in the tray is what lets queued posts go out after a reboot. */}
      <div
        className={isMobile ? "flex flex-col gap-2 px-4 py-3" : "flex items-center justify-between gap-4 px-4 py-3"}
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="min-w-0">
          <span className="text-sm block" style={{ color: "var(--text-primary)" }}>
            {t("settings.autostart")}
          </span>
          <span className="text-xs block mt-0.5" style={{ color: "var(--text-muted)" }}>
            {t("settings.autostartHint")}
          </span>
        </div>
        <div style={{ opacity: autostartBusy ? 0.55 : 1, pointerEvents: autostartBusy ? "none" : "auto" }}>
          <Toggle checked={autostart} onChange={applyAutostart} />
        </div>
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
        <img
          src="/icon.png"
          width={56}
          height={56}
          alt=""
          draggable={false}
          className="rounded-2xl shadow-md"
        />
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
  const isMobile = useIsMobileLayout();
  return (
    <div>
      <h2
        className={"text-xs font-semibold uppercase tracking-widest " + (isMobile ? "mb-2.5" : "mb-3")}
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
  const isMobile = useIsMobileLayout();
  return (
    <div
      className={
        isMobile
          ? "flex flex-col gap-2 px-4 py-3"
          : "flex items-center justify-between px-4 py-3"
      }
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
