# barnguard

Interactive touchscreen booth. Ships as a single binary that serves the kiosk
game and drives a Brother VC-500W label printer over the local network.

Three packages:

| Path                     | What it is                                                                       |
| ------------------------ | -------------------------------------------------------------------------------- |
| `crates/printer-driver/` | Rust driver for the VC-500W (wire protocol, TCP + mock backends, trait).         |
| `crates/server/`         | The runnable app: print queue, HTTP + SSE API, embedded web UI, TOML config.     |
| `web/`                   | Kiosk game. Vite + Svelte 5 + TypeScript on a custom 2D render engine.           |

The Rust code is a Cargo workspace at the repo root; the web app is an npm
package under `web/`.

## Getting started

Two terminals for dev:

```bash
# back end (mock printer, listens on :9110)
cargo run -p printer-daemon

# front end (Vite dev server, proxies /api/printer → :9110)
npm --prefix web install
npm --prefix web run dev
```

Release build: one binary with the SPA baked in. The web bundle has to exist
before `cargo build` because `rust-embed` reads `web/dist/` at compile time:

```bash
npm --prefix web ci
npm --prefix web run build              # → web/dist/
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
