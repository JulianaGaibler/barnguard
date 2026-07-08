//! HTTP + SSE server. All routes live under `/api/printer`.

pub mod routes;
pub mod sse;

use crate::events::EventHub;
use printer_driver::MockControls;
use crate::log::LogHub;
use crate::queue::QueueController;
use crate::client_config::ClientConfigState;
use crate::store::GameLogController;
use axum::http::{header, HeaderValue, Method};
use axum::routing::{delete, get, post};
use axum::Router;
use std::sync::{Arc, RwLock};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

/// Shared application state handed to every handler.
#[derive(Clone)]
pub struct AppState {
    pub controller: QueueController,
    pub events: EventHub,
    pub log: LogHub,
    /// `Some` only when the mock backend is active; gates `/debug/mock`.
    pub mock: Option<Arc<MockControls>>,
    pub games: GameLogController,
    /// Client-facing config served to the web app: base value from
    /// `config.toml` plus an optional in-memory override. Mutated by
    /// `/config/reload` and `/config/override`; read by the SSE snapshot +
    /// `GET /config`.
    pub client_config: Arc<RwLock<ClientConfigState>>,
}

pub fn build_router(state: AppState, allowed_origins: &[String]) -> Router {
    let cors = build_cors(allowed_origins);
    let router = Router::new()
        .route("/api/printer/print", post(routes::print))
        .route("/api/printer/status", get(routes::status))
        .route("/api/printer/queue", get(routes::queue))
        .route("/api/printer/queue/clear", post(routes::clear))
        .route("/api/printer/reconnect", post(routes::reconnect))
        .route("/api/printer/config", get(routes::config_get))
        .route("/api/printer/config/reload", post(routes::config_reload))
        .route(
            "/api/printer/config/override",
            post(routes::config_override).delete(routes::config_override_reset),
        )
        .route("/api/printer/log", get(routes::log))
        .route("/api/printer/jobs/{id}", get(routes::job))
        .route("/api/printer/jobs/{id}/cancel", post(routes::cancel))
        .route("/api/printer/jobs/{id}/reprint", post(routes::reprint))
        .route("/api/printer/events", get(sse::events))
        .route("/api/printer/debug/mock", post(routes::debug_mock))
        .route("/api/printer/healthz", get(routes::healthz))
        .route(
            "/api/games",
            get(routes::games_list)
                .post(routes::games_create)
                .delete(routes::games_clear),
        )
        .route("/api/games/high-scores", get(routes::games_high_scores))
        .route("/api/games/{id}", delete(routes::games_delete));

    // Serve the embedded SPA for everything else (release builds only).
    #[cfg(feature = "embed-web")]
    let router = router.fallback(crate::web::handler);

    router
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// CORS. A `"*"` entry (or the kiosk default) yields a fully permissive layer;
/// there is no security boundary on the locked-down booth network. Otherwise
/// only the listed origins are allowed.
fn build_cors(origins: &[String]) -> CorsLayer {
    if origins.iter().any(|o| o == "*") || origins.is_empty() {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST, Method::DELETE])
            .allow_headers(Any)
    } else {
        let list: Vec<HeaderValue> = origins.iter().filter_map(|o| o.parse().ok()).collect();
        CorsLayer::new()
            .allow_origin(list)
            .allow_methods([Method::GET, Method::POST, Method::DELETE])
            .allow_headers([header::CONTENT_TYPE])
    }
}
