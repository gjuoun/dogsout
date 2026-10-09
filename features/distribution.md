# distribution

Navigation: [index](INDEX.md) · [registry](registry.yaml) · [product intent](product.md) · [architecture](architecture.md).

Status and code/test entry points live in registry.yaml. Section keys are stable; planned text is not a current capability. Manual evidence below uses fake data in temporary homes (2026-10-09); gaps are explicit.

### dist-npm

**Intent:** Install jtk without cloning source.

**Target:** Primary distribution target. Package bin exists but no publishing workflow; executable entry/shebang and clean install must be verified before declaring shipped.

**Acceptance:** Fresh npm installation executes jtk and preserves Bun/runtime prerequisites.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### dist-compile

**Intent:** Run jtk on a VPS without a source checkout.

**Target:** Secondary bun --compile artifact; target platforms/build dependency compatibility require probes.

**Acceptance:** Compiled artifact runs isolated vault/CLI acceptance on supported platforms.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### dist-quickjs

**Intent:** Keep an alternate small-runtime exit open without investing now.

**Target:** Deferred; runtime/crypto/schema parity must be demonstrated, not assumed.

**Acceptance:** Same plain-data contracts and authorization behavior on an alternate runtime.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### dist-microts

**Intent:** Record a possible future runtime, not a present dependency.

**Target:** Deferred; no implementation path or schedule.

**Acceptance:** Only pursue after compatibility and deployment need are demonstrated.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

## Decisions

[Foundation snapshot](../docs/decisions/0001-foundation.md) records the original rationale, not current status. Do not duplicate its phase labels in new roadmap entries.
