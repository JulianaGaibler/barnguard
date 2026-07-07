# printer-daemon (server)

The barnguard server. Owns the connection to a Brother VC-500W label printer
(via the [`printer-driver` crate](../printer-driver/)), serializes print jobs
through a single worker, exposes an HTTP + SSE API for the web app, and,
behind the `embed-web` feature, serves the built SPA from `web/dist/` so one
binary hosts everything.

Runnable output: `barnguard-server` (in `target/release/` after
`cargo build --release -p printer-daemon --features embed-web`).

## Architecture

There are two hops with different communication styles:

```
   Browser (web app)                 printer-daemon                     Printer
  ┌────────────────┐   HTTP POST    ┌───────────────────────┐   XML/TCP  ┌─────────┐
  │ GameOverOverlay│──/print, etc.─▶│ axum HTTP handlers     │           │ VC-500W │
  │ PrinterPanel   │                │        │ mpsc/notify   │           │  :9100  │
  │                │◀═══ SSE ═══════│  Worker task (1)       │──poll────▶│         │
  │ (printerLive)  │  push: status, │  owns Box<dyn Backend> │◀─resp─────│         │
  └────────────────┘  job, queue    └───────────────────────┘           └─────────┘
        ▲  PUSH  (daemon → browser)          POLL  (daemon → printer)  ▲
```

Daemon → browser is push (SSE). The daemon broadcasts `status`, `job`, and
`queue` events the instant it has something new.

Daemon → printer is poll (request/response). The printer never calls back;
the daemon only learns its state by asking (`get_status`). State the daemon
drives itself (a job going `printing → cutting → done`) is pushed instantly;
externally-changed state (printer asleep, out of media) is discovered on the
next poll and then pushed.

### Module layout (`src/`)

| File | Responsibility |
|---|---|
| `main.rs` / `lib.rs` | Entry point: load config, spawn worker, serve HTTP. |
| `config.rs` | `Config` (TOML + env overrides + validation). |
| `types.rs` | Wire DTOs: `PrinterStatus`, `PrintJob`, `JobState`, `JobMeta`, `QueueSnapshot`, `LogEntry`, `ServerEvent`. |
| `queue.rs` | `QueueStore` + `QueueController` + the worker task (the FSM). |
| `events.rs` | Broadcast hub feeding SSE. |
| `log.rs` | In-memory operator-log ring, published on SSE. |
| `backend_factory.rs` | Maps `Config` to `printer-driver` constructors. |
| `http/mod.rs` | axum router + CORS. |
| `http/routes.rs` | REST handlers. |
| `http/sse.rs` | `/events` stream. |
| `web.rs` (feature `embed-web`) | Serves the SPA embedded via `rust-embed`. |

The wire protocol, TCP + mock backends, `PrinterBackend` trait, and generic
types (`PrinterState`, `PrintOpts`, `PrinterHealth`, `PrinterError`, …) live
in [`crates/printer-driver/`](../printer-driver/).

### Concurrency model

A single worker task owns the printer backend, so the socket is never used
concurrently. HTTP handlers mutate the shared `QueueStore` (behind a `Mutex`)
directly for fast operations (enqueue/cancel/reprint/clear) and emit the SSE
event before the HTTP response returns, so the stream is consistent with the
response (no "200 OK but SSE still says printing" race). Only the worker
touches the backend and drives job progress. A `Notify` lets handlers wake
the idle worker immediately (new job, or a reconnect request).

## The print lifecycle (and the quirks it handles)

Each job runs through this sequence in the worker; the ordering is dictated
by the hardware:

```
Queued
  → get_status()            pre-flight: NoMedia → fail fast (don't send bytes);
                            AwaitingRemoval → wait until the old label is pulled
  → send <print> + JPEG     ack "ready to receive" → stream exactly datasize bytes
                            → ack "print data received"
  → state = Printing
  → CLOSE the TCP socket    ★ this is what triggers the physical cut
  → state = Cutting
  → sleep(cut_wait_ms)      let the cut cycle begin
  → reconnect
  → poll get_status() until Idle           (every poll_interval_ms)
       · AwaitingRemoval → hold (no timeout, waits on a human), then Done
       · idle_timeout    → Done + warning "idle_timeout" (label almost certainly
                           printed; NOT retried, to avoid a duplicate)
  → Done
```

Quirks handled here:

- Socket-close triggers the cut. The backend's `send_print` deliberately
  leaves the socket open; the worker calls `close_for_cut()` to cut, waits
  `cut_wait_ms`, then reconnects to resume polling.
- Output-slot sensor. If a printed label is still in the slot the printer
  won't start the next job; the worker surfaces `awaiting_removal` and waits
  (no timeout) for it to clear rather than erroring.
- No media. A pre-flight check (and the printer's `code 3`) aborts before
  any JPEG bytes are sent; the job fails with `no_media` and is not
  auto-retried (retrying just spins). The bytes are retained so an
  attendant can reprint after loading tape.

`JobState`: `queued · printing · cutting · awaiting_removal · done · failed · canceled`.

### Retry policy

- `NoMedia` / `NotReady` → terminal (`failed`), no retry.
- `Timeout` / `Disconnected` mid-sequence → retry the whole job at most
  `max_retries` times (default 1). Capped low on purpose: a failure after
  "print data received" may mean the label already printed, so aggressive
  retry risks duplicates.
- Post-send `idle_timeout` → `done` with a `warning`, not a retry.

## Status polling: adaptive cadence, keep-alive, reconnect

Because the printer only reveals its state when polled, the worker uses an
adaptive idle cadence:

- Slow (`keepalive_interval_ms`, default 30s) when the booth is quiet, just
  frequent enough to prevent the printer's auto-sleep. TCP is refused while
  asleep; waking needs a physical button, so continued polling is what
  detects recovery.
- Fast (`active_interval_ms`, default 3s) while a job is running or recently
  finished, so the panel stays fresh during a busy session.
- Relaxes back to slow after `active_linger_ms` (default 30s) with no job.

During a job the post-cut wait already polls at `poll_interval_ms`; the
adaptive rates above govern the idle cadence between/after jobs. Enqueue,
reconnect, and debug actions `notify` the worker to poll immediately, so
they never wait for an interval.

### Unreachable telemetry + manual reconnect

Every status poll updates connection telemetry, published in `PrinterStatus`:

- `reachable`: `false` when the last poll failed.
- `failedAttempts`: consecutive failed polls since the last success.
- `unreachableSinceMs`: when it first went unreachable (for "unreachable for Xm").

The daemon retries forever, so the booth recovers without an attendant. For
instant feedback after someone fixes the printer, `POST /reconnect` nudges
the worker to poll immediately instead of waiting for the next tick (this
backs the attendant panel's "Reconnect printer" button).

### Boot reconciliation

On start-up the worker connects, reads `/config.xml` (to learn tape width),
and if the printer is mid-state (`awaiting_removal` / printing after a power
loss) it waits for that to clear before processing any queued job, rather
than printing on top of a stuck label.

## Backends

Selected by `backend` in config; both implement the same `PrinterBackend`
trait (from `printer-driver`).

- `tcp`: the real printer over `TcpStream`. Requires `printer.host`.
- `mock`: no hardware. Simulates the timing/state machine and writes each
  received JPEG (+ a `.json` sidecar of the print options) to `mock.out_dir`
  (pruned to the newest ~50 on boot) so you can eyeball output. Supports
  fault injection via `POST /debug/mock` for exercising UI states:

  | Flag | Effect |
  |---|---|
  | `forceNoMedia` | `get_status` reports `no_media`; prints fail without writing. |
  | `forceAwaitingRemoval` | after the next print, holds in `awaiting_removal`. |
  | `clearAwaitingRemoval` | release a held label. |
  | `forceUnreachable` | `get_status` errors, simulating a powered-off / crashed printer. |

  `/debug/mock` nudges an immediate poll, so flag changes reflect on the
  panel right away rather than on the next keep-alive tick.

## HTTP + SSE API

All routes are under `/api/printer`. JSON responses; the print body is raw
`image/jpeg`. Wire fields are `camelCase`.

| Method | Path | Notes |
|---|---|---|
| POST | `/print` | body = raw JPEG; meta via query: `stateId`, `score`, `highScore`, `source`. → `202 { jobId, state, queuePosition }` |
| GET  | `/status` | `{ printer: PrinterStatus, queueLength, active: PrintJob\|null }` |
| GET  | `/queue` | `{ active, pending[], recent[] }` |
| GET  | `/jobs/{id}` | one `PrintJob` (404 if unknown) |
| POST | `/jobs/{id}/cancel` | cancels a queued job; `409` if already printing |
| POST | `/jobs/{id}/reprint` | re-enqueues the retained bytes as a new job; `410` if evicted |
| POST | `/queue/clear` | drops all queued jobs → `{ cleared }` |
| POST | `/reconnect` | nudge an immediate printer poll (manual retry) |
| GET  | `/events` | SSE stream (see below) |
| POST | `/debug/mock` | mock backend only; `{ forceNoMedia?, forceAwaitingRemoval?, clearAwaitingRemoval?, forceUnreachable? }` |
| GET  | `/healthz` | liveness → `ok` |

### SSE events (`GET /events`)

On connect the stream first replays the current `status` + `queue` snapshot,
so a late subscriber is immediately consistent; then it pushes live. A
`: ping` comment every 15s keeps the connection alive.

| `event:` | `data:` payload |
|---|---|
| `status` | `PrinterStatus` |
| `job` | `PrintJob` (on every job state transition) |
| `queue` | `{ active, pending[], recent[] }` (when the queue composition changes) |

### DTO shapes

```jsonc
// PrinterStatus
{
  "reachable": true,
  "state": "idle",            // idle|busy|printing|feeding|cutting|
                              // awaiting_removal|no_media|sleeping|unknown
  "printJobError": "no_media",// optional
  "tapeRemainingMm": 4500.0,  // optional
  "tapeWidthMm": 25.0,        // optional
  "model": "VC-500W",         // optional
  "serial": "…",              // optional
  "backend": "mock",          // "mock" | "tcp"
  "lastSeenMs": 1730000000000,
  "unreachableSinceMs": 1730000000000, // optional; present while unreachable
  "failedAttempts": 0
}

// PrintJob
{
  "id": "uuid",
  "state": "printing",        // see JobState above
  "createdAtMs": 0, "updatedAtMs": 0,
  "error": "…",   "warning": "idle_timeout",  // optional
  "attempts": 1,
  "meta": { "stateId": "BW", "score": 42, "highScore": true, "source": "game" }
}
```

## Configuration

A TOML file (`./config.toml` by default, or `PRINTER_DAEMON_CONFIG=<path>`),
falling back to built-in defaults if absent. Every top-level-ish key can be
overridden by an env var `PRINTER_DAEMON_<KEY>` (common ones:
`PRINTER_DAEMON_BACKEND`, `PRINTER_DAEMON_BIND`, `PRINTER_DAEMON_PRINTER_HOST`,
`PRINTER_DAEMON_MOCK_OUT_DIR`). See `config.example.toml` at the repo root
for the full annotated set.

| Key | Default | Meaning |
|---|---|---|
| `backend` | `"mock"` | `"mock"` or `"tcp"`. |
| `bind` | `127.0.0.1:9110` | HTTP/SSE listen address. |
| `allowed_origins` | `["http://localhost:5173"]` | CORS origins; `["*"]` (or empty) = permissive (fine on a locked-down kiosk). |
| `printer.host` / `.port` | `""` / `9100` | Printer address (tcp backend). |
| `printer.*_timeout_ms` | 3000 / 10000 / 120000 | connect / response / print (long) timeouts. |
| `print.mode` / `.cut_mode` | `vivid` / `full` | Print quality + cut. |
| `print.img_width` / `.img_height` | `0` / `0` | `0` ⇒ printer autofit (the web app sizes the JPEG). |
| `timing.cut_wait_ms` | 3000 | Wait after socket close (cut) before reconnecting. |
| `timing.poll_interval_ms` | 2500 | In-job poll rate while waiting for idle. |
| `timing.idle_timeout_ms` | 30000 | Give up waiting for idle after a print (→ done+warning). |
| `timing.keepalive_interval_ms` | 30000 | Slow idle poll (anti-sleep). |
| `timing.active_interval_ms` | 3000 | Fast idle poll while active. |
| `timing.active_linger_ms` | 30000 | Stay fast this long after the last job. |
| `timing.max_retries` | 1 | Whole-job retries on transport error. |
| `mock.out_dir` | `./` | Where the mock writes JPEGs + sidecars. |
| `mock.print_ms` / `.cut_ms` | 1500 / 800 | Simulated timing. |
| `mock.tape_width_mm` | 25.0 | Tape width the mock reports. |
| `mock.force_no_media` / `.force_awaiting_removal` | `false` | Start-up fault injection. |

## Run

### Development (no hardware)

```sh
cargo run -p printer-daemon   # mock backend by default; writes to ./mock-out
curl localhost:9110/api/printer/healthz
curl localhost:9110/api/printer/status
```

Run the web app (`npm --prefix web run dev`) in another terminal. The Vite
dev proxy forwards `/api/printer/*` to `localhost:9110`. Open the booth menu
(double-tap a top corner) → **Printer** to see the live panel.

### Kiosk (real printer)

Set `backend = "tcp"` and `printer.host` to the printer's reserved IP (in
`config.toml` or via env). Build a release binary and run it under a
launchd LaunchAgent (`RunAtLoad`, `KeepAlive=true`) so it starts with the
kiosk and restarts on crash:

```sh
cargo build --release -p printer-daemon --features embed-web
# → ./target/release/barnguard-server
```

## Tests & checks

```sh
cargo test -p printer-daemon    # queue lifecycle (mock-driven): print, no-media,
                                # awaiting-removal, reprint, history cap,
                                # unreachable→recover.
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

Protocol framing tests (against the raw `.bin` captures) live in
[`crates/printer-driver/tests/`](../printer-driver/tests/).
