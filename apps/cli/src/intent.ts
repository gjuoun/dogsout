// junethekey feature map — intent layer (the only hand-written part of the map).
// Structure (commands/flags/meta) is exported by ./commands.ts and read live by the
// `jtkmap` query tool (kept locally, outside this repo). This file answers "why" and
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
			does: "create vault.enc + config.json in JTK_HOME — no password: mints a Secure Enclave key, seals an empty vault, unlocks once (Touch ID) before reporting success",
			gotchas: [
				"--force replaces config AND vault — tests must use temporary JTK_HOME only",
				"needs the native helper (apps/ask/build.sh → ~/.bun/bin/jtk-approve, or JTK_SE_HELPER); tests point JTK_SE_HELPER at the fake",
				"one unlock factor only (this Mac's Touch ID) until WebUI passkey enrollment (F3)",
			],
			legacyFlags: { force: "init-guard" },
		},
		set: {
			tier: "stable",
			does: "store a value from stdin at a jtk:// address; vault/item are auto-created",
			plaintext: "value arrives via stdin, never as a CLI argument",
			gotchas: [
				"--stdin is declared but optional — the value ALWAYS comes from stdin",
				"one trailing newline is stripped; empty result is refused",
			],
			legacyFlags: { stdin: "set-stdin" },
			legacyKeys: ["set-autocreate"],
		},
		get: {
			tier: "stable",
			does: "read a value; masked sha256 digest + length by default",
			plaintext: "stdout, only with --reveal",
			gotchas: ["dotted subpath digs into JSON field values (legacy get-subpath)"],
			legacyFlags: { reveal: "get-reveal" },
			legacyKeys: ["get-mask", "get-subpath"],
		},
		ls: {
			tier: "stable",
			does: "list field addresses (or --json vault summary) without values",
			legacyFlags: { json: "ls-json" },
			legacyKeys: ["ls-lines"],
		},
		rm: {
			tier: "stable",
			does: "remove one field; refuses subpaths (field-level only)",
		},
		alias: {
			tier: "stable",
			does: "register NAME -> jtk:// address in config.json; rotation follows automatically",
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
		run: {
			tier: "stable",
			does: "resolve aliases/refs and inject them into a child process environment",
			plaintext: "child process env only; masked everywhere else",
			flagsExp: ["session", "resume", "principal"],
			gotchas: [
				"cmd-ts rest() keeps the leading -- token; the handler strips it",
				"--from-item is rejected with loud guidance (item spread was removed)",
				"exit code = child exit code; jtk failures exit 1 before spawning",
			],
			legacyFlags: { env: "run-env", "from-env": "run-fromenv" },
			legacyKeys: ["run-exitcode", "run-noleak"],
		},
		"import-env": {
			tier: "stable",
			does: "import a .env file: literals into the vault, jtk:// refs become aliases, op:// skipped",
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
			does: "vault envelope: status (no unlock), rekey, slot rm, restore a verified rolling backup",
			gotchas: [
				"a v1 (password) vault.enc is refused — cold cut 2026-10-14, no reader, no converter",
				"until the F3 daemon every vault command asks Touch ID once; cron/agents cannot unlock the vault yet",
				"restore promotes the state BEFORE the last write (rolling-backup semantics) and parks the broken file as vault.enc.broken",
				"rekey drops passkey slots (no PRF output on the CLI) — re-enroll them in the WebUI",
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
			id: "tests-use-temp-home",
			statement: "tests and manual checks use a temporary JTK_HOME with fake credentials, never the real vault",
		},
	],
	vault: {
		shape:
			"plaintext {version:1, vaults:{<vault>:{<item>:{fields, tags?, owner?, updated_at}}}}; on disk the v2 envelope {version:2, vault_id, fingerprint, data, slots[]} — type-contracts/src/vault.ts",
		crypto: [
			"random 32-byte DEK, AES-256-GCM over the whole vault JSON (AAD jtk/data/v2|vault_id), fresh IV per save",
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
			note: "swiftui -> cli approval channels, fail-closed when no channel decides",
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
			note: "spawns jtk-approve --se-* per call (JTK_SE_HELPER override; test fake in src/vault/helper/fake-se.ts)",
		},
		{
			name: "api skeleton",
			path: "src/api/",
			tier: "exp",
			note: "Hono + OpenAPI ask contract; not wired as a CLI command yet",
		},
	],
};
