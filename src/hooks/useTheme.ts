import { useSettingsStore } from "@/store/settingsStore";
import type { Theme } from "@/types/settings";

export function useTheme() {
  const theme    = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  const toggleTheme = () => {
    const next: Theme =
      theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
    setTheme(next);
  };

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  return { theme, setTheme, toggleTheme, isDark };
}
