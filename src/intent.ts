// junethekey feature map — intent layer (the only hand-written part of the map).
// Structure (commands/flags/meta) is exported by ./cli/commands.ts and read live by the
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
			does: "create vault.enc + config.json in JTK_HOME; master from JTK_MASTER, TTY prompt, or stdin",
			gotchas: [
				"master shorter than 8 chars is refused (legacy init-min8)",
				"--force replaces config AND vault — tests must use temporary JTK_HOME only",
			],
			legacyFlags: { force: "init-guard" },
			legacyKeys: ["init-master", "init-min8"],
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
	},
	invariants: [
		{
			id: "no-plaintext-default",
			statement: "default outputs, logs and notifications never carry values; reveal is always explicit",
			appliesTo: ["get"],
		},
		{
			id: "master-not-inherited",
			statement: "run strips JTK_MASTER from the child environment",
			appliesTo: ["run"],
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
			id: "tests-use-temp-home",
			statement: "tests and manual checks use a temporary JTK_HOME with fake credentials, never the real vault",
		},
	],
	vault: {
		shape: "{version:1, vaults:{<vault>:{<item>:{fields, tags?, owner?, updated_at}}}} — contracts/vault.ts",
		crypto: [
			"argon2id m=64MiB t=2 p=1 (hash-wasm) derives the AES-256 key",
			"AES-256-GCM over the whole vault JSON; fresh IV per save, salt fixed per vault",
			"envelope {kdf, iv_b64, ct_b64}; 0600 atomic write (tempfile + rename)",
		],
		gotchas: [
			"wrong master and tampering are indistinguishable (GCM auth failure) — by design",
			"every write re-encrypts the whole vault",
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
			name: "api skeleton",
			path: "src/api/",
			tier: "exp",
			note: "Hono + OpenAPI ask contract; not wired as a CLI command yet",
		},
	],
};
