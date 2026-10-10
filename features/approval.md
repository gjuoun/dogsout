# approval

Navigation: [index](INDEX.md) · [registry](registry.yaml) · [product intent](product.md) · [architecture](architecture.md).

Status and code/test entry points live in registry.yaml. Section keys are stable; planned text is not a current capability. Manual evidence below uses fake data in temporary homes (2026-10-09); gaps are explicit.

### approve-page

**Intent:** Let a person control agent requests without cloud deployment.

**Target:** Built-in minimal HTTP approval page reachable through LAN/tailnet; pending/approve/deny CLI fallback, adjustable TTL. Page auth/CSRF/origin rules need a protocol/security spec before exposure.

**Acceptance:** Approve creates a grant and releases the waiting request; deny/expiry release no value.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### approve-owner

**Intent:** Ask the credential's owner instead of an unrelated approver.

**Target:** Route ask to owner; link owner overrides or inherits canonical owner. Human pending default 24h, agent 15m; grant records approved_by/via.

**Acceptance:** A link cannot bypass owner routing.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### approve-once

**Intent:** Separate approval from a replayable value download.

**Target:** Approval creates a one-time fetch capability, consumed on retrieval; replay/concurrency behavior needs protocol definition.

**Acceptance:** Second redemption fails and values never pass through relay.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### approve-touchid

**Intent:** Make phone approval deliberate and convenient.

**Target:** Deferred biometric/device integration; platform and enrollment details open.

**Acceptance:** Only an authenticated human gesture authorizes the request.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### approve-pwa

**Intent:** Approve without keeping the local page in the foreground.

**Target:** Deferred PWA/Web Push, then possible iOS app; platform push constraints and authentication need separate design.

**Acceptance:** Background notifications carry metadata only.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### ask-contract

**Intent:** One JSON contract shared by every approval channel.

**Target:** zod schemas in contracts/ask.ts (AskRequest, Decision, TTL tiers, per-key choices) formalize the validated mockup; channels parse and emit only this contract.

**Acceptance:** The mockup decision literals parse and validate; deny carries no key map.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### ask-swiftui

**Intent:** Single-person local approval window without a daemon.

**Target:** Stateless SwiftUI helper jtk-approve: jtk writes AskRequest JSON, launches the helper, Decision JSON arrives on stdout, the process exits; closing the window yields deny.

**Acceptance:** approve/deny round-trip through contracts/ask.ts; closed window never approves.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### ask-cli

**Intent:** Approve from a terminal when no GUI channel exists.

**Target:** TTY per-key three-state prompt consuming the same AskRequest and emitting the same Decision JSON; non-TTY stdin yields deny (fail-closed).

**Acceptance:** Piped non-interactive stdin refuses to approve.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

## Decisions

[Foundation snapshot](../docs/decisions/0001-foundation.md) records the original rationale, not current status. Do not duplicate its phase labels in new roadmap entries.
