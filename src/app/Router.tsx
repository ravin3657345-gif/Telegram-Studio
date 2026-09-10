import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { EditorPage } from "@/pages/EditorPage";
import { DraftsPage } from "@/pages/DraftsPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { SchedulePage } from "@/pages/SchedulePage";
import { ChannelsPage } from "@/pages/ChannelsPage";
import { BotsPage } from "@/pages/BotsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { useChannelsStore } from "@/store/channelsStore";

function RequireSetup({ children }: { children: React.ReactNode }) {
  const hasBots = useChannelsStore((s) => s.bots.length > 0);
  if (!hasBots) {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

export function AppRouter() {
  return (
    <Routes>
      <Route path="/onboarding" element={<OnboardingPage />} />

      <Route
        element={
          <RequireSetup>
            <AppShell />
          </RequireSetup>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/editor/:draftId" element={<EditorPage />} />
        <Route path="/drafts" element={<DraftsPage />} />
        <Route path="/templates" element={<TemplatesPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/bots" element={<BotsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
