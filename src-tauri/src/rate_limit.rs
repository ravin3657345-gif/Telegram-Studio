use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct RateLimiter {
    window:   Duration,
    max_hits: usize,
    hits:     Mutex<VecDeque<Instant>>,
}

impl RateLimiter {
    pub fn new(max_hits: usize, window_secs: u64) -> Self {
        Self {
            window: Duration::from_secs(window_secs),
            max_hits,
            hits: Mutex::new(VecDeque::new()),
        }
    }

    /// Returns true if the action is allowed, false if rate-limited.
    pub fn allow(&self) -> bool {
        let mut hits = self.hits.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        // Drop entries outside the window
        while hits.front().map(|t| now.duration_since(*t) > self.window).unwrap_or(false) {
            hits.pop_front();
        }
        if hits.len() >= self.max_hits {
            return false;
        }
        hits.push_back(now);
        true
    }
}
