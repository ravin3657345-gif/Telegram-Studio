import { useEffect } from "react";
import { useSettingsStore } from "@/store/settingsStore";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const resolved =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
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
