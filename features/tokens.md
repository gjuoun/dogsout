# tokens

Navigation: [index](INDEX.md) · [registry](registry.yaml) · [product intent](product.md) · [architecture](architecture.md).

Status and code/test entry points live in registry.yaml. Section keys are stable; planned text is not a current capability. Manual evidence below uses fake data in temporary homes (2026-10-09); gaps are explicit.

### token-issue

**Intent:** Preapprove unattended jobs within a bounded scope.

**Target:** token issue --for --scope ... --ttl; issuance itself authorizes scope, plaintext shown once; deny rules remain authoritative.

**Acceptance:** Scoped job runs without repeated ask, outside scope fails.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### token-scope

**Intent:** Avoid vault-wide service-account access.

**Target:** Multiple jtk:// scopes with :r/:w/:rw suffix, union permissions; field/json.path through item/vault. Query component does not bypass prefix scope; whole-item jq requires item permission.

**Acceptance:** Field-only scope cannot expose another field or authorize an item-wide query.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### token-hash

**Intent:** Avoid persisting a reusable token plaintext.

**Target:** Broker stores SHA-256 plus metadata, not token plaintext; authentication timing/entropy need review.

**Acceptance:** Persisted token state cannot be used as a bearer token.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### token-ttl

**Intent:** Support both temporary and long-running jobs.

**Target:** Any TTL bounded by settings.token_max_ttl (target default one year); renew by reissuing.

**Acceptance:** Expired token fails regardless of cached grant.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### token-revoke

**Intent:** Stop a job's future authorized access.

**Target:** Revoke removes hash/authorization metadata; audit records use/scope/last_used_at. Already-released values cannot be recalled.

**Acceptance:** Next request after revoke fails.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### token-remote

**Intent:** Use scoped credentials from a trusted remote job.

**Target:** Deferred --listen or SSH forwarding over tailnet; authentication, transport and value-location threat model must be approved before exposing network reads.

**Acceptance:** No public unauthenticated broker entry; document where plaintext terminates.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

## Decisions

[Foundation snapshot](../docs/decisions/0001-foundation.md) records the original rationale, not current status. Do not duplicate its phase labels in new roadmap entries.
