//! Generic types exposed by the driver. Nothing here knows about print queues,
//! HTTP APIs, or job metadata: those live in the consuming application.

use serde::{Deserialize, Serialize};

/// Current printer state (last-known snapshot).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrinterState {
    Idle,
    Busy,
    Printing,
    Feeding,
    Cutting,
    AwaitingRemoval,
    NoMedia,
    Sleeping,
    #[default]
    Unknown,
}

impl PrinterState {
    /// True when the printer is ready to accept the next job.
    pub fn is_ready(self) -> bool {
        matches!(self, PrinterState::Idle)
    }
}

/// Static-ish printer info from `/config.xml`.
#[derive(Debug, Clone, Default)]
pub struct PrinterConfigInfo {
    pub tape_width_mm: Option<f32>,
    pub model: Option<String>,
    pub serial: Option<String>,
    pub cassette_type: Option<String>,
    pub tape_length_mm: Option<f32>,
}

/// Lean status snapshot returned by [`crate::PrinterBackend::get_status`]. The
/// driver fills in what it can read from the printer (state + tape/model
/// fields the backend has cached from `get_config`); connection telemetry
/// (reachable, last-seen timestamps, failure counters) is the caller's
/// responsibility.
#[derive(Debug, Clone, Default)]
pub struct PrinterHealth {
    pub state: PrinterState,
    pub print_job_error: Option<String>,
    pub tape_remaining_mm: Option<f32>,
    pub tape_width_mm: Option<f32>,
    pub model: Option<String>,
    pub serial: Option<String>,
}

/// Print quality mode. Maps to the `<mode>/<speed>/<lpi>` triple in the
/// `<print>` command.
#[derive(Debug, Clone, Copy)]
pub enum PrintMode {
    Vivid,
    Normal,
}

impl PrintMode {
    /// Returns `(mode, speed, lpi)` exactly as the printer expects them.
    pub fn xml(self) -> (&'static str, u8, u16) {
        match self {
            PrintMode::Vivid => ("vivid", 0, 317),
            PrintMode::Normal => ("color", 1, 264),
        }
    }
}

/// Cut behavior after a print.
#[derive(Debug, Clone, Copy)]
pub enum CutMode {
    Full,
    Half,
    None,
}

impl CutMode {
    pub fn xml(self) -> &'static str {
        match self {
            CutMode::Full => "full",
            CutMode::Half => "half",
            CutMode::None => "none",
        }
    }
}

/// Options for one print. `img_w`/`img_h` of 0 mean "let the printer autofit".
#[derive(Debug, Clone, Copy)]
pub struct PrintOpts {
    pub mode: PrintMode,
    pub cut: CutMode,
    pub img_w: u32,
    pub img_h: u32,
}
