# Architecture and trust boundaries

## Current F1

```text
caller -> src/cli/main.ts -> command handler
                              |
                              +-> config.json (settings and one-level aliases)
                              +-> vault.enc (Argon2id + AES-GCM, whole vault)
                              +-> get --reveal: plaintext stdout
                              +-> run: plaintext in child env
```

| Responsibility | Entry points | Change impact |
|---|---|---|
| Runtime data schemas | contracts/config.ts, contracts/vault.ts | zod schemas own plain-data shape; optional policy fields are placeholders |
| Field/item/name parsing | src/cli/address.ts | get/set/rm/alias/run and future scope matching |
| Config/vault orchestration | src/cli/store.ts | shared unlock, persistence, aliases |
| Encrypted envelope | src/vault/vault.ts | hash-wasm KDF + WebCrypto AES-GCM; not Bun.password |
| Env-file classification | src/vault/io.ts | import skips op:// while run refuses it; other schemes remain strings |
| CLI dispatch and failures | src/cli/main.ts | jtk errors vs child exit code; handler tests do not cover dispatcher |

Stored plaintext model after decryption: `{version:1,vaults:{<vault>:{<item>:{fields,tags?,owner?,updated_at}}}}`. There is no `items` wrapper. Config aliases are single-level address mappings, not a general link resolver.

## Target local broker (not implemented)

```text
principal --authenticated local request--> broker
                                          |
                                          +-> pure policy evaluator
                                          +-> encrypted local vault
                                          +-> grant metadata (no values)
                                          +-> append-only audit (no values)
                                          | ask
                                          v
                               local phone page / approve CLI
                                          |
                                          +-> grant -> local caller/child env
```

[Policy](policy.md), [broker](broker.md), [approval](approval.md) and [tokens](tokens.md) describe targets. Protocol authentication, browser security, concurrent requests and unlock-key lifecycle still need implementation designs; their file paths are deliberately absent from the registry until real code exists.

## Relay and hosted boundaries

```text
local broker --outbound WS + metadata--> optional relay --> phone notification
             <--authenticated approval--             <--human action

credential plaintext: local broker -> authorized caller (NEVER via relay)
```

Self-hosted and hosted delivery may share a protocol without sharing data ownership. Hosted service enrollment, tenant isolation and operation need separate approval. Remote token reads and encrypted backups must explicitly settle where values/keys terminate; do not silently broaden the local-only promise.

## Security limits and change seams

- **Same uid** — an already-compromised peer process can read local keys/socket/parent environment; this is not the defended boundary.
- **Master handoff gap** — run strips inherited JTK_MASTER, but an explicitly injected entry of that name can restore it. See [run-noleak](execution.md#run-noleak); documentation migration does not fix this.
- **No absolute persistence promise** — jtk does not create a plaintext cache, but input files, shell history and child programs may persist values.
- **Narrow seams later** — Store/backend/notifier interfaces preserve caller semantics when justified by implementation. SQLite/1Password/runtime alternatives are not dependencies today.
- **Change navigation** — registry code arrays are entry points, not exhaustive ownership. Search callers and shared schema/tests before editing; check relevant feature dependencies too.

## Verification boundaries

`bun test` covers schema, vault and handler behavior; `bun run test:e2e` drives the outer CLI in two temporary homes with fake credentials. Manual checks and missing assertions are recorded per feature. `features:check` validates navigation consistency, not authorization correctness or secret leakage.

The [foundation snapshot](../docs/decisions/0001-foundation.md) explains historical choices; current facts here supersede its old P-phase plan and target directory layout.
