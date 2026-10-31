// dogsout feature map — intent layer (the only hand-written part of the map).
// Structure (commands/flags/meta) is exported by ./commands.ts and read live by the
// feature-map query tool (kept locally, outside this repo). This file answers "why" and
// "what must not break". Only existing functionality is described here.
// Types are self-contained on purpose: the repo must not depend on local tooling.

export type Tier = "stable" | "exp";
export type Resource = "config" | "vault" | "grants" | "sessions";

export interface CommandIntent {
	tier: Tier;
	does: string;
	plaintext?: string;
	flagsExp?: string[];
	gotchas?: string[];
	legacyFlags?: Record<string, string>;
	legacyKeys?: string[];
}

export interface Invariant {
	id: string;
	statement: string;
	appliesTo?: string[];
}

export interface VaultModel {
	shape: string;
	crypto: string[];
	gotchas: string[];
}

export interface Component {
	name: string;
	path: string;
	tier: Tier;
	note: string;
}

export interface FeatureMap {
	commands: Record<string, CommandIntent>;
	invariants: Invariant[];
	vault?: VaultModel;
	components: Component[];
}

export const featureMap: FeatureMap = {
	commands: {
		init: {
			tier: "stable",
			does: "create vault.enc + config.json in DOGSOUT_HOME — no password, no Touch ID: mints a local 0600 unlock token, seals an empty vault with a token slot and verifies it opens; --se keeps the legacy Secure Enclave slot",
			gotchas: [
				"--force replaces config AND vault — tests must use temporary DOGSOUT_HOME only",
				"the unlock token (DOGSOUT_HOME/unlock-token, 0600) is printed as a PATH only — never as a value",
				"migrating an existing Touch ID vault: dogsout vault token add (one final Touch ID), then every command opens with the token",
			],
			legacyFlags: { force: "init-guard" },
		},
		set: {
			tier: "stable",
			does: "store a value from stdin at a dogsout:// address (or .vault.item.field sugar); a value starting with op:// is kept as a 1password ref",
			plaintext: "value arrives via stdin, never as a CLI argument",
			gotchas: [
				"--stdin is declared but optional — the value ALWAYS comes from stdin",
				"one trailing newline is stripped; empty result is refused",
				"a value starting with op:// goes to config.json (0600) as a reference: no unlock, no parse, no 1Password call — a typo surfaces at read time",
				"a literal write is refused when the address is already served by a ref — set an op:// reference to replace it, or rm it first",
				"a value lives on a leaf only: an item path or a subpath is refused (one node cannot be both a value and a branch)",
				"segments are [a-z0-9_-]; the jq-style sugar is CLI input only — stored addresses stay canonical",
			],
			legacyFlags: { stdin: "set-stdin" },
			legacyKeys: ["set-autocreate"],
		},
		get: {
			tier: "stable",
			does: "read a value; masked sha256 digest + length by default",
			plaintext: "stdout, only with --reveal",
			gotchas: [
				"dotted subpath digs into JSON field values (legacy get-subpath); an array element uses the standard jq index, .dev.gh.list.[0]",
				'bracket subpath keys stay readable: ["client.email"] for a key a dot would split',
				"alias/map slots win over the sugar; a dotted name that is not registered is read as .vault.item.field",
			],
			legacyFlags: { reveal: "get-reveal" },
			legacyKeys: ["get-mask", "get-subpath"],
		},
		ls: {
			tier: "stable",
			does: "list field paths without values; one listing, three views: a TTY connector tree that grows into JSON objects, a pipe of one jq dot path per leaf (feed it back to get), --json structure with metadata / null leaves",
			gotchas: [
				"one listing, three renderings: tty tree (human), piped jq paths (grep/xargs/get), --json trie (agents) — machine views use standard jq / JSON only, no invented notation; the retired `tree` command is `ls --json`",
				'a piped line is a jq path, not a dogsout:// address: .dev.gh.config.api.retry, and ["client.email"] when a key is not an identifier — every line is valid `get` input',
				"a JSON object field grows into its keys in all three views and shows no metadata of its own (get prints its digest)",
				"non-object JSON (array / scalar) stays one leaf, annotated only in the tty view (hosts · array(3)) — ls never expands arrays; get reaches an element through the standard index .field.[0]",
				"--json leaves carry address / value_hash / bytes / updated_at for a stored field, and null for a node inside a JSON value — never a value",
				"the listing is rooted where the path pinned it: (none) -> vaults, vault -> items, vault.item -> fields; a pipe line stays absolute either way",
				"glob: a.b.* is one level, a.b.** is the subtree; a path shorter than vault/item/field is a subtree prefix",
				"a literal field address that matches nothing is an error; a wildcard that matches nothing prints nothing",
				"subpaths are not listing arguments (the leaves are fields)",
				"stored addresses that violate the segment charset are reported on stderr — never rewritten; get/rm still accept them so the value can be moved by hand",
			],
			legacyFlags: { json: "ls-json" },
			legacyKeys: ["ls-lines", "tree"],
		},
		rm: {
			tier: "stable",
			does: "remove one field; refuses subpaths (field-level only)",
		},
		alias: {
			tier: "stable",
			does: "register NAME -> dogsout:// address in config.json; rotation follows automatically",
			gotchas: [
				"overlaps with `map` — the foundation spec wanted alias to be the soft link; merge is decided, not done yet",
			],
		},
		map: {
			tier: "exp",
			does: "register a slot pointing at an address or another slot (chained refs, cycle-guarded)",
			gotchas: [
				"divergence from the foundation spec (alias should have been the soft link) — merge pending, treat as exp",
				"resolution order: map slot first, then alias (resolveToAddress)",
			],
			legacyKeys: ["vault-link"],
		},
		migrate: {
			tier: "stable",
			does: "one-time rename migration: rewrite stored jtk:// addresses to dogsout:// and move the storage dir to ~/.config/dogsout",
			gotchas: [
				"--dry-run prints the plan and writes nothing; a second run reports zero rewrites and touches no file",
				"never decrypts the vault: vault.enc stays byte-identical and every value_hash is copied verbatim",
				"every other command refuses to start while a populated ~/.config/junethekey exists and ~/.config/dogsout does not",
				"stored addresses that violate the segment charset are listed (config/grants only — the vault is never opened) and left untouched",
			],
			legacyKeys: ["storage-migration-idempotent"],
		},
		run: {
			tier: "stable",
			does: "resolve aliases/refs and inject them into a child process environment",
			plaintext: "child process env only; masked everywhere else",
			flagsExp: ["session", "resume", "principal"],
			gotchas: [
				"cmd-ts rest() keeps the leading -- token; the handler strips it",
				"--from-item is rejected with loud guidance (item spread was removed)",
				"exit code = child exit code; dogsout failures exit 1 before spawning",
			],
			legacyFlags: { env: "run-env", "from-env": "run-fromenv" },
			legacyKeys: ["run-exitcode", "run-noleak"],
		},
		"import-env": {
			tier: "stable",
			does: "import a .env file: literals into the vault, dogsout:// refs become aliases, op:// lines become config refs",
			gotchas: [
				"a literal key becomes its lowercased field name (GITHUB_TOKEN -> github_token): env names are UPPER_SNAKE, address segments are lowercase",
				"a key still invalid after lowercasing, or two keys folding onto one field, aborts the whole import",
				"--vault/--item and every dogsout:// ref are validated before anything is written (no partial import)",
				"an op:// line lands as a config ref at dogsout://op/<1p-vault>/<lowercased key> (fixed op namespace, independent of --vault); a file of refs only never opens the vault",
			],
			legacyKeys: ["io-importenv"],
		},
		export: {
			tier: "stable",
			does: "export aliases as references only — env-ref / json-ref, never values",
			legacyKeys: ["io-exportref", "io-roundtrip"],
		},
		policy: {
			tier: "exp",
			does: "preview / explain / regression-test policy decisions; safe config edits",
			gotchas: ["simulate shares the live evaluator; it grants nothing and reveals nothing"],
			legacyKeys: [
				"policy-rules",
				"policy-decide",
				"policy-ttl",
				"policy-askon",
				"policy-evaluate",
				"policy-simulate",
				"policy-why",
				"policy-test",
				"policy-config",
			],
		},
		grants: {
			tier: "exp",
			does: "inspect and revoke approvals — metadata only, never values",
			legacyKeys: ["grants-meta", "session-model", "session-resume"],
		},
		vault: {
			tier: "exp",
			does: "vault envelope: status (no unlock), rekey, token add (Touch ID → local token migration), slot rm, restore a verified rolling backup",
			gotchas: [
				"a v1 (password) vault.enc is refused — cold cut 2026-10-14, no reader, no converter",
				"unlock order: local token first (no UI); a legacy Secure Enclave slot is used only when DOGSOUT_ALLOW_SE=1, which `vault token add` sets for its one run",
				"restore promotes the state BEFORE the last write (rolling-backup semantics) and parks the broken file as vault.enc.broken",
				"rekey drops passkey slots (no PRF output on the CLI) and token slots whose token is absent — re-add with vault token add",
			],
		},
	},
	invariants: [
		{
			id: "no-plaintext-default",
			statement: "default outputs, logs and notifications never carry values; reveal is always explicit",
			appliesTo: ["get"],
		},
		{
			id: "export-refs-only",
			statement: "export and ls emit references/metadata only, never secret values",
			appliesTo: ["export", "ls"],
		},
		{
			id: "metadata-only-persist",
			statement: "grants/sessions persist hashes and approval metadata, never values",
			appliesTo: ["run", "grants", "policy"],
		},
		{
			id: "v2-at-least-one-slot",
			statement: "a v2 vault always keeps at least one unlock slot; removing the last slot is refused",
			appliesTo: ["vault"],
		},
		{
			id: "backup-verified-before-rotate",
			statement: "a write is read back before it replaces vault.enc; a failed write never rotates or replaces anything",
			appliesTo: ["set", "rm", "import-env", "vault"],
		},
		{
			id: "unlock-fail-closed",
			statement: "no usable slot, cancelled Touch ID or a failing helper denies — never a fallback to a weaker factor",
			appliesTo: ["get", "run", "set", "ls", "rm", "vault"],
		},
		{
			id: "storage-migration-idempotent",
			statement:
				"the rename migration rewrites addresses only: it never opens the vault, keeps every value_hash, and a second run changes nothing",
			appliesTo: ["migrate"],
		},
		{
			id: "address-segment-charset",
			statement:
				"every vault, item and field segment a write introduces is [a-z0-9_-] (lowercase, no dots); subpath keys are JSON keys and exempt. Reads and rm stay tolerant so pre-charset addresses remain readable and removable, and violations are reported, never rewritten",
			appliesTo: ["set", "get", "rm", "ls", "alias", "map", "import-env", "migrate"],
		},
		{
			id: "tests-use-temp-home",
			statement: "tests and manual checks use a temporary DOGSOUT_HOME with fake credentials, never the real vault",
		},
	],
	vault: {
		shape:
			"plaintext {version:1, vaults:{<vault>:{<item>:{fields, tags?, owner?, updated_at}}}}; on disk the v2 envelope {version:2, vault_id, fingerprint, data, slots[]} — type-contracts/src/vault.ts",
		crypto: [
			"random 32-byte DEK, AES-256-GCM over the whole vault JSON (AAD jtk/data/v2|vault_id — a frozen wire constant, see the MUST NOT CHANGE note in vault/envelope.ts), fresh IV per save",
			"se slot = ECDH(Secure Enclave, ephemeral) → HKDF jtk/se-kek/v1 → AES-GCM wrap of the DEK (AAD jtk/slot/se|vault_id|slot_id)",
			"fingerprint = HKDF(DEK, jtk/fingerprint/v1)[0:4]; no password, no Argon2id",
			"every write: tmp (0600) → read-back check → .bak.1→.bak.2, vault.enc→.bak.1 → rename (2 rolling backups)",
		],
		gotchas: [
			"a slot moved into another vault fails its AAD check; tampering is a GCM auth failure — never plaintext",
			"every write re-encrypts the whole vault",
			"v2 slot metadata (kind, id, created_at, public keys) is plaintext so status never unlocks",
		],
	},
	components: [
		{
			name: "ask channel chain",
			path: "src/ask/",
			tier: "exp",
			note: "mygo -> cli approval channels, fail-closed when no channel decides",
		},
		{ name: "policy core", path: "src/policy/", tier: "exp", note: "pure evaluator + TTL tiers" },
		{
			name: "session stores",
			path: "src/session/",
			tier: "exp",
			note: "grants.json / sessions.json, 0600 atomic, metadata only",
		},
		{
			name: "vault v2 envelope",
			path: "src/vault/envelope.ts",
			tier: "exp",
			note: "pure DEK/slot crypto; the Secure Enclave is injected as an ECDH function",
		},
		{
			name: "secure enclave helper client",
			path: "src/vault/se.ts",
			tier: "exp",
			note: "spawns dogsout-se per call (DOGSOUT_SE_HELPER override; test fake in src/vault/helper/fake-se.ts)",
		},
		{
			name: "api skeleton",
			path: "src/api/",
			tier: "exp",
			note: "Hono + OpenAPI ask contract; not wired as a CLI command yet",
		},
	],
};
