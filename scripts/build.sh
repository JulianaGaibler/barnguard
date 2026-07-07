#!/usr/bin/env bash
#
# Build a NATIVE (host-arch) release of the barnguard server with the web UI
# embedded — for testing the shipped single-binary experience locally.
#
#   1. vite build          → web/dist/ (embedded into the binary)
#   2. cargo build --release --features embed-web (native target)
#   3. assemble release/   → the executable + config.example.toml
#
# For a deployable x86_64 Linux build (cross-compiled from any host), use
# scripts/build-linux.sh instead.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
OUT_DIR="$ROOT/release"
BIN_NAME="barnguard-server"

echo "==> building web UI (vite)"
npm --prefix web ci
npm --prefix web run build

echo "==> building daemon (release, embed-web, native target)"
cargo build --release -p printer-daemon --features embed-web

BIN="$ROOT/target/release/$BIN_NAME"
[[ -f "$BIN" ]] || { echo "ERROR: build produced no binary"; exit 1; }

echo "==> assembling $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp "$BIN" "$OUT_DIR/$BIN_NAME"
chmod +x "$OUT_DIR/$BIN_NAME"
cp "$ROOT/config.example.toml" "$OUT_DIR/config.example.toml"

echo "==> done"
file "$OUT_DIR/$BIN_NAME" 2>/dev/null || true
echo
echo "Run it:        $OUT_DIR/$BIN_NAME        # then open http://localhost:9110/"
echo "Real printer:  PRINTER_DAEMON_BACKEND=tcp PRINTER_DAEMON_PRINTER_HOST=<ip> $OUT_DIR/$BIN_NAME"
