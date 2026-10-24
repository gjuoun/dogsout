# dogsout

**The credential broker for AI agents.** Your agents ask. Your phone decides.

`dogsout` is a local-first, open-source credential broker: a daemon holds your secrets and releases them to agents (or humans) only under a human-tunable policy — allow / ask / deny, per principal × credential × moment — with short-lived grants, a tamper-evident audit log, and one-tap approval from your phone. Values never leave your machine.

> **Status: F1 + F2 shipped** — the `dogsout` CLI below works today, plus the policy engine: allow/ask/deny rules, TTL grants, session manifests with one-shot resume, and single-person local approval (mygo native window + CLI fallback, fail-closed). Daemon, phone approval, relay, and tokens are future increments. Per-command intent, tiers and invariants live in [`apps/cli/src/intent.ts`](apps/cli/src/intent.ts).

## Install (dev)

`dogsout` is a Bun app; there is no npm release yet. From a clone:

```bash
git clone https://github.com/gjuoun/dogsout && cd dogsout
bun install
cd apps/cli && bun link    # puts dogsout on PATH (~/.bun/bin/dogsout)
cd ../.. && bash apps/ask/build.sh   # native helpers: dogsout-approve (mygo window) + dogsout-se (Secure Enclave unlock)
```

Requires [Bun](https://bun.sh) and [Go](https://go.dev) 1.27+ on PATH, and macOS with a Secure Enclave (Apple silicon or T2) — the vault unlocks with Touch ID, there is no master password. Uninstall with `cd apps/cli && bun unlink`.

## Repo layout

Seven packages, split along process boundaries — the seams an agent actually crosses:

| package | what it holds |
|---|---|
| `apps/cli` | the command layer and `bin: dogsout` |
| `apps/api` | Hono/OpenAPI server — the seed of the F3 daemon; drizzle table definitions |
| `apps/web` | the WebUI: approval page + agent activity panel (TanStack Start, Nitro bun) |
| `apps/ask` | the native macOS approval window — a Go module on mygo's native UI — plus `dogsout-se` and the design mockup |
| `packages/core` | the broker engine: vault, policy, session, the ask flow |
| `packages/type-contracts` | the zod single source for every shape that crosses a boundary |
| `packages/api-client` | heyapi output generated from `apps/api/openapi.json` — what the browser imports |

Dependencies are one-way — `apps/*` → `packages/*`. An app never imports another app, and nothing in `packages/core` reaches back into `apps/`. The approval protocol has two declared homes: the wire half (the JSON that crosses into `apps/ask`) is `packages/type-contracts/src/ask.ts`; the in-process half (the `Channel` interface and its degradation chain) is `packages/core/src/ask/channel.ts`.

### Type chain (one source, no second hand-written copy)

```
drizzle table (entity source) → drizzle-zod (server only) → createRoute → GET /doc (OpenAPI 3.1)
                                                    ↓
                    apps/api/openapi.json → heyapi codegen → packages/api-client (client only)
```

`bun run openapi:write` refreshes the spec from the live Hono routes; `bun run codegen` regenerates the client; `apps/api/src/typechain.test.ts` fails when either artifact has drifted. `bun run check:bundle` scans the built client assets for server markers (`drizzle-orm`, `bun:sqlite`, `@dogsout/core`, `node:*`), and `packages/api-client/src/boundary.test.ts` allowlists the generated imports to relative paths + `zod`.

### WebUI (preview)

```
bun apps/api/src/server.ts 8787                     # ask/session/grant surface + WS /events
cd apps/web && bun run dev                          # http://localhost:5173 (approval page), /agent (panel)
bun run drive:ui                                    # headless end-to-end: ask → decision → grant → frames
```

The approval page mirrors the native mockup (per-key 批准|本次|拒绝, six TTL tiers defaulting to 10m, a read-only held-keys section) and produces the same decision JSON as `dogsout-approve --selftest`. Approving requires a WebAuthn touch on a platform authenticator; **there is no password fallback** — without an authenticator the button is disabled and the page points at the CLI/mygo channels.

## Usage guide

### Setup

```bash
# DOGSOUT_HOME selects storage (default ~/.config/dogsout); there is no password
dogsout init   # Secure Enclave key + vault.enc + config.json; one Touch ID to prove the slot opens
```

Upgrading from the pre-rename install (`~/.config/junethekey`, `jtk://` addresses)? Run the one-time
migration once — it rewrites addresses only (the vault is never opened, `value_hash` stays identical)
and moves the directory:

```bash
dogsout migrate --dry-run   # print the plan, change nothing
dogsout migrate             # rewrite addresses + move ~/.config/junethekey -> ~/.config/dogsout
```

### Vault basics

Values live at `dogsout://vault/item/field` addresses; a dotted path digs into JSON field values, and
a list element uses the standard jq index: `dogsout get .dev.zai.hosts.[0]`.
Every segment is a lowercase token — `[a-z0-9_-]`, never a dot (the dot is the separator) — which is
what keeps an address unambiguous as storage, as a glob, and as an `ls` argument. Input sugar follows jq:
`dogsout://dev/zai/api_key`, `.dev.zai.api_key` and `dev.zai.api_key` are the same address, and the
sugar is expanded in the CLI only (stored addresses stay canonical).

```bash
echo "sk-..." | dogsout set .dev.zai.api_key             # value via stdin, never as a CLI argument
dogsout get .dev.zai.api_key                            # masked digest (sha256:…, length)
dogsout get .dev.zai.api_key --reveal                   # actual value — explicit plaintext only
dogsout alias ZAI_API_KEY .dev.zai.api_key               # env-friendly name -> one address
dogsout rm dogsout://dev/zai/api_key                     # remove one field
dogsout get ZAI_API_KEY                              # aliases read like addresses
```

A value lives on a leaf: `set .dev.zai` (an item) and `set .dev.zai.api_key.extra` (a subpath) are
refused rather than writing something the caller did not ask for. A subpath key containing a dot is
written in brackets: `dogsout get '.gcp.sa.key["client.email"]'`.

`ls` takes an optional path plus globs — `a.b.*` is one level, `a.b.**` is the subtree — and prints one
listing in three views; a value is never part of any of them:

```bash
dogsout ls                      # human: a connector tree (vaults -> items -> fields)
dogsout ls dev.gh.config        # a JSON field keeps growing inward through its keys
dogsout ls dev.gh.*             # the fields of one item
dogsout ls dev.**               # everything in the dev vault
dogsout ls --json dev           # agents: the same structure, leaves are metadata or null
dogsout ls dev.** | xargs -n1 dogsout get   # piped: one jq dot path per leaf, feed it straight back
```

- **Piped** — one jq dot path per leaf, in listing order: `.dev.gh.config.api.retry`, or
  `["client.email"]` when a key is not an identifier. Every line is valid `get` input, so
  `grep` / `xargs` compose without a second format.
- **`--json`** — a nested map rooted where the path pinned it: a stored field leaf is
  `{"address": …, "value_hash": "sha256:…", "bytes": N, "updated_at": …}`, and a node that exists
  only inside a JSON value is `null` (structure, never the value).
- **TTY** — the connector tree; a field holding a JSON array or scalar is one annotated leaf
  (`hosts · array(3)`, `port · number`) and is not expanded.

Addresses stored before the charset rule are listed by `ls` (on stderr) and by `dogsout migrate` —
reported, never rewritten.

Rotation is alias-native: `set` the same address again and every alias/run follows — no copies to drift.

### Inject into child processes

```bash
# inject secrets into child env without a plaintext cache; the child can still persist values
dogsout run --env ZAI_API_KEY -- sh -c 'curl -s -H "Authorization: Bearer $ZAI_API_KEY" …'

# whole .env files (--from-env: literals pass through, dogsout:// refs resolve; item spread --from-item was removed)
printf 'ZAI=dogsout://dev/zai/api_key\nREGION=us-east-1\n' > app.env   # refs only — committable
dogsout run --from-env app.env -- ./deploy.sh
```

`run` exits with the child's exit code.

### .env migration round-trip

```bash
# migrate a simple KEY=value file (values in; dogsout:// becomes aliases; op:// skips appear in the summary)
printf 'DEEPSEEK_API_KEY=sk-x\nZAI=dogsout://dev/zai/api_key\n' > keys.env
dogsout import-env keys.env --vault dev --item misc
dogsout export --format env-ref    # refs only, safe to commit
```

A literal key lands under its lowercased field name (`DEEPSEEK_API_KEY` → `deepseek_api_key`): env
names are UPPER_SNAKE, address segments are lowercase. A key that cannot become a segment, or two
keys that fold onto one field, abort the whole import — nothing is written.

### Policy: allow / ask / deny

Rules are last-match-wins; no match falls to `default_decision` (ask). `deny` beats every grant.

```bash
dogsout policy config rule add '{"id":"cron-allow","principal":"cron-*","resource":"*_API_KEY","decide":"allow"}'
dogsout policy config rule add '{"id":"zai-ask","principal":"*","resource":"ZAI_*","decide":"ask","ask_on":["first-use","value-changed"]}'
dogsout policy config principal add '{"name":"nightly@host"}'   # names today; keys come with the daemon
dogsout policy config show                                     # current config json

dogsout policy simulate --principal 'nightly@host' --alias ZAI_API_KEY   # preview a verdict, no grant
dogsout policy why --alias ZAI_API_KEY                                    # verdict + grant state
```

### Approval and grants

With no allow rule, `run` asks: a native mygo window (the `dogsout-approve` helper) or a CLI prompt. Timeout, a closed window, or no available channel is a deny — always. Approvals become metadata-only grants (agent / alias / value_hash / expiry) in `grants.json`; rotate the value and the grant dies.

```bash
dogsout run --env ZAI_API_KEY -- ./script.sh
dogsout grants ls                      # what is live, and for how long
dogsout grants rm ZAI_API_KEY          # revoke -> next run asks again
```

The approval window is the validated [design mockup](apps/ask/mockups/jtk-approve.swift) — a SwiftUI prototype kept as a reference, not built — turned into a real helper: a Go module on mygo's native UI (build with `apps/ask/build.sh`). CI tests the contract with a fake helper; the real window and Touch ID stay macOS smoke evidence.

### Sessions

One manifest invites keys in one approval window; grants die when the run ends. An interrupted run resumes once — `--resume` replays the last approval list (permissions, not values).

```bash
printf '{"id":"sess_1","principal":"agent@laptop","groups":[],"invites":["ZAI_API_KEY"]}' > session.json
dogsout run --session session.json --env ZAI_API_KEY -- ./long-job.sh
dogsout run --session session.json --resume --env ZAI_API_KEY -- ./long-job.sh
```

### Map slots (experimental)

```bash
dogsout map llm ZAI_API_KEY    # slot -> address or another slot (chained refs, cycle-guarded)
dogsout get llm                # resolved fresh on every read — rotate upstream, slots follow
```

`map` overlaps with `alias`; the planned merge into a single chained-alias model is tracked as roadmap cleanup.

### Vault: Touch ID, no password

```bash
dogsout vault status            # fingerprint, unlock slots, backups — never unlocks
dogsout vault restore           # vault.enc unreadable? promote the newest verified backup
dogsout vault rekey             # suspected leak: new data key, slots re-wrapped, backups cleared
```

The native helpers are the approval window (`apps/ask/build.sh` → `~/.bun/bin/dogsout-approve`) and the Secure Enclave CLI (`→ ~/.bun/bin/dogsout-se`, `--se-*` modes; `DOGSOUT_SE_HELPER` overrides the path). Every write keeps two rolling backups (`vault.enc.bak.1`, `.bak.2`) — the state before the last two writes. A pre-2026-10-14 password vault (`version: 1`) is refused; re-create it with `dogsout init --force`.

## Current security boundary

dogsout is a local vault tool, not yet a broker boundary; it does not defend against an already-compromised same-uid process. Input files and child programs may persist values; dogsout's lack of a plaintext cache is not a guarantee about them.

Vault unlock:

- The unlock key lives in this Mac's Secure Enclave and never leaves the chip; dogsout stores only its public key and a chip-bound handle. There is no master password and nothing offline-crackable in `vault.enc`. **The Touch ID slot dies with the Mac** (reinstall, logic-board swap). Until passkey enrollment lands with the F3 WebUI, the vault has exactly one factor — losing the Mac loses the vault.
- `.userPresence` falls back to the macOS login password when Touch ID is unavailable — the same boundary as the login itself.
- Until the F3 daemon, every vault command asks Touch ID once, and cron/agents/SSH sessions cannot unlock the vault.
- Planned (F3): passkey slots via WebAuthn PRF. A synced passkey (iCloud Keychain, 1Password…) puts that provider's account inside the trust boundary — an attacker needs both the account and a copy of `vault.enc`.
- Rolling backups are whole-file ciphertext copies on the same disk: they protect against a bad write, not against losing the Mac. A removed slot can still open them until rotated out — use `dogsout vault rekey` after a suspected leak.

## Why

- Password-manager service accounts (1Password, Bitwarden) are vault-wide, read-only, and have no approval hook or per-item scoping — too coarse for local agents.
- Coding agents already have permission prompts for tools; secrets deserve the same treatment.
- 1Password items cannot reference each other — copies drift on rotation. F1 aliases reference one stored value; nested/dynamic soft-links are a planned increment.

## How it works (target architecture)

```text
agent --dogsout get KEY--> daemon --allow + valid grant--> value (local hot path, <10ms)
                          |
                          ask
                          v
                     phone approval (tailnet web page, or self-hosted relay push)
                          |
                     Approve(ttl) / Deny  ->  grant  ->  value + audit row
```

## Compared to the closest prior art

Target broker comparison; identity, policy, tokens and audit below are not F1 capabilities. See the feature index for current behavior and known gaps.

| | secret-gate | dogsout |
|---|---|---|
| Backend | 1Password Connect server | local encrypted vault (zero external deps) |
| Identity | self-declared machine string | registered principals (ed25519 challenge-response) |
| Policy | none (asks every time) | allow/ask/deny matrix + TTL grants + first-use/value-changed |
| Tokens | 1Password SA (vault-wide) | self-issued, field→vault scope, :r/:w, any TTL |
| Values | pass through a public server | never leave your machine |
| Audit | logs | append-only JSONL + hash chain |

## Roadmap

| Milestone | Scope | State |
|---|---|---|
| F1 | Local CLI — the pre-split monolith | shipped |
| F2 | Policy engine (rules, TTL grants, sessions, local approval) | shipped |
| F3 | Local broker and phone approval | next |
| F4 | Scoped tokens | planned |
| F5 | Self-hosted relay | planned |

Milestones are groups, not a dependency order. Shipped means locally available, not published or fully regression-covered.

## Contributing

Clear is better than clever. `bun run typecheck`, `bun run lint`, `bun test` and `bun run test:e2e` must pass — CI runs `bun run test` (turbo, per package) *and* `bun test` (whole tree) on purpose, so a suite reachable from only one of them shows up as a count mismatch. Start with [AGENTS.md](AGENTS.md); when a command's behavior changes, update [`apps/cli/src/intent.ts`](apps/cli/src/intent.ts) in the same diff.

## License

Apache-2.0
