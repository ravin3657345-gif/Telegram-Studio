import { useEffect, useState } from "react";
import { api, type BroadcastResult } from "../api";

function pluralBuyers(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "покупатель";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "покупателя";
  return "покупателей";
}

export default function BroadcastTab() {
  const [buyerCount, setBuyerCount] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getBuyerCount().then(setBuyerCount).catch((err) => setError(String(err)));
  }, []);

  async function send() {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.broadcastUpdate(message);
      setResult(r);
      setMessage("");
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="panel">
      <h2>Рассылка об обновлении</h2>
      <p className="hint">
        Сообщение уйдёт всем уникальным покупателям из леджера продаж (
        {buyerCount === null ? "…" : `${buyerCount} ${pluralBuyers(buyerCount)}`}) — тем же людям, кому
        отвечает команда /mykey. Не подписка, разовая ручная отправка каждый раз, когда вы сами решите её запустить.
      </p>

      <div className="form-grid">
        <label>
          Текст сообщения
          <textarea
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Вышла новая версия 1.7.0— добавили..."
          />
        </label>
      </div>

      {!confirming ? (
        <div className="button-row">
          <button disabled={!message.trim() || sending || buyerCount === 0} onClick={() => setConfirming(true)}>
            Отправить
          </button>
        </div>
      ) : (
        <div className="button-row">
          <span className="hint" style={{ margin: 0 }}>
            Точно отправить {buyerCount} покупателям? Это необратимо.
          </span>
          <button disabled={sending} onClick={send}>
            {sending ? "Отправляю…" : "Да, отправить"}
          </button>
          <button className="ghost" disabled={sending} onClick={() => setConfirming(false)}>
            Отмена
          </button>
        </div>
      )}

      {result && (
        <div className="notice notice--ok">
          Отправлено {result.sent} из {result.total}.
          {result.failed > 0 && ` Не удалось: ${result.failed} (возможно, заблокировали бота).`}
        </div>
      )}
      {error && <div className="notice notice--error">{error}</div>}
    </div>
  );
}
