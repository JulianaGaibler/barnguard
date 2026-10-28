# barnguard

Interactive touchscreen booth. Ships as a single binary that serves the kiosk
game and drives a Brother VC-500W label printer over the local network or USB.

Three packages:

| Path                     | What it is                                                                       |
| ------------------------ | -------------------------------------------------------------------------------- |
| `crates/printer-driver/` | Rust driver for the VC-500W (wire protocol, TCP + USB + mock backends, trait).   |
| `crates/server/`         | The runnable app: print queue, HTTP + SSE API, embedded web UI, TOML config.     |
| `web/`                   | Kiosk game. Vite + Svelte 5 + TypeScript on a custom 2D render engine.           |

The Rust code is a Cargo workspace at the repo root; the web app is an npm
package under `web/`.

## Getting started

Two terminals for dev:

```bash
# back end (mock printer, listens on :9110)
cargo run -p printer-daemon

# front end (Vite dev server, proxies /api/printer -> :9110)
npm --prefix web install
npm --prefix web run dev
```

Release build: one binary with the SPA baked in. The web bundle has to exist
before `cargo build` because `rust-embed` reads `web/dist/` at compile time:

```bash
npm --prefix web ci
npm --prefix web run build              # -> web/dist/
cargo build --release -p printer-daemon --features embed-web
./target/release/barnguard-server       # open http://localhost:9110/
```

`scripts/build.sh` (native host) and `scripts/build-linux.sh` (cross-compile
x86_64 Linux from any host) wrap both steps and produce a deploy bundle.

## Configuring the server

Copy `config.example.toml` to `config.toml` next to the binary and edit, or
override any key via env vars named `PRINTER_DAEMON_<KEY>` (e.g.
`PRINTER_DAEMON_BACKEND=tcp`, `PRINTER_DAEMON_PRINTER_HOST=192.168.1.50`).
The mock backend is the default so a hardware-free dev environment works out
of the box.

## Printing over USB

Set `backend = "usb"` to drive the printer over its USB cable instead of the
network. The XML protocol is the same, but how the printer behaves over USB
(whether it answers status reads, and what makes it cut) varies by host, so
check it on the actual machine before an event. Stop the server, then run:

```bash
barnguard-server usb-probe                             # interfaces, port status, read test
barnguard-server usb-probe --print label.jpg           # also print one label
barnguard-server usb-probe --print label.jpg --cut-trigger zlp
```

The probe suggests a `usb.read_mode`. Keep `bidirectional` if status reads are
answered. `write_only` only estimates the printer's state, so a label left in
the slot goes unseen and the next one is lost. The comments in
`config.example.toml` describe every `[usb]` key.

A sleeping printer drops off USB, and only its power button wakes it. The
attendant panel says so when the printer is unreachable.

Host setup:

- **NixOS:** the flake's module installs a udev rule, adds the service to a
  `barnguard` group, and blacklists the `usblp` kernel driver.
- **Other Linux:** add the same udev rule
  (`/etc/udev/rules.d/70-barnguard.rules`) and run the server as a member of
  the group it names:

  ```
  SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", ATTR{idVendor}=="04f9", ATTR{idProduct}=="20b0", MODE="0660", GROUP="barnguard"
  ```

- **macOS:** no setup needed. If the probe reports the interface as busy,
  remove the printer from System Settings > Printers & Scanners and quit
  Brother's apps.
