use thiserror::Error;

/// Errors from talking to a printer backend (mock or TCP). The `NoMedia` and
/// `NotReady` variants are distinct so the queue worker can abort *before*
/// streaming JPEG bytes and surface a clear "load tape" state instead of
/// retrying pointlessly.
#[derive(Debug, Error)]
pub enum PrinterError {
    #[error("no media loaded")]
    NoMedia,
    #[error("printer not ready (code {0}): {1}")]
    NotReady(i32, String),
    #[error("operation timed out")]
    Timeout,
    #[error("printer disconnected")]
    Disconnected,
    /// The JPEG was fully delivered but the completion ack never came. The
    /// label has most likely printed, so this is not retryable: a retry would
    /// print a duplicate.
    #[error("print data sent but not confirmed: {0}")]
    SentUnconfirmed(String),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl PrinterError {
    /// Whether retrying the whole job might succeed. Media and not-ready
    /// errors are terminal because retrying just spins. Transport errors are
    /// retryable.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            PrinterError::Timeout | PrinterError::Disconnected | PrinterError::Io(_)
        )
    }

    /// Short machine-readable tag stored on a failed job (`error` field).
    pub fn tag(&self) -> String {
        match self {
            PrinterError::NoMedia => "no_media".into(),
            PrinterError::NotReady(code, msg) => format!("printer_error({code}): {msg}"),
            PrinterError::Timeout => "timeout".into(),
            PrinterError::SentUnconfirmed(_) => "sent_unconfirmed".into(),
            PrinterError::Disconnected => "disconnected".into(),
            PrinterError::Protocol(m) => format!("protocol: {m}"),
            PrinterError::Io(e) => format!("io: {e}"),
        }
    }
}
