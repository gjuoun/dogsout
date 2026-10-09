# junethekey

**The credential broker for AI agents.** Your agents ask. Your phone decides.

`jtk` is a local-first, open-source credential broker: a daemon holds your secrets and releases them to agents (or humans) only under a human-tunable policy — allow / ask / deny, per principal × credential × moment — with short-lived grants, a tamper-evident audit log, and one-tap approval from your phone. Values never leave your machine.

> **Status: F1 shipped** — the local monolith CLI below works today. Policy engine, daemon, phone approval, relay, and tokens are the next feature increments (see [docs-spec.md](docs-spec.md) §9).

## Quick start (F1 monolith)

```bash
git clone https://github.com/gjuoun/junethekey && cd junethekey
bun install

# every command reads JTK_HOME (default ~/.config/junethekey) and JTK_MASTER
export JTK_MASTER="a-long-master-passphrase"

bun src/cli/main.ts init                       # create vault.enc (AES-256-GCM, argon2id) + config.json
echo "sk-..." | bun src/cli/main.ts set jtk://dev/zai/api_key --stdin
bun src/cli/main.ts get jtk://dev/zai/api_key                 # masked digest (sha256:…)
bun src/cli/main.ts get jtk://dev/zai/api_key --reveal        # actual value
bun src/cli/main.ts alias ZAI_API_KEY jtk://dev/zai/api_key   # register an alias

# run a command with secrets injected into its env — values never touch disk or shell history
bun src/cli/main.ts run --env ZAI_API_KEY -- sh -c 'curl -s -H "Authorization: Bearer $ZAI_API_KEY" …'

# item spread (--from-item) and whole .env files (--from-env: literals pass through, jtk:// refs resolve)
printf 'ZAI=jtk://dev/zai/api_key\nREGION=us-east-1\n' > app.env   # refs only — committable
bun src/cli/main.ts run --from-env app.env -- ./deploy.sh

# migrate from a .env file (direct values in; jtk:// refs become aliases; op:// lines skipped with a warning)
printf 'DEEPSEEK_API_KEY=sk-x\nZAI=jtk://dev/zai/api_key\n' > keys.env
bun src/cli/main.ts import-env keys.env --vault dev --item misc
bun src/cli/main.ts export --format env-ref                  # refs only, safe to commit
```

## Why

- Password-manager service accounts (1Password, Bitwarden) are vault-wide, read-only, and have no approval hook or per-item scoping — too coarse for local agents.
- Coding agents already have permission prompts for tools; secrets deserve the same treatment.
- 1Password items cannot reference each other — copies drift on rotation. junethekey credentials can soft-link: one value, many names, rotate once.

## How it works (target architecture)

```
agent --jtk get KEY--> daemon --allow + valid grant--> value (local hot path, <10ms)
                          |
                          ask
                          v
                     phone approval (tailnet web page, or self-hosted relay push)
                          |
                     Approve(ttl) / Deny  ->  grant  ->  value + audit row
```

## Compared to the closest prior art

| | secret-gate | junethekey |
|---|---|---|
| Backend | 1Password Connect server | local encrypted vault (zero external deps) |
| Identity | self-declared machine string | registered principals (ed25519 challenge-response) |
| Policy | none (asks every time) | allow/ask/deny matrix + TTL grants + first-use/value-changed |
| Tokens | 1Password SA (vault-wide) | self-issued, field→vault scope, :r/:w, any TTL |
| Values | pass through a public server | never leave your machine |
| Audit | logs | append-only JSONL + hash chain |

## Roadmap (feature-sized increments)

- **F1 (shipped)** monolith CLI — vault.enc, aliases, run injection, import/export
- **F2** policy engine — allow/ask/deny rules, `simulate`/`why`/`test`
- **F3** daemon + phone approval page + audit chain
- **F4** scoped tokens (:r/:w, field→vault)
- **F5** relay (self-hosted push)
- **P3** MCP server, 1Password adapter

## Contributing

Clear is better than clever. `bun run lint` and `bun test` must pass.

## License

Apache-2.0