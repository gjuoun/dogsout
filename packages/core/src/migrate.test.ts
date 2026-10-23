import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigration, planMigration } from "./migrate.ts";
import { storageGuard } from "./paths.ts";

const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

const CONFIG = {
	version: 1,
	aliases: { ZAI: "jtk://dev/zai/api_key", GH: "dogsout://dev/gh/pat" },
	maps: { llm: "jtk://dev/zai/api_key", llm2: "llm" },
	rules: [{ id: "r1", principal: "*", resource: "jtk://dev/*", decide: "ask" }],
};

const GRANTS = {
	version: 1,
	grants: [
		{
			id: "g1",
			principal: "agent@laptop",
			alias: "ZAI",
			address: "jtk://dev/zai/api_key",
			value_hash: "sha256:ab12cd34ef56",
			ttl: "10m",
			approved_via: "mygo",
			approved_at: "2026-10-20T12:00:00.000Z",
			expires_at: "2026-10-20T12:10:00.000Z",
			consumed: false,
		},
	],
};

let legacy = "";
let home = "";

/** A pre-rename home: legacy addresses, a config/vault pair, 0600 modes. */
function seedLegacy(dir: string): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "config.json"), JSON.stringify(CONFIG, null, 2));
	chmodSync(join(dir, "config.json"), 0o600);
	writeFileSync(join(dir, "grants.json"), JSON.stringify(GRANTS, null, 2));
	chmodSync(join(dir, "grants.json"), 0o600);
	writeFileSync(join(dir, "vault.enc"), JSON.stringify({ version: 2, ciphertext: "not-really" }));
	chmodSync(join(dir, "vault.enc"), 0o600);
}

beforeAll(() => {
	legacy = mkdtempSync(join(tmpdir(), "dogsout-migrate-legacy-"));
	home = join(mkdtempSync(join(tmpdir(), "dogsout-migrate-target-")), "dogsout");
	seedLegacy(legacy);
	delete process.env.DOGSOUT_HOME;
});

afterAll(() => {
	rmSync(legacy, { recursive: true, force: true });
	rmSync(join(home, ".."), { recursive: true, force: true });
});

describe("storageGuard", () => {
	let guardRoot = "";

	const seed = (dir: string): void => {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "config.json"), JSON.stringify({ version: 1, aliases: {}, maps: {} }));
	};

	test("points at migrate while only the legacy directory is populated", () => {
		guardRoot = mkdtempSync(join(tmpdir(), "dogsout-guard-"));
		const legacyDir = join(guardRoot, "junethekey");
		seed(legacyDir);
		const msg = storageGuard(undefined, join(guardRoot, "dogsout"), legacyDir);
		expect(msg).toBe(`storage found at ${legacyDir} — run: dogsout migrate`);
	});

	test("stands down once the new directory exists or DOGSOUT_HOME is explicit", () => {
		const legacyDir = join(guardRoot, "junethekey");
		const newDir = join(guardRoot, "dogsout");
		expect(storageGuard("any", newDir, legacyDir)).toBeNull();
		seed(newDir);
		expect(storageGuard(undefined, newDir, legacyDir)).toBeNull();
		rmSync(guardRoot, { recursive: true, force: true });
	});
});

describe("dogsout migrate", () => {
	test("dry-run plans the rewrites and changes no byte", async () => {
		const configBefore = readFileSync(join(legacy, "config.json"), "utf8");
		const grantsBefore = readFileSync(join(legacy, "grants.json"), "utf8");
		const vaultBefore = sha(join(legacy, "vault.enc"));

		const plan = await planMigration({ home, legacy });
		expect(plan.isOk()).toBe(true);
		const p = plan._unsafeUnwrap();
		expect(p.storage.action).toBe("move");
		// alias ZAI + maps.llm + rules[0].resource + grants[0].address = 4
		expect(p.totalRewrites).toBe(4);
		expect(p.files.find((f) => f.path.endsWith("config.json"))?.rewrites).toBe(3);
		expect(p.files.find((f) => f.path.endsWith("grants.json"))?.rewrites).toBe(1);

		expect(readFileSync(join(legacy, "config.json"), "utf8")).toBe(configBefore);
		expect(readFileSync(join(legacy, "grants.json"), "utf8")).toBe(grantsBefore);
		expect(sha(join(legacy, "vault.enc"))).toBe(vaultBefore);
	});

	test("apply rewrites addresses, keeps value_hash and the vault bytes, then moves the directory", async () => {
		const vaultBefore = sha(join(legacy, "vault.enc"));
		const plan = (await planMigration({ home, legacy }))._unsafeUnwrap();
		const applied = await applyMigration(plan);
		expect(applied.isOk()).toBe(true);
		const r = applied._unsafeUnwrap();
		expect(r.rewrites).toBe(4);
		expect(r.filesWritten).toBe(2);
		expect(r.storage).toBe("move");

		const cfg = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
		expect(cfg.aliases.ZAI).toBe("dogsout://dev/zai/api_key");
		expect(cfg.aliases.GH).toBe("dogsout://dev/gh/pat");
		expect(cfg.maps.llm).toBe("dogsout://dev/zai/api_key");
		expect(cfg.rules[0].resource).toBe("dogsout://dev/*");

		const grants = JSON.parse(readFileSync(join(home, "grants.json"), "utf8"));
		expect(grants.grants[0].address).toBe("dogsout://dev/zai/api_key");
		// the rotation fingerprint is metadata copied verbatim, never recomputed
		expect(grants.grants[0].value_hash).toBe("sha256:ab12cd34ef56");

		expect(sha(join(home, "vault.enc"))).toBe(vaultBefore);
		expect(statSync(join(home, "config.json")).mode & 0o777).toBe(0o600);
		expect(statSync(join(home, "grants.json")).mode & 0o777).toBe(0o600);
	});

	test("a second run is a no-op and writes nothing", async () => {
		const cfgBefore = readFileSync(join(home, "config.json"), "utf8");
		const plan = (await planMigration({ home, legacy }))._unsafeUnwrap();
		expect(plan.storage.action).toBe("already-migrated");
		expect(plan.totalRewrites).toBe(0);
		const applied = await applyMigration(plan);
		expect(applied._unsafeUnwrap().filesWritten).toBe(0);
		expect(readFileSync(join(home, "config.json"), "utf8")).toBe(cfgBefore);
	});
});
