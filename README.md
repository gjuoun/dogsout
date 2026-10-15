# junethekey

**The credential broker for AI agents.** Your agents ask. Your phone decides.

`jtk` is a local-first, open-source credential broker: a daemon holds your secrets and releases them to agents (or humans) only under a human-tunable policy — allow / ask / deny, per principal × credential × moment — with short-lived grants, a tamper-evident audit log, and one-tap approval from your phone. Values never leave your machine.

> **Status: F1 + F2 shipped** — the local monolith CLI below works today, plus the policy engine: allow/ask/deny rules, TTL grants, session manifests with one-shot resume, and single-person local approval (SwiftUI helper + CLI fallback, fail-closed). Daemon, phone approval, relay, and tokens are future increments. Per-command intent, tiers and invariants live in [`apps/cli/src/intent.ts`](apps/cli/src/intent.ts).

## Install (dev)

`jtk` is a Bun app; there is no npm release yet. From a clone:

```bash
git clone https://github.com/gjuoun/junethekey && cd junethekey
bun install
cd apps/cli && bun link    # puts jtk on PATH (~/.bun/bin/jtk)
```

Requires [Bun](https://bun.sh) on PATH. Uninstall with `cd apps/cli && bun unlink`.

## Usage guide

### Setup

```bash
# JTK_HOME selects storage (default ~/.config/junethekey); vault operations use JTK_MASTER
# export/help do not decrypt or require the master
export JTK_MASTER="a-long-master-passphrase"

jtk init   # create vault.enc (AES-256-GCM, argon2id) + config.json
```

### Vault basics

Values live at `jtk://vault/item/field` addresses; a dotted path digs into JSON field values.

```bash
echo "sk-..." | jtk set jtk://dev/zai/api_key   # value via stdin, never as a CLI argument
jtk get jtk://dev/zai/api_key                    # masked digest (sha256:…, length)
jtk get jtk://dev/zai/api_key --reveal           # actual value — explicit plaintext only
jtk ls                                           # list field addresses, no values
jtk rm jtk://dev/zai/api_key                     # remove one field

jtk alias ZAI_API_KEY jtk://dev/zai/api_key      # env-friendly name -> one address
jtk get ZAI_API_KEY                              # aliases read like addresses
```

Rotation is alias-native: `set` the same address again and every alias/run follows — no copies to drift.

### Inject into child processes

```bash
# inject secrets into child env without a plaintext cache; the child can still persist values
jtk run --env ZAI_API_KEY -- sh -c 'curl -s -H "Authorization: Bearer $ZAI_API_KEY" …'

# whole .env files (--from-env: literals pass through, jtk:// refs resolve; item spread --from-item was removed)
printf 'ZAI=jtk://dev/zai/api_key\nREGION=us-east-1\n' > app.env   # refs only — committable
jtk run --from-env app.env -- ./deploy.sh
```

`run` strips the inherited `JTK_MASTER` from the child environment; exit code is the child's.

### .env migration round-trip

```bash
# migrate a simple KEY=value file (values in; jtk:// becomes aliases; op:// skips appear in the summary)
printf 'DEEPSEEK_API_KEY=sk-x\nZAI=jtk://dev/zai/api_key\n' > keys.env
jtk import-env keys.env --vault dev --item misc
jtk export --format env-ref    # refs only, safe to commit
```

### Policy: allow / ask / deny

Rules are last-match-wins; no match falls to `default_decision` (ask). `deny` beats every grant.

```bash
jtk policy config rule add '{"id":"cron-allow","principal":"cron-*","resource":"*_API_KEY","decide":"allow"}'
jtk policy config rule add '{"id":"zai-ask","principal":"*","resource":"ZAI_*","decide":"ask","ask_on":["first-use","value-changed"]}'
jtk policy config principal add '{"name":"nightly@host"}'   # names today; keys come with the daemon
jtk policy config show                                     # current config json

jtk policy simulate --principal 'nightly@host' --alias ZAI_API_KEY   # preview a verdict, no grant
jtk policy why --alias ZAI_API_KEY                                    # verdict + grant state
```

### Approval and grants

With no allow rule, `run` asks: a SwiftUI window (the `jtk-approve` helper) or a CLI prompt. Timeout, a closed window, or no available channel is a deny — always. Approvals become metadata-only grants (agent / alias / value_hash / expiry) in `grants.json`; rotate the value and the grant dies.

```bash
jtk run --env ZAI_API_KEY -- ./script.sh
jtk grants ls                      # what is live, and for how long
jtk grants rm ZAI_API_KEY          # revoke -> next run asks again
```

The approval window is the validated [SwiftUI mockup](mockups/jtk-approve.swift) turned into a real helper (`apps/ask/helper/jtk-approve.swift`, build with `apps/ask/build.sh`; `scripts/build-helper.sh` is a shim); CI tests the contract with a fake helper and leaves the Touch ID window smoke as manual macOS evidence.

### Sessions

One manifest invites keys in one approval window; grants die when the run ends. An interrupted run resumes once — `--resume` replays the last approval list (permissions, not values).

```bash
printf '{"id":"sess_1","principal":"agent@laptop","groups":[],"invites":["ZAI_API_KEY"]}' > session.json
jtk run --session session.json --env ZAI_API_KEY -- ./long-job.sh
jtk run --session session.json --resume --env ZAI_API_KEY -- ./long-job.sh
```

### Map slots (experimental)

```bash
jtk map llm ZAI_API_KEY    # slot -> address or another slot (chained refs, cycle-guarded)
jtk get llm                # resolved fresh on every read — rotate upstream, slots follow
```

`map` overlaps with `alias`; the planned merge into a single chained-alias model is tracked as roadmap cleanup.

## Current security boundary

F1 is a local vault tool, not yet a policy/approval boundary; it does not defend against an already-compromised same-uid process. `run` strips inherited `JTK_MASTER`, but explicit injection of that name can restore it. Input files and child programs may persist values; jtk's lack of a plaintext cache is not a guarantee about them.

## Why

- Password-manager service accounts (1Password, Bitwarden) are vault-wide, read-only, and have no approval hook or per-item scoping — too coarse for local agents.
- Coding agents already have permission prompts for tools; secrets deserve the same treatment.
- 1Password items cannot reference each other — copies drift on rotation. F1 aliases reference one stored value; nested/dynamic soft-links are a planned increment.

## How it works (target architecture)

```text
agent --jtk get KEY--> daemon --allow + valid grant--> value (local hot path, <10ms)
                          |
                          ask
                          v
                     phone approval (tailnet web page, or self-hosted relay push)
                          |
                     Approve(ttl) / Deny  ->  grant  ->  value + audit row
```

## Compared to the closest prior art

Target broker comparison; identity, policy, tokens and audit below are not F1 capabilities. See the feature index for current behavior and known gaps.

| | secret-gate | junethekey |
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
| F1 | Local monolith CLI | shipped |
| F2 | Policy engine (rules, TTL grants, sessions, local approval) | shipped |
| F3 | Local broker and phone approval | next |
| F4 | Scoped tokens | planned |
| F5 | Self-hosted relay | planned |

Milestones are groups, not a dependency order. Shipped means locally available, not published or fully regression-covered.

## Contributing

Clear is better than clever. `bun run typecheck`, `bun run lint`, `bun test` and `bun run test:e2e` must pass. Start with [AGENTS.md](AGENTS.md); when a command's behavior changes, update [`apps/cli/src/intent.ts`](apps/cli/src/intent.ts) in the same diff.

## License

Apache-2.0
