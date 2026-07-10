import { useEffect, useState } from "react";
import { api, type BotConfig } from "../api";

export default function SettingsTab() {
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testKey, setTestKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch((err) => setError(String(err)));
  }, []);

  async function save() {
    if (!config) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      await api.setConfig(config);
      await api.restartBot();
      setNotice("Настройки сохранены, бот перезапущен с новыми значениями.");
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function makeTestKey() {
    setGenerating(true);
    setTestKey(null);
    setError(null);
    try {
      setTestKey(await api.generateTestKey());
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  }

  if (!config) {
    return (
      <div className="panel">
        <h2>Настройки</h2>
        {error ? <div className="notice notice--error">{error}</div> : <p className="hint">Загрузка…</p>}
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Настройки</h2>

      <div className="form-grid">
        <label>
          Цена лицензии (Stars)
          <input
            type="number"
            min={1}
            value={config.starsPrice}
            onChange={(e) => setConfig({ ...config, starsPrice: Number(e.target.value) })}
          />
        </label>

        <label>
          Курс ₽ за 1 Star (только для отображения в статистике)
          <input
            type="number"
            step="0.1"
            min={0}
            value={config.rubPerStar}
            onChange={(e) => setConfig({ ...config, rubPerStar: Number(e.target.value) })}
          />
        </label>

        <label>
          Chat ID для уведомлений о продажах
          <input
            type="text"
            value={config.adminChatId}
            onChange={(e) => setConfig({ ...config, adminChatId: e.target.value })}
          />
        </label>

        <label>
          Контакт поддержки (виден покупателям в /help и при ошибках)
          <input
            type="text"
            value={config.supportContact}
            onChange={(e) => setConfig({ ...config, supportContact: e.target.value })}
          />
        </label>
      </div>

      <p className="hint">
        ≈{Math.round(config.starsPrice * config.rubPerStar).toLocaleString("ru-RU")} ₽ по указанному курсу.
        Сохранение автоматически перезапускает бота, чтобы изменения применились.
      </p>

      <div className="button-row">
        <button disabled={saving} onClick={save}>
          {saving ? "Сохраняю…" : "Сохранить и перезапустить бота"}
        </button>
      </div>

      {notice && <div className="notice notice--ok">{notice}</div>}
      {error && <div className="notice notice--error">{error}</div>}

      <hr className="divider" />

      <h3>Ручная генерация ключа</h3>
      <p className="hint">Для случаев, когда ключ нужно выдать вручную (ошибка выдачи, поддержка).</p>
      <div className="button-row">
        <button className="ghost" disabled={generating} onClick={makeTestKey}>
          {generating ? "Генерирую…" : "Сгенерировать ключ"}
        </button>
      </div>
      {testKey && (
        <div className="key-output">
          <code>{testKey}</code>
          <button
            className="ghost small"
            onClick={() => navigator.clipboard.writeText(testKey)}
          >
            Копировать
          </button>
        </div>
      )}
    </div>
  );
}
