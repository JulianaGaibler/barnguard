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
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl PrinterError {
    /// Whether retrying the whole job might succeed. Media / not-ready errors
    /// are terminal (retrying just spins); transport errors are retryable.
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
            PrinterError::Disconnected => "disconnected".into(),
            PrinterError::Protocol(m) => format!("protocol: {m}"),
            PrinterError::Io(e) => format!("io: {e}"),
        }
    }
}
