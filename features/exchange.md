# exchange

Navigation: [index](INDEX.md) · [registry](registry.yaml) · [product intent](product.md) · [architecture](architecture.md).

Status and code/test entry points live in registry.yaml. Section keys are stable; planned text is not a current capability. Manual evidence below uses fake data in temporary homes (2026-10-09); gaps are explicit.

### io-importenv

**Intent:** Migrate a small env file into the local vault.

**Current:** Defaults vault=imported/item=misc. Direct strings become fields, jtk:// becomes aliases, op:// is skipped and reported in stdout summary. Other schemes are strings. Existing fields/aliases can be overwritten; files are not erased.

**Acceptance:** Mixed file produces expected value/ref/skip counts and imported alias resolves.

**Verification:** io.test.ts covers classification; e2e.ts resolves the imported value through child env. Gaps: multi-key overwrite/ordering cases are missing.

**Impact:** Keep skip-on-import distinct from refuse-on-run; existing F6 message is legacy text, not a new milestone.

### io-exportref

**Intent:** Share configuration without exporting credential values.

**Current:** export supports env-ref/json-ref only, sorts alias keys and reads config without decrypting. Output is aliases, not a full vault listing. Plaintext env/json export and vault filtering are not implemented.

**Acceptance:** env-ref and json-ref match aliases and contain no source values.

**Verification:** io.test.ts and e2e.ts cover refs. Gaps: single-alias fixture does not demonstrate multi-key sort order.

**Impact:** Reference files imported into a fresh home do not transfer their target secret values.

### io-roundtrip

**Intent:** Keep portable reference configuration byte-stable.

**Current:** export env-ref -> import-env -> export env-ref is deterministic for the aliases represented. This does not promise a value backup/restore roundtrip.

**Acceptance:** Exported stdout is byte-identical after importing into a second temporary home.

**Verification:** io.test.ts covers same-home handler strings; e2e.ts covers fresh-home CLI stdout. Gaps: multi-alias sorting remains separate.

**Impact:** A new home receives references only; their target values remain in the original vault.

### io-reveal

**Intent:** Migrate values deliberately with an auditable authorization boundary.

**Target:** Explicit --reveal for plaintext env/json export, with policy/audit integration and vault filtering. Current export only supports env-ref/json-ref; adding --reveal to a refs export is not a value-export capability.

**Acceptance:** Plaintext export is impossible without explicit authorization; a permitted export records an audit event without putting values in the audit.

**Verification:** Not implemented. No existing runtime assertions prove target export or filtering behavior.

**Impact:** Broker policy, schema/backend field resolution and audit hooks; default reference-only export remains safe.

## Decisions

[Foundation snapshot](../docs/decisions/0001-foundation.md) records the original rationale, not current status. Do not duplicate its phase labels in new roadmap entries.
