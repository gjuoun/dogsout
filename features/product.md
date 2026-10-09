# Product intent

junethekey is a local-first credential broker for AI agents: the human remains the authorization authority. It is not a replacement cloud password manager or a generic infrastructure vault.

## Current product

F1 is a local monolith CLI: encrypted vault, field/alias reads, process environment injection and reference import/export. It has **no policy engine, daemon, principal authentication, approval page, token service or audit chain yet**. npm publishing/compiled artifacts are separate, unshipped features.

## User journeys

| User intent | Start here | State |
|---|---|---|
| Store and inspect a local key | [credentials](credentials.md) | Current |
| Launch an application with refs.env / 环境文件注入 | [run-fromenv](execution.md#run-fromenv) | Current |
| Explain which rule an agent hits / 策略命中优先级 | [policy-rules](policy.md#policy-rules), [policy-why](policy.md#policy-why) | Planned |
| Ask a person before an agent gets access | [approval](approval.md) | Planned |
| Operate push delivery for another person | [relay-hosted](relay.md#relay-hosted) | Direction, separate service spec required |
| Recover/sync across machines | [hosted](hosted.md) | Deferred, not cloud secret custody |

## Evolution boundaries

- **Local first** — CLI now; local broker next. Do not invent runtime abstractions simply because a hosted facet exists.
- **Default zero deployment** — future phone approval uses the local page over LAN/tailnet. Self-hosted relay is optional for real off-screen push.
- **Hosted relay** — managed delivery of approval metadata, not credential values. Tenant isolation, billing and operation are separate design work.
- **Sync/backup** — only recorded as deferred directions. Encryption, recovery-key ownership and threat model require independent approval.
- **Plaintext handoff** — explicit reveal or authorized child env is allowed; notifications/logs/default reference exports must not carry values. Current F1 limits are in [execution](execution.md).
- **Non-goals** — protecting a compromised same-uid process, inventing a policy language, or claiming a hash chain is absolute tamper protection.

## How to use the map

[INDEX](INDEX.md) discovers stable keys; [registry](registry.yaml) owns status, surfaces and code/test pointers; family prose explains intent/current/target/acceptance. F1–F5 are milestone groups, not feature identities or a dependency order. Historical P0–P3 labels live only in the [foundation snapshot](../docs/decisions/0001-foundation.md).

Update a feature and its prose together. Evidence level is separate from implementation status: a shipped behavior may still have regression gaps. Never turn a planned target into a current security guarantee.
