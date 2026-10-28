//! Printer backends. Consumers talk only to the [`PrinterBackend`] trait, so
//! the mock and the real TCP implementation are interchangeable behind a
//! `Box<dyn PrinterBackend>`.

pub mod mock;
pub mod protocol;
pub mod tcp;
pub mod usb;

use crate::error::PrinterError;
use crate::types::{PrintOpts, PrinterConfigInfo, PrinterHealth, PrinterState};
use async_trait::async_trait;

pub use mock::{MockBackend, MockControls, MockOpts};
pub use tcp::{TcpBackend, TcpTimeouts};
pub use usb::{UsbBackend, UsbCutTrigger, UsbOpts, UsbReadMode};

/// Fields from the last successful `/config.xml` read. Status reads don't
/// carry tape width, model or serial, so the real backends cache them here and
/// stamp them onto every health snapshot.
#[derive(Debug, Clone, Default)]
pub(crate) struct ConfigCache {
    width_mm: Option<f32>,
    model: Option<String>,
    serial: Option<String>,
}

impl ConfigCache {
    /// Keep any field `info` carries; leave the rest as they were.
    pub(crate) fn update(&mut self, info: &PrinterConfigInfo) {
        if info.tape_width_mm.is_some() {
            self.width_mm = info.tape_width_mm;
        }
        if info.model.is_some() {
            self.model = info.model.clone();
        }
        if info.serial.is_some() {
            self.serial = info.serial.clone();
        }
    }

    /// A health snapshot in `state` carrying the cached fields.
    pub(crate) fn health(&self, state: PrinterState) -> PrinterHealth {
        PrinterHealth {
            state,
            tape_width_mm: self.width_mm,
            model: self.model.clone(),
            serial: self.serial.clone(),
            ..PrinterHealth::default()
        }
    }
}

/// A printer backend. Connection lifecycle is explicit because the VC-500W's
/// cut is triggered by closing the socket. The caller must do
/// `send_print` -> `close_for_cut` -> reconnect -> poll, so the backend cannot
/// hide connect/close behind each call.
#[async_trait]
pub trait PrinterBackend: Send {
    /// Ensure a usable connection. Idempotent, and a no-op for the mock.
    async fn connect(&mut self) -> Result<(), PrinterError>;

    /// Read `/config.xml` (tape width, model, serial, …).
    async fn get_config(&mut self) -> Result<PrinterConfigInfo, PrinterError>;

    /// Read `/status.xml` and map it to a health snapshot.
    async fn get_status(&mut self) -> Result<PrinterHealth, PrinterError>;

    /// Send the `<print>` command + JPEG bytes and await both acks. Returns
    /// `Ok` once the printer reports "print data received". MUST NOT close the
    /// connection. Closing triggers the cut prematurely. The caller owns that
    /// step via [`close_for_cut`].
    async fn send_print(&mut self, jpeg: &[u8], opts: &PrintOpts) -> Result<(), PrinterError>;

    /// Close the connection to trigger the physical cut.
    async fn close_for_cut(&mut self) -> Result<(), PrinterError>;
}
