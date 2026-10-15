# junethekey runbook

How to launch, drive and verify this repo — written to be read cold by an agent. Run every command from the repo root. The command structure lives in `apps/cli/src/commands.ts`, per-command intent and invariants in `apps/cli/src/intent.ts`; this file only says how to drive and prove things.

> Surface: **CLI** (short-lived processes, no daemon yet) plus an experimental HTTP skeleton (`apps/api`). Packages: `apps/cli` (commands + `bin: jtk`) · `apps/api` (Hono skeleton) · `apps/ask` (native macOS helper: approval window + Secure Enclave unlock) · `packages/core` (engine) · `packages/type-contracts` (zod single source).

## Launch

The CLI needs no server. One isolated instance = one temporary `JTK_HOME`; the vault unlocks through a Secure Enclave helper, and tests/agents use the **test-only fake** helper:

```bash
export JTK_HOME="$(mktemp -d /tmp/jtk-run.XXXXXX)"                          # isolation is entirely this
export JTK_SE_HELPER="$PWD/packages/core/src/vault/helper/fake-se.ts"        # fake Secure Enclave (tests only)
bun apps/cli/src/main.ts init   # → initialized $JTK_HOME (vault v2, fingerprint XXXX-XXXX) + one-factor warning
```

On a real Mac drop `JTK_SE_HELPER`: the default helper is `~/.bun/bin/jtk-approve` (`bash apps/ask/build.sh`) and every vault command asks Touch ID once — see [vault.md](vault.md). There is no master password.

API skeleton (exp): `bun apps/api/src/server.ts 8787` → prints `jtk api skeleton on http://127.0.0.1:8787` when ready; see [api-skeleton.md](api-skeleton.md).

## Doctor

Read-only checks that answer "is this checkout worth driving?":

```bash
bun apps/cli/src/main.ts help            # exit 0, lists 13 commands
bun run typecheck                        # turbo, 4 packages (apps/ask has no typecheck) → Tasks: 4 successful
bun run lint                             # biome → exit 0 (warnings do not fail)
bun apps/cli/src/main.ts vault status    # with the Launch env: vault v2 · fingerprint … — never unlocks
bash apps/ask/build.sh /tmp/jtk-approve  # macOS only: … {"se":"ok"} = Secure Enclave reachable, no Touch ID
```

## Drive

Prefer the repo's own harnesses:

- **End to end**: `bun run test:e2e` (`tests/e2e.ts`) — temporary homes, fake credentials, fake approval and fake Secure Enclave helpers; covers F1, F2 ask/deny/session and the vault (fingerprint, slots, backups, restore, rekey, fail-closed unlock, v1 refused). One `PASS:`/`FAIL:` line per check: expect **23 PASS, 0 FAIL**.
- **Unit — run both runners and compare totals**: `bun run test` (turbo, per package: type-contracts 18 + core 60 + api 3 + cli 37) and `bun test` (root, single runner: 118). A mismatch is a finding — a suite became unreachable from one of them (this happened on 2026-10-13: a fixture read a cwd-relative path, its `beforeAll` threw under turbo and the group silently vanished, 86 → 81).

Every package must also pass on its own (that is how turbo runs it):

```bash
(cd apps/cli && bun test); (cd apps/api && bun test); (cd packages/core && bun test); (cd packages/type-contracts && bun test)
```

Driving single commands uses the Launch env plus, for the ask flow, the fake approval helper:

```bash
export JTK_APPROVE_HELPER="$PWD/packages/core/src/ask/helper/fake-approve.ts"   # no real window
FAKE_APPROVE_MODE=deny bun apps/cli/src/main.ts run --env X -- sh -c 'exit 0'     # deny → exit ≠ 0, child never starts
FAKE_SE_MODE=deny bun apps/cli/src/main.ts ls                                      # cancelled Touch ID → exit 1
```

## Gate

"All green" for this repo, one command (CI runs the same root scripts):

```bash
bash runbook/scripts/verify-all.sh
```

Gates in order: `install (frozen)` → `typecheck` → `lint` → `test-turbo` → `test-direct` → `e2e`; each prints its exit code and summary lines, the last line is `VERIFY-ALL: PASS|FAIL`, any red exits 1. `--with-map` additionally runs the feature-map checker (`jtkm check`, a local maintainer tool that is **not** part of this repo; it reads `commands.ts` + `intent.ts` and expects `13/13 commands covered, 0 dangling`).

## Evidence

- Exit codes (jtk errors exit 1; `run` exits with the child's code) and stdout lines (`PASS:`, `initialized …`, `sha256:…`, `vault v2 · fingerprint …`).
- Files under `JTK_HOME`: `config.json` and `vault.enc` (0600); `vault.enc.bak.1/.bak.2` after writes; `grants.json` after an approval (metadata only — no values).
- API: the curl response body.
- Gate: the `VERIFY-ALL: PASS` line, each gate's exit code, `118 pass 0 fail` from both runners, 23 `PASS:` lines.
- Keep a log: `bun run test:e2e 2>&1 | tee /tmp/jtk-e2e-$(date +%s).log`.

## Cleanup

```bash
rm -rf "$JTK_HOME"        # only this instance's scratch state
kill "$API_PID"           # the PID recorded at start — never kill by process name
```

Evidence (tee'd logs, copied response bodies, gate output) lives outside `JTK_HOME` and survives cleanup.

## Helpers

- `runbook/scripts/verify-all.sh` — the full gate (repo-relative; `JTK_REPO` overrides the checkout).
- `tests/e2e.ts` — the end-to-end harness, and a readable driving example.
- `packages/core/src/ask/helper/fake-approve.ts` — fake approval channel (`FAKE_APPROVE_MODE=approve|deny|crash`).
- `packages/core/src/vault/helper/fake-se.ts` — fake Secure Enclave (`JTK_SE_HELPER`; `FAKE_SE_MODE=deny` = cancelled Touch ID). **Test only**: its "blob" is the raw private key.
- `apps/ask/build.sh [out]` — builds the native helper (approval window + `--se-*` modes) and runs both selftests.

## Topics

- [vault-basics.md](vault-basics.md) — init / set / get / alias / run round trip
- [vault.md](vault.md) — Touch ID unlock, slots, rolling backups, restore, rekey; fake helper and real-chip smoke
- [policy-approval.md](policy-approval.md) — rules, the ask flow, grants, sessions
- [import-export.md](import-export.md) — .env import and refs-only export round trip
- [api-skeleton.md](api-skeleton.md) — the experimental HTTP skeleton
