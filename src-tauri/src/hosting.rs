//! Внешний хостинг изображений для rich-сообщений Telegram.
//!
//! Telegram не скачивает медиа со своего же `api.telegram.org/file/...`, а
//! `<img>` в rich-сообщении принимает только публичные HTTP/HTTPS URL. Поэтому
//! фото заливается на публичный хостинг, а Telegram затем перехостит картинку
//! на свой CDN (исходная ссылка в опубликованном посте не сохраняется).
//!
//! Основной хостинг — litterbox.catbox.moe (временное хранилище без
//! регистрации, файлы живут 24 часа — этого достаточно, Telegram скачивает
//! картинку сразу при sendRichMessage). При его отказе используется uguu.se —
//! независимый сервис на другой инфраструктуре, чтобы сбой одного хоста не
//! ронял все фото в посте. (0x0.st рассматривался, но отключил анонимную
//! загрузку насовсем из-за спама ботов — проверено вручную, не работает.)

const LITTERBOX_API: &str = "https://litterbox.catbox.moe/resources/internals/api.php";
const UGUU_API: &str = "https://uguu.se/upload";
const USER_AGENT: &str = "TElega-POST/1.0";

/// True if `url_str` is `https://` and its host is exactly `domain` or a
/// subdomain of it — e.g. `host_matches_domain(url, "uguu.se")` accepts both
/// `d.uguu.se` and `n.uguu.se` (uguu.se spreads uploads across several
/// subdomains by file type) without accepting an unrelated host like
/// `uguu.se.evil.com` or `evil.com/?uguu.se`.
fn host_matches_domain(url_str: &str, domain: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url_str) else { return false };
    if parsed.scheme() != "https" {
        return false;
    }
    match parsed.host_str() {
        Some(host) => host == domain || host.ends_with(&format!(".{domain}")),
        None => false,
    }
}

/// Загрузить файл на публичный хостинг и вернуть публичный URL.
/// Пробует litterbox.catbox.moe первым, при отказе — uguu.se.
pub async fn upload_file(bytes: Vec<u8>, mime_type: &str, file_name: &str) -> Result<String, String> {
    match upload_to_litterbox(bytes.clone(), mime_type, file_name).await {
        Ok(url) => Ok(url),
        Err(primary_err) => {
            log::warn!("[hosting] litterbox failed, trying fallback host uguu.se: {}", primary_err);
            upload_to_uguu(bytes, mime_type, file_name)
                .await
                .map_err(|fallback_err| format!("{primary_err}; uguu.se: {fallback_err}"))
        }
    }
}

async fn upload_to_litterbox(bytes: Vec<u8>, mime_type: &str, file_name: &str) -> Result<String, String> {
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
    // Accept any catbox.moe subdomain to prevent SSRF via Telegram
    if !host_matches_domain(&url, "catbox.moe") {
        return Err(format!("litterbox: неожиданный URL хоста: {}", url));
    }
    Ok(url)
}

async fn upload_to_uguu(bytes: Vec<u8>, mime_type: &str, file_name: &str) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name.to_string())
        .mime_str(mime_type)
        .map_err(|e| e.to_string())?;

    // uguu.se expects a PHP-style array field name for the file part.
    let form = reqwest::multipart::Form::new().part("files[]", part);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(UGUU_API)
        .header("User-Agent", USER_AGENT)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("uguu.se network: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(format!("uguu.se HTTP {}: {}", status, text.trim()));
    }

    #[derive(serde::Deserialize)]
    struct UguuFile { url: String }
    #[derive(serde::Deserialize)]
    struct UguuResponse { success: bool, files: Option<Vec<UguuFile>> }

    let parsed: UguuResponse = serde_json::from_str(&text)
        .map_err(|e| format!("uguu.se: не удалось разобрать ответ ({e}): {}", text.trim()))?;

    let url = parsed
        .files
        .filter(|_| parsed.success)
        .and_then(|files| files.into_iter().next())
        .map(|f| f.url)
        .ok_or_else(|| format!("uguu.se: сервис не вернул файл: {}", text.trim()))?;

    // Accept any uguu.se subdomain to prevent SSRF via Telegram — uguu.se
    // spreads uploads across several (d., n., ... by file type), not just "d."
    if !host_matches_domain(&url, "uguu.se") {
        return Err(format!("uguu.se: неожиданный URL хоста: {}", url));
    }
    Ok(url)
}

/// Обратная совместимость — загрузить JPEG.
pub async fn upload_image(jpeg_bytes: Vec<u8>) -> Result<String, String> {
    upload_file(jpeg_bytes, "image/jpeg", "photo.jpg").await
}
