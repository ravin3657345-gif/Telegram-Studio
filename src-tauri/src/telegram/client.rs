use reqwest::Client;
use serde::Serialize;
use crate::telegram::types::TelegramResponse;

#[derive(Debug, thiserror::Error)]
pub enum TelegramError {
    #[error("Ошибка сети: {0}")]
    Network(String),
    #[error("Ошибка Telegram API: {0}")]
    Api(String),
    #[error("Ошибка разбора ответа: {0}")]
    Parse(String),
    #[error("Пустой ответ от Telegram API")]
    EmptyResult,
    #[error("Ошибка декодирования файла: {0}")]
    Base64(String),
    #[error("Ошибка сериализации: {0}")]
    Json(String),
}

impl From<TelegramError> for String {
    fn from(e: TelegramError) -> Self {
        e.to_string()
    }
}

pub struct TelegramClient {
    token: String,
    base_url: String,
    http: Client,
}

impl TelegramClient {
    pub fn new(token: impl Into<String>) -> Self {
        let token = token.into();
        // Never log the token or full base_url.
        let base_url = format!("https://api.telegram.org/bot{}", token);
        let http = Client::builder()
            // Если до Telegram не достучаться (блокировка/нет прокси) — падаем
            // за 15с с понятной ошибкой, а не висим весь request-таймаут.
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(90))
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { token, base_url, http }
    }

    pub async fn call<T, B>(&self, method: &str, body: &B) -> Result<T, TelegramError>
    where
        T: for<'de> serde::Deserialize<'de>,
        B: Serialize,
    {
        let url = format!("{}/{}", self.base_url, method);
        log::debug!("[tg] POST {} (json)", method);

        let resp = self
            .http
            .post(&url)
            .json(body)
            .send()
            .await
            .map_err(|e| TelegramError::Network(self.redact(e.to_string())))?;

        let status = resp.status();
        let body_text = resp.text().await.map_err(|e| TelegramError::Network(self.redact(e.to_string())))?;

        log::debug!("[tg] response ({}) status={} ok={}", method, status, status.is_success());

        let tg: TelegramResponse<T> = serde_json::from_str(&body_text)
            .map_err(|e| TelegramError::Parse(format!("{}: response body omitted", e)))?;

        if tg.ok {
            tg.result.ok_or(TelegramError::EmptyResult)
        } else {
            Err(TelegramError::Api(
                tg.description.unwrap_or_else(|| "Unknown error".to_string()),
            ))
        }
    }

    pub async fn call_multipart<T>(
        &self,
        method: &str,
        form: reqwest::multipart::Form,
    ) -> Result<T, TelegramError>
    where
        T: for<'de> serde::Deserialize<'de>,
    {
        let url = format!("{}/{}", self.base_url, method);
        log::debug!("[tg] POST {} (multipart)", method);

        let resp = self
            .http
            .post(&url)
            .multipart(form)
            .send()
            .await
            .map_err(|e| TelegramError::Network(self.redact(e.to_string())))?;

        let status = resp.status();
        let body = resp.text().await.map_err(|e| TelegramError::Network(self.redact(e.to_string())))?;

        log::debug!("[tg] response ({}) status={} ok={}", method, status, status.is_success());

        let tg: TelegramResponse<T> = serde_json::from_str(&body)
            .map_err(|e| TelegramError::Parse(format!("{}: response body omitted", e)))?;

        if tg.ok {
            tg.result.ok_or(TelegramError::EmptyResult)
        } else {
            Err(TelegramError::Api(
                tg.description.unwrap_or_else(|| "Unknown error".to_string()),
            ))
        }
    }

    /// Strips the bot token out of a Display'd error message. reqwest's
    /// `Error::to_string()` appends " for url (...)" for request/connection
    /// errors (confirmed in the vendored reqwest-0.12.28/src/error.rs:268),
    /// and `base_url` embeds the token — so an ordinary network blip
    /// (Telegram unreachable, timeout, DNS failure) would otherwise leak the
    /// token straight into the returned error string, which callers persist
    /// verbatim in `publication_history`/`scheduled_posts.error_message` and
    /// display in the UI.
    fn redact(&self, msg: String) -> String {
        if self.token.is_empty() {
            msg
        } else {
            msg.replace(&self.token, "***")
        }
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }
}
