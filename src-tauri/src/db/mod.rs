pub mod migrations;
pub mod models;
pub mod queries;

use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub app_dir: PathBuf,
}
