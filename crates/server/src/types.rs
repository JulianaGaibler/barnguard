//! Server-side data types / DTOs. Everything serialized to the web client uses
//! `camelCase` field names; enum string values are `snake_case` (e.g.
//! `"no_media"`, `"awaiting_removal"`); the TS client matches those literals.

use printer_driver::PrinterState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;


/// Milliseconds since the Unix epoch. Used for job timestamps + mock filenames.
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Lifecycle of a single print job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Printing,
    Cutting,
    AwaitingRemoval,
    Done,
    Failed,
    Canceled,
}

/// Free-form metadata attached to a job by the caller. Populated from the
/// `POST /print` query params.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<i64>,
    #[serde(default)]
    pub high_score: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// A print job as exposed over the API. JPEG bytes are stored separately in the
/// queue (retained for reprint), never in this DTO.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintJob {
    pub id: Uuid,
    pub state: JobState,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    pub attempts: u32,
    pub meta: JobMeta,
}

impl PrintJob {
    pub fn new(meta: JobMeta) -> Self {
        let now = now_ms();
        Self {
            id: Uuid::new_v4(),
            state: JobState::Queued,
            created_at_ms: now,
            updated_at_ms: now,
            error: None,
            warning: None,
            attempts: 0,
            meta,
        }
    }

    pub fn set_state(&mut self, state: JobState) {
        self.state = state;
        self.updated_at_ms = now_ms();
    }
}

/// Last-known printer status, pushed over SSE and returned by `GET /status`.
/// Combines the driver's [`printer_driver::PrinterHealth`] snapshot with the
/// server's own connection telemetry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterStatus {
    pub reachable: bool,
    pub state: PrinterState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub print_job_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tape_remaining_mm: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tape_width_mm: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial: Option<String>,
    pub backend: String,
    pub last_seen_ms: u64,
    /// When the printer first became unreachable (epoch ms); `None` while
    /// reachable. Lets the UI show "unreachable for Xm".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unreachable_since_ms: Option<u64>,
    /// Consecutive failed status polls since the last success (0 when reachable).
    pub failed_attempts: u32,
}

impl PrinterStatus {
    /// A conservative "we don't know yet / can't reach it" snapshot.
    pub fn unknown(backend: &str) -> Self {
        Self {
            reachable: false,
            state: PrinterState::Unknown,
            print_job_error: None,
            tape_remaining_mm: None,
            tape_width_mm: None,
            model: None,
            serial: None,
            backend: backend.to_string(),
            last_seen_ms: now_ms(),
            unreachable_since_ms: None,
            failed_attempts: 0,
        }
    }

    /// Wrap a fresh [`printer_driver::PrinterHealth`] reading as a full status
    /// snapshot. Sets `reachable = true` and stamps `last_seen_ms = now`.
    /// Connection telemetry (`failed_attempts`, `unreachable_since_ms`) is
    /// filled in by the caller.
    pub fn from_health(health: printer_driver::PrinterHealth, backend: &str) -> Self {
        Self {
            reachable: true,
            state: health.state,
            print_job_error: health.print_job_error,
            tape_remaining_mm: health.tape_remaining_mm,
            tape_width_mm: health.tape_width_mm,
            model: health.model,
            serial: health.serial,
            backend: backend.to_string(),
            last_seen_ms: now_ms(),
            unreachable_since_ms: None,
            failed_attempts: 0,
        }
    }
}

/// Snapshot of the whole queue for `GET /queue` and the SSE `queue` event.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueSnapshot {
    pub active: Option<PrintJob>,
    pub pending: Vec<PrintJob>,
    pub recent: Vec<PrintJob>,
}

/// Severity of a message-log entry.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

/// One operator-facing message in the daemon's in-memory log ring.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub ts_ms: u64,
    pub level: LogLevel,
    /// Short subsystem tag, e.g. "printer", "worker", "system", "panic".
    pub source: String,
    pub message: String,
}

/// Client-facing daemon configuration pushed to the web app (SSE `config` event
/// + `GET /api/printer/config`). Deliberately separate from the on-disk
/// [`crate::config::ClientCfg`]: TOML deserializes snake_case, but everything
/// sent to the browser is `camelCase` (`{ "labelUrl": "..." }`), matching the
/// other DTOs here.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfig {
    /// Effective URL printed top-right on every result label (the runtime
    /// override if one is set, otherwise the `config.toml` value).
    pub label_url: String,
    /// True when a runtime override is active (set from the attendant UI) and
    /// thus superseding the `config.toml` value. Lets the UI show the state and
    /// offer a reset.
    pub label_url_overridden: bool,
}

/// Events broadcast to SSE subscribers.
#[derive(Debug, Clone)]
pub enum ServerEvent {
    Status(PrinterStatus),
    Job(PrintJob),
    Queue(QueueSnapshot),
    Log(LogEntry),
    GameCreated(GameRecord),
    GameDeleted(Uuid),
    /// Client-facing config changed (emitted on `POST /config/reload`).
    Config(ClientConfig),
}

// ---------------------------------------------------------------------------
// Web-facing state & game log
// ---------------------------------------------------------------------------

/// Why a round ended. JSON: `snake_case` (`"collision"`, `"exited_germany"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GameEndReason {
    Collision,
    ExitedGermany,
}

impl fmt::Display for GameEndReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GameEndReason::Collision => f.write_str("collision"),
            GameEndReason::ExitedGermany => f.write_str("exited_germany"),
        }
    }
}

/// A single finished game. Persisted in `games.json` (newest last). The high-
/// score flags are snapshotted at record-creation time so reprints stay 1:1
/// with the original badge even if a later game surpasses this score.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRecord {
    pub id: Uuid,
    pub ts_ms: u64,
    pub state_id: String,
    pub reason: GameEndReason,
    pub score: u32,
    pub duration_ms: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub escape_heading_rad: Option<f32>,
    /// True if this score was the overall best at the moment it was recorded.
    pub was_overall_high: bool,
    /// True if this score was the best for its state at the moment it was recorded.
    pub was_state_high: bool,
}

/// Client-supplied payload for `POST /api/games`. The server assigns `id`,
/// `ts_ms`, and the `wasOverallHigh` / `wasStateHigh` flags.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewGame {
    pub state_id: String,
    pub reason: GameEndReason,
    pub score: u32,
    pub duration_ms: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub escape_heading_rad: Option<f32>,
}

impl NewGame {
    /// Assemble a full [`GameRecord`] from this payload plus a computed
    /// snapshot of the high scores as they stood *before* this game landed.
    /// The comparison is `>`, matching the web's "beat the previous best"
    /// semantics (equalling doesn't trigger the star).
    pub fn into_record(self, prev: &HighScores) -> GameRecord {
        let was_overall_high = self.score > prev.overall;
        let was_state_high = self
            .score
            > prev.by_state.get(&self.state_id).copied().unwrap_or(0);
        GameRecord {
            id: Uuid::new_v4(),
            ts_ms: now_ms(),
            state_id: self.state_id,
            reason: self.reason,
            score: self.score,
            duration_ms: self.duration_ms,
            escape_heading_rad: self.escape_heading_rad,
            was_overall_high,
            was_state_high,
        }
    }
}

/// High scores computed on demand from a game log slice. Never persisted.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighScores {
    pub overall: u32,
    pub by_state: HashMap<String, u32>,
}

impl HighScores {
    /// Recompute from any iterable of records; order doesn't matter.
    pub fn from_games(games: &[GameRecord]) -> Self {
        let mut overall = 0u32;
        let mut by_state: HashMap<String, u32> = HashMap::new();
        for g in games {
            if g.score > overall {
                overall = g.score;
            }
            let slot = by_state.entry(g.state_id.clone()).or_insert(0);
            if g.score > *slot {
                *slot = g.score;
            }
        }
        Self { overall, by_state }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(state: &str, score: u32) -> GameRecord {
        GameRecord {
            id: Uuid::new_v4(),
            ts_ms: 0,
            state_id: state.into(),
            reason: GameEndReason::Collision,
            score,
            duration_ms: 0,
            escape_heading_rad: None,
            was_overall_high: false,
            was_state_high: false,
        }
    }

    #[test]
    fn high_scores_track_overall_and_per_state() {
        let games = vec![
            record("bayern", 100),
            record("hessen", 250),
            record("bayern", 150),
            record("hessen", 200),
        ];
        let hs = HighScores::from_games(&games);
        assert_eq!(hs.overall, 250);
        assert_eq!(hs.by_state.get("bayern").copied(), Some(150));
        assert_eq!(hs.by_state.get("hessen").copied(), Some(250));
    }

    #[test]
    fn new_game_flags_are_strict_greater_than() {
        let prev = HighScores {
            overall: 100,
            by_state: [("bayern".to_string(), 50)].into_iter().collect(),
        };
        // Equalling the overall best does NOT trigger the star.
        let rec = NewGame {
            state_id: "bayern".into(),
            reason: GameEndReason::Collision,
            score: 100,
            duration_ms: 5_000,
            escape_heading_rad: None,
        }
        .into_record(&prev);
        assert!(!rec.was_overall_high);
        assert!(rec.was_state_high); // 100 > 50
    }

    #[test]
    fn new_game_flags_first_ever_beats_zero() {
        let rec = NewGame {
            state_id: "sachsen".into(),
            reason: GameEndReason::ExitedGermany,
            score: 1,
            duration_ms: 100,
            escape_heading_rad: Some(1.5),
        }
        .into_record(&HighScores::default());
        assert!(rec.was_overall_high);
        assert!(rec.was_state_high);
    }

    #[test]
    fn client_config_serializes_camel_case() {
        // The web client parses `labelUrl`; keep the snake_case-in /
        // camelCase-out contract locked so a rename can't silently break it.
        let json = serde_json::to_string(&ClientConfig {
            label_url: "mzl.la/enterprise".into(),
            label_url_overridden: false,
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"labelUrl":"mzl.la/enterprise","labelUrlOverridden":false}"#
        );
    }
}
