import { useEffect, useState, useCallback } from "react";
import { api, type InstallerInfo } from "../api";

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function InstallersTab() {
  const [installers, setInstallers] = useState<InstallerInfo[]>([]);
  const [published, setPublished] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, pub] = await Promise.all([api.getInstallers(), api.getPublishedInstallerVersion()]);
      setInstallers(list);
      setPublished(pub);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function publish(it: InstallerInfo) {
    setPublishing(it.name);
    setNotice(null);
    setError(null);
    try {
      await api.uploadInstallerToStorage(it.name, it.version);
      setNotice(`v${it.version} опубликована — бот теперь присылает именно её.`);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setPublishing(null);
    }
  }

  return (
    <div className="panel">
      <h2>Установщики (D:\Релиз)</h2>
      <p className="hint">
        Бот присылает покупателям только ту версию, что опубликована в Supabase — это не обязательно самая свежая
        сборка в D:\Релиз, пока её явно не опубликуете.
      </p>

      <div className="button-row">
        <button className="ghost" onClick={refresh} disabled={loading}>
          Обновить
        </button>
      </div>

      {notice && <div className="notice notice--ok">{notice}</div>}
      {error && <div className="notice notice--error">{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Версия</th>
              <th>Файл</th>
              <th>Размер</th>
              <th>Изменён</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {installers.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="empty-row">
                  Установщики не найдены
                </td>
              </tr>
            )}
            {installers.map((it) => (
              <tr key={it.name}>
                <td className="nowrap">{it.version}</td>
                <td className="mono">{it.name}</td>
                <td className="nowrap">{formatSize(it.sizeBytes)}</td>
                <td className="nowrap">{it.modified}</td>
                <td>
                  {it.version === published && <span className="badge">📡 Опубликована — отправится покупателю</span>}
                  {it.isLatest && it.version !== published && <span className="badge badge--muted">Последняя сборка</span>}
                </td>
                <td>
                  <button
                    className="ghost small"
                    disabled={publishing !== null || it.version === published}
                    onClick={() => publish(it)}
                  >
                    {publishing === it.name ? "Публикую…" : "Опубликовать"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
