# junethekey

**The credential broker for AI agents.** Your agents ask. Your phone decides.

`jtk` is a local-first, open-source credential broker: a daemon holds your secrets and releases them to agents (or humans) only under a human-tunable policy — allow / ask / deny, per principal × credential × moment — with short-lived grants, a tamper-evident audit log, and one-tap approval from your phone. Values never leave your machine.

> **Status: F1 + F2 shipped** — the local monolith CLI below works today, plus the F2 policy engine: allow/ask/deny rules, TTL grants, session manifests with one-shot resume, and single-person local approval (SwiftUI helper + CLI fallback, fail-closed). Daemon, phone approval, relay, and tokens are the next increments (see the [feature index](features/INDEX.md)).

## Quick start (F1 monolith)

```bash
git clone https://github.com/gjuoun/junethekey && cd junethekey
bun install

# JTK_HOME selects storage (default ~/.config/junethekey); vault operations use JTK_MASTER
# export/help do not decrypt or require the master
export JTK_MASTER="a-long-master-passphrase"

bun src/cli/main.ts init                       # create vault.enc (AES-256-GCM, argon2id) + config.json
echo "sk-..." | bun src/cli/main.ts set jtk://dev/zai/api_key --stdin
bun src/cli/main.ts get jtk://dev/zai/api_key                 # masked digest (sha256:…)
bun src/cli/main.ts get jtk://dev/zai/api_key --reveal        # actual value
bun src/cli/main.ts alias ZAI_API_KEY jtk://dev/zai/api_key   # register an alias

# inject secrets into child env without a plaintext cache; the child can still persist values
bun src/cli/main.ts run --env ZAI_API_KEY -- sh -c 'curl -s -H "Authorization: Bearer $ZAI_API_KEY" …'

# whole .env files (--from-env: literals pass through, jtk:// refs resolve; item spread --from-item was removed)
printf 'ZAI=jtk://dev/zai/api_key\nREGION=us-east-1\n' > app.env   # refs only — committable
bun src/cli/main.ts run --from-env app.env -- ./deploy.sh

# migrate a simple KEY=value file (values in; jtk:// becomes aliases; op:// skips appear in the summary)
printf 'DEEPSEEK_API_KEY=sk-x\nZAI=jtk://dev/zai/api_key\n' > keys.env
bun src/cli/main.ts import-env keys.env --vault dev --item misc
bun src/cli/main.ts export --format env-ref                  # refs only, safe to commit
```

## F2: policy, approval, sessions

```bash
# rules: last-match-wins, no match -> default_decision (ask). deny beats every grant.
bun src/cli/main.ts policy config rule add '{"id":"cron-allow","principal":"cron-*","resource":"*_API_KEY","decide":"allow"}'
bun src/cli/main.ts policy config rule add '{"id":"zai-ask","principal":"*","resource":"ZAI_*","decide":"ask","ask_on":["first-use","value-changed"]}'
bun src/cli/main.ts policy simulate --principal 'nightly@host' --alias ZAI_API_KEY   # preview, no grant
bun src/cli/main.ts policy why --alias ZAI_API_KEY                                  # verdict + grant state

# approval: with no allow rule, run asks — SwiftUI window (jtk-approve helper) or CLI prompt.
# timeout / closed window / no channel = deny, always. Approvals become metadata-only grants
# (agent/alias/value_hash/expiry) in grants.json; rotate the value and the grant dies.
bun src/cli/main.ts run --env ZAI_API_KEY -- ./script.sh
bun src/cli/main.ts grants ls                          # what is live, and for how long
bun src/cli/main.ts grants rm ZAI_API_KEY              # revoke -> next run asks again

# sessions: one manifest invites keys in one approval window; grants die when the run ends;
# an interrupted run resumes once (--resume replays the last approval list, permissions not values)
printf '{"id":"sess_1","principal":"agent@laptop","groups":[],"invites":["ZAI_API_KEY"]}' > session.json
bun src/cli/main.ts run --session session.json --env ZAI_API_KEY -- ./long-job.sh
bun src/cli/main.ts run --session session.json --resume --env ZAI_API_KEY -- ./long-job.sh

# map slots: chain references resolved fresh on every read — rotate the upstream, slots follow
bun src/cli/main.ts map llm ZAI_API_KEY
bun src/cli/main.ts get llm
```

The approval window is the validated [SwiftUI mockup](mockups/jtk-approve.swift) turned into a real helper (`src/ask/helper/jtk-approve.swift`, build with `scripts/build-helper.sh`); CI tests the contract with a fake helper and leaves the Touch ID window smoke as manual macOS evidence.

## Current security boundary

F1 is a local vault tool, not yet a policy/approval boundary; it does not defend against an already-compromised same-uid process. `run` strips inherited `JTK_MASTER`, but explicit injection of that name can restore it — see [the documented gap](features/execution.md#run-noleak). Input files and child programs may persist values; jtk's lack of a plaintext cache is not a guarantee about them.

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

## Roadmap (feature-sized increments)

<!-- features:roadmap:start -->
Generated from [features/registry.yaml](features/registry.yaml). See the [feature index](features/INDEX.md) for intent, evidence and code/test pointers.

| Milestone | Scope | Feature state |
|---|---|---|
| F1 | Local monolith CLI | 26 shipped |
| F2 | Policy engine | 16 shipped |
| F3 | Local broker and phone approval | 12 planned |
| F4 | Scoped tokens | 5 planned |
| F5 | Self-hosted relay | 4 planned |

Unscheduled directions: 6 planned, 11 deferred. Distribution, MCP/adapters, hosted relay and deferred sync/backup are separate keys, not an implied release promise.

Shipped means locally available, not published or fully regression-covered. Partial/manual evidence and known gaps remain explicit in the feature pages.
<!-- features:roadmap:end -->

## Contributing

Clear is better than clever. `bun run typecheck`, `bun run lint`, `bun test`, `bun run test:e2e` and `bun run features:check` must pass. Start with [AGENTS.md](AGENTS.md); update registry and prose together, then run `bun run features:generate`.

## License

Apache-2.0