import { useEffect, useState, useCallback } from "react";
import { api, type BotStatus } from "../api";

function formatSince(iso: string | null): string {
  if (!iso) return "—";
  const since = new Date(iso);
  if (Number.isNaN(since.getTime())) return iso;
  const ms = Date.now() - since.getTime();
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} мин`;
  return `${hours} ч ${minutes} мин`;
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
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  async function run(action: () => Promise<void>, message: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await new Promise((r) => setTimeout(r, 1200));
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const running = status?.running ?? false;

  return (
    <div className="panel">
      <h2>Статус бота</h2>

      <div className={`status-card ${loading ? "status-card--loading" : running ? "status-card--ok" : "status-card--off"}`}>
        <div className="status-dot" />
        <div>
          <div className="status-title">
            {loading ? "Проверяю статус…" : running ? "Бот работает" : "Бот остановлен"}
          </div>
          <div className="status-sub">
            {loading ? (
              "—"
            ) : running ? (
              <>
                PID {status?.pid} · запущен {formatSince(status?.since ?? null)} назад
              </>
            ) : (
              "Не отвечает на сообщения покупателей"
            )}
          </div>
          {!loading && status && !status.supervisorRunning && running && (
            <div className="status-warn">
              ⚠ Работает без supervisor'а (run-forever.ps1) — при падении сам не перезапустится
            </div>
          )}
        </div>
      </div>

      <div className="button-row">
        <button disabled={loading || busy || running} onClick={() => run(api.startBot, "Бот запущен")}>
          ▶ Запустить
        </button>
        <button disabled={loading || busy || !running} onClick={() => run(api.stopBot, "Бот остановлен")}>
          ⏹ Остановить
        </button>
        <button disabled={loading || busy} onClick={() => run(api.restartBot, "Бот перезапущен")}>
          ⟳ Перезапустить
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
