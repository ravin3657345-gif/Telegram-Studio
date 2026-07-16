import { HashRouter } from "react-router-dom";
import { Providers } from "./Providers";
import { AppRouter } from "./Router";
import { WindowControls } from "@/components/layout/WindowControls";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { LicenseGate } from "@/components/LicenseGate";
import { isAndroidPlatform } from "@/hooks/useIsMobileLayout";

export default function App() {
  return (
    <HashRouter>
      <Providers>
        <LicenseGate>
          <div className="app-root">
            {/* No OS window chrome on Android — there's no window to minimize/close */}
            {!isAndroidPlatform() && <WindowControls />}
            <AppRouter />
            <ToastContainer />
          </div>
        </LicenseGate>
      </Providers>
    </HashRouter>
  );
}
