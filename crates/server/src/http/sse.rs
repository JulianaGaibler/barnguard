//! Server-Sent Events endpoint. Streams `status`, `job`, and `queue` events. On
//! connect it first replays the current status + queue snapshot so a late
//! subscriber is immediately consistent.

use super::AppState;
use crate::types::ServerEvent;
use axum::extract::State;
use axum::response::sse::{Event, KeepAlive, Sse};
use futures_util::{stream, Stream, StreamExt};
use std::convert::Infallible;
use std::time::Duration;
use tokio_stream::wrappers::BroadcastStream;

pub async fn events(
    State(st): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // Subscribe BEFORE snapshotting, so anything emitted between the two isn't
    // missed. (status/queue may arrive once more on the live stream, harmless;
    // log dupes across reconnects are handled client-side by clearing on open.)
    let live = BroadcastStream::new(st.events.subscribe()).filter_map(|res| async move {
        match res {
            Ok(ev) => Some(Ok(event_to_sse(ev))),
            // Dropped due to lag; skip. The next full `queue` event re-syncs.
            Err(_) => None,
        }
    });

    // Real named `ping` events every 15 s. The `KeepAlive` below sends an SSE
    // comment line (`:ping\n\n`) — browsers ignore comment lines, so they
    // don't dispatch to any EventSource handler and can't feed the client's
    // heartbeat monitor. A named event does dispatch, so the client bumps its
    // liveness clock on receipt. Comment keep-alive is kept as a byte-level
    // fallback for intermediary proxies.
    let pings = stream::unfold((), |()| async {
        tokio::time::sleep(Duration::from_secs(15)).await;
        Some((
            Ok::<_, Infallible>(Event::default().event("ping").data("ping")),
            (),
        ))
    });

    // Replay current snapshot + buffered log history so a (re)connecting client
    // is immediately consistent and gets recent messages ("flush on connect").
    let status = st.controller.status();
    let snapshot = st.controller.snapshot();
    let logs = st.log.snapshot();
    let games = st.games.snapshot();
    let client_config = st.client_config.read().unwrap().snapshot();
    let mut initial: Vec<Result<Event, Infallible>> = Vec::with_capacity(4 + logs.len());
    initial.push(Ok(sse_json("status", &status)));
    initial.push(Ok(sse_json("queue", &snapshot)));
    initial.push(Ok(sse_json("games", &games)));
    initial.push(Ok(sse_json("config", &client_config)));
    for entry in &logs {
        initial.push(Ok(sse_json("log", entry)));
    }

    let tail = stream::select(live, pings);
    Sse::new(stream::iter(initial).chain(tail)).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}

fn sse_json<T: serde::Serialize>(name: &str, value: &T) -> Event {
    let data = serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string());
    Event::default().event(name).data(data)
}

fn event_to_sse(ev: ServerEvent) -> Event {
    match ev {
        ServerEvent::Status(s) => sse_json("status", &s),
        ServerEvent::Job(j) => sse_json("job", &j),
        ServerEvent::Queue(q) => sse_json("queue", &q),
        ServerEvent::Log(e) => sse_json("log", &e),
        ServerEvent::GameCreated(g) => sse_json("game.created", &g),
        ServerEvent::GameDeleted(id) => {
            Event::default().event("game.deleted").data(id.to_string())
        }
        ServerEvent::Config(c) => sse_json("config", &c),
    }
}
