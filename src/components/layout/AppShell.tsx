import { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { BottomTabBar } from "./BottomTabBar";
import { OnboardingTour } from "./OnboardingTour";
import { CommandPalette } from "./CommandPalette";
import { UpdateChecker } from "@/components/updates/UpdateChecker";
import { useChannelsStore, dedupeChannels } from "@/store/channelsStore";
import { useDraftsStore } from "@/store/draftsStore";
import { getBots, getChannels, getDrafts } from "@/lib/tauriApi";
import { useIsMobileLayout } from "@/hooks/useIsMobileLayout";
import { useIsLandscape } from "@/hooks/useIsLandscape";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { ensureNotificationPermission } from "@/lib/notifications";

export function AppShell() {
  const location = useLocation();
  const isMobile = useIsMobileLayout();
  // `.app-root`'s 100dvh doesn't reliably shrink for the on-screen keyboard
  // on Android WebView — without this, the bottom tab bar and whatever's at
  // the bottom of the current page render underneath the keyboard instead of
  // being pushed above it. Applied once here (not per-page) so every mobile
  // screen gets it, not just the editor.
  const keyboardInset = useKeyboardInset();
  const isLandscape = useIsLandscape();
  // Mobile landscape is wide-but-short — a bottom tab bar would eat the
  // scarcest dimension (height). Move navigation to a slim left rail and make
  // the shell a row, so the content column keeps the full height.
  const mobileRail = isMobile && isLandscape;
  const setBots     = useChannelsStore((s) => s.setBots);
  const setChannels = useChannelsStore((s) => s.setChannels);
  const setDrafts   = useDraftsStore((s) => s.setDrafts);

  // Refresh bot/channel names from Telegram once per app launch, so a rename
  // shows up everywhere (publish panel, dashboard, etc.) without the user
  // having to visit the Bots/Channels pages first — those pages still
  // refresh on their own mount too, for a manual re-check mid-session.
  // Drafts are loaded here too (previously only fetched on DraftsPage/
  // SchedulePage mount) so CommandPalette has something to search from the
  // moment the app opens, not just after the user has visited /drafts once.
  useEffect(() => {
    getBots().then(setBots).catch(() => {});
    getChannels().then((chs) => setChannels(dedupeChannels(chs))).catch(() => {});
    getDrafts().then(setDrafts).catch(() => {});
    // Scheduled-post outcome notifications (see scheduler/mod.rs) only
    // deliver on Android once permission's been granted — this is the
    // one-time request for that, same startup effect as the rest above.
    ensureNotificationPermission();
  }, []);

  return (
    <div
      className="app-shell"
      data-mobile={isMobile ? "true" : "false"}
      data-landscape={isLandscape ? "true" : "false"}
      style={{ flexDirection: isMobile ? (mobileRail ? "row" : "column") : "row", paddingBottom: isMobile ? keyboardInset : 0 }}
    >
      {!isMobile && <Sidebar />}
      {mobileRail && <BottomTabBar orientation="vertical" />}
      <div className="content-area">
        <div
          key={location.pathname}
          className="page-fade-in"
          style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}
        >
          <Outlet />
        </div>
      </div>
      {isMobile && !mobileRail && <BottomTabBar orientation="horizontal" />}
      {!isMobile && <OnboardingTour />}
      <CommandPalette />
      <UpdateChecker />
    </div>
  );
}
