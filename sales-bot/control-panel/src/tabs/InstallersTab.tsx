import { useEffect, useState, useCallback } from "react";
import { api, type InstallerInfo } from "../api";

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function InstallersTab() {
  const [installers, setInstallers] = useState<InstallerInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setInstallers(await api.getInstallers());
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

  return (
    <div className="panel">
      <h2>Установщики (D:\Релиз)</h2>
      <p className="hint">
        Бот при каждой продаже сам находит и присылает установщик с наибольшим номером версии — это то, что
        помечено «Последний».
      </p>

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
              <th>Версия</th>
              <th>Файл</th>
              <th>Размер</th>
              <th>Изменён</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {installers.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="empty-row">
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
                <td>{it.isLatest && <span className="badge">Последний — отправится покупателю</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
