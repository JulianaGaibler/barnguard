//! In-memory message log: a bounded ring buffer of curated, operator-facing
//! entries. Each entry is broadcast to SSE subscribers (so the attendant panel
//! updates live) and mirrored to `tracing` (so it also lands in stderr /
//! journald for durable, post-mortem review).

use crate::events::EventHub;
use crate::types::{now_ms, LogEntry, LogLevel, ServerEvent};
use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

/// Cloneable handle to the shared log ring + broadcast hub.
#[derive(Clone)]
pub struct LogHub {
    buf: Arc<Mutex<VecDeque<LogEntry>>>,
    cap: usize,
    events: EventHub,
}

impl LogHub {
    pub fn new(cap: usize, events: EventHub) -> Self {
        let cap = cap.max(1);
        Self {
            buf: Arc::new(Mutex::new(VecDeque::with_capacity(cap.min(1024)))),
            cap,
            events,
        }
    }

    /// Append an entry (evicting the oldest past `cap`), broadcast it, and mirror
    /// to `tracing`. Blocking lock; safe on the normal (non-panicking) path.
    pub fn push(&self, level: LogLevel, source: &str, message: impl Into<String>) {
        let entry = LogEntry {
            ts_ms: now_ms(),
            level,
            source: source.to_string(),
            message: message.into(),
        };
        self.mirror_tracing(&entry);
        if let Ok(mut b) = self.buf.lock() {
            b.push_back(entry.clone());
            while b.len() > self.cap {
                b.pop_front();
            }
        }
        self.events.publish(ServerEvent::Log(entry));
    }

    pub fn info(&self, source: &str, message: impl Into<String>) {
        self.push(LogLevel::Info, source, message);
    }
    pub fn warn(&self, source: &str, message: impl Into<String>) {
        self.push(LogLevel::Warn, source, message);
    }
    pub fn error(&self, source: &str, message: impl Into<String>) {
        self.push(LogLevel::Error, source, message);
    }

    /// Buffered entries, oldest → newest. Used for the SSE backfill on connect
    /// and `GET /api/printer/log`.
    pub fn snapshot(&self) -> Vec<LogEntry> {
        self.buf
            .lock()
            .map(|b| b.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Record a message from a panic hook. Uses `try_lock` so it can NEVER
    /// deadlock if the panicking thread was already holding the buffer lock;
    /// falls back to stderr. Still attempts the broadcast (a separate lock).
    pub fn record_panic(&self, message: String) {
        let entry = LogEntry {
            ts_ms: now_ms(),
            level: LogLevel::Error,
            source: "panic".to_string(),
            message,
        };
        match self.buf.try_lock() {
            Ok(mut b) => {
                b.push_back(entry.clone());
                while b.len() > self.cap {
                    b.pop_front();
                }
            }
            Err(_) => {
                eprintln!("[panic-hook] log buffer busy; message: {}", entry.message);
            }
        }
        self.events.publish(ServerEvent::Log(entry));
    }

    fn mirror_tracing(&self, e: &LogEntry) {
        match e.level {
            LogLevel::Info => tracing::info!(source = %e.source, "{}", e.message),
            LogLevel::Warn => tracing::warn!(source = %e.source, "{}", e.message),
            LogLevel::Error => tracing::error!(source = %e.source, "{}", e.message),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::LogLevel;

    #[test]
    fn ring_evicts_oldest_past_cap() {
        let hub = LogHub::new(3, EventHub::new(16));
        for i in 0..5 {
            hub.info("test", format!("m{i}"));
        }
        let snap = hub.snapshot();
        assert_eq!(snap.len(), 3);
        assert_eq!(snap.first().unwrap().message, "m2"); // oldest kept
        assert_eq!(snap.last().unwrap().message, "m4"); // newest
    }

    #[test]
    fn record_panic_appends_error() {
        let hub = LogHub::new(10, EventHub::new(16));
        hub.record_panic("boom".into());
        let snap = hub.snapshot();
        assert_eq!(snap.len(), 1);
        assert!(matches!(snap[0].level, LogLevel::Error));
        assert_eq!(snap[0].source, "panic");
    }
}
