import { useEffect } from "react";
import { useSettingsStore } from "@/store/settingsStore";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const theme = useSettingsStore((s) => s.theme);
  // designTheme ("soft") now has its own dark tokens (designs.css), so it no
  // longer pins the app to light — the Theme toggle applies to both skins.
  // The data-design attribute is applied separately by settingsStore.

  useEffect(() => {
    const resolved = theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
      : theme;

    // Animate color transition
    document.documentElement.classList.add("theme-transitioning");
    document.documentElement.setAttribute("data-theme", resolved);
    const t = setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 280);
    return () => clearTimeout(t);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.add("theme-transitioning");
      document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      const t = setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 280);
      return () => clearTimeout(t);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return <>{children}</>;
}
