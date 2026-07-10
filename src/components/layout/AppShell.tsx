import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { BottomTabBar } from "./BottomTabBar";
import { OnboardingTour } from "./OnboardingTour";
import { useChannelsStore, dedupeChannels } from "@/store/channelsStore";
import { getBots, getChannels } from "@/lib/tauriApi";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";

export function AppShell() {
  const location = useLocation();
  const isMobile = useIsMobileLayout();
  const setBots     = useChannelsStore((s) => s.setBots);
  const setChannels = useChannelsStore((s) => s.setChannels);

  // Refresh bot/channel names from Telegram once per app launch, so a rename
  // shows up everywhere (publish panel, dashboard, etc.) without the user
  // having to visit the Bots/Channels pages first — those pages still
  // refresh on their own mount too, for a manual re-check mid-session.
  useEffect(() => {
    getBots().then(setBots).catch(() => {});
    getChannels().then((chs) => setChannels(dedupeChannels(chs))).catch(() => {});
  }, []);

  return (
    <div className="app-shell" style={{ flexDirection: isMobile ? "column" : "row" }}>
      {!isMobile && <Sidebar />}
      <div className="content-area">
        <div
          key={location.pathname}
          className="page-fade-in"
          style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}
        >
          <Outlet />
        </div>
      </div>
      {isMobile && <BottomTabBar />}
      {!isMobile && <OnboardingTour />}
    </div>
  );
}
