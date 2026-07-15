import { useEffect, useState, useCallback } from "react";
import { api, type BotStatus } from "../api";

function formatAgo(iso: string | null): string {
  if (!iso) return "—";
  const since = new Date(iso);
  if (Number.isNaN(since.getTime())) return iso;
  const ms = Date.now() - since.getTime();
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} мин назад`;
  return `${hours} ч ${minutes} мин назад`;
}

export default function StatusTab() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.getBotStatus();
      setStatus(s);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await action();
      setNotice(message);
      await new Promise((r) => setTimeout(r, 1000));
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const ok = status?.functionReachable && Boolean(status?.webhookUrl);
  const hasWarning = ok && Boolean(status?.lastErrorMessage);

  return (
    <div className="panel">
      <h2>Статус бота</h2>
      <p className="hint">
        Бот — Supabase Edge Function (webhook), не процесс на этом ПК. «Остановить» снимает вебхук у Telegram
        (бот перестаёт получать сообщения совсем), «Запустить» — ставит его обратно.
      </p>

      <div
        className={`status-card ${
          loading ? "status-card--loading" : ok ? (hasWarning ? "status-card--warn" : "status-card--ok") : "status-card--off"
        }`}
      >
        <div className="status-dot" />
        <div>
          <div className="status-title">
            {loading ? "Проверяю статус…" : ok ? (hasWarning ? "Работает, но были сбои" : "Бот работает") : "Бот не отвечает"}
          </div>
          <div className="status-sub">
            {loading ? (
              "—"
            ) : ok ? (
              <>Вебхук: {status?.webhookUrl}</>
            ) : (
              "Функция недоступна или вебхук не настроен — покупатели не получат ответ"
            )}
          </div>
          {!loading && status && (status.pendingUpdateCount ?? 0) > 0 && (
            <div className="status-warn">
              ⚠ Telegram накопил {status.pendingUpdateCount} недоставленных апдейтов
            </div>
          )}
          {!loading && hasWarning && (
            <div className="status-warn">
              ⚠ Последняя ошибка доставки: {status?.lastErrorMessage}
              {status?.lastErrorDate ? ` (${formatAgo(status.lastErrorDate)})` : ""}
            </div>
          )}
        </div>
      </div>

      <div className="status-card status-card--muted">
        <div>
          <div className="status-title">Последняя активность</div>
          <div className="status-sub">
            {loading
              ? "—"
              : status?.lastLogAt
                ? `${formatAgo(status.lastLogAt)} — ${status.lastLogMessage}`
                : "Пока ничего не обрабатывал"}
          </div>
        </div>
      </div>

      <div className="button-row">
        <button disabled={loading || busy || !ok} onClick={() => run(api.pauseBot, "Бот остановлен — вебхук снят")}>
          ⏹ Остановить
        </button>
        <button disabled={loading || busy || ok} onClick={() => run(api.resumeBot, "Бот запущен")}>
          ▶ Запустить
        </button>
        <button className="ghost" disabled={loading || busy} onClick={refresh}>
          Обновить
        </button>
      </div>

      {notice && <div className="notice notice--ok">{notice}</div>}
      {error && <div className="notice notice--error">{error}</div>}
    </div>
  );
}
