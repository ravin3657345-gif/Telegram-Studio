//! Pure retry/backoff decision logic for scheduled Telegram publishing.
//! Kept dependency-light so it can be unit tested without Tauri linkage.

/// Substrings (checked case-insensitively) that indicate a *permanent*,
/// bot/channel-specific failure — retrying with the same bot won't help, but
/// a different bot might (e.g. one that wasn't kicked from the channel).
const PERMANENT_ERROR_MARKERS: &[&str] = &[
    "unauthorized",
    "forbidden",
    "chat not found",
    "bot was kicked",
    "not a member",
    "have no rights",
    "not enough rights",
    "peer_id_invalid",
    "bad request: chat_id",
    "invalid token",
];

/// True if `msg` looks like a permanent (bot/permission) failure rather than
/// a transient network/API issue (timeout, 5xx, connection reset, flood wait).
pub fn is_permanent_telegram_error(msg: &str) -> bool {
    let lower = msg.to_lowercase();
    PERMANENT_ERROR_MARKERS.iter().any(|m| lower.contains(m))
}

/// Parses the `retry_after` hint Telegram embeds in 429 ("Too Many Requests")
/// error descriptions, e.g. `"Too Many Requests: retry after 30"` → `Some(30)`.
///
/// Telegram also sends this as a structured `parameters.retry_after` field,
/// but by the time an error reaches call sites it's already been flattened to
/// a display string — so we parse it back out here rather than threading a
/// new field through every Telegram API call site.
pub fn parse_retry_after_secs(msg: &str) -> Option<u64> {
    let lower = msg.to_lowercase();
    let idx = lower.find("retry after")?;
    let rest = lower[idx + "retry after".len()..].trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        None
    } else {
        digits.parse().ok()
    }
}

/// What the scheduler should do with a post after a transient send failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryDecision {
    /// Leave the post pending — retry on a later scheduler tick.
    RetryLater { retry_count: i64 },
    /// Retry budget exhausted — mark the post permanently failed.
    GiveUp { attempts: i64 },
}

/// Decide what to do after a transient failure, given how many transient
/// attempts have already been made and the configured retry budget.
///
/// `max_retries` must be >= 1; a `prev_retry_count` at or above it always
/// gives up (defensive — handles a budget lowered after upgrade).
pub fn next_retry_decision(prev_retry_count: i64, max_retries: i64) -> RetryDecision {
    let new_count = prev_retry_count + 1;
    if new_count >= max_retries {
        RetryDecision::GiveUp { attempts: new_count }
    } else {
        RetryDecision::RetryLater { retry_count: new_count }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_permanent_errors_case_insensitively() {
        assert!(is_permanent_telegram_error("Forbidden: bot was kicked from the group chat"));
        assert!(is_permanent_telegram_error("UNAUTHORIZED"));
        assert!(is_permanent_telegram_error("Bad Request: chat not found"));
        assert!(is_permanent_telegram_error("bot is not a member of the channel chat"));
        assert!(is_permanent_telegram_error("Forbidden: have no rights to send a message"));
    }

    #[test]
    fn treats_network_and_server_errors_as_transient() {
        assert!(!is_permanent_telegram_error("error sending request: connection reset"));
        assert!(!is_permanent_telegram_error("operation timed out"));
        assert!(!is_permanent_telegram_error("Internal Server Error"));
        assert!(!is_permanent_telegram_error("Too Many Requests: retry after 30"));
        assert!(!is_permanent_telegram_error("dns error: failed to lookup address"));
    }

    #[test]
    fn empty_message_is_transient() {
        assert!(!is_permanent_telegram_error(""));
    }

    #[test]
    fn retries_while_under_budget() {
        assert_eq!(
            next_retry_decision(0, 5),
            RetryDecision::RetryLater { retry_count: 1 }
        );
        assert_eq!(
            next_retry_decision(3, 5),
            RetryDecision::RetryLater { retry_count: 4 }
        );
    }

    #[test]
    fn gives_up_once_budget_is_reached() {
        assert_eq!(
            next_retry_decision(4, 5),
            RetryDecision::GiveUp { attempts: 5 }
        );
    }

    #[test]
    fn gives_up_immediately_if_already_over_budget() {
        // Defensive case: e.g. MAX_RETRIES lowered after an upgrade.
        assert_eq!(
            next_retry_decision(10, 5),
            RetryDecision::GiveUp { attempts: 11 }
        );
    }

    #[test]
    fn a_max_of_one_never_retries() {
        assert_eq!(
            next_retry_decision(0, 1),
            RetryDecision::GiveUp { attempts: 1 }
        );
    }

    #[test]
    fn detects_the_additional_permanent_markers() {
        assert!(is_permanent_telegram_error("Forbidden: not enough rights to send text messages"));
        assert!(is_permanent_telegram_error("Bad Request: PEER_ID_INVALID"));
        assert!(is_permanent_telegram_error("Bad Request: chat_id is empty"));
        assert!(is_permanent_telegram_error("Unauthorized: invalid token"));
    }

    #[test]
    fn parses_retry_after_from_telegram_description() {
        assert_eq!(
            parse_retry_after_secs("Too Many Requests: retry after 30"),
            Some(30)
        );
        assert_eq!(
            parse_retry_after_secs("Ошибка Telegram API: Too Many Requests: retry after 5"),
            Some(5)
        );
    }

    #[test]
    fn parse_retry_after_is_case_insensitive() {
        assert_eq!(parse_retry_after_secs("RETRY AFTER 12"), Some(12));
    }

    #[test]
    fn parse_retry_after_returns_none_when_absent() {
        assert_eq!(parse_retry_after_secs("Internal Server Error"), None);
        assert_eq!(parse_retry_after_secs(""), None);
    }

    #[test]
    fn parse_retry_after_returns_none_for_malformed_number() {
        assert_eq!(parse_retry_after_secs("Too Many Requests: retry after soon"), None);
        assert_eq!(parse_retry_after_secs("Too Many Requests: retry after"), None);
    }
}
