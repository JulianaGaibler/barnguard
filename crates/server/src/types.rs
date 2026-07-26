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

/// Stable id for the Stallwächter display; used as the `display` tag on
/// records + high scores. Future displays get their own constants alongside.
pub const DISPLAY_STALLWAECHTER: &str = "stallwaechter";

/// Stable id for the Arcade display (hosts Jezzball, Connect Four, Orbo).
pub const DISPLAY_ARCADE: &str = "arcade";

/// Why a Stallwächter round ended. JSON: `snake_case` (`"collision"`,
/// `"exited_germany"`).
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

/// Display-specific detail payload. Envelope fields (id/ts/score/duration) live
/// on [`GameRecord`]; anything only meaningful to one display goes here. Tagged
/// by `display` on the wire and in `games.json` — that discriminator is
/// authoritative and matches the `?display=` URL parameter on the web side.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "display", rename_all = "snake_case")]
pub enum GameDetails {
    Stallwaechter(StallwaechterDetails),
    Arcade(ArcadeDetails),
}

impl GameDetails {
    /// The display id this variant belongs to. Kept in sync with the serde tag
    /// so filtering / grouping code doesn't have to string-match.
    pub fn display_id(&self) -> &'static str {
        match self {
            GameDetails::Stallwaechter(_) => DISPLAY_STALLWAECHTER,
            GameDetails::Arcade(_) => DISPLAY_ARCADE,
        }
    }
}

/// Arcade-specific game details. `game_id` is the arcade `GameMeta.id` (e.g.
/// `"jezzball"`, `"connect-four"`, `"orbo"`) — an open string, not a closed
/// enum, so a new arcade game starts logging with no server code change
/// (mirrors [`LeaderboardEntry::display`] below). `score`'s meaning is
/// game-specific (points for Jezzball; the winning side's round-win streak
/// for the round-based games) and is only ever compared within the same
/// `game_id` — see [`ArcadeHighScores`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArcadeDetails {
    pub game_id: String,
    /// Free-form mode tag, e.g. `"solo"`, `"versus"`, `"round"`.
    pub mode: String,
    /// Human-readable winning side (e.g. `"player1"`, `"left"`, `"tie"`);
    /// `None` when the game has no opposing side (Jezzball solo).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub winner: Option<String>,
    /// True if this score was the best for its `game_id` at the moment it was
    /// recorded.
    pub was_game_high: bool,
    /// The name the player saved to the leaderboard for this run, if any —
    /// `None` when they skipped name entry or the score didn't qualify. Purely
    /// an echo for attendant visibility; the leaderboard entry itself is the
    /// separate `LeaderboardEntry` this name was actually submitted to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub player_name: Option<String>,
}

/// Stallwächter-specific game details. `state_id` is the ISO code (lowercase);
/// high-score flags are snapshotted at record-creation time so reprints stay
/// 1:1 with the original badge even after a later game surpasses this score.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StallwaechterDetails {
    pub state_id: String,
    pub reason: GameEndReason,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub escape_heading_rad: Option<f32>,
    /// True if this score was the overall best (for this display) at the
    /// moment it was recorded.
    pub was_overall_high: bool,
    /// True if this score was the best for its state at the moment it was
    /// recorded.
    pub was_state_high: bool,
}

/// A single finished game. Persisted in `games.json` (newest last). Envelope
/// fields are shared by every display; display-specific fields live inside
/// `details` (flattened into the top-level JSON object next to a `display`
/// discriminator).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRecord {
    pub id: Uuid,
    pub ts_ms: u64,
    pub score: u32,
    pub duration_ms: u32,
    #[serde(flatten)]
    pub details: GameDetails,
}

impl GameRecord {
    pub fn display_id(&self) -> &'static str {
        self.details.display_id()
    }
}

/// Client-supplied payload for `POST /api/games`. Same envelope + details
/// shape as [`GameRecord`], but the server assigns `id`, `ts_ms`, and (for
/// Stallwächter) the `was*High` flags.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewGame {
    pub score: u32,
    pub duration_ms: u32,
    #[serde(flatten)]
    pub details: NewGameDetails,
}

/// Same discriminator as [`GameDetails`], but with the high-score flags left
/// off — the server fills them in.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "display", rename_all = "snake_case")]
pub enum NewGameDetails {
    Stallwaechter(NewStallwaechterDetails),
    Arcade(NewArcadeDetails),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewStallwaechterDetails {
    pub state_id: String,
    pub reason: GameEndReason,
    #[serde(default)]
    pub escape_heading_rad: Option<f32>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewArcadeDetails {
    pub game_id: String,
    pub mode: String,
    #[serde(default)]
    pub winner: Option<String>,
    #[serde(default)]
    pub player_name: Option<String>,
}

impl NewGame {
    /// Assemble a full [`GameRecord`] from this payload plus a snapshot of the
    /// prior high scores for the same display. The comparison is `>`, matching
    /// the web's "beat the previous best" semantics (equalling doesn't
    /// trigger the star).
    pub fn into_record(self, prev: &DisplayHighScores) -> GameRecord {
        let NewGame {
            score,
            duration_ms,
            details,
        } = self;
        let full = match details {
            NewGameDetails::Stallwaechter(d) => {
                let DisplayHighScores::Stallwaechter(s) = prev else {
                    panic!("prev high scores variant didn't match Stallwaechter details")
                };
                let was_overall_high = score > s.overall;
                let was_state_high =
                    score > s.by_state.get(&d.state_id).copied().unwrap_or(0);
                GameDetails::Stallwaechter(StallwaechterDetails {
                    state_id: d.state_id,
                    reason: d.reason,
                    escape_heading_rad: d.escape_heading_rad,
                    was_overall_high,
                    was_state_high,
                })
            }
            NewGameDetails::Arcade(d) => {
                let DisplayHighScores::Arcade(s) = prev else {
                    panic!("prev high scores variant didn't match Arcade details")
                };
                let was_game_high = score > s.by_game.get(&d.game_id).copied().unwrap_or(0);
                GameDetails::Arcade(ArcadeDetails {
                    game_id: d.game_id,
                    mode: d.mode,
                    winner: d.winner,
                    was_game_high,
                    player_name: d.player_name,
                })
            }
        };
        GameRecord {
            id: Uuid::new_v4(),
            ts_ms: now_ms(),
            score,
            duration_ms,
            details: full,
        }
    }
}

/// High scores computed on demand from a game log slice. Per-display shape:
/// each variant matches its [`GameDetails`] sibling. Never persisted.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "display", rename_all = "snake_case")]
pub enum DisplayHighScores {
    Stallwaechter(StallwaechterHighScores),
    Arcade(ArcadeHighScores),
}

impl DisplayHighScores {
    pub fn empty_for(display: &str) -> Self {
        match display {
            DISPLAY_STALLWAECHTER => {
                DisplayHighScores::Stallwaechter(StallwaechterHighScores::default())
            }
            DISPLAY_ARCADE => DisplayHighScores::Arcade(ArcadeHighScores::default()),
            other => panic!("unknown display id: {other}"),
        }
    }

    /// Recompute from a slice of records. Only records whose `display_id()`
    /// matches `display` contribute; the rest are silently skipped, so
    /// callers can pass the whole log without prefiltering.
    pub fn from_games(display: &str, games: &[GameRecord]) -> Self {
        match display {
            DISPLAY_STALLWAECHTER => {
                let mut overall = 0u32;
                let mut by_state: HashMap<String, u32> = HashMap::new();
                for g in games {
                    if let GameDetails::Stallwaechter(d) = &g.details {
                        if g.score > overall {
                            overall = g.score;
                        }
                        let slot = by_state.entry(d.state_id.clone()).or_insert(0);
                        if g.score > *slot {
                            *slot = g.score;
                        }
                    }
                }
                DisplayHighScores::Stallwaechter(StallwaechterHighScores {
                    overall,
                    by_state,
                })
            }
            DISPLAY_ARCADE => {
                let mut by_game: HashMap<String, u32> = HashMap::new();
                for g in games {
                    if let GameDetails::Arcade(d) = &g.details {
                        let slot = by_game.entry(d.game_id.clone()).or_insert(0);
                        if g.score > *slot {
                            *slot = g.score;
                        }
                    }
                }
                DisplayHighScores::Arcade(ArcadeHighScores { by_game })
            }
            other => panic!("unknown display id: {other}"),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StallwaechterHighScores {
    pub overall: u32,
    pub by_state: HashMap<String, u32>,
}

/// Best score per arcade `game_id`. No `overall` field — Jezzball's points
/// and the other games' round-win streaks aren't comparable, so there's no
/// meaningful arcade-wide best.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArcadeHighScores {
    pub by_game: HashMap<String, u32>,
}

// ---------------------------------------------------------------------------
// Leaderboard — generic, per-`display` (arcade game id), one entry per name.
// ---------------------------------------------------------------------------
//
// Unlike `GameDetails`/`NewGameDetails` above, `display` here is an open
// string rather than a closed enum: a new arcade game starts submitting
// scores with no backend code change, just its own id.

/// A single leaderboard row, persisted in `leaderboard.json`. Only the
/// best score per `(display, name)` is ever kept — see
/// [`crate::store::LeaderboardController::submit`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaderboardEntry {
    pub id: Uuid,
    pub ts_ms: u64,
    pub display: String,
    /// Already normalized (trimmed, lowercased, truncated to 6 chars) by the
    /// time it's stored — see `NewLeaderboardEntry::normalized_name`.
    pub name: String,
    pub score: u32,
}

/// Client-supplied payload for `POST /api/leaderboard`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewLeaderboardEntry {
    pub display: String,
    pub name: String,
    pub score: u32,
}

/// Max characters kept from a submitted name after normalization.
pub const LEADERBOARD_NAME_MAX_CHARS: usize = 6;

impl NewLeaderboardEntry {
    /// Trim, lowercase, and truncate to [`LEADERBOARD_NAME_MAX_CHARS`]
    /// **characters** (not bytes, so multi-byte input truncates cleanly).
    /// Applied server-side regardless of what the client already did, so
    /// `"abc"` / `"ABC"` / `"abc  "` all collide on the same stored key.
    pub fn normalized_name(&self) -> String {
        self.name
            .trim()
            .to_lowercase()
            .chars()
            .take(LEADERBOARD_NAME_MAX_CHARS)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stall_details(state: &str) -> StallwaechterDetails {
        StallwaechterDetails {
            state_id: state.into(),
            reason: GameEndReason::Collision,
            escape_heading_rad: None,
            was_overall_high: false,
            was_state_high: false,
        }
    }

    fn record(state: &str, score: u32) -> GameRecord {
        GameRecord {
            id: Uuid::new_v4(),
            ts_ms: 0,
            score,
            duration_ms: 0,
            details: GameDetails::Stallwaechter(stall_details(state)),
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
        let DisplayHighScores::Stallwaechter(hs) =
            DisplayHighScores::from_games(DISPLAY_STALLWAECHTER, &games)
        else {
            panic!("expected Stallwaechter high scores")
        };
        assert_eq!(hs.overall, 250);
        assert_eq!(hs.by_state.get("bayern").copied(), Some(150));
        assert_eq!(hs.by_state.get("hessen").copied(), Some(250));
    }

    fn stall_new(state: &str, score: u32) -> NewGame {
        NewGame {
            score,
            duration_ms: 5_000,
            details: NewGameDetails::Stallwaechter(NewStallwaechterDetails {
                state_id: state.into(),
                reason: GameEndReason::Collision,
                escape_heading_rad: None,
            }),
        }
    }

    #[test]
    fn new_game_flags_are_strict_greater_than() {
        let prev = DisplayHighScores::Stallwaechter(StallwaechterHighScores {
            overall: 100,
            by_state: [("bayern".to_string(), 50)].into_iter().collect(),
        });
        let rec = stall_new("bayern", 100).into_record(&prev);
        let GameDetails::Stallwaechter(d) = &rec.details else {
            panic!("expected Stallwaechter details")
        };
        // Equalling the overall best does NOT trigger the star.
        assert!(!d.was_overall_high);
        assert!(d.was_state_high); // 100 > 50
    }

    #[test]
    fn new_game_flags_first_ever_beats_zero() {
        let prev = DisplayHighScores::empty_for(DISPLAY_STALLWAECHTER);
        let rec = stall_new("sachsen", 1).into_record(&prev);
        let GameDetails::Stallwaechter(d) = &rec.details else {
            panic!("expected Stallwaechter details")
        };
        assert!(d.was_overall_high);
        assert!(d.was_state_high);
    }

    fn arcade_new(game_id: &str, score: u32) -> NewGame {
        NewGame {
            score,
            duration_ms: 5_000,
            details: NewGameDetails::Arcade(NewArcadeDetails {
                game_id: game_id.into(),
                mode: "solo".into(),
                winner: None,
                player_name: None,
            }),
        }
    }

    #[test]
    fn arcade_high_scores_are_grouped_per_game_and_dont_mix() {
        let games = vec![
            arcade_new("jezzball", 4200).into_record(&DisplayHighScores::empty_for(DISPLAY_ARCADE)),
            arcade_new("connect-four", 3).into_record(&DisplayHighScores::empty_for(DISPLAY_ARCADE)),
        ];
        let DisplayHighScores::Arcade(hs) = DisplayHighScores::from_games(DISPLAY_ARCADE, &games)
        else {
            panic!("expected Arcade high scores")
        };
        assert_eq!(hs.by_game.get("jezzball").copied(), Some(4200));
        assert_eq!(hs.by_game.get("connect-four").copied(), Some(3));
    }

    #[test]
    fn arcade_details_carries_player_name_through() {
        let mut new = arcade_new("jezzball", 100);
        let NewGameDetails::Arcade(d) = &mut new.details else {
            panic!("expected Arcade details")
        };
        d.player_name = Some("aaaa".into());
        let rec = new.into_record(&DisplayHighScores::empty_for(DISPLAY_ARCADE));
        let GameDetails::Arcade(d) = &rec.details else {
            panic!("expected Arcade details")
        };
        assert_eq!(d.player_name.as_deref(), Some("aaaa"));
    }

    #[test]
    fn arcade_new_game_flags_are_scoped_to_game_id() {
        let prev = DisplayHighScores::Arcade(ArcadeHighScores {
            by_game: [("jezzball".to_string(), 100)].into_iter().collect(),
        });
        // A "connect-four" score of 1 doesn't collide with jezzball's 100.
        let rec = arcade_new("connect-four", 1).into_record(&prev);
        let GameDetails::Arcade(d) = &rec.details else {
            panic!("expected Arcade details")
        };
        assert!(d.was_game_high);
    }

    #[test]
    fn client_config_serializes_camel_case() {
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

    #[test]
    fn game_record_flattens_display_tag() {
        let rec = record("bayern", 42);
        let json = serde_json::to_string(&rec).unwrap();
        // Top-level object carries envelope + flattened display tag +
        // per-display fields (no nested `details` object).
        assert!(json.contains(r#""display":"stallwaechter""#));
        assert!(json.contains(r#""stateId":"bayern""#));
        assert!(!json.contains(r#""details":"#));
        let round: GameRecord = serde_json::from_str(&json).unwrap();
        assert_eq!(round.display_id(), DISPLAY_STALLWAECHTER);
    }

    fn new_leaderboard(name: &str) -> NewLeaderboardEntry {
        NewLeaderboardEntry {
            display: "jezzball".into(),
            name: name.into(),
            score: 100,
        }
    }

    #[test]
    fn leaderboard_name_normalizes_case_and_whitespace() {
        assert_eq!(new_leaderboard("ABC").normalized_name(), "abc");
        assert_eq!(new_leaderboard("  abc  ").normalized_name(), "abc");
        assert_eq!(
            new_leaderboard("ABC").normalized_name(),
            new_leaderboard("  abc  ").normalized_name(),
        );
    }

    #[test]
    fn leaderboard_name_truncates_to_six_chars() {
        assert_eq!(new_leaderboard("TOOLONG").normalized_name(), "toolon");
    }
}
