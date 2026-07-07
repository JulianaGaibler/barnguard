//! Mock backend: simulates the printer's timing and state machine and writes
//! each received JPEG (with a `.json` sidecar) to disk so the full pipeline is
//! testable without hardware. Faults (no-media, awaiting-removal, unreachable)
//! can be injected via [`MockControls`].

use super::PrinterBackend;
use crate::error::PrinterError;
use crate::types::{PrintOpts, PrinterConfigInfo, PrinterHealth, PrinterState};
use async_trait::async_trait;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Live fault switches shared between a running [`MockBackend`] and any
/// controller that wants to nudge it at runtime (e.g. a debug HTTP route).
#[derive(Debug)]
pub struct MockControls {
    force_no_media: AtomicBool,
    force_awaiting_removal: AtomicBool,
    /// The printer is currently holding a printed label in the output slot.
    awaiting_now: AtomicBool,
    /// Simulate an unreachable / powered-off / crashed printer (status polls
    /// error), so the reconnect + telemetry path is demoable without hardware.
    force_unreachable: AtomicBool,
}

impl MockControls {
    pub fn new(force_no_media: bool, force_awaiting_removal: bool) -> Arc<Self> {
        Arc::new(Self {
            force_no_media: AtomicBool::new(force_no_media),
            force_awaiting_removal: AtomicBool::new(force_awaiting_removal),
            awaiting_now: AtomicBool::new(false),
            force_unreachable: AtomicBool::new(false),
        })
    }

    pub fn set_unreachable(&self, v: bool) {
        self.force_unreachable.store(v, Ordering::Relaxed);
    }

    fn unreachable_forced(&self) -> bool {
        self.force_unreachable.load(Ordering::Relaxed)
    }

    pub fn set_no_media(&self, v: bool) {
        self.force_no_media.store(v, Ordering::Relaxed);
    }

    pub fn set_force_awaiting_removal(&self, v: bool) {
        self.force_awaiting_removal.store(v, Ordering::Relaxed);
    }

    /// Simulate the attendant removing the held label.
    pub fn clear_awaiting(&self) {
        self.awaiting_now.store(false, Ordering::Relaxed);
    }

    /// Directly set the "holding a label" state. Used by tests to simulate a
    /// printer that boots already awaiting removal (e.g. after a power loss).
    pub fn set_awaiting_now(&self, v: bool) {
        self.awaiting_now.store(v, Ordering::Relaxed);
    }

    fn no_media(&self) -> bool {
        self.force_no_media.load(Ordering::Relaxed)
    }

    fn awaiting(&self) -> bool {
        self.awaiting_now.load(Ordering::Relaxed)
    }
}

/// Construction-time options for [`MockBackend`]. Provided as primitives so the
/// driver stays independent of any config format.
#[derive(Debug, Clone)]
pub struct MockOpts {
    pub out_dir: PathBuf,
    pub print_delay: Duration,
    pub cut_delay: Duration,
    pub tape_width_mm: f32,
}

#[derive(Serialize)]
struct Sidecar {
    mode: &'static str,
    speed: u8,
    lpi: u16,
    cut_mode: &'static str,
    img_w: u32,
    img_h: u32,
    datasize: usize,
}

pub struct MockBackend {
    out_dir: PathBuf,
    print_delay: Duration,
    cut_delay: Duration,
    tape_width_mm: f32,
    controls: Arc<MockControls>,
    seq: AtomicU64,
}

impl MockBackend {
    pub fn new(opts: MockOpts, controls: Arc<MockControls>) -> Self {
        if let Err(e) = std::fs::create_dir_all(&opts.out_dir) {
            tracing::warn!("mock: could not create out_dir {:?}: {e}", opts.out_dir);
        }
        prune_out_dir(&opts.out_dir, 50);
        Self {
            out_dir: opts.out_dir,
            print_delay: opts.print_delay,
            cut_delay: opts.cut_delay,
            tape_width_mm: opts.tape_width_mm,
            controls,
            seq: AtomicU64::new(0),
        }
    }

    fn state(&self) -> PrinterState {
        if self.controls.no_media() {
            PrinterState::NoMedia
        } else if self.controls.awaiting() {
            PrinterState::AwaitingRemoval
        } else {
            PrinterState::Idle
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[async_trait]
impl PrinterBackend for MockBackend {
    async fn connect(&mut self) -> Result<(), PrinterError> {
        Ok(())
    }

    async fn get_config(&mut self) -> Result<PrinterConfigInfo, PrinterError> {
        let has_media = !self.controls.no_media();
        Ok(PrinterConfigInfo {
            tape_width_mm: has_media.then_some(self.tape_width_mm),
            model: Some("MockVC-500W".into()),
            serial: Some("MOCK00000000".into()),
            cassette_type: has_media.then(|| "1".to_string()),
            tape_length_mm: Some(5000.0),
        })
    }

    async fn get_status(&mut self) -> Result<PrinterHealth, PrinterError> {
        if self.controls.unreachable_forced() {
            return Err(PrinterError::Disconnected);
        }
        let state = self.state();
        Ok(PrinterHealth {
            state,
            print_job_error: (state == PrinterState::NoMedia).then(|| "no_media".to_string()),
            tape_remaining_mm: Some(4500.0),
            tape_width_mm: (state != PrinterState::NoMedia).then_some(self.tape_width_mm),
            model: Some("MockVC-500W".into()),
            serial: Some("MOCK00000000".into()),
        })
    }

    async fn send_print(&mut self, jpeg: &[u8], opts: &PrintOpts) -> Result<(), PrinterError> {
        // Mirror the real "code 3, don't send the image" path.
        if self.controls.no_media() {
            return Err(PrinterError::NoMedia);
        }
        let seq = self.seq.fetch_add(1, Ordering::Relaxed);
        let stem = format!("label-{seq:04}-{}", now_ms());
        let jpg_path = self.out_dir.join(format!("{stem}.jpg"));
        let json_path = self.out_dir.join(format!("{stem}.json"));
        // Small, synchronous writes; fine for a dev mock.
        if let Err(e) = std::fs::write(&jpg_path, jpeg) {
            return Err(PrinterError::Io(e));
        }
        let (mode, speed, lpi) = opts.mode.xml();
        let sidecar = Sidecar {
            mode,
            speed,
            lpi,
            cut_mode: opts.cut.xml(),
            img_w: opts.img_w,
            img_h: opts.img_h,
            datasize: jpeg.len(),
        };
        if let Ok(js) = serde_json::to_vec_pretty(&sidecar) {
            let _ = std::fs::write(&json_path, js);
        }
        tracing::info!("mock: wrote {:?} ({} bytes)", jpg_path, jpeg.len());
        tokio::time::sleep(self.print_delay).await;
        Ok(())
    }

    async fn close_for_cut(&mut self) -> Result<(), PrinterError> {
        tokio::time::sleep(self.cut_delay).await;
        if self.controls.force_awaiting_removal.load(Ordering::Relaxed) {
            self.controls.awaiting_now.store(true, Ordering::Relaxed);
        }
        Ok(())
    }
}

/// Best-effort prune: keep only the newest `keep` `.jpg` files (plus their
/// `.json` sidecars) so a busy dev environment doesn't accumulate thousands.
fn prune_out_dir(dir: &std::path::Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut jpgs: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jpg"))
        .map(|p| {
            let mtime = std::fs::metadata(&p)
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            (mtime, p)
        })
        .collect();
    if jpgs.len() <= keep {
        return;
    }
    jpgs.sort_by_key(|(t, _)| *t);
    let remove = jpgs.len() - keep;
    for (_, path) in jpgs.into_iter().take(remove) {
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("json"));
    }
}
