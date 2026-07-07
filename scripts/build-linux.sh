#!/usr/bin/env bash
#
# Cross-compile a deployable x86_64 Linux bundle from any host (macOS, Linux,
# Windows) — no zig, no C toolchain. Uses LLVM's built-in linker (rust-lld)
# which ships with rustup.
#
# Only works while every dependency is pure Rust. If a crate ever pulls in a
# `cc` build-script or links native C libs, this will fail with a missing-cc
# or missing-native-lib error — switch to cargo-zigbuild in that case.
#
#   1. vite build          → web/dist/ (the web UI, embedded into the binary)
#   2. cargo build         → cross-compile with rust-lld (musl, fully static), --features embed-web
#   3. assemble release-linux/ → the executable + config.example.toml
#
# Prerequisites (one-time):
#   rustup target add x86_64-unknown-linux-musl
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TARGET="${TARGET:-x86_64-unknown-linux-musl}"       # fully static (no glibc dependency)
OUT_DIR="$ROOT/release-linux"
BIN_NAME="barnguard-server"

echo "==> checking prerequisites"
command -v npm >/dev/null || { echo "ERROR: npm not found"; exit 1; }
rustup target list --installed 2>/dev/null | grep -qx "$TARGET" || {
  echo "ERROR: rust target $TARGET not installed — run: rustup target add $TARGET"; exit 1; }

echo "==> building web UI (vite)"
npm --prefix web ci
npm --prefix web run build

echo "==> cross-compiling server for $TARGET (embed-web, rust-lld)"
RUSTFLAGS="-C linker=rust-lld" \
  cargo build --release --target "$TARGET" -p printer-daemon --features embed-web

# Locate the built binary.
BIN="$ROOT/target/$TARGET/release/$BIN_NAME"
if [[ ! -f "$BIN" ]]; then
  BIN="$(find "$ROOT/target" -type f -name "$BIN_NAME" -path '*release*' | head -n1)"
fi
[[ -f "$BIN" ]] || { echo "ERROR: could not find the built binary"; exit 1; }

echo "==> assembling $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp "$BIN" "$OUT_DIR/$BIN_NAME"
chmod +x "$OUT_DIR/$BIN_NAME"
cp "$ROOT/config.example.toml" "$OUT_DIR/config.example.toml"

echo "==> done"
file "$OUT_DIR/$BIN_NAME" 2>/dev/null || true
echo
echo "Bundle ready in: $OUT_DIR"
echo "  deploy:  scp -r $OUT_DIR/ user@host:/opt/barnguard"
