pub mod commands;
pub mod crypto;
pub mod db;
pub mod fs;
pub mod hosting;
pub mod image_utils;
pub mod rate_limit;
pub mod scheduler;
pub mod telegram;
pub mod telegraph;

use db::AppState;
use rate_limit::RateLimiter;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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

            app.manage(AppState {
                db: std::sync::Mutex::new(conn),
                app_dir,
            });

            app.manage(commands::telegraph::TelegraphWebviewState::default());

            // Rate limiter: max 5 bot token validations per 60 seconds
            app.manage(RateLimiter::new(5, 60));

            // Запускаем планировщик отложенных публикаций
            scheduler::start(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bots::validate_bot_token,
            commands::bots::get_bots,
            commands::bots::add_bot,
            commands::bots::delete_bot,
            commands::channels::get_channels,
            commands::channels::add_channel,
            commands::channels::delete_channel,
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
            commands::publish::publish_rich_post,
            commands::publish::send_poll,
            commands::telegraph::telegraph_publish,
            commands::telegraph::telegraph_webview_result,
            commands::telegraph::telegraph_open_login,
            commands::templates::get_templates,
            commands::templates::save_template,
            commands::templates::delete_template,
            commands::history::get_history,
            commands::history::schedule_post_delete,
            commands::history::edit_published_post,
            commands::history::get_history_for_edit,
            commands::dashboard::get_channel_dashboard,
            commands::fs_utils::read_file_as_base64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
