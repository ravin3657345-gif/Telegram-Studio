import { useEffect } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { useUpdateStore } from "@/store/updateStore";
import { UpdateDialog } from "./UpdateDialog";

/**
 * Mounts the silent "вышла новая версия" check plus the dialog it may open.
 * Headless on purpose: the actual state machine is in updateStore, so Settings →
 * "О программе" can drive the same dialog (manual check, auto-check toggle)
 * without a second copy of this flow.
 *
 * Mounted from AppShell — i.e. only for an already-activated app inside the
 * shell, never on the activation/onboarding screens where an update prompt
 * would be noise (and where the check itself is meaningless anyway).
 */
export function UpdateChecker() {
  const autoCheckUpdates = useSettingsStore((s) => s.autoCheckUpdates);
  const check = useUpdateStore((s) => s.check);

  useEffect(() => {
    if (!autoCheckUpdates) return;
    // Delayed so the check never competes with the startup burst (license
    // status, bots/channels/drafts fetch, notification permission) — an update
    // prompt that appears while the UI is still filling in reads as a glitch.
    const id = window.setTimeout(() => void check({ silent: true }), 2500);
    return () => window.clearTimeout(id);
  }, [autoCheckUpdates, check]);

  return <UpdateDialog />;
}
