//! barnguard printer-daemon: a local print-queue service for the Brother
//! VC-500W. See `README.md` for the protocol quirks this exists to handle.

pub mod backend_factory;
pub mod cli;
pub mod client_config;
pub mod config;
pub mod events;
pub mod http;
pub mod log;
pub mod queue;
pub mod store;
pub mod types;
#[cfg(feature = "embed-web")]
pub mod web;

use crate::client_config::ClientConfigState;
use crate::config::Config;
use crate::events::EventHub;
use crate::http::{build_router, AppState};
use crate::log::LogHub;
use crate::queue::{run_worker, QueueController, QueueStore, WorkerConfig};
use crate::store::GameLogController;
use crate::types::PrinterStatus;
use printer_driver::MockControls;
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::{Duration, Instant};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

/// Global handle so the panic hook can record a final message. Set once at
/// start-up; the hook no-ops until then.
static LOG_HUB: OnceLock<LogHub> = OnceLock::new();

/// Load config, supervise the worker, and serve the HTTP + SSE API until shutdown.
pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    install_panic_hook();

    let cfg = Config::load()?;

    let events = EventHub::new(256);
    let log = LogHub::new(cfg.log_buffer_size, events.clone());
    let _ = LOG_HUB.set(log.clone());
    log.info(
        "system",
        format!("printer-daemon starting (backend={})", cfg.backend),
    );

    // Mock controls are created once and reused across worker restarts so
    // `/debug/mock` stays wired to the live backend.
    let mock_controls = if cfg.backend == "mock" {
        Some(MockControls::new(
            cfg.mock.force_no_media,
            cfg.mock.force_awaiting_removal,
        ))
    } else {
        None
    };

    let store = Arc::new(Mutex::new(QueueStore::new(PrinterStatus::unknown(
        &cfg.backend,
    ))));
    let controller = QueueController::new(store, events.clone(), log.clone());

    // Supervise the worker in its own task; the HTTP server below runs
    // independently, so the panel + log stay reachable even if the worker flaps.
    tokio::spawn(supervise(
        cfg.clone(),
        controller.clone(),
        log.clone(),
        mock_controls.clone(),
    ));

    let games_store = GameLogController::load(&cfg.data_dir, &log, events.clone());

    // Client-facing config lives behind a lock: `POST /config/reload` refreshes
    // the base from disk, `POST/DELETE /config/override` set/clear the in-memory
    // override, and every SSE (re)connect reads the effective value.
    let client_config = Arc::new(RwLock::new(ClientConfigState::new(
        cfg.client.label_url.clone(),
    )));

    let state = AppState {
        controller,
        events,
        log,
        mock: mock_controls,
        games: games_store,
        client_config,
    };
    let app = build_router(state, &cfg.allowed_origins);

    let listener = TcpListener::bind(&cfg.bind).await?;
    tracing::info!("listening on http://{}", cfg.bind);
    axum::serve(listener, app).await?;
    Ok(())
}

/// Install a process-wide panic hook that runs the default handler (stderr /
/// journald) and then records a best-effort message into the log ring: the
/// "message before it fully panics". Uses `try_lock` internally so it can never
/// deadlock, even if the panicking thread already held the log lock.
fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        default(info);
        if let Some(hub) = LOG_HUB.get() {
            let thread = std::thread::current()
                .name()
                .unwrap_or("unknown")
                .to_string();
            hub.record_panic(format!("panic on thread '{thread}': {info}"));
        }
    }));
}

/// Restart the worker if it panics/exits. A panicking worker task aborts
/// without taking down the process, so we respawn it (recreating the backend)
/// with a short backoff. After too many failures in a short window we stop and
/// require a manual restart, but keep the HTTP server (and log) alive.
async fn supervise(
    cfg: Config,
    controller: QueueController,
    log: LogHub,
    mock_controls: Option<Arc<MockControls>>,
) {
    let wcfg = WorkerConfig::from_config(&cfg);
    let mut tracker = RestartTracker::new(5, Duration::from_secs(60));

    loop {
        let (backend, _controls) = backend_factory::make_backend_with(&cfg, mock_controls.clone());
        match tokio::spawn(run_worker(backend, controller.clone(), wcfg.clone())).await {
            Ok(()) => log.warn("worker", "worker task exited unexpectedly; restarting"),
            Err(e) => log.error("worker", format!("worker crashed ({e}); restarting")),
        }

        match tracker.on_failure(Instant::now()) {
            Some(backoff) => {
                log.warn(
                    "worker",
                    format!("restarting worker in {}s", backoff.as_secs()),
                );
                tokio::time::sleep(backoff).await;
            }
            None => {
                log.error(
                    "worker",
                    "worker keeps failing; giving up. A manual daemon restart is required",
                );
                return;
            }
        }
    }
}

/// Restart accounting for the supervisor: allow up to `max` failures per rolling
/// `window` (with a linear backoff), then give up. Kept separate + pure so it's
/// unit-testable without spawning tasks.
struct RestartTracker {
    fails: u32,
    window_start: Instant,
    max: u32,
    window: Duration,
}

impl RestartTracker {
    fn new(max: u32, window: Duration) -> Self {
        Self {
            fails: 0,
            window_start: Instant::now(),
            max,
            window,
        }
    }

    /// Record a failure at `now`; returns the backoff to wait before the next
    /// attempt, or `None` once `max` failures occur within the window (give up).
    fn on_failure(&mut self, now: Instant) -> Option<Duration> {
        if now.duration_since(self.window_start) > self.window {
            self.fails = 0;
            self.window_start = now;
        }
        self.fails += 1;
        if self.fails > self.max {
            None
        } else {
            Some(Duration::from_secs(u64::from(self.fails.min(5))))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_tracker_gives_up_after_max() {
        let base = Instant::now();
        let mut t = RestartTracker::new(3, Duration::from_secs(60));
        assert!(t.on_failure(base).is_some()); // 1
        assert!(t.on_failure(base).is_some()); // 2
        assert!(t.on_failure(base).is_some()); // 3
        assert!(t.on_failure(base).is_none()); // 4 > max → give up
    }

    #[test]
    fn restart_tracker_resets_after_window() {
        let base = Instant::now();
        let mut t = RestartTracker::new(2, Duration::from_secs(60));
        assert!(t.on_failure(base).is_some());
        assert!(t.on_failure(base).is_some());
        assert!(t.on_failure(base).is_none()); // exceeded within window
                                               // After the window elapses, the counter resets and we retry again.
        let later = base + Duration::from_secs(61);
        assert!(t.on_failure(later).is_some());
    }
}
