pub mod backup;
pub mod commands;
pub mod crypto;
pub mod db;
pub mod fs;
pub mod image_utils;
pub mod rate_limit;
pub mod scheduler;
pub mod telegram;

use db::AppState;
use rate_limit::RateLimiter;
// The system tray is a desktop-only concept — `tauri::menu`/`tauri::tray` don't
// exist at all on mobile targets (gated `#[cfg(desktop)]` inside tauri itself).
#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .level_for("tauri", log::LevelFilter::Warn)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                ])
                .build(),
        )
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");

            std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

            let media_dir = app_dir.join("media");
            std::fs::create_dir_all(&media_dir).expect("failed to create media dir");

            let db_path = app_dir.join("telegram-studio.db");
            let conn = rusqlite::Connection::open(&db_path)
                .expect("failed to open database");

            db::migrations::run(&conn).expect("failed to run migrations");

            // Daily consistent snapshot — cheap no-op on every launch after the
            // first one today. Never blocks startup on failure (logs only).
            backup::maybe_backup(&conn, &app_dir);

            app.manage(AppState {
                db: std::sync::Mutex::new(conn),
                app_dir,
            });

            // Rate limiter: max 5 bot token validations per 60 seconds
            app.manage(RateLimiter::new(5, 60));

            // Запускаем планировщик отложенных публикаций
            scheduler::start(app.handle().clone());

            // ── Системный трей (только десктоп — на мобильных трея нет) ────────
            #[cfg(desktop)]
            {
                let show_item = MenuItem::with_id(app, "show", "Открыть", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

                let mut tray_builder = TrayIconBuilder::new();
                // Icon is optional — a missing icon must not crash startup.
                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }
                tray_builder
                    .tooltip("Telegram Studio")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        // Левый клик по иконке — показать окно
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }

            Ok(())
        })
        // Закрытие окна → скрыть в трей, не завершать процесс
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::bots::validate_bot_token,
            commands::bots::get_bots,
            commands::bots::reveal_bot_token,
            commands::bots::add_bot,
            commands::bots::delete_bot,
            commands::channels::get_channels,
            commands::channels::add_channel,
            commands::channels::delete_channel,
            commands::channels::update_channel_bot,
            commands::drafts::get_drafts,
            commands::drafts::get_draft,
            commands::drafts::upsert_draft,
            commands::drafts::delete_draft,
            commands::settings::get_settings,
            commands::settings::update_setting,
            commands::publish::publish_post,
            commands::publish::schedule_post,
            commands::publish::get_scheduled_posts,
            commands::publish::cancel_scheduled_post,
            commands::publish::update_scheduled_post_content,
            commands::publish::publish_rich_post,
            commands::publish::republish_rich_post,
            commands::publish::schedule_rich_post,
            commands::publish::send_poll,
            commands::templates::get_templates,
            commands::templates::get_template,
            commands::templates::save_template,
            commands::templates::delete_template,
            commands::templates::record_template_use,
            commands::snippets::get_snippets,
            commands::snippets::save_snippet,
            commands::snippets::delete_snippet,
            commands::history::get_history,
            commands::history::schedule_post_delete,
            commands::history::edit_published_post,
            commands::history::get_history_for_edit,
            commands::dashboard::get_channel_dashboard,
            commands::dashboard::get_today_stats,
            commands::license::get_license_status,
            commands::license::activate_license,
            commands::winbypass::enable_windows_bypass,
            commands::winbypass::windows_bypass_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
