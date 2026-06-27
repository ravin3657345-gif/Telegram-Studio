import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Radio, CheckCircle2, ArrowRight, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { addBot, addChannel } from "@/lib/tauriApi";
import { useChannelsStore } from "@/store/channelsStore";
import { toast } from "@/store/uiStore";
import clsx from "clsx";

type Step = "bot" | "channel" | "done";

export function OnboardingPage() {
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
      toast.error("Ошибка подключения бота", String(err));
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
      toast.error("Ошибка подключения канала", String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-6"
      style={{ backgroundColor: "var(--bg-app)", color: "var(--text-primary)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 mb-10">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: "var(--accent)" }}
        >
          <svg width="22" height="22" viewBox="0 0 16 16" fill="none">
            <path d="M8 1L14 4.5V11.5L8 15L2 11.5V4.5L8 1Z" fill="white" />
          </svg>
        </div>
        <span className="text-xl font-semibold">Telegram Studio</span>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-3 mb-8">
        <StepDot active={step === "bot"} done={step !== "bot"} label="Бот" />
        <div className="w-8 h-px" style={{ backgroundColor: "var(--border-default)" }} />
        <StepDot active={step === "channel"} done={step === "done"} label="Канал" />
        <div className="w-8 h-px" style={{ backgroundColor: "var(--border-default)" }} />
        <StepDot active={step === "done"} done={false} label="Готово" />
      </div>

      {/* Card */}
      <div
        className="w-full max-w-md rounded-xl border p-8"
        style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-default)",
          boxShadow: "var(--shadow-lg)",
        }}
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
        <h1 className="text-lg font-semibold">Подключите бота</h1>
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
          Как получить токен:
        </p>
        <ol className="space-y-1 list-decimal list-inside">
          <li>Откройте @BotFather в Telegram</li>
          <li>Отправьте команду /newbot</li>
          <li>Следуйте инструкциям</li>
          <li>Скопируйте полученный токен</li>
        </ol>
      </div>

      <label className="block mb-1 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Токен бота
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
        {loading ? "Проверяем..." : "Подключить бота"}
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
        <h1 className="text-lg font-semibold">Добавьте канал</h1>
      </div>

      <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
        Убедитесь, что бот добавлен в канал как администратор с правом публикации
        сообщений.
      </p>

      <label className="block mb-1 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Username или ID канала
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
          Пропустить
        </Button>
        <Button
          variant="primary"
          size="md"
          loading={loading}
          disabled={!value.trim()}
          onClick={onSubmit}
          className="flex-1"
        >
          Добавить канал
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
        <h1 className="text-lg font-semibold mb-2">Всё готово!</h1>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Telegram Studio настроен и готов к работе.
          Начните создавать посты прямо сейчас.
        </p>
      </div>

      <Button variant="primary" size="lg" onClick={onStart} fullWidth>
        Начать работу
      </Button>
    </div>
  );
}
