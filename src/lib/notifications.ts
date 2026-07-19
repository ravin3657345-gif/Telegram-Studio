import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

// tauri-plugin-notification was declared and initialized (lib.rs) but never
// actually called anywhere in this app before this — same dead-dependency
// shape the project already had once with tauri-plugin-updater (see
// [[project-android-port]]; that one crashed the app via transitive init,
// this one was just inert). The Rust side (scheduler/mod.rs) now fires
// real notifications for scheduled-post outcomes, but Android won't
// deliver them at all without the user having granted permission first —
// this is the one-time request for that, called once at app startup
// (AppShell.tsx) alongside the existing bots/channels/drafts fetch.
export async function ensureNotificationPermission(): Promise<void> {
  try {
    const granted = await isPermissionGranted();
    if (!granted) await requestPermission();
  } catch {
    // Desktop platforms without a notification permission model, or any
    // other environment where the plugin's commands aren't available —
    // never worth surfacing to the user, scheduled-post outcomes are still
    // fully visible in the app itself (History/Drafts) either way.
  }
}
