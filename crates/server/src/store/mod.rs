//! Persistence for web-app state (`state.json`) and the game log (`games.json`).
//!
//! Design:
//! - Each store is `Arc<Mutex<...>>` behind a cloneable `*Controller` handle,
//!   mirroring the pattern used by [`crate::queue::QueueController`].
//! - Writes are atomic (write to a sibling `.tmp` file, `fsync`, then `rename`).
//! - Boot-time resilience: a corrupted file is renamed to
//!   `<name>.corrupted-<unix_ts>.json`, logged loudly, and the store falls back
//!   to `Default::default()`. A parse error must never take down the kiosk.
//!
//! Locks are the standard sync `Mutex`; writes are small (< 1 MB) and infrequent,
//! so blocking under the lock is the simpler tradeoff over an async actor.

use crate::events::EventHub;
use crate::log::LogHub;
use crate::types::{
    now_ms, DisplayHighScores, GameRecord, LeaderboardEntry, NewGame, NewLeaderboardEntry,
    ServerEvent, DISPLAY_ARCADE, DISPLAY_STALLWAECHTER,
};
use serde_json::Value as JsonValue;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const GAMES_FILE: &str = "games.json";

/// One-shot migration: legacy `games.json` records had the Stallwächter shape
/// flat at the top level (no `display` discriminator). Inject
/// `"display": "stallwaechter"` on any object that lacks it so the tagged-enum
/// deserializer accepts it. New records always carry the tag.
fn migrate_legacy_games_json(bytes: &[u8]) -> io::Result<Vec<u8>> {
    let mut value: JsonValue = serde_json::from_slice(bytes).map_err(io::Error::other)?;
    if let JsonValue::Array(items) = &mut value {
        for item in items {
            if let JsonValue::Object(map) = item {
                if !map.contains_key("display") {
                    map.insert(
                        "display".to_string(),
                        JsonValue::String(DISPLAY_STALLWAECHTER.to_string()),
                    );
                }
            }
        }
    }
    serde_json::to_vec(&value).map_err(io::Error::other)
}

// ---------------------------------------------------------------------------
// GameLogStore
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct GameLogController {
    inner: Arc<Mutex<Vec<GameRecord>>>,
    path: Arc<PathBuf>,
    events: EventHub,
}

impl GameLogController {
    pub fn load(data_dir: &Path, log: &LogHub, events: EventHub) -> Self {
        ensure_dir(data_dir, log);
        let path = data_dir.join(GAMES_FILE);
        let games = match read_json_migrated::<Vec<GameRecord>>(&path) {
            LoadResult::Loaded(v) => v,
            LoadResult::Missing => Vec::new(),
            LoadResult::Corrupt(err) => {
                quarantine(&path, log, "games.json", &err);
                Vec::new()
            }
        };
        log.info(
            "store",
            format!("loaded {} game(s) from {}", games.len(), path.display()),
        );
        Self {
            inner: Arc::new(Mutex::new(games)),
            path: Arc::new(path),
            events,
        }
    }

    /// Newest-first slice, honoring `limit` (or None for unbounded) and `offset`.
    pub fn list(&self, limit: Option<usize>, offset: usize) -> Vec<GameRecord> {
        let guard = self.inner.lock().unwrap();
        let iter = guard.iter().rev().skip(offset).cloned();
        match limit {
            Some(n) => iter.take(n).collect(),
            None => iter.collect(),
        }
    }

    pub fn snapshot(&self) -> Vec<GameRecord> {
        self.inner.lock().unwrap().clone()
    }

    /// High scores for the given display, computed over the current log.
    pub fn high_scores(&self, display: &str) -> DisplayHighScores {
        DisplayHighScores::from_games(display, &self.inner.lock().unwrap())
    }

    /// Append a new game. High-score flags are computed under the same lock so
    /// two concurrent submissions can't both claim the same "was the overall
    /// best" star.
    pub fn push(&self, new: NewGame) -> io::Result<GameRecord> {
        let mut guard = self.inner.lock().unwrap();
        // The details variant already tells us which display's high scores to
        // compare against — snapshot only those before inserting.
        let display = match &new.details {
            crate::types::NewGameDetails::Stallwaechter(_) => DISPLAY_STALLWAECHTER,
            crate::types::NewGameDetails::Arcade(_) => DISPLAY_ARCADE,
        };
        let prev = DisplayHighScores::from_games(display, &guard);
        let record = new.into_record(&prev);
        guard.push(record.clone());
        atomic_write_json(&self.path, &*guard)?;
        drop(guard);
        self.events.publish(ServerEvent::GameCreated(record.clone()));
        Ok(record)
    }

    /// Remove a record by id. Returns `true` if something was removed.
    pub fn delete(&self, id: Uuid) -> io::Result<bool> {
        let mut guard = self.inner.lock().unwrap();
        let before = guard.len();
        guard.retain(|g| g.id != id);
        let removed = guard.len() != before;
        if removed {
            atomic_write_json(&self.path, &*guard)?;
        }
        drop(guard);
        if removed {
            self.events.publish(ServerEvent::GameDeleted(id));
        }
        Ok(removed)
    }

    /// Remove every recorded game. Returns the number of entries dropped. Used
    /// by the attendant panel's "wipe high scores" action, which is the only
    /// path to this — the CLI intentionally stays read-only.
    pub fn clear(&self) -> io::Result<usize> {
        let mut guard = self.inner.lock().unwrap();
        if guard.is_empty() {
            return Ok(0);
        }
        let ids: Vec<Uuid> = guard.iter().map(|g| g.id).collect();
        let count = ids.len();
        guard.clear();
        atomic_write_json(&self.path, &*guard)?;
        drop(guard);
        for id in ids {
            self.events.publish(ServerEvent::GameDeleted(id));
        }
        Ok(count)
    }
}

// ---------------------------------------------------------------------------
// LeaderboardController — generic, per-`display` (arcade game id) top scores
// keyed by name. Unlike `GameLogController`, `display` is an open string, not
// a closed enum, so a new arcade game needs no backend change to start
// submitting. No SSE event on change — the UI fetches on open/submit, there's
// no live multi-kiosk sync need for this feature.
// ---------------------------------------------------------------------------

const LEADERBOARD_FILE: &str = "leaderboard.json";

#[derive(Clone)]
pub struct LeaderboardController {
    inner: Arc<Mutex<Vec<LeaderboardEntry>>>,
    path: Arc<PathBuf>,
}

impl LeaderboardController {
    pub fn load(data_dir: &Path, log: &LogHub) -> Self {
        ensure_dir(data_dir, log);
        let path = data_dir.join(LEADERBOARD_FILE);
        let entries = match read_json::<Vec<LeaderboardEntry>>(&path) {
            LoadResult::Loaded(v) => v,
            LoadResult::Missing => Vec::new(),
            LoadResult::Corrupt(err) => {
                quarantine(&path, log, "leaderboard.json", &err);
                Vec::new()
            }
        };
        log.info(
            "store",
            format!(
                "loaded {} leaderboard entry(ies) from {}",
                entries.len(),
                path.display()
            ),
        );
        Self {
            inner: Arc::new(Mutex::new(entries)),
            path: Arc::new(path),
        }
    }

    /// Entries for `display`, best-first (ties broken by earliest
    /// achievement), capped to `limit` (or unbounded when `None`).
    pub fn list(&self, display: &str, limit: Option<usize>) -> Vec<LeaderboardEntry> {
        let guard = self.inner.lock().unwrap();
        let mut entries: Vec<LeaderboardEntry> = guard
            .iter()
            .filter(|e| e.display == display)
            .cloned()
            .collect();
        entries.sort_by(|a, b| b.score.cmp(&a.score).then(a.ts_ms.cmp(&b.ts_ms)));
        match limit {
            Some(n) => entries.into_iter().take(n).collect(),
            None => entries,
        }
    }

    /// Upsert the best score for `(display, normalized name)`. Returns the
    /// record for that name after the call: updated if this score improved
    /// it, unchanged (and not persisted again) if it didn't — either way is
    /// success, never an error.
    pub fn submit(&self, new: NewLeaderboardEntry) -> io::Result<LeaderboardEntry> {
        let name = new.normalized_name();
        let mut guard = self.inner.lock().unwrap();
        let existing_idx = guard
            .iter()
            .position(|e| e.display == new.display && e.name == name);

        let record = if let Some(idx) = existing_idx {
            if new.score <= guard[idx].score {
                return Ok(guard[idx].clone());
            }
            guard[idx].score = new.score;
            guard[idx].ts_ms = now_ms();
            guard[idx].clone()
        } else {
            let entry = LeaderboardEntry {
                id: Uuid::new_v4(),
                ts_ms: now_ms(),
                display: new.display,
                name,
                score: new.score,
            };
            guard.push(entry.clone());
            entry
        };
        atomic_write_json(&self.path, &*guard)?;
        Ok(record)
    }

    /// Remove a single entry by id. Returns `true` if something was removed.
    /// Attendant-only, mirrors `GameLogController::delete` (no SSE event here
    /// either, matching the rest of this controller).
    pub fn delete(&self, id: Uuid) -> io::Result<bool> {
        let mut guard = self.inner.lock().unwrap();
        let before = guard.len();
        guard.retain(|e| e.id != id);
        let removed = guard.len() != before;
        if removed {
            atomic_write_json(&self.path, &*guard)?;
        }
        Ok(removed)
    }

    /// Remove every leaderboard entry (every display). Returns the number
    /// dropped. Attendant-only, mirrors `GameLogController::clear`.
    pub fn clear(&self) -> io::Result<usize> {
        let mut guard = self.inner.lock().unwrap();
        if guard.is_empty() {
            return Ok(0);
        }
        let count = guard.len();
        guard.clear();
        atomic_write_json(&self.path, &*guard)?;
        Ok(count)
    }
}

// ---------------------------------------------------------------------------
// CLI-facing helpers (synchronous, read-only, no LogHub side-effects)
// ---------------------------------------------------------------------------

/// Read the persisted game log without touching a store. Used by the read-only
/// CLI subcommands. Returns an empty vec if the file is absent; propagates
/// parse errors to the caller so a corrupted file surfaces loudly.
pub fn load_games(data_dir: &Path) -> Result<Vec<GameRecord>, Box<dyn std::error::Error>> {
    let path = data_dir.join(GAMES_FILE);
    match read_json_migrated::<Vec<GameRecord>>(&path) {
        LoadResult::Loaded(v) => Ok(v),
        LoadResult::Missing => Ok(Vec::new()),
        LoadResult::Corrupt(e) => Err(format!(
            "failed to parse {}: {} (rename or fix it, then rerun)",
            path.display(),
            e
        )
        .into()),
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

enum LoadResult<T> {
    Loaded(T),
    Missing,
    Corrupt(String),
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> LoadResult<T> {
    match fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<T>(&bytes) {
            Ok(v) => LoadResult::Loaded(v),
            Err(e) => LoadResult::Corrupt(e.to_string()),
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => LoadResult::Missing,
        Err(e) => LoadResult::Corrupt(format!("read error: {e}")),
    }
}

/// Same as [`read_json`], but first passes the raw bytes through
/// [`migrate_legacy_games_json`] so legacy Stallwächter records (missing the
/// `display` discriminator) still deserialize.
fn read_json_migrated<T: serde::de::DeserializeOwned>(path: &Path) -> LoadResult<T> {
    match fs::read(path) {
        Ok(bytes) => {
            let migrated = match migrate_legacy_games_json(&bytes) {
                Ok(b) => b,
                Err(e) => return LoadResult::Corrupt(format!("migrate error: {e}")),
            };
            match serde_json::from_slice::<T>(&migrated) {
                Ok(v) => LoadResult::Loaded(v),
                Err(e) => LoadResult::Corrupt(e.to_string()),
            }
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => LoadResult::Missing,
        Err(e) => LoadResult::Corrupt(format!("read error: {e}")),
    }
}

fn ensure_dir(dir: &Path, log: &LogHub) {
    if let Err(e) = fs::create_dir_all(dir) {
        // Don't fail boot; the first write attempt will surface the error too.
        log.error(
            "store",
            format!(
                "could not create data dir {} ({e}); persistence will fail",
                dir.display()
            ),
        );
    }
}

fn quarantine(path: &Path, log: &LogHub, label: &str, err: &str) {
    let backup = path.with_file_name(format!(
        "{}.corrupted-{}",
        path.file_name().and_then(|s| s.to_str()).unwrap_or(label),
        now_ms(),
    ));
    match fs::rename(path, &backup) {
        Ok(_) => log.error(
            "store",
            format!(
                "{label} failed to parse ({err}); quarantined at {} — booting on defaults",
                backup.display()
            ),
        ),
        Err(rename_err) => log.error(
            "store",
            format!(
                "{label} failed to parse ({err}) and could not be moved aside ({rename_err}); \
                 booting on defaults; NEXT WRITE WILL OVERWRITE the corrupt file"
            ),
        ),
    }
}

/// Write `value` as pretty JSON atomically: write to a sibling `.tmp` file,
/// `fsync`, then `rename` on top of the destination. `rename` is atomic on
/// POSIX (and best-effort on Windows), so a mid-write power loss can never
/// leave a half-written file behind.
fn atomic_write_json<T: serde::Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "path has no parent"))?;
    // Include the pid so parallel processes writing the same file don't collide
    // on the tmp name. Same-process writes serialize through the Mutex above.
    let tmp = dir.join(format!(
        ".{}.tmp.{}",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("file"),
        std::process::id()
    ));
    {
        let mut f = File::create(&tmp)?;
        f.write_all(&bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::events::EventHub;
    use crate::types::{
        GameDetails, GameEndReason, NewArcadeDetails, NewGameDetails, NewStallwaechterDetails,
        DISPLAY_ARCADE,
    };
    use tempfile::TempDir;

    fn stall_new(state: &str, reason: GameEndReason, score: u32, duration_ms: u32) -> NewGame {
        NewGame {
            score,
            duration_ms,
            details: NewGameDetails::Stallwaechter(NewStallwaechterDetails {
                state_id: state.into(),
                reason,
                escape_heading_rad: None,
            }),
        }
    }

    fn arcade_new(game_id: &str, score: u32) -> NewGame {
        NewGame {
            score,
            duration_ms: 1000,
            details: NewGameDetails::Arcade(NewArcadeDetails {
                game_id: game_id.into(),
                mode: "solo".into(),
                winner: None,
                player_name: None,
            }),
        }
    }

    fn hub() -> (LogHub, EventHub) {
        let events = EventHub::new(16);
        let log = LogHub::new(64, events.clone());
        (log, events)
    }

    #[test]
    fn game_log_push_computes_high_score_flags() {
        let dir = TempDir::new().unwrap();
        let (log, events) = hub();
        let store = GameLogController::load(dir.path(), &log, events);

        let first = store
            .push(stall_new("bayern", GameEndReason::Collision, 100, 5000))
            .unwrap();
        let GameDetails::Stallwaechter(fd) = &first.details else {
            panic!("expected Stallwaechter details")
        };
        assert!(fd.was_overall_high);
        assert!(fd.was_state_high);

        let second = store
            .push(stall_new("bayern", GameEndReason::Collision, 50, 3000))
            .unwrap();
        let GameDetails::Stallwaechter(sd) = &second.details else {
            panic!("expected Stallwaechter details")
        };
        assert!(!sd.was_overall_high);
        assert!(!sd.was_state_high);

        let third = store
            .push(stall_new("hessen", GameEndReason::ExitedGermany, 75, 4000))
            .unwrap();
        let GameDetails::Stallwaechter(td) = &third.details else {
            panic!("expected Stallwaechter details")
        };
        assert!(!td.was_overall_high); // 75 < 100
        assert!(td.was_state_high); // new state, > 0

        let DisplayHighScores::Stallwaechter(hs) = store.high_scores(DISPLAY_STALLWAECHTER)
        else {
            panic!("expected Stallwaechter high scores")
        };
        assert_eq!(hs.overall, 100);
        assert_eq!(hs.by_state.get("bayern").copied(), Some(100));
        assert_eq!(hs.by_state.get("hessen").copied(), Some(75));
    }

    #[test]
    fn game_log_push_scopes_arcade_high_scores_per_game() {
        let dir = TempDir::new().unwrap();
        let (log, events) = hub();
        let store = GameLogController::load(dir.path(), &log, events);

        store.push(arcade_new("jezzball", 500)).unwrap();
        let cf = store.push(arcade_new("connect-four", 1)).unwrap();
        let GameDetails::Arcade(cfd) = &cf.details else {
            panic!("expected Arcade details")
        };
        // connect-four's 1 doesn't collide with jezzball's 500.
        assert!(cfd.was_game_high);

        let DisplayHighScores::Arcade(hs) = store.high_scores(DISPLAY_ARCADE) else {
            panic!("expected Arcade high scores")
        };
        assert_eq!(hs.by_game.get("jezzball").copied(), Some(500));
        assert_eq!(hs.by_game.get("connect-four").copied(), Some(1));
    }

    #[test]
    fn game_log_delete_returns_false_for_unknown_id() {
        let dir = TempDir::new().unwrap();
        let (log, events) = hub();
        let store = GameLogController::load(dir.path(), &log, events);
        assert!(!store.delete(Uuid::new_v4()).unwrap());
    }

    #[test]
    fn game_log_delete_survives_reload() {
        let dir = TempDir::new().unwrap();
        let (log, events) = hub();
        let store = GameLogController::load(dir.path(), &log, events.clone());
        let rec = store
            .push(stall_new("berlin", GameEndReason::Collision, 42, 1000))
            .unwrap();
        assert!(store.delete(rec.id).unwrap());

        let reopened = GameLogController::load(dir.path(), &log, events);
        assert!(reopened.snapshot().is_empty());
    }

    #[test]
    fn corrupt_games_file_is_quarantined_and_empty_used() {
        let dir = TempDir::new().unwrap();
        std::fs::write(dir.path().join(GAMES_FILE), b"[ not valid json").unwrap();
        let (log, events) = hub();
        let store = GameLogController::load(dir.path(), &log, events);
        assert!(store.snapshot().is_empty());

        let quarantined: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("games.json.corrupted-")
            })
            .collect();
        assert_eq!(quarantined.len(), 1, "expected a quarantined backup file");
    }

    #[test]
    fn list_honors_limit_and_offset() {
        let dir = TempDir::new().unwrap();
        let (log, events) = hub();
        let store = GameLogController::load(dir.path(), &log, events);
        for i in 0..5 {
            store
                .push(stall_new("bayern", GameEndReason::Collision, i, 1000))
                .unwrap();
        }
        // Newest-first: scores should be 4,3,2,1,0.
        let all = store.list(None, 0);
        assert_eq!(all.iter().map(|g| g.score).collect::<Vec<_>>(), vec![4, 3, 2, 1, 0]);

        let page = store.list(Some(2), 1);
        assert_eq!(page.iter().map(|g| g.score).collect::<Vec<_>>(), vec![3, 2]);
    }

    fn new_score(display: &str, name: &str, score: u32) -> NewLeaderboardEntry {
        NewLeaderboardEntry {
            display: display.into(),
            name: name.into(),
            score,
        }
    }

    #[test]
    fn leaderboard_submit_inserts_new_name() {
        let dir = TempDir::new().unwrap();
        let (log, _events) = hub();
        let store = LeaderboardController::load(dir.path(), &log);
        let rec = store.submit(new_score("jezzball", "abc", 100)).unwrap();
        assert_eq!(rec.name, "abc");
        assert_eq!(rec.score, 100);
        assert_eq!(store.list("jezzball", None).len(), 1);
    }

    #[test]
    fn leaderboard_submit_keeps_only_the_top_score_per_name() {
        let dir = TempDir::new().unwrap();
        let (log, _events) = hub();
        let store = LeaderboardController::load(dir.path(), &log);
        store.submit(new_score("jezzball", "abc", 100)).unwrap();

        // A lower score under the same name is a no-op: unchanged, not an error.
        let unchanged = store.submit(new_score("jezzball", "abc", 50)).unwrap();
        assert_eq!(unchanged.score, 100);
        assert_eq!(store.list("jezzball", None).len(), 1);

        // A higher score under the same name overwrites it in place.
        let improved = store.submit(new_score("jezzball", "abc", 150)).unwrap();
        assert_eq!(improved.score, 150);
        assert_eq!(improved.id, unchanged.id);
        assert_eq!(store.list("jezzball", None).len(), 1);
    }

    #[test]
    fn leaderboard_submit_normalizes_name_before_matching() {
        let dir = TempDir::new().unwrap();
        let (log, _events) = hub();
        let store = LeaderboardController::load(dir.path(), &log);
        store.submit(new_score("jezzball", "ABC", 100)).unwrap();
        // Different case/whitespace, same normalized name: still one entry.
        store.submit(new_score("jezzball", "  abc  ", 200)).unwrap();
        let entries = store.list("jezzball", None);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].score, 200);
    }

    #[test]
    fn leaderboard_list_sorts_by_score_then_earliest_and_filters_by_display() {
        let dir = TempDir::new().unwrap();
        let (log, _events) = hub();
        let store = LeaderboardController::load(dir.path(), &log);
        store.submit(new_score("jezzball", "low", 10)).unwrap();
        store.submit(new_score("jezzball", "high", 90)).unwrap();
        store.submit(new_score("orbo", "other", 999)).unwrap();

        let entries = store.list("jezzball", None);
        assert_eq!(
            entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(),
            vec!["high", "low"]
        );

        let capped = store.list("jezzball", Some(1));
        assert_eq!(capped.len(), 1);
        assert_eq!(capped[0].name, "high");
    }

    #[test]
    fn leaderboard_survives_reload() {
        let dir = TempDir::new().unwrap();
        let (log, _events) = hub();
        let store = LeaderboardController::load(dir.path(), &log);
        store.submit(new_score("jezzball", "abc", 100)).unwrap();

        let reopened = LeaderboardController::load(dir.path(), &log);
        assert_eq!(reopened.list("jezzball", None).len(), 1);
    }

    #[test]
    fn leaderboard_delete_removes_one_entry_and_survives_reload() {
        let dir = TempDir::new().unwrap();
        let (log, _events) = hub();
        let store = LeaderboardController::load(dir.path(), &log);
        let rec = store.submit(new_score("jezzball", "abc", 100)).unwrap();
        store.submit(new_score("jezzball", "xyz", 50)).unwrap();

        assert!(store.delete(rec.id).unwrap());
        assert!(!store.delete(rec.id).unwrap(), "deleting twice is a no-op");

        let entries = store.list("jezzball", None);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "xyz");

        let reopened = LeaderboardController::load(dir.path(), &log);
        assert_eq!(reopened.list("jezzball", None).len(), 1);
    }

    #[test]
    fn leaderboard_clear_wipes_every_display() {
        let dir = TempDir::new().unwrap();
        let (log, _events) = hub();
        let store = LeaderboardController::load(dir.path(), &log);
        store.submit(new_score("jezzball", "abc", 100)).unwrap();
        store.submit(new_score("orbo", "xyz", 50)).unwrap();
        assert_eq!(store.clear().unwrap(), 2);
        assert!(store.list("jezzball", None).is_empty());
        assert!(store.list("orbo", None).is_empty());
    }
}
