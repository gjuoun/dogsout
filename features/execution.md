# execution

Navigation: [index](INDEX.md) · [registry](registry.yaml) · [product intent](product.md) · [architecture](architecture.md).

Status and code/test entry points live in registry.yaml. Section keys are stable; planned text is not a current capability. Manual evidence below uses fake data in temporary homes (2026-10-09); gaps are explicit.

### run-env

**Intent:** Run applications with credentials without printing them to the agent.

**Current:** Repeated --env NAME resolves aliases. Names must match an env-variable identifier; direct addresses are rejected. Values go into child env; stdout/stderr remain inherited.

**Acceptance:** Child observes the alias value; missing alias and address-as-name fail before spawn.

**Verification:** run.test.ts and e2e.ts cover injection and bad names. Gaps: repeated --env and collision precedence lack dedicated regression.

**Impact:** Child behavior is outside jtk's no-persistence guarantees. Precedence: inherited env < from-env < explicit --env.

### run-fromenv

**Intent:** Commit refs.env-style application configuration while resolving secrets only on launch.

**Current:** --from-env FILE passes KEY=literal through, resolves KEY=jtk:// references and loudly refuses op://. Grammar trims lines, skips blank/comment/no-equals lines and splits at first equals; no shell quote/export/escape expansion. Other schemes are literal strings.

**Acceptance:** Child receives both literal and referenced values; op:// fails.

**Verification:** run.test.ts asserts the two values and op:// refusal. Gaps: collisions and shell-style syntax are outside this grammar.

**Impact:** Parser is shared with import-env, whose op:// behavior intentionally differs.

### run-noleak

**Intent:** Keep the launcher's master variable out of the child environment.

**Current:** run removes inherited JTK_MASTER before spreading inject. Known gap: explicitly supplied JTK_MASTER in a reference file/item/alias injection can restore that name. No absolute secret-leak protection or memory-zeroing guarantee.

**Acceptance:** Without explicit reinjection, child does not inherit the parent's fake master.

**Verification:** Manual evidence: 2026-10-09 child-env check with a fake master. Gaps: no permanent regression; explicit reinjection remains possible and needs separate safety work.

**Impact:** Target invariant is never exposing the unlock master to child processes; do not claim the reserved-name gap is fixed.

### run-exitcode

**Intent:** Preserve application failure signals for shell automation.

**Current:** run returns the child's exit code; dispatcher calls process.exit with it. jtk parsing/resolution failures use 1.

**Acceptance:** Child exit 7 becomes CLI exit 7.

**Verification:** Manual evidence: 2026-10-09 isolated CLI nonzero-child check. Gaps: existing run tests only assert zero exit.

**Impact:** Distinguish handler success (Result ok with code) from application success.

## Decisions

[Foundation snapshot](../docs/decisions/0001-foundation.md) records the original rationale, not current status. Do not duplicate its phase labels in new roadmap entries.
