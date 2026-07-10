import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api";

export default function LogsTab() {
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const l = await api.getLogTail(300);
      setLines(l);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(refresh, 4000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, refresh]);

  return (
    <div className="panel">
      <h2>Логи</h2>
      <div className="button-row">
        <button className="ghost" onClick={refresh}>
          Обновить
        </button>
        <label className="checkbox-label">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Автообновление
        </label>
      </div>

      {error && <div className="notice notice--error">{error}</div>}

      <div className="log-viewer">
        {lines.length === 0 && <div className="empty-row">Лог пуст</div>}
        {lines.map((line, i) => (
          <div key={i} className={line.includes("ОШИБКА") ? "log-line log-line--error" : "log-line"}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
