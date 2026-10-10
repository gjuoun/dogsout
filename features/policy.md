# policy

Navigation: [index](INDEX.md) · [registry](registry.yaml) · [product intent](product.md) · [architecture](architecture.md).

Status and code/test entry points live in registry.yaml. Section keys are stable; planned text is not a current capability. Manual evidence below uses fake data in temporary homes (2026-10-09); gaps are explicit.

### policy-rules

**Intent:** Express understandable exceptions to general access rules.

**Target:** Last-match-wins, principal/group, glob resource and tags; no match uses default_decision.

**Acceptance:** A later specific rule overrides an earlier general match.

**Verification:** Automated unit + e2e coverage on temporary homes with fake data (2026-10-10, JG-121); see registry code/tests pointers.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### policy-decide

**Intent:** Separate automatic use, human approval and refusal.

**Target:** Decisions include matched rule and reason; token preauthorization never overrides deny.

**Acceptance:** deny refuses even a scope-authorized token.

**Verification:** Automated unit + e2e coverage on temporary homes with fake data (2026-10-10, JG-121); see registry code/tests pointers.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### policy-ttl

**Intent:** Limit how long a human approval stays valid.

**Target:** once/10m/1h/24h/30d/always (UI six tiers, default 10m) plus a session tier (manifest-only, dies with session end); always = fixed 30d expiry (always_decay configurable); rule TTL can be overridden at approval.

**Acceptance:** Expired and consumed grants cannot be reused.

**Verification:** Automated unit + e2e coverage on temporary homes with fake data (2026-10-10, JG-121); see registry code/tests pointers.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### policy-askon

**Intent:** Prevent approval drift after rotation or a new requesting principal.

**Target:** ask_on supports first-use and value-changed against the resolved value fingerprint.

**Acceptance:** Rotation triggers reapproval when configured, even through a link.

**Verification:** Automated unit + e2e coverage on temporary homes with fake data (2026-10-10, JG-121); see registry code/tests pointers.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### policy-evaluate

**Intent:** Keep live authorization and policy debugging consistent.

**Target:** evaluate takes policy, grants and credential metadata and returns plain decision/reason; no IO or global mutable state.

**Acceptance:** Identical input produces identical live and simulated decisions.

**Verification:** Automated unit + e2e coverage on temporary homes with fake data (2026-10-10, JG-121); see registry code/tests pointers.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### policy-simulate

**Intent:** Preview policy without granting or reading secrets.

**Target:** simulate principal/resource shares evaluate with live requests.

**Acceptance:** Simulation reports match/reason and does not create a grant.

**Verification:** Automated unit + e2e coverage on temporary homes with fake data (2026-10-10, JG-121); see registry code/tests pointers.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### policy-why

**Intent:** Explain the current grant and matched policy.

**Target:** why adds grant state and remaining TTL without exposing values.

**Acceptance:** Explain expired/mismatched grants without changing state.

**Verification:** Automated unit + e2e coverage on temporary homes with fake data (2026-10-10, JG-121); see registry code/tests pointers.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### policy-test

**Intent:** Regression-test a personal authorization policy.

**Target:** JSON cases compare expected decisions and can run in CI; not credential fixtures with real secrets.

**Acceptance:** Incorrect policy cases fail with useful reasons.

**Verification:** Automated unit + e2e coverage on temporary homes with fake data (2026-10-10, JG-121); see registry code/tests pointers.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### policy-config

**Intent:** Offer a safe writer for principals/settings/rules.

**Target:** config show/set/rule add|rm/principal add|rm/test; schema validation and 0600 atomic writes. F1 still writes aliases through flat commands.

**Acceptance:** Invalid changes leave the previous config intact.

**Verification:** Automated unit + e2e coverage on temporary homes with fake data (2026-10-10, JG-121); see registry code/tests pointers.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### grants-meta

**Intent:** Persist approvals without ever persisting values.

**Target:** grants.json under JTK_HOME stores agent/alias/value_hash/expiry/approved_via with 0600 atomic writes; value_hash mismatch (rotation) invalidates a grant regardless of remaining TTL.

**Acceptance:** Rotating a value invalidates its grant mid-TTL; no secret material ever lands in the store.

**Verification:** Automated unit + e2e coverage on temporary homes with fake data (2026-10-10, JG-121); see registry code/tests pointers.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### session-model

**Intent:** Tie approvals to an agent run instead of loose commands.

**Target:** Session {id, principal, key-set}; an opening manifest invites keys in batch under the session TTL tier; session end revokes every grant bound to it.

**Acceptance:** Grants issued inside a session stop working after session end.

**Verification:** Automated unit + e2e coverage on temporary homes with fake data (2026-10-10, JG-121); see registry code/tests pointers.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### session-resume

**Intent:** Resume an interrupted run without re-asking every key.

**Target:** resume replays the last approval list exactly once — permissions are restored, values are not; the replay list empties after use.

**Acceptance:** A resumed session receives its previously approved keys without prompts, exactly once.

**Verification:** Automated unit + e2e coverage on temporary homes with fake data (2026-10-10, JG-121); see registry code/tests pointers.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

## Decisions

[Foundation snapshot](../docs/decisions/0001-foundation.md) records the original rationale, not current status. Do not duplicate its phase labels in new roadmap entries.
