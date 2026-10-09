# broker

Navigation: [index](INDEX.md) · [registry](registry.yaml) · [product intent](product.md) · [architecture](architecture.md).

Status and code/test entry points live in registry.yaml. Section keys are stable; planned text is not a current capability. Manual evidence below uses fake data in temporary homes (2026-10-09); gaps are explicit.

### daemon-socket

**Intent:** Centralize credential release behind authorization.

**Target:** 0600 unix socket, JSONL protocol, auto-start on first request; frame schemas in contracts; status/stop/flush management. Frame/version and concurrency details need implementation design.

**Acceptance:** ask waits for approval; deny never releases values.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### daemon-principal

**Intent:** Identify agents and human devices without self-declared names.

**Target:** Registered ed25519 keypair per principal; one challenge-response per connection, group/kind/public key in config; private keys separate 0600 files.

**Acceptance:** Unregistered or invalid signatures fail before secret release.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### daemon-grants

**Intent:** Avoid prompting again after a harmless broker restart.

**Target:** grants.json stores principal/resource/value_hash/expiry/rule/approved_by/via, never credential values.

**Acceptance:** Restart preserves valid approval; changed values invalidate configured grants.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### daemon-audit

**Intent:** Account for authorized and refused requests without logging values.

**Target:** Append-only JSONL with prev_hash, verify/tail. Best-effort tamper evidence, not defense against a compromised same-uid host.

**Acceptance:** Verify detects changed chain rows; events never include secret values.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### daemon-hotpath

**Intent:** Keep repeated authorized requests practical.

**Target:** Target <10ms once the broker is unlocked; measurement conditions and KDF/key lifecycle must be specified before accepting this target. F1 re-derives keys and has no such guarantee.

**Acceptance:** Benchmark the authorized unlocked path, not cold vault unlock.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### daemon-autolock

**Intent:** Bound unlock key residency.

**Target:** Configurable auto_lock and unlock mechanism; key residency must reconcile performance with no plaintext value cache.

**Acceptance:** An idle locked broker refuses reads until unlocked.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### store-sqlite

**Intent:** Allow scale-driven persistence changes without changing callers.

**Target:** Deferred until measured need; narrow Store interface, keep protocol/CLI semantics stable.

**Acceptance:** A migration preserves grant metadata and encrypted value ownership.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### grant-decay

**Intent:** Inspect and revoke long-lived approvals.

**Target:** Deferred management UI/CLI for always decay and revocation; policy TTL semantics remain in policy-ttl.

**Acceptance:** Revoked or decayed approvals no longer authorize access.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

## Decisions

[Foundation snapshot](../docs/decisions/0001-foundation.md) records the original rationale, not current status. Do not duplicate its phase labels in new roadmap entries.
