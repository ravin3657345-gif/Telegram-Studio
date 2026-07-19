use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::{Method, Request};
use reqwest::Client;
use serde::Serialize;
use crate::telegram::fragmented::send_via_fragmented;
use crate::telegram::form::TgForm;
use crate::telegram::types::TelegramResponse;

// Each of the 4 call paths (direct/fragmented × json/multipart) gets its own
// hard bound via tokio::time::timeout, not just reqwest's own Client-level
// connect_timeout/timeout on the direct path. Two real gaps this closes:
// 1. connect_timeout only covers the TCP handshake — SNI-based DPI blocking
//    typically lets TCP connect fine and then silently drops everything
//    after the ClientHello, which falls through to the *overall* 90s
//    timeout instead of failing fast the way the original comment on
//    `new()` assumed.
// 2. The fragmented path (fragmented.rs) had NO timeout at all before this —
//    if fragmentation doesn't actually defeat a given DPI setup (unproven,
//    see fragmented.rs's module doc), that attempt could hang forever with
//    nothing left to fall back to. A live test surfaced exactly this: it
//    "hung" rather than failing, until a VPN was turned on by hand.
const JSON_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(15);
// Multipart bodies can be up to Telegram's own 50MB cap — needs more
// headroom than a json call, but still a hard bound instead of none.
const MULTIPART_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(45);

/// Shared by all four call paths below (direct/fragmented × json/multipart)
/// — was duplicated inline in `call`/`call_multipart` before the fragmented
/// fallback existed; duplicating it a third and fourth time wasn't worth it.
fn finish_response<T>(body_text: &str) -> Result<T, TelegramError>
where
    T: for<'de> serde::Deserialize<'de>,
{
    let tg: TelegramResponse<T> = serde_json::from_str(body_text)
        .map_err(|e| TelegramError::Parse(format!("{e}: response body omitted")))?;

    if tg.ok {
        tg.result.ok_or(TelegramError::EmptyResult)
    } else {
        Err(TelegramError::Api(
            tg.description.unwrap_or_else(|| "Unknown error".to_string()),
        ))
    }
}

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

    /// Direct path first; on a NETWORK failure only (not a valid-but-negative
    /// Telegram API response, which retrying over a different transport
    /// can't fix) falls back to a hand-rolled connection with a fragmented
    /// TLS ClientHello — see fragmented.rs's module doc for why. Anywhere
    /// outside Russia, or anywhere the direct path already works, this
    /// fallback never triggers at all.
    /// Runs `fut` under a hard deadline — a plain `TelegramError::Network` on
    /// expiry, same as any other connection failure, so callers (`call`/
    /// `call_multipart`) don't need to know or care whether a given attempt
    /// failed outright or just never finished.
    async fn with_timeout<T>(
        &self,
        dur: Duration,
        label: &str,
        fut: impl std::future::Future<Output = Result<T, TelegramError>>,
    ) -> Result<T, TelegramError> {
        match tokio::time::timeout(dur, fut).await {
            Ok(result) => result,
            Err(_) => Err(TelegramError::Network(
                self.redact(format!("{label} timed out after {}s", dur.as_secs())),
            )),
        }
    }

    pub async fn call<T, B>(&self, method: &str, body: &B) -> Result<T, TelegramError>
    where
        T: for<'de> serde::Deserialize<'de>,
        B: Serialize,
    {
        match self
            .with_timeout(JSON_ATTEMPT_TIMEOUT, "direct connection", self.call_direct(method, body))
            .await
        {
            Err(TelegramError::Network(_)) => {
                log::debug!("[tg] {method} failed over direct connection, retrying with a fragmented TLS handshake");
                self.with_timeout(
                    JSON_ATTEMPT_TIMEOUT,
                    "fragmented TLS handshake",
                    self.call_fragmented(method, body),
                )
                .await
            }
            other => other,
        }
    }

    async fn call_direct<T, B>(&self, method: &str, body: &B) -> Result<T, TelegramError>
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
        finish_response(&body_text)
    }

    async fn call_fragmented<T, B>(&self, method: &str, body: &B) -> Result<T, TelegramError>
    where
        T: for<'de> serde::Deserialize<'de>,
        B: Serialize,
    {
        let json_bytes = serde_json::to_vec(body).map_err(|e| TelegramError::Json(e.to_string()))?;
        let path = format!("/bot{}/{}", self.token, method);

        let req = Request::builder()
            .method(Method::POST)
            .uri(&path)
            .header("Host", "api.telegram.org")
            .header("Content-Type", "application/json")
            .body(Full::new(Bytes::from(json_bytes)))
            .map_err(|e| TelegramError::Network(self.redact(e.to_string())))?;

        let resp = send_via_fragmented("api.telegram.org", 443, req)
            .await
            .map_err(|e| TelegramError::Network(self.redact(e.to_string())))?;

        let status = resp.status();
        let body_bytes = resp
            .into_body()
            .collect()
            .await
            .map_err(|e| TelegramError::Network(self.redact(e.to_string())))?
            .to_bytes();
        let body_text = String::from_utf8_lossy(&body_bytes).into_owned();

        log::debug!("[tg-fragmented] response ({method}) status={status}");
        finish_response(&body_text)
    }

    pub async fn call_multipart<T>(&self, method: &str, form: TgForm) -> Result<T, TelegramError>
    where
        T: for<'de> serde::Deserialize<'de>,
    {
        match self
            .with_timeout(MULTIPART_ATTEMPT_TIMEOUT, "direct connection", self.call_multipart_direct(method, &form))
            .await
        {
            Err(TelegramError::Network(_)) => {
                log::debug!("[tg] {method} multipart failed over direct connection, retrying with a fragmented TLS handshake");
                self.with_timeout(
                    MULTIPART_ATTEMPT_TIMEOUT,
                    "fragmented TLS handshake",
                    self.call_multipart_fragmented(method, &form),
                )
                .await
            }
            other => other,
        }
    }

    async fn call_multipart_direct<T>(&self, method: &str, form: &TgForm) -> Result<T, TelegramError>
    where
        T: for<'de> serde::Deserialize<'de>,
    {
        let url = format!("{}/{}", self.base_url, method);
        log::debug!("[tg] POST {} (multipart)", method);

        let resp = self
            .http
            .post(&url)
            .multipart(form.into_reqwest()?)
            .send()
            .await
            .map_err(|e| TelegramError::Network(self.redact(e.to_string())))?;

        let status = resp.status();
        let body = resp.text().await.map_err(|e| TelegramError::Network(self.redact(e.to_string())))?;

        log::debug!("[tg] response ({}) status={} ok={}", method, status, status.is_success());
        finish_response(&body)
    }

    async fn call_multipart_fragmented<T>(&self, method: &str, form: &TgForm) -> Result<T, TelegramError>
    where
        T: for<'de> serde::Deserialize<'de>,
    {
        let boundary = format!("----tgform-{}", uuid::Uuid::new_v4());
        let body_bytes = form.encode_raw(&boundary);
        let path = format!("/bot{}/{}", self.token, method);

        let req = Request::builder()
            .method(Method::POST)
            .uri(&path)
            .header("Host", "api.telegram.org")
            .header("Content-Type", format!("multipart/form-data; boundary={boundary}"))
            .body(Full::new(Bytes::from(body_bytes)))
            .map_err(|e| TelegramError::Network(self.redact(e.to_string())))?;

        let resp = send_via_fragmented("api.telegram.org", 443, req)
            .await
            .map_err(|e| TelegramError::Network(self.redact(e.to_string())))?;

        let status = resp.status();
        let body_bytes = resp
            .into_body()
            .collect()
            .await
            .map_err(|e| TelegramError::Network(self.redact(e.to_string())))?
            .to_bytes();
        let body_text = String::from_utf8_lossy(&body_bytes).into_owned();

        log::debug!("[tg-fragmented] response ({method}) status={status}");
        finish_response(&body_text)
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
