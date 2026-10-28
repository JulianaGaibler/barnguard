//! Rust driver for the Brother VC-500W label printer.
//!
//! Use-case agnostic: this crate knows how to talk to the printer over its
//! XML protocol (on TCP or USB) and nothing about queues, HTTP APIs, or job
//! metadata. See [`PrinterBackend`] for the async trait every backend
//! implements, and [`TcpBackend`] / [`UsbBackend`] / [`MockBackend`] for the
//! shipping implementations.

pub mod backend;
pub mod error;
pub mod types;

/// Re-export of the wire-protocol builders and framing parser so external
/// tooling and tests can reach them without knowing the internal module layout.
pub use backend::protocol;
pub use backend::{
    MockBackend, MockControls, MockOpts, PrinterBackend, TcpBackend, TcpTimeouts, UsbBackend,
    UsbCutTrigger, UsbOpts, UsbReadMode,
};
pub use error::PrinterError;
pub use types::{CutMode, PrintMode, PrintOpts, PrinterConfigInfo, PrinterHealth, PrinterState};
