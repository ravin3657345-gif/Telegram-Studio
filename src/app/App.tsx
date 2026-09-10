import { HashRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { Providers } from "./Providers";
import { AppRouter } from "./Router";
import { WindowControls } from "@/components/layout/WindowControls";
import { ToastContainer } from "@/components/ui/ToastContainer";
import { LicenseGate } from "@/components/LicenseGate";
import { isAndroidPlatform } from "@/hooks/useIsMobileLayout";

export default function App() {
  return (
    // Android forces reduced motion (transform/layout animations off, opacity
    // fades stay) — the mid-range SoC it ships on drops frames on the spring/
    // slide churn. Desktop follows the OS reduce-motion preference.
    <MotionConfig reducedMotion={isAndroidPlatform() ? "always" : "user"}>
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
    </MotionConfig>
  );
}
