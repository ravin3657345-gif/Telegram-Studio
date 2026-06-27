use reqwest::Client;
use serde::Deserialize;

fn client() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("failed to build HTTP client")
}

#[derive(Debug, Deserialize)]
struct TelegraphResponse<T> {
    ok: bool,
    result: Option<T>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TelegraphAccount {
    pub access_token: String,
}

#[derive(Debug, Deserialize)]
pub struct TelegraphPage {
    pub url: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
struct UploadResult {
    src: String,
}

pub async fn create_account(short_name: &str) -> Result<TelegraphAccount, String> {
    let resp: TelegraphResponse<TelegraphAccount> = client()
        .post("https://api.telegra.ph/createAccount")
        .json(&serde_json::json!({
            "short_name": short_name,
            "author_name": short_name,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    if resp.ok {
        resp.result.ok_or_else(|| "Пустой ответ Telegraph".to_string())
    } else {
        Err(resp.error.unwrap_or_else(|| "Ошибка Telegraph API".to_string()))
    }
}

pub async fn upload_image(
    bytes: Vec<u8>,
    _mime_type: &str,
    file_name: &str,
) -> Result<String, String> {
    // Telegraph accepts JPEG/GIF reliably; PNG with alpha/ICC often rejected → force JPEG.
    let (bytes, mime_type, _file_name) = crate::image_utils::normalize_to_jpeg(bytes, file_name)?;

    #[cfg(debug_assertions)]
    eprintln!("[telegraph] uploading image as {} ({} bytes)", mime_type, bytes.len());

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("photo.jpg".to_string())
        .mime_str("image/jpeg")
        .map_err(|e| e.to_string())?;

    let form = reqwest::multipart::Form::new().part("file", part);

    let response = client()
        .post("https://telegra.ph/upload")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36")
        .header("Origin", "https://telegra.ph")
        .header("Referer", "https://telegra.ph/")
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Telegraph upload: сетевая ошибка: {}", e))?;

    let status = response.status();

    #[cfg(debug_assertions)]
    eprintln!("[telegraph] upload status={}", status);

    let text = response
        .text()
        .await
        .map_err(|e| format!("Telegraph upload: ошибка чтения ответа: {}", e))?;

    // Success: [{"src": "/file/..."}]
    if let Ok(results) = serde_json::from_str::<Vec<UploadResult>>(&text) {
        let src = results
            .into_iter()
            .next()
            .ok_or_else(|| "Telegraph upload: пустой массив".to_string())?
            .src;
        return Ok(if src.starts_with("http") {
            src
        } else {
            format!("https://telegra.ph{}", src)
        });
    }

    // Error: {"error": "..."} or plain text
    #[derive(Deserialize)]
    struct ErrResp { error: String }
    if let Ok(err) = serde_json::from_str::<ErrResp>(&text) {
        return Err(format!("Telegraph upload: {}", err.error));
    }

    Err(format!(
        "Telegraph upload: HTTP {}, ответ: {}",
        status,
        &text[..text.len().min(200)]
    ))
}

pub async fn create_page(
    access_token: &str,
    title: &str,
    content: serde_json::Value,
) -> Result<TelegraphPage, String> {
    let response = client()
        .post("https://api.telegra.ph/createPage")
        .json(&serde_json::json!({
            "access_token": access_token,
            "title": title,
            "content": content,
            "return_content": false,
        }))
        .send()
        .await
        .map_err(|e| format!("Telegraph createPage: сетевая ошибка: {}", e))?;

    let text = response
        .text()
        .await
        .map_err(|e| format!("Telegraph createPage: ошибка чтения ответа: {}", e))?;

    let resp: TelegraphResponse<TelegraphPage> = serde_json::from_str(&text)
        .map_err(|e| format!("Telegraph createPage: парсинг ответа: {}", e))?;

    if resp.ok {
        resp.result.ok_or_else(|| "Telegraph createPage: пустой result".to_string())
    } else {
        Err(resp.error.unwrap_or_else(|| "Telegraph createPage: неизвестная ошибка".to_string()))
    }
}
