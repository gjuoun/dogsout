#!/usr/bin/env bash
# Build the dogsout native helpers (macOS only; CI never runs this).
#   dogsout-approve — Go, no cgo: the mygo approval window
#   dogsout-se      — Swift, no UI: the vault's Secure Enclave slot (Touch ID)
set -euo pipefail
cd "$(dirname "$0")"
outdir="${1:-$HOME/.bun/bin}"
mkdir -p "$outdir"

reference='{"decision":"approve","ttl":"10m","renew_existing":false,"keys":{"aws":"deny","gh":"ttl","openai":"once"}}'

if ! command -v go >/dev/null 2>&1; then
	echo "go not found — install Go 1.27+ (e.g. mise use go@1.27.1)" >&2
	exit 1
fi
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o "$outdir/dogsout-approve" .
echo "built $outdir/dogsout-approve"
echo "selftest:"
got="$("$outdir/dogsout-approve" --selftest)"
if [ "$got" != "$reference" ]; then
	echo "selftest mismatch" >&2
	echo "   got: $got" >&2
	echo "  want: $reference" >&2
	exit 1
fi
echo "$got"

if ! command -v swiftc >/dev/null 2>&1; then
	echo "swiftc not found — the Secure Enclave helper needs the Xcode command line tools" >&2
	exit 1
fi
swiftc -O -o "$outdir/dogsout-se" se/dogsout-se.swift
codesign --force --sign - "$outdir/dogsout-se" 2>/dev/null || true
echo "built $outdir/dogsout-se"
echo "se-selftest:"
"$outdir/dogsout-se" --se-selftest
