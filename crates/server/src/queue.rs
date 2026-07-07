//! Print queue + the single worker task that owns the printer backend.
//!
//! Concurrency model: HTTP handlers mutate the shared [`QueueStore`] directly
//! (under its `Mutex`) for enqueue/cancel/reprint/clear: fast, synchronous
//! operations that emit the corresponding SSE event *before* returning, so the
//! stream is always consistent with the HTTP response (no "200 OK but SSE still
//! says printing" race). Only the **worker** touches the backend and drives job
//! progress (Printing/Cutting/Done/…). The `Mutex` serializes the two.

use crate::config::Config;
use crate::events::EventHub;
use crate::log::LogHub;
use crate::types::{
    now_ms, JobMeta, JobState, PrintJob, PrinterStatus, QueueSnapshot, ServerEvent,
};
use printer_driver::{PrintOpts, PrinterBackend, PrinterError, PrinterHealth, PrinterState};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tokio::sync::Notify;
use uuid::Uuid;

/// Max jobs kept in `recent` history. Retained JPEG bytes are bounded by
/// `pending + active + HISTORY_CAP`, so memory can't grow unbounded over a
/// multi-day exhibition.
const HISTORY_CAP: usize = 20;

pub struct QueueStore {
    pending: VecDeque<PrintJob>,
    active: Option<PrintJob>,
    recent: VecDeque<PrintJob>,
    /// Retained JPEG bytes, keyed by job id, for reprint. Dropped when a job is
    /// evicted from `recent`.
    jpegs: HashMap<Uuid, Arc<Vec<u8>>>,
    printer: PrinterStatus,
    /// Connection telemetry, surfaced in the published status.
    failed_attempts: u32,
    unreachable_since_ms: Option<u64>,
}

impl QueueStore {
    pub fn new(printer: PrinterStatus) -> Self {
        Self {
            pending: VecDeque::new(),
            active: None,
            recent: VecDeque::new(),
            jpegs: HashMap::new(),
            printer,
            failed_attempts: 0,
            unreachable_since_ms: None,
        }
    }

    fn snapshot(&self) -> QueueSnapshot {
        QueueSnapshot {
            active: self.active.clone(),
            pending: self.pending.iter().cloned().collect(),
            recent: self.recent.iter().cloned().collect(),
        }
    }

    fn push_recent(&mut self, job: PrintJob) {
        self.recent.push_back(job);
        while self.recent.len() > HISTORY_CAP {
            if let Some(old) = self.recent.pop_front() {
                self.jpegs.remove(&old.id);
            }
        }
    }

    fn find_any(&self, id: Uuid) -> Option<&PrintJob> {
        if let Some(a) = &self.active {
            if a.id == id {
                return Some(a);
            }
        }
        self.pending
            .iter()
            .chain(self.recent.iter())
            .find(|j| j.id == id)
    }
}

/// Outcome of a cancel request.
#[derive(Debug, PartialEq, Eq)]
pub enum CancelOutcome {
    Canceled,
    AlreadyActive,
    NotFound,
}

/// Why a reprint could not be enqueued.
#[derive(Debug, PartialEq, Eq)]
pub enum ReprintError {
    NotFound,
    BytesEvicted,
}

/// Cloneable handle to the queue, shared by the HTTP layer and the worker.
#[derive(Clone)]
pub struct QueueController {
    store: Arc<Mutex<QueueStore>>,
    events: EventHub,
    log: LogHub,
    notify: Arc<Notify>,
}

impl QueueController {
    pub fn new(store: Arc<Mutex<QueueStore>>, events: EventHub, log: LogHub) -> Self {
        Self {
            store,
            events,
            log,
            notify: Arc::new(Notify::new()),
        }
    }

    /// Shared message-log handle (for the worker's free functions).
    pub fn log(&self) -> &LogHub {
        &self.log
    }

    fn lock(&self) -> MutexGuard<'_, QueueStore> {
        // Survive a poisoned lock; a panicked holder shouldn't wedge the booth.
        self.store.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn notified(&self) -> tokio::sync::futures::Notified<'_> {
        self.notify.notified()
    }

    // --- API-facing mutations (called from HTTP handlers) ------------------

    /// Enqueue a new job. Returns its id.
    pub fn enqueue(&self, meta: JobMeta, jpeg: Vec<u8>) -> Uuid {
        let job = PrintJob::new(meta);
        let id = job.id;
        {
            let mut s = self.lock();
            s.jpegs.insert(id, Arc::new(jpeg));
            s.pending.push_back(job.clone());
            self.events.publish(ServerEvent::Job(job));
            self.events.publish(ServerEvent::Queue(s.snapshot()));
        }
        self.notify.notify_one();
        id
    }

    pub fn cancel(&self, id: Uuid) -> CancelOutcome {
        let mut s = self.lock();
        if let Some(pos) = s.pending.iter().position(|j| j.id == id) {
            let mut job = s.pending.remove(pos).expect("index just found");
            job.set_state(JobState::Canceled);
            self.events.publish(ServerEvent::Job(job.clone()));
            s.push_recent(job);
            self.events.publish(ServerEvent::Queue(s.snapshot()));
            CancelOutcome::Canceled
        } else if s.active.as_ref().map(|j| j.id) == Some(id) {
            CancelOutcome::AlreadyActive
        } else {
            CancelOutcome::NotFound
        }
    }

    pub fn reprint(&self, id: Uuid) -> Result<Uuid, ReprintError> {
        let (meta, bytes) = {
            let s = self.lock();
            let job = s.find_any(id).ok_or(ReprintError::NotFound)?;
            let meta = job.meta.clone();
            let bytes = s
                .jpegs
                .get(&id)
                .cloned()
                .ok_or(ReprintError::BytesEvicted)?;
            (meta, bytes)
        };
        let job = PrintJob::new(meta);
        let new_id = job.id;
        {
            let mut s = self.lock();
            s.jpegs.insert(new_id, bytes);
            s.pending.push_back(job.clone());
            self.events.publish(ServerEvent::Job(job));
            self.events.publish(ServerEvent::Queue(s.snapshot()));
        }
        self.notify.notify_one();
        Ok(new_id)
    }

    /// Drop all *queued* jobs (marking them canceled). Never touches the active
    /// job. Returns how many were cleared.
    pub fn clear(&self) -> usize {
        let mut s = self.lock();
        let mut canceled = Vec::new();
        while let Some(mut job) = s.pending.pop_front() {
            job.set_state(JobState::Canceled);
            canceled.push(job);
        }
        let n = canceled.len();
        for job in canceled {
            self.events.publish(ServerEvent::Job(job.clone()));
            s.push_recent(job);
        }
        if n > 0 {
            self.events.publish(ServerEvent::Queue(s.snapshot()));
        }
        n
    }

    // --- Read snapshots -----------------------------------------------------

    pub fn snapshot(&self) -> QueueSnapshot {
        self.lock().snapshot()
    }

    pub fn status(&self) -> PrinterStatus {
        self.lock().printer.clone()
    }

    pub fn queue_len(&self) -> usize {
        self.lock().pending.len()
    }

    pub fn find(&self, id: Uuid) -> Option<PrintJob> {
        self.lock().find_any(id).cloned()
    }

    // --- Worker-side mutations ---------------------------------------------

    /// Move the next pending job into the active slot, if idle. Returns the job
    /// and its retained JPEG bytes.
    fn take_next(&self) -> Option<(PrintJob, Arc<Vec<u8>>)> {
        let mut s = self.lock();
        if s.active.is_some() {
            return None;
        }
        let job = s.pending.pop_front()?;
        let Some(jpeg) = s.jpegs.get(&job.id).cloned() else {
            // Bytes vanished (shouldn't happen); mark failed and skip.
            let mut failed = job;
            failed.set_state(JobState::Failed);
            failed.error = Some("missing_bytes".into());
            self.events.publish(ServerEvent::Job(failed.clone()));
            s.push_recent(failed);
            self.events.publish(ServerEvent::Queue(s.snapshot()));
            return None;
        };
        s.active = Some(job.clone());
        self.events.publish(ServerEvent::Queue(s.snapshot()));
        Some((job, jpeg))
    }

    fn set_active_state(&self, state: JobState) {
        let mut s = self.lock();
        if let Some(job) = s.active.as_mut() {
            if job.state == state {
                return;
            }
            job.set_state(state);
            self.events.publish(ServerEvent::Job(job.clone()));
        }
    }

    fn mark_active_attempt(&self) {
        let mut s = self.lock();
        if let Some(job) = s.active.as_mut() {
            job.attempts += 1;
        }
    }

    fn finish_active(&self, state: JobState, error: Option<String>, warning: Option<String>) {
        let mut s = self.lock();
        if let Some(mut job) = s.active.take() {
            job.set_state(state);
            job.error = error;
            job.warning = warning;
            self.events.publish(ServerEvent::Job(job.clone()));
            // Operator-facing log for terminal outcomes.
            match state {
                JobState::Failed => self.log.error(
                    "print",
                    format!(
                        "print failed: {}",
                        job.error.as_deref().unwrap_or("unknown error")
                    ),
                ),
                JobState::Done => {
                    if let Some(w) = &job.warning {
                        self.log
                            .warn("print", format!("print finished with warning: {w}"));
                    }
                }
                _ => {}
            }
            s.push_recent(job);
            self.events.publish(ServerEvent::Queue(s.snapshot()));
        }
    }

    /// Record the outcome of a status poll and publish a `Status` event. On
    /// success resets the unreachable telemetry; on failure increments the
    /// failed-attempt counter and stamps how long we've been unreachable.
    /// Returns the result so callers can still use `?`.
    fn note_status(
        &self,
        backend: &str,
        result: Result<PrinterHealth, PrinterError>,
    ) -> Result<PrinterStatus, PrinterError> {
        let mut s = self.lock();
        match result {
            Ok(health) => {
                // `unreachable_since_ms` is set only after a real failure, so it
                // distinguishes a genuine recovery from the first boot poll.
                let recovered = s.unreachable_since_ms.is_some();
                s.failed_attempts = 0;
                s.unreachable_since_ms = None;
                let st = PrinterStatus::from_health(health, backend);
                s.printer = st.clone();
                self.events.publish(ServerEvent::Status(st.clone()));
                if recovered {
                    self.log.info("printer", "printer reachable again");
                }
                Ok(st)
            }
            Err(e) => {
                let first_failure = s.failed_attempts == 0;
                s.failed_attempts = s.failed_attempts.saturating_add(1);
                s.unreachable_since_ms.get_or_insert_with(now_ms);
                let mut st = PrinterStatus::unknown(backend);
                // Connection refused typically means the printer went to sleep.
                st.state = PrinterState::Sleeping;
                st.print_job_error = Some(e.tag());
                st.failed_attempts = s.failed_attempts;
                st.unreachable_since_ms = s.unreachable_since_ms;
                s.printer = st.clone();
                self.events.publish(ServerEvent::Status(st));
                // Log only the transition into unreachable, not every failed poll.
                if first_failure {
                    self.log
                        .warn("printer", format!("printer unreachable: {}", e.tag()));
                }
                Err(e)
            }
        }
    }

    /// Wake the idle worker to attempt an immediate reconnect + status poll,
    /// instead of waiting for the next keep-alive tick. Backs the attendant
    /// panel's "Reconnect" button.
    pub fn request_reconnect(&self) {
        self.notify.notify_one();
    }
}

/// Timing / options snapshot handed to the worker.
#[derive(Clone)]
pub struct WorkerConfig {
    pub print_opts: PrintOpts,
    pub cut_wait: Duration,
    pub poll_interval: Duration,
    pub idle_timeout: Duration,
    /// Slow idle-poll rate (anti-sleep) when the booth is quiet.
    pub keepalive_interval: Duration,
    /// Fast idle-poll rate while the booth is active.
    pub active_interval: Duration,
    /// How long to stay on the fast rate after the last job.
    pub active_linger: Duration,
    pub reconcile_timeout: Duration,
    pub max_retries: u32,
    pub backend_name: String,
}

impl WorkerConfig {
    pub fn from_config(cfg: &Config) -> Self {
        Self {
            print_opts: cfg.print.opts(),
            cut_wait: Duration::from_millis(cfg.timing.cut_wait_ms),
            poll_interval: Duration::from_millis(cfg.timing.poll_interval_ms),
            idle_timeout: Duration::from_millis(cfg.timing.idle_timeout_ms),
            keepalive_interval: Duration::from_millis(cfg.timing.keepalive_interval_ms),
            active_interval: Duration::from_millis(cfg.timing.active_interval_ms),
            active_linger: Duration::from_millis(cfg.timing.active_linger_ms),
            reconcile_timeout: Duration::from_millis(cfg.timing.idle_timeout_ms.max(30_000)),
            max_retries: cfg.timing.max_retries,
            backend_name: cfg.backend.clone(),
        }
    }
}

/// The worker task. Owns the backend; loops forever draining the queue and
/// keeping the printer awake while idle.
pub async fn run_worker(
    mut backend: Box<dyn PrinterBackend>,
    controller: QueueController,
    cfg: WorkerConfig,
) {
    reconcile(&mut backend, &controller, &cfg).await;

    // Adaptive idle cadence: poll fast for `active_linger` after the last job,
    // then relax to the slow keepalive rate while the booth is quiet.
    let mut last_activity = Instant::now();
    loop {
        if let Some((_, jpeg)) = controller.take_next() {
            process_job(&mut backend, &controller, &cfg, jpeg).await;
            last_activity = Instant::now();
            continue; // drain: check for the next job immediately
        }

        // Idle: keep the printer awake + refresh status, then wait for work.
        keepalive(&mut backend, &controller, &cfg).await;
        let idle_interval = if last_activity.elapsed() < cfg.active_linger {
            cfg.active_interval
        } else {
            cfg.keepalive_interval
        };
        tokio::select! {
            _ = controller.notified() => {}
            _ = tokio::time::sleep(idle_interval) => {}
        }
    }
}

/// On boot: connect, learn tape width (caches it for status), and clear any
/// lingering hardware state (a half-cut label / awaiting-removal after a power
/// loss) before processing any queued job.
async fn reconcile(
    backend: &mut Box<dyn PrinterBackend>,
    controller: &QueueController,
    cfg: &WorkerConfig,
) {
    if let Err(e) = backend.connect().await {
        let _ = controller.note_status(&cfg.backend_name, Err(e));
        return;
    }
    // Populate the tape-width / model cache (TCP status reads don't carry it).
    let _ = backend.get_config().await;

    // Loop ends when note_status returns Err (unreachable) or an arm breaks.
    let start = Instant::now();
    while let Ok(st) = controller.note_status(&cfg.backend_name, backend.get_status().await) {
        match st.state {
            PrinterState::Printing
            | PrinterState::Cutting
            | PrinterState::Feeding
            | PrinterState::Busy
            | PrinterState::AwaitingRemoval => {
                if start.elapsed() > cfg.reconcile_timeout {
                    controller.log().warn(
                        "printer",
                        format!("reconcile: printer still {:?} after timeout", st.state),
                    );
                    break;
                }
                tokio::time::sleep(cfg.poll_interval).await;
            }
            // Idle / NoMedia / Sleeping / Unknown: don't block boot.
            _ => break,
        }
    }
}

/// Idle keep-alive: a single status read to prevent auto-sleep and refresh the
/// published status. Failures mark the printer unreachable.
async fn keepalive(
    backend: &mut Box<dyn PrinterBackend>,
    controller: &QueueController,
    cfg: &WorkerConfig,
) {
    if controller
        .note_status(&cfg.backend_name, backend.get_status().await)
        .is_err()
    {
        // Drop the (likely dead) connection so the next attempt reconnects.
        let _ = backend.close_for_cut().await;
    }
}

/// Run one job through the full FSM, applying the retry policy.
async fn process_job(
    backend: &mut Box<dyn PrinterBackend>,
    controller: &QueueController,
    cfg: &WorkerConfig,
    jpeg: Arc<Vec<u8>>,
) {
    let max_attempts = cfg.max_retries + 1;
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        controller.mark_active_attempt();
        match try_print(backend, controller, cfg, &jpeg).await {
            Ok(warning) => {
                controller.finish_active(JobState::Done, None, warning);
                return;
            }
            Err(e) => {
                if e.is_retryable() && attempt < max_attempts {
                    controller.log().warn(
                        "print",
                        format!("print attempt {attempt} failed: {}; retrying", e.tag()),
                    );
                    // Force a fresh connection before retrying.
                    let _ = backend.close_for_cut().await;
                    let _ = backend.connect().await;
                    continue;
                }
                controller.finish_active(JobState::Failed, Some(e.tag()), None);
                return;
            }
        }
    }
}

/// One print attempt. Returns `Ok(Some(warning))` when the label almost
/// certainly printed but we couldn't confirm idle (don't retry; that risks a
/// duplicate label).
async fn try_print(
    backend: &mut Box<dyn PrinterBackend>,
    controller: &QueueController,
    cfg: &WorkerConfig,
    jpeg: &[u8],
) -> Result<Option<String>, PrinterError> {
    // Pre-flight status check (also (re)connects on the TCP backend, and
    // reports unreachable via note_status if the connection is down).
    let st = controller.note_status(&cfg.backend_name, backend.get_status().await)?;
    match st.state {
        PrinterState::NoMedia => return Err(PrinterError::NoMedia),
        PrinterState::AwaitingRemoval => {
            // A previous label is still in the slot; wait for it to be removed.
            controller.set_active_state(JobState::AwaitingRemoval);
            wait_for_removal(backend, controller, cfg).await?;
        }
        _ => {}
    }

    controller.set_active_state(JobState::Printing);
    backend.send_print(jpeg, &cfg.print_opts).await?; // Ok => "print data received"

    controller.set_active_state(JobState::Cutting);
    backend.close_for_cut().await?; // closing the socket triggers the cut
    tokio::time::sleep(cfg.cut_wait).await;
    backend.connect().await?; // reconnect to poll

    poll_until_done(backend, controller, cfg).await
}

/// Block (polling status) until a held label is removed. No timeout; this
/// waits on a human, and the printed job hasn't started yet.
async fn wait_for_removal(
    backend: &mut Box<dyn PrinterBackend>,
    controller: &QueueController,
    cfg: &WorkerConfig,
) -> Result<(), PrinterError> {
    loop {
        let st = controller.note_status(&cfg.backend_name, backend.get_status().await)?;
        match st.state {
            PrinterState::AwaitingRemoval => {
                tokio::time::sleep(cfg.poll_interval).await;
            }
            PrinterState::NoMedia => return Err(PrinterError::NoMedia),
            _ => return Ok(()),
        }
    }
}

/// After the cut, poll until the printer is idle again. Awaiting-removal does
/// not count toward the idle timeout (it waits on a human).
async fn poll_until_done(
    backend: &mut Box<dyn PrinterBackend>,
    controller: &QueueController,
    cfg: &WorkerConfig,
) -> Result<Option<String>, PrinterError> {
    let start = Instant::now();
    loop {
        let st = controller.note_status(&cfg.backend_name, backend.get_status().await)?;
        match st.state {
            PrinterState::Idle => return Ok(None),
            PrinterState::AwaitingRemoval => {
                controller.set_active_state(JobState::AwaitingRemoval);
                tokio::time::sleep(cfg.poll_interval).await;
                continue; // don't apply the idle timeout while waiting on a human
            }
            PrinterState::NoMedia => {
                // Ran dry after sending; the label almost certainly printed.
                return Ok(Some("no_media_after_print".into()));
            }
            _ => {}
        }
        if start.elapsed() > cfg.idle_timeout {
            return Ok(Some("idle_timeout".into()));
        }
        tokio::time::sleep(cfg.poll_interval).await;
    }
}
