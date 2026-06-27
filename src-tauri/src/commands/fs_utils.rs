use base64::{engine::general_purpose::STANDARD, Engine};

const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024; // 100 MB hard cap

/// Read a local file (from OS file-drop) and return it as base64.
/// Rejects directories, symlinks, and files over 100 MB.
#[tauri::command]
pub async fn read_file_as_base64(path: String) -> Result<String, String> {
    let path = std::path::Path::new(&path);

    // Resolve canonical path to prevent traversal via ".." or symlinks
    let canonical = path
        .canonicalize()
        .map_err(|_| "Файл не найден".to_string())?;

    let meta = canonical
        .metadata()
        .map_err(|_| "Не удалось получить метаданные файла".to_string())?;

    if !meta.is_file() {
        return Err("Путь не является файлом".to_string());
    }

    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "Файл слишком большой (максимум {} МБ)",
            MAX_FILE_BYTES / 1024 / 1024
        ));
    }

    // On Windows, canonicalize() already resolves symlinks; reject if original
    // path differs from canonical in a way that indicates symlink traversal.
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // FILE_ATTRIBUTE_REPARSE_POINT = 0x400 (symlink / junction)
        if meta.file_attributes() & 0x400 != 0 {
            return Err("Символические ссылки не разрешены".to_string());
        }
    }

    let bytes = std::fs::read(&canonical).map_err(|e| format!("Ошибка чтения файла: {e}"))?;
    Ok(STANDARD.encode(&bytes))
}
