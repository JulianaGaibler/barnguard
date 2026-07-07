//! Serves the built SPA, embedded into the binary at compile time via
//! `rust-embed`. Only compiled under the `embed-web` feature (release/deploy
//! builds); in dev, Vite serves the app and proxies the API instead.

use axum::body::Body;
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use rust_embed::{EmbeddedFile, RustEmbed};

#[derive(RustEmbed)]
#[folder = "../../web/dist"] // produced by `npm --prefix web run build`
struct WebAssets;

/// Router fallback for any path not matched by the `/api/printer/*` routes:
/// serve the embedded file at that path, else fall back to `index.html` so the
/// SPA can handle client-side routing.
pub async fn handler(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    match WebAssets::get(path) {
        Some(file) => serve(file),
        None => match WebAssets::get("index.html") {
            Some(index) => serve(index),
            None => (StatusCode::NOT_FOUND, "web assets not embedded").into_response(),
        },
    }
}

/// Serve an embedded file with the correct `Content-Type` (from `mime_guess`),
/// so ES modules etc. aren't blocked by strict browser MIME checking.
fn serve(file: EmbeddedFile) -> Response {
    let mime = file.metadata.mimetype().to_string();
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .body(Body::from(file.data.into_owned()))
        .unwrap_or_else(|_| (StatusCode::INTERNAL_SERVER_ERROR, "asset error").into_response())
}
