# hosted

Navigation: [index](INDEX.md) · [registry](registry.yaml) · [product intent](product.md) · [architecture](architecture.md).

Status and code/test entry points live in registry.yaml. Section keys are stable; planned text is not a current capability. Manual evidence below uses fake data in temporary homes (2026-10-09); gaps are explicit.

### hosted-sync

**Intent:** Explore multi-machine coordination without assuming cloud secret custody.

**Target:** Deferred. Ciphertext/key ownership, conflict resolution and threat model must be separately approved; does not weaken values-stay-local promise.

**Acceptance:** No plaintext value is sent to hosted infrastructure.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### hosted-backup

**Intent:** Explore recovery beyond one machine.

**Target:** Deferred. Encryption, recovery keys, retention and deletion need their own spec; refs export is not a value backup.

**Acceptance:** Recoverability and cloud trust boundaries are explicitly approved before implementation.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

## Decisions

[Foundation snapshot](../docs/decisions/0001-foundation.md) records the original rationale, not current status. Do not duplicate its phase labels in new roadmap entries.
