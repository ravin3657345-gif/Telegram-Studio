import { create } from "zustand";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  restartApp,
  type UpdateInfo,
} from "@/lib/updates";
import { useSettingsStore } from "@/store/settingsStore";

// Update flow state machine, shared by the startup checker (UpdateChecker, which
// only exists to trigger a silent check + render the dialog) and the "О программе"
// section in Settings (manual check + auto-check toggle). Lives in a store rather
// than in a component so both entry points drive the same dialog instead of each
// rendering its own copy.
//
// Two kinds of "не сейчас" are deliberately different, and that's the whole point
// of the feature request this implements:
//   • «Позже»  — remind me on the NEXT launch. Only kept in memory for the current
//                app run (deferredVersion below); a relaunch clears it naturally.
//   • «Не напоминать об этой версии» — persisted (settingsStore.skipUpdateVersion),
//                the dialog never comes back for that version on any launch.

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "up-to-date"
  | "error";

interface UpdateState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  /** Bytes downloaded so far while status === "downloading". */
  downloaded: number;
  /** Total bytes, once known — null until the server reports a content length. */
  contentLength: number | null;
  error: string | null;
  /** Version the user postponed with «Позже» during this app run. */
  deferredVersion: string | null;
  dialogOpen: boolean;
  /** The download finished and the installer already ran: the only step left is
   * a restart. Tracked separately from `status` so that a failed/blocked
   * relaunch still offers «Перезапустить» instead of re-downloading everything. */
  installed: boolean;

  /** `silent` = the startup check: failures and "нет обновлений" stay invisible. */
  check: (opts?: { silent?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  openDialog: () => void;
  remindNextLaunch: () => void;
  skipVersion: (version: string) => void;
}

export const useUpdateStore = create<UpdateState>()((set, get) => ({
  status: "idle",
  info: null,
  downloaded: 0,
  contentLength: null,
  error: null,
  deferredVersion: null,
  dialogOpen: false,
  installed: false,

  check: async ({ silent = false } = {}) => {
    const { status } = get();
    // Never interrupt an install in progress with another check.
    if (status === "checking" || status === "downloading" || status === "installing") return;

    set({ status: "checking", error: null });
    try {
      const info = await checkForUpdate();

      if (!info) {
        set({ status: silent ? "idle" : "up-to-date", info: null });
        return;
      }

      // «Не напоминать» / «Позже» — both mean "don't open the dialog now", but
      // only the first is remembered across launches (see the note above).
      const { skipUpdateVersion } = useSettingsStore.getState();
      const postponed = get().deferredVersion === info.version;
      if ((skipUpdateVersion && skipUpdateVersion === info.version) || postponed) {
        set({ status: "idle", info: null });
        return;
      }

      set({
        status: "available",
        info,
        dialogOpen: true,
        downloaded: 0,
        contentLength: null,
        installed: false,
      });
    } catch (e) {
      // Silent checks must never surface a startup error to the user — an
      // offline machine is a perfectly normal state for a local-first app.
      set({ status: silent ? "idle" : "error", error: silent ? null : String(e), info: null });
    }
  },

  install: async () => {
    if (!get().info) return;
    set({ status: "downloading", downloaded: 0, contentLength: null, error: null });
    try {
      await downloadAndInstallUpdate(({ downloaded, contentLength }) =>
        set({ downloaded, contentLength })
      );
      set({ status: "installing", installed: true });
      // The user already asked for the update, so relaunching into it is the
      // expected continuation — no second confirmation. Never resolves.
      await restartApp();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  restart: async () => {
    try {
      await restartApp();
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  openDialog: () => set({ dialogOpen: true }),

  remindNextLaunch: () => {
    const { info } = get();
    set({ dialogOpen: false, status: "idle", deferredVersion: info?.version ?? null });
  },

  skipVersion: (version) => {
    useSettingsStore.getState().setSkipUpdateVersion(version);
    set({ dialogOpen: false, status: "idle" });
  },
}));
