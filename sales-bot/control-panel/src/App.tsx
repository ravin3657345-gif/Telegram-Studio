import { useState } from "react";
import StatusTab from "./tabs/StatusTab";
import SalesTab from "./tabs/SalesTab";
import LogsTab from "./tabs/LogsTab";
import InstallersTab from "./tabs/InstallersTab";
import SettingsTab from "./tabs/SettingsTab";
import { useSalesNotifier } from "./useSalesNotifier";

const TABS = [
  { id: "status", label: "Статус", icon: "●" },
  { id: "sales", label: "Продажи", icon: "₽" },
  { id: "logs", label: "Логи", icon: "▤" },
  { id: "installers", label: "Установщики", icon: "⬇" },
  { id: "settings", label: "Настройки", icon: "⚙" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<TabId>("status");
  useSalesNotifier();

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <span className="brand-dot" />
          Панель продаж
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-item ${tab === t.id ? "nav-item--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <span className="nav-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="content">
        {tab === "status" && <StatusTab />}
        {tab === "sales" && <SalesTab />}
        {tab === "logs" && <LogsTab />}
        {tab === "installers" && <InstallersTab />}
        {tab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}
