//! Maps the server's TOML [`Config`] to the driver's primitive constructor
//! args, and returns a `Box<dyn PrinterBackend>` ready to hand to the queue
//! worker. Kept in the server (not the driver) because it's the only place
//! that knows the config schema.

use crate::config::Config;
use printer_driver::{
    MockBackend, MockControls, MockOpts, PrinterBackend, TcpBackend, TcpTimeouts, UsbBackend,
    UsbOpts,
};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// Build the configured backend. For the mock, also returns the shared
/// [`MockControls`] handle so the `/debug/mock` route can inject faults.
pub fn make_backend(cfg: &Config) -> (Box<dyn PrinterBackend>, Option<Arc<MockControls>>) {
    make_backend_with(cfg, None)
}

/// Like [`make_backend`], but reuses an existing mock-controls handle when one
/// is provided. The worker supervisor uses this so `/debug/mock` stays valid
/// after it recreates the backend on a restart. Ignored for the TCP and USB
/// backends.
pub fn make_backend_with(
    cfg: &Config,
    existing: Option<Arc<MockControls>>,
) -> (Box<dyn PrinterBackend>, Option<Arc<MockControls>>) {
    match cfg.backend.as_str() {
        "tcp" => {
            let timeouts = TcpTimeouts {
                connect: Duration::from_millis(cfg.printer.connect_timeout_ms),
                response: Duration::from_millis(cfg.printer.response_timeout_ms),
                print: Duration::from_millis(cfg.printer.print_timeout_ms),
            };
            (
                Box::new(TcpBackend::new(
                    cfg.printer.host.clone(),
                    cfg.printer.port,
                    timeouts,
                )),
                None,
            )
        }
        "usb" => (Box::new(UsbBackend::new(usb_opts(cfg))), None),
        _ => {
            let controls = existing.unwrap_or_else(|| {
                MockControls::new(cfg.mock.force_no_media, cfg.mock.force_awaiting_removal)
            });
            let opts = MockOpts {
                out_dir: PathBuf::from(&cfg.mock.out_dir),
                print_delay: Duration::from_millis(cfg.mock.print_ms),
                cut_delay: Duration::from_millis(cfg.mock.cut_ms),
                tape_width_mm: cfg.mock.tape_width_mm,
            };
            let backend = MockBackend::new(opts, controls.clone());
            (Box::new(backend), Some(controls))
        }
    }
}

/// Driver options for the USB backend. The `[usb]` strings are checked by
/// `Config::validate` at load, so the fallbacks here only cover a config that
/// skipped validation.
pub fn usb_opts(cfg: &Config) -> UsbOpts {
    let defaults = UsbOpts::default();
    UsbOpts {
        vendor_id: cfg.usb.vendor_id().unwrap_or(defaults.vendor_id),
        product_id: cfg.usb.product_id().unwrap_or(defaults.product_id),
        serial: cfg.usb.serial(),
        read_mode: cfg.usb.read_mode().unwrap_or(defaults.read_mode),
        cut_trigger: cfg.usb.cut_trigger().unwrap_or(defaults.cut_trigger),
        hold_interface: cfg.usb.hold_interface,
        connect_timeout: Duration::from_millis(cfg.printer.connect_timeout_ms),
        response_timeout: Duration::from_millis(cfg.printer.response_timeout_ms),
        print_timeout: Duration::from_millis(cfg.printer.print_timeout_ms),
        write_only_print: Duration::from_millis(cfg.usb.write_only_print_ms),
    }
}
