//! Printer backends. Consumers talk only to the [`PrinterBackend`] trait, so
//! the mock and the real TCP implementation are interchangeable behind a
//! `Box<dyn PrinterBackend>`.

pub mod mock;
pub mod protocol;
pub mod tcp;

use crate::error::PrinterError;
use crate::types::{PrintOpts, PrinterConfigInfo, PrinterHealth};
use async_trait::async_trait;

pub use mock::{MockBackend, MockControls, MockOpts};
pub use tcp::{TcpBackend, TcpTimeouts};

/// A printer backend. Connection lifecycle is explicit because the VC-500W's
/// cut is triggered by closing the socket. The caller must do
/// `send_print` → `close_for_cut` → reconnect → poll, so the backend cannot
/// hide connect/close behind each call.
#[async_trait]
pub trait PrinterBackend: Send {
    /// Ensure a usable connection. Idempotent; a no-op for the mock.
    async fn connect(&mut self) -> Result<(), PrinterError>;

    /// Read `/config.xml` (tape width, model, serial, …).
    async fn get_config(&mut self) -> Result<PrinterConfigInfo, PrinterError>;

    /// Read `/status.xml` and map it to a health snapshot.
    async fn get_status(&mut self) -> Result<PrinterHealth, PrinterError>;

    /// Send the `<print>` command + JPEG bytes and await both acks. Returns
    /// `Ok` once the printer reports "print data received". MUST NOT close the
    /// connection. Closing triggers the cut prematurely; the caller owns
    /// that step via [`close_for_cut`].
    async fn send_print(&mut self, jpeg: &[u8], opts: &PrintOpts) -> Result<(), PrinterError>;

    /// Close the connection to trigger the physical cut.
    async fn close_for_cut(&mut self) -> Result<(), PrinterError>;
}
