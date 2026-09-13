import { Channel, invoke } from "@tauri-apps/api/core";

// Typed wrappers over the Rust updater commands (commands/app_updates.rs).
// Everything the desktop plugin can't do (Android) reports "up to date" /
// throws a clear error instead — see isInAppUpdateSupported below.

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  /** Release notes from the update manifest, if the build shipped them. */
  notes: string | null;
  date: string | null;
}

/** Mirrors the Rust UpdateDownloadEvent enum's `{ event, data }` wire shape. */
type UpdateDownloadEvent =
  | { event: "started"; data: { contentLength: number | null } }
  | { event: "progress"; data: { downloaded: number } }
  | { event: "finished"; data?: undefined };

export interface UpdateProgress {
  /** Bytes downloaded so far. */
  downloaded: number;
  /** Total size, once the server has told us — null before the first chunk. */
  contentLength: number | null;
}

/**
 * In-app update is a desktop concept only: the Tauri updater plugin has no
 * mobile implementation at all (and initializing it on Android is what crashed
 * the app once already). On phones the same check still runs, but the answer is
 * always "no update" so the UI falls back to a plain download link.
 */
export const isInAppUpdateSupported = (): boolean =>
  typeof navigator === "undefined" || !/Android|iPhone|iPad/i.test(navigator.userAgent);

/** Returns the newer build, or null when up to date / unsupported platform. */
export const checkForUpdate = (): Promise<UpdateInfo | null> =>
  invoke("check_for_update");

/**
 * Downloads and installs the pending update. The caller is responsible for
 * restarting afterwards (restartApp) — installation alone leaves the running
 * process on the old build until then.
 */
export async function downloadAndInstallUpdate(
  onProgress: (progress: UpdateProgress) => void
): Promise<void> {
  const channel = new Channel<UpdateDownloadEvent>();
  let contentLength: number | null = null;

  channel.onmessage = (message) => {
    if (message.event === "started") {
      contentLength = message.data.contentLength;
      onProgress({ downloaded: 0, contentLength });
    } else if (message.event === "progress") {
      onProgress({ downloaded: message.data.downloaded, contentLength });
    }
  };

  await invoke("download_and_install_update", { onEvent: channel });
}

/** Relaunches into the installed build. Never resolves on desktop. */
export const restartApp = (): Promise<void> => invoke("restart_app");
