import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrate } from "./migrate.ts";

const CONFIG = { version: 1, aliases: { ZAI: "jtk://dev/zai/api_key" }, maps: { llm: "jtk://dev/zai/api_key" } };
const GRANTS = {
	version: 1,
	grants: [
		{
			id: "g1",
			principal: "agent@laptop",
			alias: "ZAI",
			address: "jtk://dev/zai/api_key",
			value_hash: "sha256:keepme",
			ttl: "10m",
			approved_via: "mygo",
			approved_at: "2026-10-20T12:00:00.000Z",
			expires_at: null,
			consumed: false,
		},
	],
};

let root = "";
let legacy = "";
let home = "";

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "dogsout-cli-migrate-"));
	legacy = join(root, "junethekey");
	home = join(root, "dogsout");
	mkdirSync(legacy, { recursive: true });
	writeFileSync(join(legacy, "config.json"), JSON.stringify(CONFIG, null, 2));
	chmodSync(join(legacy, "config.json"), 0o600);
	writeFileSync(join(legacy, "grants.json"), JSON.stringify(GRANTS, null, 2));
	chmodSync(join(legacy, "grants.json"), 0o600);
	writeFileSync(join(legacy, "vault.enc"), "ciphertext-only");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("dogsout migrate command", () => {
	test("--dry-run describes the plan without touching a file", async () => {
		const before = readFileSync(join(legacy, "config.json"), "utf8");
		const r = await runMigrate(["--dry-run", "--home", home, "--legacy-home", legacy]);
		expect(r.isOk()).toBe(true);
		const out = r._unsafeUnwrap();
		expect(out).toContain("migrate (dry-run):");
		expect(out).toContain("total: 3 rewrites"); // alias + map slot + grant address
		expect(readFileSync(join(legacy, "config.json"), "utf8")).toBe(before);
	});
});

describe("charset violations in stored addresses", () => {
	let vroot = "";
	let vhome = "";
	let vlegacy = "";

	beforeAll(() => {
		vroot = mkdtempSync(join(tmpdir(), "dogsout-cli-migrate-cs-"));
		vlegacy = join(vroot, "junethekey");
		vhome = join(vroot, "dogsout");
		mkdirSync(vlegacy, { recursive: true });
		writeFileSync(
			join(vlegacy, "config.json"),
			JSON.stringify(
				{
					version: 1,
					aliases: { LEGACY_KEY: "dogsout://Dev/gh/DIRECT_ONE" },
					maps: { ok: "dogsout://dev/gh/pat" },
				},
				null,
				2,
			),
		);
	});

	afterAll(() => {
		rmSync(vroot, { recursive: true, force: true });
	});

	test("--dry-run lists them by segment and still writes nothing", async () => {
		const before = readFileSync(join(vlegacy, "config.json"), "utf8");
		const r = await runMigrate(["--dry-run", "--home", vhome, "--legacy-home", vlegacy]);
		expect(r.isOk()).toBe(true);
		const out = r._unsafeUnwrap();
		expect(out).toContain("charset: 1 stored address(es) violate [a-z0-9_-]");
		expect(out).toContain('dogsout://Dev/gh/DIRECT_ONE (vault "Dev", field "DIRECT_ONE")');
		expect(out).toContain('vault "Dev"');
		expect(out).toContain('field "DIRECT_ONE"');
		expect(out).toContain("total: 0 rewrites");
		expect(readFileSync(join(vlegacy, "config.json"), "utf8")).toBe(before);
	});
});
