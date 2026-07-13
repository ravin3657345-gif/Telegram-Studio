import { useEffect } from "react";
import { useSettingsStore } from "@/store/settingsStore";

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const theme = useSettingsStore((s) => s.theme);
  // "soft" has no dark-mode tokens of its own — keep it pinned to light
  // regardless of the Theme setting (covers "system" silently flipping to
  // dark at night, on top of setDesignTheme's own explicit-selection guard).
  const designTheme = useSettingsStore((s) => s.designTheme);

  useEffect(() => {
    const resolved = designTheme === "soft" ? "light" :
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
  }, [theme, designTheme]);

  useEffect(() => {
    if (theme !== "system" || designTheme === "soft") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      document.documentElement.classList.add("theme-transitioning");
      document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      const t = setTimeout(() => document.documentElement.classList.remove("theme-transitioning"), 280);
      return () => clearTimeout(t);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, designTheme]);

  return <>{children}</>;
}
