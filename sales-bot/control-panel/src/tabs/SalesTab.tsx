import { useEffect, useState, useCallback } from "react";
import { api, type SaleRow, type BotConfig } from "../api";

export default function SalesTab() {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starBalance, setStarBalance] = useState<number | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c] = await Promise.all([api.getSales(), api.getConfig()]);
      setSales(s);
      setConfig(c);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }

    // Отдельный try — реальный баланс требует сети и токена бота, и не должен
    // блокировать показ уже посчитанной локальной статистики продаж, если
    // Telegram недоступен или token.txt ещё не создан.
    try {
      const balance = await api.getStarBalance();
      setStarBalance(balance.amount);
      setBalanceError(null);
    } catch (err) {
      setBalanceError(String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalStars = sales.reduce((sum, s) => sum + (Number(s.stars) || 0), 0);
  const rubPerStar = config?.rubPerStar ?? 0;
  const totalRub = Math.round(totalStars * rubPerStar);

  return (
    <div className="panel">
      <h2>Продажи</h2>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-value">{sales.length}</div>
          <div className="stat-label">продаж</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalStars}</div>
          <div className="stat-label">Stars всего</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">≈{totalRub.toLocaleString("ru-RU")} ₽</div>
          <div className="stat-label">по курсу {rubPerStar} ₽/Star</div>
        </div>
        <div className="stat-card" title={balanceError ?? undefined}>
          <div className="stat-value">
            {balanceError ? "—" : starBalance === null ? "…" : starBalance.toLocaleString("ru-RU")}
          </div>
          <div className="stat-label">
            {balanceError ? "баланс недоступен" : "на балансе бота"}
          </div>
        </div>
      </div>

      <div className="button-row">
        <button className="ghost" onClick={refresh} disabled={loading}>
          Обновить
        </button>
      </div>

      {error && <div className="notice notice--error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Покупатель</th>
              <th>Stars</th>
              <th>Ключ</th>
            </tr>
          </thead>
          <tbody>
            {sales.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="empty-row">
                  Продаж пока нет
                </td>
              </tr>
            )}
            {sales.map((s, i) => (
              <tr key={i}>
                <td className="nowrap">{new Date(s.timestamp).toLocaleString("ru-RU")}</td>
                <td>{s.username ? `@${s.username}` : s.userId}</td>
                <td className="nowrap">{s.stars}</td>
                <td className="mono key-cell" title={s.key}>
                  {s.key}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
