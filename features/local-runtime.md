# local runtime

Navigation: [index](INDEX.md) · [registry](registry.yaml) · [product intent](product.md) · [architecture](architecture.md).

Status and code/test entry points live in registry.yaml. Section keys are stable; planned text is not a current capability. Manual evidence below uses fake data in temporary homes (2026-10-09); gaps are explicit.

### global-home

**Intent:** Select a per-machine or per-test vault without touching another profile.

**Current:** JTK_HOME selects config.json and vault.enc; default is ~/.config/junethekey.

**Acceptance:** Given a temporary JTK_HOME, init writes only there.

**Verification:** main.test.ts isolates JTK_HOME. Gaps: default-home behavior is not exercised (tests must not touch the real vault).

**Impact:** Shared by all file operations.

### global-master

**Intent:** Unlock locally without a daemon or a persistent plaintext cache.

**Current:** Vault-reading/writing handlers read JTK_MASTER per invocation; init additionally accepts a TTY prompt or stdin. export/help do not decrypt and need no master. No daemon or auto-lock exists yet.

**Acceptance:** Without master, get fails; refs-only export still succeeds.

**Verification:** Manual evidence: 2026-10-09 isolated CLI checks unset the master for get and export. Gaps: no checked-in missing/changed-master regression.

**Impact:** Do not describe target daemon key lifetime as current behavior.

### global-exit

**Intent:** Make shell automation distinguish broker failures and child exit codes.

**Current:** Success is 0; broker errors use stderr prefix jtk: and exit 1; help/--help return 0, no arguments print help and return 1. run forwards child exit status.

**Acceptance:** help exits 0, an unknown command exits 1, a child exiting 7 produces 7.

**Verification:** Manual evidence: 2026-10-09 isolated CLI help/error/nonzero-child checks. Gaps: dispatcher has no checked-in unit regression.

**Impact:** Keep run-exitcode separate from handler Result success.

### global-crypto

**Intent:** Keep persisted credential values encrypted at rest.

**Current:** hash-wasm Argon2id (65536 KiB, 2 iterations, parallelism 1; random 16-byte salt) derives a raw 32-byte AES key. WebCrypto AES-256-GCM uses a fresh 12-byte IV per seal. Save retains the salt. Whole-vault reads/decrypts and writes/reseals; no stable latency promise.

**Acceptance:** Roundtrip preserves data; wrong master and modified ciphertext return failures.

**Verification:** vault.test.ts covers roundtrip, wrong-master, tampering, retained salt. Gaps: no dedicated fresh-IV/KDF/header-corruption assertion.

**Impact:** The historical Bun.password design is not the implementation. Data schema is vaults.<vault>.<item>.fields, not an items wrapper.

### global-files

**Intent:** Keep the credential file authoritative without durable value copies.

**Current:** config.json stores aliases/settings; vault.enc stores credential values. Each writer chmods its temporary file to 0600 then renames it. config uses a fixed .tmp name; vault uses a PID suffix.

**Acceptance:** Files created under isolated home have no group/other permissions; plaintext is not persisted as a cache.

**Verification:** main.test.ts and vault.test.ts assert private group/other mode bits. Gaps: no crash/concurrent-writer proof or exact owner-bit regression.

**Impact:** Do not infer cross-file transactions or forensic deletion guarantees.

### help

**Intent:** Find supported CLI syntax without unlocking the vault.

**Current:** help and --help list flat F1 commands, including import-env/export. Target daemon commands are absent.

**Acceptance:** Help shows supported commands and exits 0 without master.

**Verification:** Manual evidence: 2026-10-09 CLI --help check. Gaps: no permanent usage snapshot test.

**Impact:** Update usage when adding a command, not from a planned registry entry.

## Decisions

[Foundation snapshot](../docs/decisions/0001-foundation.md) records the original rationale, not current status. Do not duplicate its phase labels in new roadmap entries.
