//! REST handlers. JSON out; the print body is raw `image/jpeg`.

use super::AppState;
use crate::config::Config;
use crate::queue::{CancelOutcome, ReprintError};
use crate::types::{
    JobMeta, NewGame, PrintJob, PrinterStatus, ServerEvent, DISPLAY_STALLWAECHTER,
};
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintQuery {
    pub state_id: Option<String>,
    pub score: Option<i64>,
    pub high_score: Option<bool>,
    pub source: Option<String>,
}

/// `POST /print`. Body is the raw JPEG; metadata comes from the query string.
pub async fn print(
    State(st): State<AppState>,
    Query(q): Query<PrintQuery>,
    body: Bytes,
) -> Response {
    if body.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "empty_body"})),
        )
            .into_response();
    }
    let meta = JobMeta {
        state_id: q.state_id,
        score: q.score,
        high_score: q.high_score.unwrap_or(false),
        source: q.source,
    };
    let id = st.controller.enqueue(meta, body.to_vec());
    let position = st.controller.queue_len() as u64;
    (
        StatusCode::ACCEPTED,
        Json(json!({ "jobId": id.to_string(), "state": "queued", "queuePosition": position })),
    )
        .into_response()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    printer: PrinterStatus,
    queue_length: usize,
    active: Option<PrintJob>,
}

/// `GET /status`
pub async fn status(State(st): State<AppState>) -> impl IntoResponse {
    let snap = st.controller.snapshot();
    Json(StatusResponse {
        printer: st.controller.status(),
        queue_length: snap.pending.len(),
        active: snap.active,
    })
}

/// `GET /queue`
pub async fn queue(State(st): State<AppState>) -> impl IntoResponse {
    Json(st.controller.snapshot())
}

/// `GET /jobs/{id}`
pub async fn job(State(st): State<AppState>, Path(id): Path<String>) -> Response {
    let Ok(uuid) = Uuid::parse_str(&id) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad_id"}))).into_response();
    };
    match st.controller.find(uuid) {
        Some(j) => Json(j).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response(),
    }
}

/// `POST /jobs/{id}/cancel`
pub async fn cancel(State(st): State<AppState>, Path(id): Path<String>) -> Response {
    let Ok(uuid) = Uuid::parse_str(&id) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad_id"}))).into_response();
    };
    match st.controller.cancel(uuid) {
        CancelOutcome::Canceled => {
            Json(json!({ "id": uuid.to_string(), "state": "canceled" })).into_response()
        }
        CancelOutcome::AlreadyActive => (
            StatusCode::CONFLICT,
            Json(json!({"error": "already_printing"})),
        )
            .into_response(),
        CancelOutcome::NotFound => {
            (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response()
        }
    }
}

/// `POST /jobs/{id}/reprint`
pub async fn reprint(State(st): State<AppState>, Path(id): Path<String>) -> Response {
    let Ok(uuid) = Uuid::parse_str(&id) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad_id"}))).into_response();
    };
    match st.controller.reprint(uuid) {
        Ok(new_id) => (
            StatusCode::ACCEPTED,
            Json(json!({ "jobId": new_id.to_string(), "state": "queued" })),
        )
            .into_response(),
        Err(ReprintError::NotFound) => {
            (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response()
        }
        Err(ReprintError::BytesEvicted) => {
            (StatusCode::GONE, Json(json!({"error": "bytes_evicted"}))).into_response()
        }
    }
}

/// `POST /queue/clear`
pub async fn clear(State(st): State<AppState>) -> impl IntoResponse {
    let cleared = st.controller.clear() as u64;
    Json(json!({ "cleared": cleared }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugMock {
    pub force_no_media: Option<bool>,
    pub force_awaiting_removal: Option<bool>,
    pub clear_awaiting_removal: Option<bool>,
    pub force_unreachable: Option<bool>,
}

/// `POST /debug/mock`. Mock backend only.
pub async fn debug_mock(State(st): State<AppState>, Json(body): Json<DebugMock>) -> Response {
    let Some(controls) = &st.mock else {
        return (StatusCode::NOT_FOUND, Json(json!({"error": "not_mock"}))).into_response();
    };
    if let Some(v) = body.force_no_media {
        controls.set_no_media(v);
    }
    if let Some(v) = body.force_awaiting_removal {
        controls.set_force_awaiting_removal(v);
    }
    if body.clear_awaiting_removal == Some(true) {
        controls.clear_awaiting();
    }
    if let Some(v) = body.force_unreachable {
        controls.set_unreachable(v);
    }
    // Reflect the change immediately: nudge the worker to re-poll + publish a
    // fresh status now instead of waiting for the next keep-alive tick.
    st.controller.request_reconnect();
    Json(json!({ "ok": true })).into_response()
}

/// `POST /reconnect`. Nudges the worker to poll the printer immediately
/// instead of waiting for the next keep-alive tick.
pub async fn reconnect(State(st): State<AppState>) -> impl IntoResponse {
    st.controller.request_reconnect();
    Json(json!({ "ok": true }))
}

/// `GET /config`. Current client-facing config: the effective label URL plus
/// whether a runtime override is active.
pub async fn config_get(State(st): State<AppState>) -> impl IntoResponse {
    Json(st.client_config.read().unwrap().snapshot())
}

/// `POST /config/reload`. Re-reads `config.toml` from disk and pushes the
/// client-facing subset to every browser over SSE. Refreshes the base label URL
/// but leaves any active override in place. Only `[client]` values take effect
/// live; printer/print/timing/mock changes still need a daemon restart. Reads
/// the same file the daemon booted with (`main` forwards `--config` into
/// `$PRINTER_DAEMON_CONFIG`, which `Config::load` honours).
pub async fn config_reload(State(st): State<AppState>) -> Response {
    match Config::load() {
        Ok(cfg) => {
            let snapshot = {
                let mut cc = st.client_config.write().unwrap();
                cc.set_base_label_url(cfg.client.label_url);
                cc.snapshot()
            };
            st.events.publish(ServerEvent::Config(snapshot));
            st.log.info(
                "system",
                "config reloaded (client values applied; \
                 printer/print/timing changes need a daemon restart)",
            );
            Json(json!({ "ok": true })).into_response()
        }
        Err(e) => {
            st.log
                .warn("system", format!("config reload failed: {e}"));
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": e.to_string() })),
            )
                .into_response()
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOverride {
    pub label_url: String,
}

/// `POST /config/override`. Set an in-memory label-URL override that supersedes
/// the `config.toml` value until reset. Not persisted — a last-minute escape
/// hatch. Rejects a blank URL so the label can't be emptied.
pub async fn config_override(
    State(st): State<AppState>,
    Json(body): Json<ConfigOverride>,
) -> Response {
    let url = body.label_url.trim().to_string();
    if url.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "empty_label_url" })),
        )
            .into_response();
    }
    let snapshot = {
        let mut cc = st.client_config.write().unwrap();
        cc.set_override(url.clone());
        cc.snapshot()
    };
    st.events.publish(ServerEvent::Config(snapshot));
    st.log
        .info("system", format!("label URL override set to {url:?}"));
    Json(json!({ "ok": true })).into_response()
}

/// `DELETE /config/override`. Clear the override, reverting to the `config.toml`
/// value.
pub async fn config_override_reset(State(st): State<AppState>) -> impl IntoResponse {
    let snapshot = {
        let mut cc = st.client_config.write().unwrap();
        cc.clear_override();
        cc.snapshot()
    };
    st.events.publish(ServerEvent::Config(snapshot));
    st.log
        .info("system", "label URL override cleared (using config.toml)");
    Json(json!({ "ok": true }))
}

/// `GET /log`. Recent buffered log entries (oldest → newest).
pub async fn log(State(st): State<AppState>) -> impl IntoResponse {
    Json(st.log.snapshot())
}

/// `GET /healthz`
pub async fn healthz() -> &'static str {
    "ok"
}

// ---------------------------------------------------------------------------
// /api/games — append-only log of finished games
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamesQuery {
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    /// Optional display filter. When set, only records whose `display` tag
    /// matches this id are returned. Absent → all displays.
    pub display: Option<String>,
}

/// `GET /api/games?limit=N&offset=M&display=<id>`. Newest-first.
pub async fn games_list(
    State(st): State<AppState>,
    Query(q): Query<GamesQuery>,
) -> impl IntoResponse {
    let all = st.games.list(q.limit, q.offset.unwrap_or(0));
    let filtered: Vec<_> = match q.display.as_deref() {
        Some(display) => all
            .into_iter()
            .filter(|g| g.display_id() == display)
            .collect(),
        None => all,
    };
    Json(filtered)
}

/// `POST /api/games`. Persists the record and emits `game.created`.
pub async fn games_create(
    State(st): State<AppState>,
    Json(body): Json<NewGame>,
) -> Response {
    match st.games.push(body) {
        Ok(record) => (StatusCode::CREATED, Json(record)).into_response(),
        Err(e) => write_error(&st, "games", e),
    }
}

/// `DELETE /api/games`. Wipes the whole log; returns `{ cleared: N }`.
pub async fn games_clear(State(st): State<AppState>) -> Response {
    match st.games.clear() {
        Ok(n) => Json(json!({ "cleared": n })).into_response(),
        Err(e) => write_error(&st, "games", e),
    }
}

/// `DELETE /api/games/{id}`. 204 on success, 404 if unknown.
pub async fn games_delete(State(st): State<AppState>, Path(id): Path<String>) -> Response {
    let Ok(uuid) = Uuid::parse_str(&id) else {
        return (StatusCode::BAD_REQUEST, Json(json!({"error": "bad_id"}))).into_response();
    };
    match st.games.delete(uuid) {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => (StatusCode::NOT_FOUND, Json(json!({"error": "not_found"}))).into_response(),
        Err(e) => write_error(&st, "games", e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighScoresQuery {
    /// Which display to compute high scores for. Defaults to Stallwächter,
    /// which is the only display shipping today.
    pub display: Option<String>,
}

/// `GET /api/games/high-scores?display=<id>`. Computed on demand from the log.
pub async fn games_high_scores(
    State(st): State<AppState>,
    Query(q): Query<HighScoresQuery>,
) -> impl IntoResponse {
    let display = q.display.as_deref().unwrap_or(DISPLAY_STALLWAECHTER);
    Json(st.games.high_scores(display))
}

/// Surface a persistence I/O error as a 500, and log it loudly. Persistence
/// failures on a kiosk (bad disk, missing perms, out of space) are things an
/// operator needs to see immediately.
fn write_error(st: &AppState, source: &str, err: std::io::Error) -> Response {
    st.log
        .error(source, format!("failed to persist to disk: {err}"));
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": "write_failed", "detail": err.to_string()})),
    )
        .into_response()
}
