//! Внешний хостинг изображений для rich-сообщений Telegram.
//!
//! Telegram не скачивает медиа со своего же `api.telegram.org/file/...`, а
//! `<img>` в rich-сообщении принимает только публичные HTTP/HTTPS URL. Поэтому
//! фото заливается на публичный хостинг, а Telegram затем перехостит картинку
//! на свой CDN (исходная ссылка в опубликованном посте не сохраняется).
//!
//! Используется litterbox.catbox.moe — временное хранилище без регистрации.
//! Файлы живут 24 часа, чего достаточно: Telegram скачает картинку сразу при
//! sendRichMessage и перехостит на свой CDN.

const LITTERBOX_API: &str = "https://litterbox.catbox.moe/resources/internals/api.php";
const USER_AGENT: &str = "TElega-POST/1.0";

/// Загрузить файл на litterbox.catbox.moe и вернуть публичный URL.
pub async fn upload_file(bytes: Vec<u8>, mime_type: &str, file_name: &str) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name.to_string())
        .mime_str(mime_type)
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new()
        .text("reqtype", "fileupload")
        .text("time", "24h")
        .part("fileToUpload", part);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(LITTERBOX_API)
        .header("User-Agent", USER_AGENT)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("litterbox network: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("litterbox HTTP {}: {}", status, text.trim()));
    }

    let url = text.trim().to_string();
    if !url.starts_with("https://") {
        return Err(format!("litterbox: неожиданный ответ: {}", url));
    }
    Ok(url)
}

/// Обратная совместимость — загрузить JPEG.
pub async fn upload_image(jpeg_bytes: Vec<u8>) -> Result<String, String> {
    upload_file(jpeg_bytes, "image/jpeg", "photo.jpg").await
}
