use std::time::Duration;

use reqwest::Client;
use serde::Serialize;
use crate::telegram::form::TgForm;
use crate::telegram::types::TelegramResponse;

// Each of the call paths (direct/relay × json/multipart) gets its own hard
// bound via tokio::time::timeout, not just reqwest's own Client-level
// connect_timeout/timeout on the direct path — connect_timeout only covers
// the TCP handshake, and Russian ISP blocking of api.telegram.org drops the
// connection at the IP+port level (confirmed live via Test-NetConnection),
// which without this would fall through to the *overall* 90s timeout
// instead of failing fast enough to try the relay.
const JSON_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(15);
// Multipart bodies can be up to Telegram's own 50MB cap — needs more
// headroom than a json call, but still a hard bound instead of none.
const MULTIPART_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(45);

// Last-resort fallback: a passthrough Edge Function on the app's own
// Supabase project (same one used for licensing, see
// tstudio_core::license::SUPABASE_URL) that forwards to api.telegram.org
// verbatim. Only reached when the direct path fails with a network error.
// A TLS-ClientHello-fragmentation fallback was tried first but confirmed
// (live, Test-NetConnection) useless here: Russian ISP blocking of
// api.telegram.org is IP+port-level, before TLS even starts, so no amount
// of TLS-layer trickery can ever get past it — the only thing that works is
// not connecting to that IP at all. Supabase's edge network is a different,
// unblocked address, reachable directly with no special transport needed —
// this is a normal reqwest call. Payload size was verified live up to
// 120MB (well past Telegram's own 50MB cap) before wiring this in.
const RELAY_BASE: &str = "https://xhjxnyhvfyzyulzzxpsg.supabase.co/functions/v1/tg-relay";

/// Shared by both call paths below (direct/relay × json/multipart) — was
/// duplicated inline in `call`/`call_multipart` before the relay fallback
/// existed; duplicating it further wasn't worth it.
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

/// `reqwest::Error::to_string()` only prints the top-level "error sending
/// request for url (...)" wrapper — the actually useful cause (connection
/// reset, TLS failure, DNS error, etc.) lives in `.source()` and is dropped
/// silently by a plain `.to_string()`. Walks the full chain so relay
/// failures are debuggable instead of always showing the same opaque
/// one-liner regardless of root cause. Added after a live relay failure
/// (multipart calls to the Supabase relay) that this exact blind spot made
/// impossible to diagnose from the error message alone.
fn describe_reqwest_error(e: &reqwest::Error) -> String {
    use std::error::Error as _;
    let mut parts = vec![e.to_string()];
    let mut cause = e.source();
    while let Some(c) = cause {
        parts.push(c.to_string());
        cause = c.source();
    }
    parts.join(" <- ")
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
    // Separate client for the Supabase relay, kept apart from `http` (whose
    // 15s connect_timeout is deliberately tight to fail fast against
    // api.telegram.org, confirmed blocked at the IP+port level in Russia —
    // too tight for a destination that isn't blocked).
    //
    // Root-caused live 2026-07-20: multipart relay calls (Rich posts with
    // photos) were failing with a bare "connection reset" while json relay
    // calls to the same host kept succeeding — confirmed via
    // `describe_reqwest_error`'s full cause chain (plain `.to_string()` had
    // been swallowing this down to an opaque "error sending request for
    // url"). Root cause: reqwest was reusing a pooled keep-alive connection
    // that Supabase's edge had already closed server-side — json calls are
    // fast enough to usually land before that happens, multipart calls
    // (form assembly takes a beat longer) more often lose the race. Fixed
    // by disabling connection reuse for this client entirely
    // (`pool_max_idle_per_host(0)`) — every relay call opens a fresh
    // connection, trading a bit of latency (this is a fallback path, not
    // the hot path) for not silently racing a server-side idle-close.
    relay_http: Client,
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
        let relay_http = Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .timeout(std::time::Duration::from_secs(90))
            // No pooled keep-alive reuse — see the field doc on
            // `relay_http` for why (avoids racing Supabase's server-side
            // idle-connection close). Didn't fix the multipart-specific
            // "connection reset" on its own — see `.http1_only()` below,
            // which is what actually resolved it.
            .pool_max_idle_per_host(0)
            // Forces HTTP/1.1, skipping ALPN negotiation for h2 (this
            // crate's reqwest is built with the "http2" feature, so
            // negotiating h2 with Supabase's Cloudflare-fronted edge is the
            // default otherwise). Root cause of the multipart-specific
            // "connection reset": small json relay bodies fit in a single
            // HTTP/2 DATA frame and always succeeded; multipart bodies with
            // real image bytes span multiple frames and consistently hit a
            // mid-stream reset — classic HTTP/2 flow-control/stream-reset
            // territory, not something `pool_max_idle_per_host` could touch
            // since it's a stream-level issue, not a connection-reuse one.
            // Confirmed by reproducing the multipart call via curl (schannel,
            // HTTP/1.1 always) from an unrelated, unblocked network: 8/8
            // succeeded there while the app's h2-negotiating client failed
            // consistently from the user's machine. HTTP/1.1 has no framing
            // to trip over for a fallback path that's never high-volume
            // anyway. Live-caught and fixed 2026-07-20.
            .http1_only()
            .build()
            .unwrap_or_else(|_| Client::new());
        Self { token, base_url, http, relay_http }
    }

    /// Direct path first; on a NETWORK failure only (not a valid-but-negative
    /// Telegram API response, which retrying over a different transport
    /// can't fix) falls back to the Supabase relay. Anywhere outside Russia,
    /// or anywhere the direct path already works, this fallback never
    /// triggers at all.
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
        let direct = self
            .with_timeout(JSON_ATTEMPT_TIMEOUT, "direct connection", self.call_direct(method, body))
            .await;
        if !matches!(direct, Err(TelegramError::Network(_))) {
            return direct;
        }
        log::debug!("[tg] {method} failed over direct connection, retrying via Supabase relay");
        self.with_timeout(JSON_ATTEMPT_TIMEOUT, "Supabase relay", self.call_relay(method, body)).await
    }

    async fn call_relay<T, B>(&self, method: &str, body: &B) -> Result<T, TelegramError>
    where
        T: for<'de> serde::Deserialize<'de>,
        B: Serialize,
    {
        let url = format!("{RELAY_BASE}/bot{}/{}", self.token, method);
        log::debug!("[tg-relay] POST {} (json)", method);

        let resp = self
            .relay_http
            .post(&url)
            .header("apikey", tstudio_core::license::SUPABASE_ANON_KEY)
            .header("Authorization", format!("Bearer {}", tstudio_core::license::SUPABASE_ANON_KEY))
            .json(body)
            .send()
            .await
            .map_err(|e| TelegramError::Network(self.redact(describe_reqwest_error(&e))))?;

        let status = resp.status();
        let body_text = resp.text().await.map_err(|e| TelegramError::Network(self.redact(describe_reqwest_error(&e))))?;

        log::debug!("[tg-relay] response ({}) status={}", method, status);
        finish_response(&body_text)
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

    pub async fn call_multipart<T>(&self, method: &str, form: TgForm) -> Result<T, TelegramError>
    where
        T: for<'de> serde::Deserialize<'de>,
    {
        let direct = self
            .with_timeout(MULTIPART_ATTEMPT_TIMEOUT, "direct connection", self.call_multipart_direct(method, &form))
            .await;
        if !matches!(direct, Err(TelegramError::Network(_))) {
            return direct;
        }
        log::debug!("[tg] {method} multipart failed over direct connection, retrying via Supabase relay");
        self.with_timeout(MULTIPART_ATTEMPT_TIMEOUT, "Supabase relay", self.call_multipart_relay(method, &form)).await
    }

    async fn call_multipart_relay<T>(&self, method: &str, form: &TgForm) -> Result<T, TelegramError>
    where
        T: for<'de> serde::Deserialize<'de>,
    {
        let url = format!("{RELAY_BASE}/bot{}/{}", self.token, method);
        log::debug!("[tg-relay] POST {} (multipart)", method);

        let resp = self
            .relay_http
            .post(&url)
            .header("apikey", tstudio_core::license::SUPABASE_ANON_KEY)
            .header("Authorization", format!("Bearer {}", tstudio_core::license::SUPABASE_ANON_KEY))
            .multipart(form.into_reqwest()?)
            .send()
            .await
            .map_err(|e| TelegramError::Network(self.redact(describe_reqwest_error(&e))))?;

        let status = resp.status();
        let body_text = resp.text().await.map_err(|e| TelegramError::Network(self.redact(describe_reqwest_error(&e))))?;

        log::debug!("[tg-relay] response ({}) status={}", method, status);
        finish_response(&body_text)
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
