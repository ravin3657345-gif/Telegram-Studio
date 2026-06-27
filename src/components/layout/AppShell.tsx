import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const location = useLocation();

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="content-area">
        <div
          key={location.pathname}
          className="page-fade-in"
          style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
}
