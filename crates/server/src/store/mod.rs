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
use crate::types::{now_ms, GameRecord, HighScores, NewGame, ServerEvent};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const GAMES_FILE: &str = "games.json";

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
        let games = match read_json::<Vec<GameRecord>>(&path) {
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

    pub fn high_scores(&self) -> HighScores {
        HighScores::from_games(&self.inner.lock().unwrap())
    }

    /// Append a new game. High-score flags are computed under the same lock so
    /// two concurrent submissions can't both claim the same "was the overall
    /// best" star.
    pub fn push(&self, new: NewGame) -> io::Result<GameRecord> {
        let mut guard = self.inner.lock().unwrap();
        let prev = HighScores::from_games(&guard);
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
// CLI-facing helpers (synchronous, read-only, no LogHub side-effects)
// ---------------------------------------------------------------------------

/// Read the persisted game log without touching a store. Used by the read-only
/// CLI subcommands. Returns an empty vec if the file is absent; propagates
/// parse errors to the caller so a corrupted file surfaces loudly.
pub fn load_games(data_dir: &Path) -> Result<Vec<GameRecord>, Box<dyn std::error::Error>> {
    let path = data_dir.join(GAMES_FILE);
    match read_json::<Vec<GameRecord>>(&path) {
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
    use crate::types::GameEndReason;
    use tempfile::TempDir;

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
            .push(NewGame {
                state_id: "bayern".into(),
                reason: GameEndReason::Collision,
                score: 100,
                duration_ms: 5000,
                escape_heading_rad: None,
            })
            .unwrap();
        assert!(first.was_overall_high);
        assert!(first.was_state_high);

        let second = store
            .push(NewGame {
                state_id: "bayern".into(),
                reason: GameEndReason::Collision,
                score: 50,
                duration_ms: 3000,
                escape_heading_rad: None,
            })
            .unwrap();
        assert!(!second.was_overall_high);
        assert!(!second.was_state_high);

        let third = store
            .push(NewGame {
                state_id: "hessen".into(),
                reason: GameEndReason::ExitedGermany,
                score: 75,
                duration_ms: 4000,
                escape_heading_rad: Some(1.5),
            })
            .unwrap();
        assert!(!third.was_overall_high); // 75 < 100
        assert!(third.was_state_high); // new state, > 0

        let hs = store.high_scores();
        assert_eq!(hs.overall, 100);
        assert_eq!(hs.by_state.get("bayern").copied(), Some(100));
        assert_eq!(hs.by_state.get("hessen").copied(), Some(75));
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
            .push(NewGame {
                state_id: "berlin".into(),
                reason: GameEndReason::Collision,
                score: 42,
                duration_ms: 1000,
                escape_heading_rad: None,
            })
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
                .push(NewGame {
                    state_id: "bayern".into(),
                    reason: GameEndReason::Collision,
                    score: i,
                    duration_ms: 1000,
                    escape_heading_rad: None,
                })
                .unwrap();
        }
        // Newest-first: scores should be 4,3,2,1,0.
        let all = store.list(None, 0);
        assert_eq!(all.iter().map(|g| g.score).collect::<Vec<_>>(), vec![4, 3, 2, 1, 0]);

        let page = store.list(Some(2), 1);
        assert_eq!(page.iter().map(|g| g.score).collect::<Vec<_>>(), vec![3, 2]);
    }
}
