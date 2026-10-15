#!/usr/bin/env bash
# Shim: the approval-window build moved in with its app (apps/ask/build.sh).
# Kept so existing callers and the runbook Helpers section keep working.
exec bash "$(cd "$(dirname "$0")/.." && pwd)/apps/ask/build.sh" "$@"
