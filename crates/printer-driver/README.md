# printer-driver

Rust driver for the Brother VC-500W label printer. No queues, no HTTP, no job
metadata: an async trait, three implementations (TCP, USB, mock), and the wire
protocol.

## What's here

- [`PrinterBackend`](src/backend/mod.rs). Async trait every backend implements.
  Connection lifecycle is explicit because the VC-500W's cut is triggered by
  closing the socket; the trait can't hide connect/close behind each call.
- [`TcpBackend`](src/backend/tcp.rs). Real backend over XML-over-TCP (port 9100).
- [`UsbBackend`](src/backend/usb.rs). Real backend over the USB printer class,
  via [`nusb`](https://docs.rs/nusb) (pure Rust, Linux and macOS). Drains stale
  replies before every command and cancels transfers that run past their
  deadline. An opt-in write-only mode, for hosts where the printer never
  answers, sends blind and reports an *estimated* state.
  [`usb::probe`](src/backend/usb.rs) reports what the host sees of the printer.
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
  `Disconnected`, `SentUnconfirmed`, `Protocol`, `Io`, with `is_retryable()` +
  `tag()`. `SentUnconfirmed` means the image was delivered but never
  acknowledged. It is not retryable, because a retry risks a duplicate label.

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
