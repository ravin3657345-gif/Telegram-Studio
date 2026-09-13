//! Single-instance guard.
//!
//! Two copies of Telegram Studio must never run at once. Each copy starts its
//! own 60-second scheduler tick over the *same* SQLite file, so both would
//! select the same `status='pending'` rows and publish the same scheduled
//! post twice — a duplicate that is impossible to take back once it is in the
//! channel. Two copies also mean two tray icons, two autosave writers racing
//! on one draft, and two updaters fighting over the same installer.
//!
//! Whichever copy starts second therefore does not start at all: it hands the
//! user back to the window that is already running and exits before touching
//! the database.
//!
//! Implemented without third-party crates (there is no network access to
//! crates.io in this environment, and the whole mechanism is small anyway):
//!
//! * Windows — a named kernel mutex, the canonical single-instance primitive.
//!   `CreateMutexW` reports `ERROR_ALREADY_EXISTS` when the object already
//!   exists, which is exactly the signal we need, and the OS frees the mutex
//!   when the process dies, so a crash can never leave a stale lock behind.
//!   To bring the running window forward we locate it by title with
//!   `FindWindowW` and restore/show it — a second, freshly-launched process is
//!   allowed to hand foreground focus to another window.
//! * macOS/Linux — binding a fixed loopback port is the portable equivalent:
//!   the port is released by the OS on exit, so there is no stale-lock case.
//! * Android — no-op: a phone launches one activity, and there is no
//!   competing desktop window to activate.
//!
//! Only desktop builds enforce this; see `run()` in `lib.rs` for the call site.

/// Outcome of the single-instance check.
pub enum Outcome {
    /// No other copy is running — this process owns the lock and should start.
    Primary,
    /// Another copy is already running; it has been brought to the front and
    /// this process must exit immediately without doing any real work.
    AlreadyRunning,
}

#[cfg(desktop)]
pub fn acquire() -> Outcome {
    imp::acquire()
}

#[cfg(desktop)]
#[cfg(not(windows))]
pub fn set_app_handle(app: tauri::AppHandle) {
    imp::set_app_handle(app)
}

/// No-op on Windows (window activation there goes through `FindWindowW`) and
/// on Android (nothing to activate). Exists so the call site in `lib.rs` does
/// not need its own `cfg` maze.
#[cfg(any(windows, mobile))]
pub fn set_app_handle(_app: tauri::AppHandle) {}

#[cfg(mobile)]
pub fn acquire() -> Outcome {
    Outcome::Primary
}

// ─────────────────────────────────────────────────────────────────────────────
// Windows: named mutex + window activation
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
mod imp {
    use super::Outcome;
    use std::sync::atomic::{AtomicIsize, Ordering};

    const ERROR_ALREADY_EXISTS: u32 = 183;
    /// `Local\` scopes the mutex to the current logon session, which is what a
    /// desktop app wants: two different Windows users may each run their own
    /// copy, but one user must not run two.
    const MUTEX_NAME: &str = "Local\\TelegramStudio.SingleInstance.v1";
    /// Must match `app.windows[0].title` in tauri.conf.json. It is never
    /// changed at runtime (there is no `setTitle` call anywhere), so the
    /// lookup is stable.
    const WINDOW_TITLE: &str = "Telegram Studio";

    const SW_SHOW: i32 = 5;
    const SW_RESTORE: i32 = 9;

    /// Holds the mutex handle for the lifetime of the process. Kept in a
    /// static so it is never dropped: releasing it would unlock the guard
    /// while the app is still running, letting a second copy start.
    static MUTEX: AtomicIsize = AtomicIsize::new(0);

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(
            lp_mutex_attributes: *mut core::ffi::c_void,
            b_initial_owner: i32,
            lp_name: *const u16,
        ) -> isize;
        fn GetLastError() -> u32;
        fn SetLastError(dw_err_code: u32);
    }

    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(lp_class_name: *const u16, lp_window_name: *const u16) -> isize;
        fn ShowWindow(h_wnd: isize, n_cmd_show: i32) -> i32;
        fn SetForegroundWindow(h_wnd: isize) -> i32;
        fn IsIconic(h_wnd: isize) -> i32;
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn acquire() -> Outcome {
        let name = wide(MUTEX_NAME);

        // GetLastError is only meaningful for the call we just made, so clear
        // it first — otherwise a stale non-zero value from earlier work could
        // be misread as "already exists".
        unsafe { SetLastError(0) };
        let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr()) };
        let err = unsafe { GetLastError() };

        if handle == 0 {
            // Could not create the mutex at all (extremely unlikely). Starting
            // is the lesser evil: refusing to launch would be worse than the
            // duplicate we are trying to prevent.
            log::warn!("[single-instance] CreateMutexW failed (error {err}); starting without a guard");
            return Outcome::Primary;
        }

        if err == ERROR_ALREADY_EXISTS {
            activate_existing();
            // Do not touch MUTEX: we never owned it.
            return Outcome::AlreadyRunning;
        }

        MUTEX.store(handle, Ordering::SeqCst);
        Outcome::Primary
    }

    /// Brings the already-running window to the front. Best-effort by design:
    /// Windows may refuse the focus change, and even then the user is better
    /// off than with a second, competing copy.
    fn activate_existing() {
        let title = wide(WINDOW_TITLE);
        let hwnd = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
        if hwnd == 0 {
            log::info!("[single-instance] another copy is running, but its window was not found");
            return;
        }
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            } else {
                ShowWindow(hwnd, SW_SHOW);
            }
            SetForegroundWindow(hwnd);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// macOS / Linux: loopback port lock
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(all(desktop, not(windows)))]
mod imp {
    use super::Outcome;
    use std::io::Write;
    use std::net::{TcpListener, TcpStream};

    /// Uncommon high port, used only as an exclusive lock token.
    const PORT: u16 = 49_217;

    /// Keeps the listener alive for the process lifetime — the socket *is* the
    /// lock, so dropping it would release the guard.
    static LISTENER: std::sync::OnceLock<TcpListener> = std::sync::OnceLock::new();

    /// The running window, published by `set_app_handle` during setup. The
    /// activation request arrives on a plain std thread (it cannot wait for
    /// Tauri's runtime), so it needs its own way back into the app.
    static APP: std::sync::Mutex<Option<tauri::AppHandle>> = std::sync::Mutex::new(None);

    pub fn acquire() -> Outcome {
        match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(listener) => {
                // Called once, before the app is built, so `set` never loses.
                let _ = LISTENER.set(listener);
                serve();
                Outcome::Primary
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                // Port busy: almost certainly the other copy. Poke it so it can
                // raise its window, then step aside.
                if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", PORT)) {
                    let _ = stream.write_all(b"activate");
                }
                Outcome::AlreadyRunning
            }
            Err(e) => {
                log::warn!("[single-instance] could not bind lock port: {e}");
                Outcome::Primary
            }
        }
    }

    pub fn set_app_handle(app: tauri::AppHandle) {
        if let Ok(mut slot) = APP.lock() {
            *slot = Some(app);
        }
    }

    /// Accepts activation requests on the lock port for the process lifetime.
    /// The peer only ever announces itself and exits, so there is nothing to
    /// send back — the connection itself is the signal.
    fn serve() {
        let Some(listener) = LISTENER.get() else { return };
        let listener = listener.try_clone();
        let Ok(listener) = listener else { return };
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if stream.is_err() {
                    continue;
                }
                raise_window();
            }
        });
    }

    fn raise_window() {
        use tauri::Manager;
        let Ok(slot) = APP.lock() else { return };
        if let Some(app) = slot.as_ref() {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }
    }
}
