#!/usr/bin/env bash
# Build + ad-hoc sign the SwiftUI approval helper (macOS only; CI never runs this).
set -euo pipefail
cd "$(dirname "$0")/.."
out="${1:-$HOME/.bun/bin/jtk-approve}"
mkdir -p "$(dirname "$out")"
swiftc -O -o "$out" src/ask/helper/jtk-approve.swift
codesign --force --sign - "$out" 2>/dev/null || true
echo "built $out"
echo "selftest:"
"$out" --selftest
