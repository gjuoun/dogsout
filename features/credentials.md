# credentials

Navigation: [index](INDEX.md) · [registry](registry.yaml) · [product intent](product.md) · [architecture](architecture.md).

Status and code/test entry points live in registry.yaml. Section keys are stable; planned text is not a current capability. Manual evidence below uses fake data in temporary homes (2026-10-09); gaps are explicit.

### init-master

**Intent:** Create a local encrypted vault using a supplied master.

**Current:** init chooses JTK_MASTER, otherwise one-line readline on TTY or stdin until EOF off-TTY. The readline prompt does not implement hidden password entry.

**Acceptance:** Environment and piped master initialize a fresh temporary home; interactive input returns after a line.

**Verification:** e2e.ts exercises environment init. Gaps: interactive prompt/TTY is not covered; do not claim hidden input.

**Impact:** Changes affect encryption and tests; never initialize a user's real home in verification.

### init-min8

**Intent:** Reject accidental empty or too-short initial masters.

**Current:** init refuses master length below 8 characters.

**Acceptance:** A 4-character master returns exit 1 before creating the vault.

**Verification:** Manual evidence: 2026-10-09 temporary-home CLI short-master check. Gaps: no checked-in length-boundary regression.

**Impact:** This is a minimum length check, not a strength estimator.

### init-guard

**Intent:** Avoid silently overwriting an existing local profile.

**Current:** Existing config.json blocks init unless --force; force replaces config and vault.

**Acceptance:** A second init without force fails.

**Verification:** main.test.ts covers duplicate refusal. Gaps: force-reset behavior has no dedicated regression.

**Impact:** --force is destructive for a real profile; use only throwaway homes in tests.

### set-stdin

**Intent:** Keep values out of CLI positional arguments.

**Current:** set reads stdin, removes one trailing newline, refuses an empty result. --stdin is documented but not actually required by the parser. Literal echo commands can still enter shell history.

**Acceptance:** set from piped input followed by reveal returns the input without its final newline.

**Verification:** main.test.ts and e2e.ts cover set/reveal. Gaps: empty/refusal and multiline-edge assertions are missing.

**Impact:** Do not promise input files/shell/child programs never persist values.

### set-autocreate

**Intent:** Store a credential without separate vault/item setup commands.

**Current:** Missing vault/item maps are created and item.updated_at is refreshed.

**Acceptance:** Setting a field in a missing item makes it readable.

**Verification:** main.test.ts implicitly exercises creation. Gaps: timestamp and overwrite semantics lack dedicated assertions.

**Impact:** Item schema and import-env share the same container shape.

### set-addr

**Intent:** Use stable jtk:// addresses across commands and references.

**Current:** set expects vault/item/field. Dot suffixes parse as subpaths, but set ignores the suffix and stores the whole input in the first field segment; it does not perform JSON subfield writes. Parser filters empty slash/dot segments and is not identical to AddressSchema.

**Acceptance:** Given key.a.b, set writes the whole supplied value at field key; get resolves the JSON path.

**Verification:** Manual evidence: 2026-10-09 dotted-set/readback check. Gaps: no checked-in parser/negative-address regression.

**Impact:** Shared parsing affects get, aliases, rm and token scope design.

### get-mask

**Intent:** Inspect a credential without printing its value.

**Current:** Default output is sha256:first8 (N bytes, --reveal to show). N currently uses JS string.length (UTF-16 code units), so the bytes label is inaccurate for non-ASCII.

**Acceptance:** Default output has a digest prefix and does not contain the source value.

**Verification:** main.test.ts asserts prefix/no source value. Gaps: exact digest/length and Unicode-label behavior need regression.

**Impact:** Fixing the unit label is separate product work; this migration documents it.

### get-reveal

**Intent:** Let a human deliberately read a local value.

**Current:** --reveal prints the resolved value to stdout. F1 has no policy gate or audit hook. run is another plaintext delivery path, into child env.

**Acceptance:** Explicit reveal equals the stored value; default output remains masked.

**Verification:** main.test.ts and e2e.ts assert exact reveal.

**Impact:** Adding broker authorization must cover readValue consumers as well as the get command.

### get-subpath

**Intent:** Reuse one structured credential item without copied fields.

**Current:** JSON field values support dot traversal. Non-JSON, non-object traversal and undefined results fail; strings return raw, other JSON results stringify. CLI errors are Result string failures, not structured daemon error frames.

**Acceptance:** A stored JSON value read at key.a.b returns b; non-JSON traversal fails.

**Verification:** Manual evidence: 2026-10-09 CLI JSON-path/value/error checks. Gaps: AddressSchema tests are syntax-only, no execution regression exists.

**Impact:** Scope and jq boundaries must not be inferred from this F1 parser.

### ls-lines

**Intent:** Discover available credentials without revealing their values.

**Current:** ls prints one canonical jtk://vault/item/field address per line; no values.

**Acceptance:** The field address appears and the stored fake value does not.

**Verification:** Manual evidence: 2026-10-09 isolated CLI ls check. Gaps: comprehensive no-value regression is missing.

**Impact:** Listing currently decrypts the vault; future metadata discovery has separate authorization semantics.

### ls-json

**Intent:** Feed discovery into tools and pipelines.

**Current:** --json returns {vaults:{<vault>:{<item>:[fieldNames]}}}, without values.

**Acceptance:** Stored field name is present in the matching item.

**Verification:** main.test.ts checks a JSON field. Gaps: complete shape/no-value assertions are missing.

**Impact:** Do not substitute the ls projection for the vault storage schema.

### rm

**Intent:** Remove a credential without silently editing a JSON subfield.

**Current:** rm deletes one field, rejects subpaths, and fails if absent. It refreshes the item timestamp; it does not perform link dependency cleanup.

**Acceptance:** After deletion, get returns not-found.

**Verification:** main.test.ts covers deletion/read failure. Gaps: nonexistent-rm and subpath-refusal regression are missing.

**Impact:** Future vault-link inbound-reference safety must be added before claiming it here.

### alias

**Intent:** Reference one stored value under an environment-friendly name.

**Current:** alias stores NAME -> jtk:// address in config.json. Resolution is one lookup; target existence is not checked. No nested alias/dynamic link behavior yet. --env separately requires a valid environment variable name.

**Acceptance:** Alias reveal and --env resolve the same field.

**Verification:** main.test.ts and run.test.ts cover alias/read/injection. Gaps: missing target handling and nested-link semantics are not feature guarantees.

**Impact:** Policy will match requested name; do not silently change identity to canonical address.

### get-jq

**Intent:** Query structured credentials without copying values.

**Target:** Support --jq and ?jq= on an item or field; never cross items. Item-wide queries require item scope, not field scope. Queries do not bypass resource authorization; jq-wasm is only a prior candidate, not an installed backend.

**Acceptance:** Scoped queries return only authorized results; field scope cannot authorize whole-item queries.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### get-batch

**Intent:** Ask once for a related batch of credentials.

**Target:** Names use glob, values use jq; expand requested names and group approval. Exact batch failure/partial-result contract must be settled before implementation.

**Acceptance:** A batch requiring ask creates one approval request, never a silent partly authorized value dump.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### get-stdin

**Intent:** Combine machine-readable discovery with complex external selection.

**Target:** Consume names from stdin, as in ls --json | jq -r ... | get --stdin; stdin names are not plaintext secret input.

**Acceptance:** Selected names follow the same policy and approval path as explicit names.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### vault-link

**Intent:** Rotate one value and have every reference follow it.

**Target:** Aliases evolve into links: address/alias targets, no cycles, depth <=8, dynamic item-local jq; owner inheritance and inbound-reference deletion safety. Policy matches requested names, grants fingerprint resolved values.

**Acceptance:** Rotation invalidates affected fingerprints; cycles and unsafe deletes fail.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

### vault-history

**Intent:** Recover mistaken edits locally.

**Target:** Deferred beyond the monolith; storage/retention/recovery design remains open.

**Acceptance:** Recovery does not produce durable plaintext copies.

**Verification:** Not implemented; no runtime test evidence. Open questions remain in the target text; no imaginary code paths are registered.

**Impact:** Review shared semantics and trust boundaries in architecture.md; historical decisions: ../docs/decisions/0001-foundation.md.

## Decisions

[Foundation snapshot](../docs/decisions/0001-foundation.md) records the original rationale, not current status. Do not duplicate its phase labels in new roadmap entries.
