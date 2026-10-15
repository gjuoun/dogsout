#!/usr/bin/env bash
# verify-all.sh — the full junethekey gate (what "all green" means; CI runs the same root scripts).
#
#   bash runbook/scripts/verify-all.sh              # repo gates: install / typecheck / lint / test / e2e
#   bash runbook/scripts/verify-all.sh --with-map   # also the feature-map check (jtkm — a local maintainer tool, not in this repo)
#
# typecheck and test run through the repo's own root scripts (what CI runs). The test gate is
# exercised twice on purpose: `bun run test` (turbo, per package) and `bun test` (single runner),
# so a split that hides a suite behind one of the two runners shows up as a count mismatch.
#
# Prints each gate's exit code plus its own summary lines, then VERIFY-ALL: PASS|FAIL.
# Exits non-zero if any gate failed. Target repo: JTK_REPO env, default = the checkout this script lives in.
set -uo pipefail

REPO="${JTK_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
WITH_MAP=0
[ "${1:-}" = "--with-map" ] && WITH_MAP=1
cd "$REPO" || { echo "no repo at $REPO"; exit 2; }
# the feature-map wrapper is installed as jtkmap, recently also shortened to jtkm
MAP_TOOL=""
for cand in jtkmap jtkm; do
  if command -v "$cand" >/dev/null 2>&1; then MAP_TOOL="$cand"; break; fi
  if [ -x "$HOME/.bun/bin/$cand" ]; then MAP_TOOL="$HOME/.bun/bin/$cand"; break; fi
done
[ -z "$MAP_TOOL" ] && MAP_TOOL="jtkmap"

fail=0
gate() {
  local name="$1"; shift
  local out code
  out="$("$@" 2>&1)"; code=$?
  echo "[$name] exit=$code"
  printf '%s\n' "$out" | grep -E 'pass|fail|PASS|FAIL|covered|Tasks|Found|Checked' | tail -5 | sed 's/^/    /'
  if [ "$code" -ne 0 ]; then
    fail=1
    echo "[$name] --- output tail ---"
    printf '%s\n' "$out" | tail -20 | sed 's/^/    /'
  fi
  return 0
}

gate install       bun install --frozen-lockfile
gate typecheck     bun run typecheck
gate lint          bun run lint
gate test-turbo    bun run test
gate test-direct   bun test
gate e2e           bun run test:e2e
[ "$WITH_MAP" -eq 1 ] && gate map "$MAP_TOOL" check

if [ "$fail" -eq 0 ]; then echo "VERIFY-ALL: PASS"; exit 0; fi
echo "VERIFY-ALL: FAIL"; exit 1
