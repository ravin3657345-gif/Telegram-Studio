// In-app updates: on launch the app asks the update endpoint (Supabase Edge
// Function, see scripts/publish-update.ps1) whether a newer build exists, and
// offers to install it — "сейчас" downloads + installs + relaunches, "позже"
// keeps quiet until the next launch (that preference lives on the JS side).
//
// Desktop-only for a hard reason: tauri-plugin-updater has no mobile
// implementation, and initializing it unconditionally is what crashed this app
// on startup the first time an updater was attempted (see the note in
// src/lib/notifications.ts). The plugin is therefore both declared and
// initialized under `#[cfg(desktop)]` (Cargo.toml target section + lib.rs).
//
// The commands themselves still exist on every target, because
// `tauri::generate_handler!`'s entry list is not itself conditionally compiled
// per-platform — same always-compiling-wrapper pattern as commands/winbypass.rs.
// On Android they do the honest thing: report that in-app updates aren't
// available there (the frontend then just opens the download link).

use serde::Serialize;

#[cfg(desktop)]
use tauri::Manager; // try_state() lives on the Manager trait
#[cfg(desktop)]
use tauri_plugin_updater::UpdaterExt;

/// Holds the update found by `check_for_update` until the user actually decides
/// to install it: the plugin's `Update` value carries the download URL and
/// signature, so re-checking at install time would be a second pointless
/// network round-trip (and a race — the endpoint could start serving a
/// different build in between).
///
/// Accessed through `try_state` rather than `State` everywhere: on Android this
/// is never managed, and extracting a non-managed `State` panics before the
/// command body (where the `#[cfg]` guard would have caught it) ever runs.
#[cfg(desktop)]
#[derive(Default)]
pub struct PendingUpdate(pub std::sync::Mutex<Option<tauri_plugin_updater::Update>>);

/// What the frontend needs to render the "доступно обновление" dialog.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    /// Release notes from the manifest (`body` in the plugin's terms).
    pub notes: Option<String>,
    pub date: Option<String>,
}

/// Progress events streamed to the frontend over a `Channel` while the update
/// downloads. Mirrors the shape the plugin's own JS API uses
/// (`{ event, data }`) so the frontend handling looks familiar.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum UpdateDownloadEvent {
    /// Sent once, on the first chunk, so the UI can show "12 из 15 МБ".
    Started { content_length: Option<u64> },
    /// Cumulative byte count — the UI never has to sum chunks itself.
    Progress { downloaded: u64 },
    /// Download finished; installation (nsis/msi) is about to start.
    Finished,
}

/// Asks the configured update endpoints whether a newer build exists. Returns
/// `Ok(None)` for "already up to date" and for every platform where the plugin
/// doesn't exist — the frontend treats both the same way ("ничего не показывать").
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    #[cfg(desktop)]
    {
        let state = app
            .try_state::<PendingUpdate>()
            .ok_or_else(|| "Updater не инициализирован".to_string())?;

        let update = app
            .updater()
            .map_err(|e| e.to_string())?
            .check()
            .await
            .map_err(|e| e.to_string())?;

        let Some(update) = update else {
            // Previously-found update is gone (rolled back / endpoint changed).
            *state.0.lock().map_err(|e| e.to_string())? = None;
            return Ok(None);
        };

        let info = UpdateInfo {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            notes: update.body.clone(),
            date: update.date.as_ref().map(|d| d.to_string()),
        };

        *state.0.lock().map_err(|e| e.to_string())? = Some(update);
        Ok(Some(info))
    }

    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(None)
    }
}

/// Downloads and installs the update found by `check_for_update`.
/// On Windows this shells out to the NSIS installer and waits for it to finish;
/// on macOS it swaps the .app bundle. Either way the app must be restarted
/// afterwards (`restart_app`) — this command deliberately does not do it, so
/// the UI can show "Установлено" before the process goes away.
#[tauri::command]
pub async fn download_and_install_update(
    app: tauri::AppHandle,
    on_event: tauri::ipc::Channel<UpdateDownloadEvent>,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let state = app
            .try_state::<PendingUpdate>()
            .ok_or_else(|| "Updater не инициализирован".to_string())?;

        // take(), not clone: installing consumes the update, and a second
        // install of the same pending update would be meaningless.
        let update = state
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .take()
            .ok_or_else(|| "Обновление не найдено — проверьте ещё раз".to_string())?;

        let progress = on_event.clone();
        let finished = on_event.clone();
        let mut downloaded: u64 = 0;
        let mut started = false;

        update
            .download_and_install(
                move |chunk_length, content_length| {
                    downloaded += chunk_length as u64;
                    if !started {
                        started = true;
                        let _ = progress.send(UpdateDownloadEvent::Started { content_length });
                    }
                    let _ = progress.send(UpdateDownloadEvent::Progress { downloaded });
                },
                move || {
                    let _ = finished.send(UpdateDownloadEvent::Finished);
                },
            )
            .await
            .map_err(|e| e.to_string())
    }

    #[cfg(not(desktop))]
    {
        let _ = (app, on_event);
        Err("Обновление в приложении доступно только на компьютере".to_string())
    }
}

/// Restarts the app onto the freshly installed build. Never returns on desktop
/// (`restart()` diverges after spawning the new process), which is exactly why
/// the frontend calls it as the last step of the update flow.
#[tauri::command]
pub async fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        app.restart()
    }

    #[cfg(not(desktop))]
    {
        let _ = app;
        Err("Перезапуск для обновления доступен только на компьютере".to_string())
    }
}
