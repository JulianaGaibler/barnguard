# printer-driver

Rust driver for the Brother VC-500W label printer. No queues, no HTTP, no job
metadata: an async trait, two implementations (TCP + mock), and the wire
protocol.

## What's here

- [`PrinterBackend`](src/backend/mod.rs). Async trait every backend implements.
  Connection lifecycle is explicit because the VC-500W's cut is triggered by
  closing the socket; the trait can't hide connect/close behind each call.
- [`TcpBackend`](src/backend/tcp.rs). Real backend over XML-over-TCP (port 9100).
- [`MockBackend`](src/backend/mock.rs) + [`MockControls`](src/backend/mock.rs).
  Simulates the state machine and writes each received JPEG to disk. Faults
  (no-media, awaiting-removal, unreachable) can be flipped at runtime through
  `MockControls`.
- [`protocol`](src/backend/protocol.rs) (re-exported at
  `printer_driver::protocol`). XML command builders + response parser, no I/O.
  Tested against real captures in `tests/fixtures/`.
- [`types`](src/types.rs). `PrinterState`, `PrintOpts`, `PrintMode`, `CutMode`,
  `PrinterConfigInfo`, and `PrinterHealth` (the status snapshot the trait
  returns).
- [`PrinterError`](src/error.rs). `NoMedia`, `NotReady`, `Timeout`,
  `Disconnected`, `Protocol`, `Io`, with `is_retryable()` + `tag()`.

## Minimal use

```rust
use printer_driver::{PrinterBackend, TcpBackend, TcpTimeouts, PrintOpts, PrintMode, CutMode};
use std::time::Duration;

let mut backend = TcpBackend::new(
    "192.168.1.50",
    9100,
    TcpTimeouts::default(),
);
backend.connect().await?;
let _info = backend.get_config().await?;
let health = backend.get_status().await?;
println!("{:?}", health.state);

backend.send_print(&jpeg_bytes, &PrintOpts {
    mode: PrintMode::Vivid,
    cut: CutMode::Full,
    img_w: 0,
    img_h: 0,
}).await?;
backend.close_for_cut().await?;  // closing the socket triggers the physical cut
```

## Tests

```sh
cargo test -p printer-driver
```

Framing + parsing tests run against the raw `.bin` request/response captures
in `tests/fixtures/`.
