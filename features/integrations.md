# integrations

Navigation: [index](INDEX.md) · [registry](registry.yaml) · [product intent](product.md) · [architecture](architecture.md).

Status and code/test entry points live in registry.yaml. Section keys are stable; planned text is not a current capability. Manual evidence below uses fake data in temporary homes (2026-10-09); gaps are explicit.

### mcp

**Intent:** Let different agent clients discover/request/use credentials.

**Target:** search/inspect_fields/request/exec_with_secret expose metadata/request/child execution; never make discovery a value dump.

**Acceptance:** A client executes with a credential under the same broker policy.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### io-adapter1p

**Intent:** Reuse existing vaults without making an external password manager mandatory.

**Target:** Adapter maps item/field identity and errors through a narrow backend; no migration/retirement claim for other tools until reevaluated.

**Acceptance:** Local vault stays usable without 1Password; adapter access uses the same policy.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### sshagent-ttl

**Intent:** Bound SSH key use to approved access lifetime.

**Target:** Deferred integration; SSH secret handling and agent socket trust need a dedicated design.

**Acceptance:** Expired approval does not keep an unintended key active.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

## Decisions

[Foundation snapshot](../docs/decisions/0001-foundation.md) records the original rationale, not current status. Do not duplicate its phase labels in new roadmap entries.
