//! Queue + worker lifecycle tests, driven through the mock backend.

use printer_daemon::backend_factory::make_backend;
use printer_daemon::config::Config;
use printer_daemon::events::EventHub;
use printer_daemon::log::LogHub;
use printer_daemon::queue::{
    run_worker, CancelOutcome, QueueController, QueueStore, ReprintError, WorkerConfig,
};
use printer_daemon::types::{JobMeta, JobState, PrintJob, PrinterStatus, ServerEvent};
use printer_driver::{MockControls, PrinterBackend};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::broadcast::Receiver;
use uuid::Uuid;

#[allow(clippy::field_reassign_with_default)] // nested-field tweaks read clearer this way
fn fast_cfg(out_dir: &Path) -> Config {
    let mut cfg = Config::default();
    cfg.backend = "mock".into();
    cfg.mock.out_dir = out_dir.to_string_lossy().into_owned();
    cfg.mock.print_ms = 5;
    cfg.mock.cut_ms = 5;
    cfg.timing.cut_wait_ms = 5;
    cfg.timing.poll_interval_ms = 10;
    cfg.timing.idle_timeout_ms = 1000;
    cfg.timing.keepalive_interval_ms = 60_000;
    cfg
}

fn meta() -> JobMeta {
    JobMeta {
        state_id: Some("BW".into()),
        score: Some(42),
        high_score: false,
        source: Some("test".into()),
    }
}

/// Build the pieces WITHOUT spawning the worker, so callers can tweak the mock
/// controls (or skip the worker entirely) before starting it.
fn build(
    cfg: &Config,
) -> (
    Box<dyn PrinterBackend>,
    QueueController,
    EventHub,
    Arc<MockControls>,
) {
    let (backend, controls) = make_backend(cfg);
    let controls = controls.expect("mock backend yields controls");
    let events = EventHub::new(256);
    let log = LogHub::new(50, events.clone());
    let store = Arc::new(Mutex::new(QueueStore::new(PrinterStatus::unknown("mock"))));
    let controller = QueueController::new(store, events.clone(), log);
    (backend, controller, events, controls)
}

fn count_jpgs(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().is_some_and(|x| x == "jpg"))
                .count()
        })
        .unwrap_or(0)
}

async fn wait_job(rx: &mut Receiver<ServerEvent>, want: JobState, secs: u64) -> PrintJob {
    let fut = async {
        loop {
            match rx.recv().await {
                Ok(ServerEvent::Job(j)) if j.state == want => return j,
                _ => continue,
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(secs), fut)
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for job state {want:?}"))
}

#[test]
fn controller_cancel_reprint_clear() {
    // No worker: pending jobs stay put so the pure queue logic is deterministic.
    let dir = tempfile::tempdir().unwrap();
    let cfg = fast_cfg(dir.path());
    let (_backend, controller, _events, _controls) = build(&cfg);

    let id1 = controller.enqueue(meta(), b"A".to_vec());
    let _id2 = controller.enqueue(meta(), b"B".to_vec());
    assert_eq!(controller.queue_len(), 2);

    // Cancel a queued job.
    assert_eq!(controller.cancel(id1), CancelOutcome::Canceled);
    assert_eq!(controller.queue_len(), 1);

    // Its bytes are retained in history, so reprint re-enqueues it.
    let reprinted = controller.reprint(id1).expect("reprint canceled job");
    assert_ne!(reprinted, id1);
    assert_eq!(controller.queue_len(), 2);

    // Unknown id → NotFound.
    assert_eq!(
        controller.reprint(Uuid::new_v4()).unwrap_err(),
        ReprintError::NotFound
    );

    // Clear drops queued jobs only.
    assert_eq!(controller.clear(), 2);
    assert_eq!(controller.queue_len(), 0);
}

#[tokio::test]
async fn worker_prints_to_disk() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = fast_cfg(dir.path());
    let (backend, controller, events, _controls) = build(&cfg);
    let mut rx = events.subscribe();
    tokio::spawn(run_worker(
        backend,
        controller.clone(),
        WorkerConfig::from_config(&cfg),
    ));

    let id = controller.enqueue(meta(), b"FAKEJPEG".to_vec());
    let job = wait_job(&mut rx, JobState::Done, 5).await;
    assert_eq!(job.id, id);
    assert_eq!(count_jpgs(dir.path()), 1);
}

#[tokio::test]
async fn worker_no_media_fails_without_writing() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = fast_cfg(dir.path());
    let (backend, controller, events, controls) = build(&cfg);
    controls.set_no_media(true);
    let mut rx = events.subscribe();
    tokio::spawn(run_worker(
        backend,
        controller.clone(),
        WorkerConfig::from_config(&cfg),
    ));

    controller.enqueue(meta(), b"FAKEJPEG".to_vec());
    let job = wait_job(&mut rx, JobState::Failed, 5).await;
    assert_eq!(job.error.as_deref(), Some("no_media"));
    assert_eq!(count_jpgs(dir.path()), 0);
}

#[tokio::test]
async fn worker_boot_reconcile_holds_until_label_removed() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = fast_cfg(dir.path());
    let (backend, controller, events, controls) = build(&cfg);
    // Simulate a printer that boots already holding a label.
    controls.set_awaiting_now(true);
    let mut rx = events.subscribe();
    tokio::spawn(run_worker(
        backend,
        controller.clone(),
        WorkerConfig::from_config(&cfg),
    ));

    controller.enqueue(meta(), b"FAKEJPEG".to_vec());
    // While the printer is awaiting removal, nothing should print.
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(
        count_jpgs(dir.path()),
        0,
        "must not print onto a held label"
    );

    // Attendant removes the label → boot reconcile clears → the job prints.
    controls.clear_awaiting();
    wait_job(&mut rx, JobState::Done, 5).await;
    assert_eq!(count_jpgs(dir.path()), 1);
}

#[tokio::test]
async fn history_cap_bounds_retained_jobs() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = fast_cfg(dir.path());
    let (backend, controller, _events, _controls) = build(&cfg);
    tokio::spawn(run_worker(
        backend,
        controller.clone(),
        WorkerConfig::from_config(&cfg),
    ));

    // Enqueue more than the history cap (20).
    let ids: Vec<Uuid> = (0..25)
        .map(|_| controller.enqueue(meta(), b"X".to_vec()))
        .collect();

    // Wait for the queue to drain.
    let mut drained = false;
    for _ in 0..800 {
        let snap = controller.snapshot();
        if snap.active.is_none() && snap.pending.is_empty() && snap.recent.len() >= 20 {
            drained = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(drained, "queue did not drain in time");

    // History is capped, and the earliest (evicted) job can no longer reprint.
    assert_eq!(controller.snapshot().recent.len(), 20);
    assert_eq!(
        controller.reprint(ids[0]).unwrap_err(),
        ReprintError::NotFound
    );
}

#[tokio::test]
async fn worker_reports_unreachable_and_recovers() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = fast_cfg(dir.path());
    let (backend, controller, events, controls) = build(&cfg);
    controls.set_unreachable(true);
    let mut rx = events.subscribe();
    tokio::spawn(run_worker(
        backend,
        controller.clone(),
        WorkerConfig::from_config(&cfg),
    ));

    // Status polls fail → reachable:false with a growing failed-attempt count.
    let down = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(ServerEvent::Status(s)) = rx.recv().await {
                if !s.reachable && s.failed_attempts >= 1 {
                    return s;
                }
            }
        }
    })
    .await
    .expect("expected an unreachable status");
    assert!(down.unreachable_since_ms.is_some());

    // Printer comes back; a manual reconnect nudge recovers it immediately.
    controls.set_unreachable(false);
    controller.request_reconnect();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(ServerEvent::Status(s)) = rx.recv().await {
                if s.reachable {
                    return;
                }
            }
        }
    })
    .await
    .expect("expected recovery to reachable");
}
