import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Radio, CheckCircle2, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { addBot, addChannel } from "@/lib/tauriApi";
import { useChannelsStore } from "@/store/channelsStore";
import { toast } from "@/store/uiStore";
import { t } from "@/lib/i18n";
import { useSettingsStore } from "@/store/settingsStore";
import clsx from "clsx";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";

type Step = "bot" | "channel" | "done";

export function OnboardingPage() {
  useSettingsStore((s) => s.language);
  const isMobile = useIsMobileLayout();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("bot");
  const [token, setToken] = useState("");
  const [channelUsername, setChannelUsername] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);

  const addBotToStore     = useChannelsStore((s) => s.addBot);
  const addChannelToStore = useChannelsStore((s) => s.addChannel);
  const setActiveBot      = useChannelsStore((s) => s.setActiveBot);
  const setActiveChannel  = useChannelsStore((s) => s.setActiveChannel);
  const bots              = useChannelsStore((s) => s.bots);

  async function handleConnectBot() {
    if (!token.trim()) return;
    setLoading(true);
    try {
      const bot = await addBot(token.trim());
      addBotToStore(bot);
      setActiveBot(bot.id);
      setStep("channel");
    } catch (err) {
      toast.error(t("onboarding.error.bot"), String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectChannel() {
    if (!channelUsername.trim() || bots.length === 0) return;
    setLoading(true);
    try {
      const ch = await addChannel(bots[0].id, channelUsername.trim());
      addChannelToStore(ch);
      setActiveChannel(ch.id);
      setStep("done");
    } catch (err) {
      toast.error(t("onboarding.error.channel"), String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={"flex flex-col items-center min-h-screen overflow-y-auto " + (isMobile ? "px-4 py-6" : "px-6")}
      style={{ backgroundColor: "var(--bg-app)", color: "var(--text-primary)", justifyContent: isMobile ? "flex-start" : "center" }}
    >
      {/* Logo */}
      <div className={"flex items-center gap-3 " + (isMobile ? "mb-6" : "mb-10")}>
        <img
          src="/icon.png"
          width={40}
          height={40}
          alt=""
          draggable={false}
          className="rounded-xl"
        />
        <span className="text-xl font-semibold">Telegram Studio</span>
      </div>

      {/* Step indicator */}
      <div className={"flex items-center gap-3 " + (isMobile ? "mb-5" : "mb-8")}>
        <StepDot active={step === "bot"} done={step !== "bot"} label={t("onboarding.step.bot")} />
        <div className="w-8 h-px" style={{ backgroundColor: "var(--border-default)" }} />
        <StepDot active={step === "channel"} done={step === "done"} label={t("onboarding.step.channel")} />
        <div className="w-8 h-px" style={{ backgroundColor: "var(--border-default)" }} />
        <StepDot active={step === "done"} done={false} label={t("onboarding.step.done")} />
      </div>

      {/* Card */}
      <div
        className="w-full max-w-md rounded-xl border overflow-hidden"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-default)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div
          key={step}
          className={isMobile ? "p-5" : "p-8"}
          style={{ animation: "pageFadeIn 0.18s ease-out both" }}
        >
          {step === "bot" && (
            <BotStep
              token={token}
              showToken={showToken}
              loading={loading}
              onChange={setToken}
              onToggleShow={() => setShowToken((v) => !v)}
              onSubmit={handleConnectBot}
            />
          )}

          {step === "channel" && (
            <ChannelStep
              value={channelUsername}
              loading={loading}
              onChange={setChannelUsername}
              onSubmit={handleConnectChannel}
              onSkip={() => navigate("/")}
            />
          )}

          {step === "done" && (
            <DoneStep onStart={() => navigate("/")} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ─────────────────────────────────────── */

function StepDot({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className={clsx(
          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors"
        )}
        style={{
          backgroundColor: done
            ? "var(--success)"
            : active
            ? "var(--accent)"
            : "var(--bg-elevated)",
          color: done || active ? "#fff" : "var(--text-muted)",
        }}
      >
        {done ? <CheckCircle2 size={14} /> : label[0]}
      </div>
      <span className="text-2xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
    </div>
  );
}

function BotStep({
  token,
  showToken,
  loading,
  onChange,
  onToggleShow,
  onSubmit,
}: {
  token: string;
  showToken: boolean;
  loading: boolean;
  onChange: (v: string) => void;
  onToggleShow: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 mb-6">
        <Bot size={20} style={{ color: "var(--accent)" }} />
        <h1 className="text-lg font-semibold">{t("onboarding.bot.title")}</h1>
      </div>

      <div
        className="rounded-lg border p-4 mb-5 text-sm"
        style={{
          backgroundColor: "var(--bg-elevated)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-secondary)",
        }}
      >
        <p className="font-medium mb-2" style={{ color: "var(--text-primary)" }}>
          {t("onboarding.bot.tokenHint")}
        </p>
        <ol className="space-y-1 list-decimal list-inside">
          <li>{t("onboarding.bot.step1")}</li>
          <li>{t("onboarding.bot.step2")}</li>
          <li>{t("onboarding.bot.step3")}</li>
          <li>{t("onboarding.bot.step4")}</li>
        </ol>
      </div>

      <label className="block mb-1 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        {t("onboarding.bot.tokenLabel")}
      </label>
      <div className="relative mb-5">
        <input
          type={showToken ? "text" : "password"}
          value={token}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          placeholder="123456789:ABCDEF..."
          className="w-full h-9 rounded-md border px-3 pr-9 text-sm font-mono"
          style={{
            backgroundColor: "var(--bg-input)",
            borderColor: "var(--border-default)",
            color: "var(--text-primary)",
            outline: "none",
          }}
          autoFocus
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-2.5 top-1/2 -translate-y-1/2"
          style={{ color: "var(--text-muted)" }}
        >
          {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>

      <Button
        variant="primary"
        size="md"
        fullWidth
        loading={loading}
        disabled={!token.trim()}
        onClick={onSubmit}
        leftIcon={loading ? undefined : <ArrowRight size={15} />}
      >
        {loading ? t("onboarding.bot.checking") : t("onboarding.bot.connect")}
      </Button>
    </>
  );
}

function ChannelStep({
  value,
  loading,
  onChange,
  onSubmit,
  onSkip,
}: {
  value: string;
  loading: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 mb-6">
        <Radio size={20} style={{ color: "var(--accent)" }} />
        <h1 className="text-lg font-semibold">{t("onboarding.channel.title")}</h1>
      </div>

      <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
        {t("onboarding.channel.hint")}
      </p>

      <label className="block mb-1 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        {t("onboarding.channel.label")}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        placeholder="@mychannel"
        className="w-full h-9 rounded-md border px-3 mb-5 text-sm"
        style={{
          backgroundColor: "var(--bg-input)",
          borderColor: "var(--border-default)",
          color: "var(--text-primary)",
          outline: "none",
        }}
        autoFocus
      />

      <div className="flex gap-3">
        <Button variant="ghost" size="md" onClick={onSkip} className="flex-1">
          {t("onboarding.channel.skip")}
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={loading}
          disabled={!value.trim()}
          onClick={onSubmit}
          className="flex-1"
        >
          {t("onboarding.channel.add")}
        </Button>
      </div>
    </>
  );
}

function DoneStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-5">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center"
        style={{ backgroundColor: "var(--success-subtle)" }}
      >
        <CheckCircle2 size={28} style={{ color: "var(--success)" }} />
      </div>

      <div>
        <h1 className="text-lg font-semibold mb-2">{t("onboarding.done.title")}</h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {t("onboarding.done.desc")}
        </p>
      </div>

      <Button variant="primary" size="lg" onClick={onStart} fullWidth>
        {t("onboarding.done.start")}
      </Button>
    </div>
  );
}
