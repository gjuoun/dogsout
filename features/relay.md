# relay

Navigation: [index](INDEX.md) · [registry](registry.yaml) · [product intent](product.md) · [architecture](architecture.md).

Status and code/test entry points live in registry.yaml. Section keys are stable; planned text is not a current capability. Manual evidence below uses fake data in temporary homes (2026-10-09); gaps are explicit.

### relay-selfhosted

**Intent:** Add off-screen push without relocating credentials.

**Target:** Optional jtk relay deployment; local phone approval remains zero-deployment default. TLS required, metadata only.

**Acceptance:** A deployed relay notifies and routes approval but never receives values.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### relay-connection

**Intent:** Reach approval devices without exposing a local public ingress.

**Target:** Daemon outbound WebSocket, enrollment token, reconnect/backoff; versioned metadata/approval protocol needed.

**Acceptance:** NAT traversal requires no inbound public daemon port.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### relay-pairing

**Intent:** Bind approval replies to a permitted device.

**Target:** Pairing code enrollment; expiry/replay/device revocation behavior remains to be specified.

**Acceptance:** An unpaired device cannot approve.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### relay-ntfy

**Intent:** Deliver a genuine push prompt for an approval.

**Target:** Initial ntfy notifications with Approve/Deny callbacks; bind callbacks to authenticated pending requests, metadata only.

**Acceptance:** A callback approves only its bound live request.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### relay-hosted

**Intent:** Offer managed approval delivery without operating a relay server.

**Target:** Direction: operate the same relay protocol/service. Tenant isolation, enrollment, operations and subscription design require a separate spec; not approval to host credentials.

**Acceptance:** Cross-tenant approval/data access fails; no secret enters the service.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

## Decisions

[Foundation snapshot](../docs/decisions/0001-foundation.md) records the original rationale, not current status. Do not duplicate its phase labels in new roadmap entries.
