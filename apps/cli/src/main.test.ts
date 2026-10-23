import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, nowIso, openData, saveData, vaultPath } from "@dogsout/core";
import type { FieldMeta, TreeNode } from "@dogsout/type-contracts";
import { runAlias } from "./alias.ts";
import type { Io } from "./cmd.ts";
import { runGet } from "./get.ts";
import { runInit } from "./init.ts";
import { runLs } from "./ls.ts";
import { runRm } from "./rm.ts";
import { runSet } from "./set.ts";

const FAKE_SE = join(import.meta.dir, "..", "..", "..", "packages", "core", "src", "vault", "helper", "fake-se.ts");
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
let home = "";

beforeAll(() => {
	home = mkdtempSync(join(tmpdir(), "dogsout-cli-"));
	process.env.DOGSOUT_HOME = home;
	process.env.DOGSOUT_SE_HELPER = FAKE_SE;
});

afterAll(() => {
	delete process.env.DOGSOUT_HOME;
	delete process.env.DOGSOUT_SE_HELPER;
	rmSync(home, { recursive: true, force: true });
});

describe("F1 CLI monolith (DOGSOUT_HOME isolated)", () => {
	test("init creates config + vault, both 0600", async () => {
		const r = await runInit([], stdinOf(""));
		expect(r.isOk()).toBe(true);
		expect(statSync(configPath(home)).mode & 0o077).toBe(0);
		expect(statSync(vaultPath(home)).mode & 0o077).toBe(0);
	});

	test("init twice without --force refused", async () => {
		const r = await runInit([]);
		expect(r.isErr()).toBe(true);
	});

	test("set → get --reveal returns original value", async () => {
		const s = await runSet(["dogsout://dev/zai/api_key", "--stdin"], stdinOf("sk-test-123\n"));
		expect(s.isOk()).toBe(true);
		const g = await runGet(["dogsout://dev/zai/api_key", "--reveal"]);
		expect(g.isOk()).toBe(true);
		if (g.isOk()) expect(g.value).toBe("sk-test-123");
	});

	test("get masked by default (no plaintext)", async () => {
		const g = await runGet(["dogsout://dev/zai/api_key"]);
		expect(g.isOk()).toBe(true);
		if (g.isOk()) {
			expect(g.value.startsWith("sha256:")).toBe(true);
			expect(g.value.includes("sk-test-123")).toBe(false);
		}
	});

	test("alias registers and resolves", async () => {
		const a = await runAlias(["ZAI_API_KEY", "dogsout://dev/zai/api_key"]);
		expect(a.isOk()).toBe(true);
		const g = await runGet(["ZAI_API_KEY", "--reveal"]);
		expect(g.isOk()).toBe(true);
		if (g.isOk()) expect(g.value).toBe("sk-test-123");
	});

	test("ls --json prints the metadata trie of the stored field", async () => {
		const r = await runLs(["--json"]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			const tree = JSON.parse(r.value) as TreeNode;
			const leaf = (tree.dev as TreeNode).zai as TreeNode;
			expect(Object.keys(leaf)).toEqual(["api_key"]);
			const meta = leaf.api_key as FieldMeta;
			expect(meta.address).toBe("dogsout://dev/zai/api_key");
			expect(meta.value_hash).toMatch(/^sha256:[0-9a-f]{8}$/);
			expect(r.value).not.toContain("sk-test-123");
		}
	});

	test("rm removes; subsequent get fails with not-found", async () => {
		const rm = await runRm(["dogsout://dev/zai/api_key"]);
		expect(rm.isOk()).toBe(true);
		const g = await runGet(["dogsout://dev/zai/api_key"]);
		expect(g.isErr()).toBe(true);
		if (g.isErr()) expect(g.error).toContain("not found");
	});
});

describe("input sugar and leaf-only writes", () => {
	test("set/get accept the jq-style sugar and share one stored field", async () => {
		const s = await runSet([".dev.zai.token", "--stdin"], stdinOf("sk-sugar-1\n"));
		expect(s.isOk()).toBe(true);
		const sugared = await runGet([".dev.zai.token", "--reveal"]);
		expect(sugared.isOk()).toBe(true);
		if (sugared.isOk()) expect(sugared.value).toBe("sk-sugar-1");
		const canonical = await runGet(["dogsout://dev/zai/token", "--reveal"]);
		if (canonical.isOk()) expect(canonical.value).toBe("sk-sugar-1");
	});

	test("alias stores the canonical address for sugared input", async () => {
		const a = await runAlias(["SUGAR_TOKEN", ".dev.zai.token"]);
		expect(a.isOk()).toBe(true);
		if (a.isOk()) expect(a.value).toBe("SUGAR_TOKEN -> dogsout://dev/zai/token");
	});

	test("set refuses an item path: a branch never holds a value", async () => {
		const s = await runSet([".dev.zai", "--stdin"], stdinOf("nope"));
		expect(s.isErr()).toBe(true);
		if (s.isErr()) expect(s.error).toContain("names an item, not a field");
	});

	test("set refuses a subpath instead of writing the first segment", async () => {
		const s = await runSet([".dev.zai.token.extra", "--stdin"], stdinOf("nope"));
		expect(s.isErr()).toBe(true);
		if (s.isErr()) expect(s.error).toContain("subpath");
		const unchanged = await runGet(["dogsout://dev/zai/token", "--reveal"]);
		if (unchanged.isOk()) expect(unchanged.value).toBe("sk-sugar-1");
	});

	test("rm accepts sugar and removes exactly that field", async () => {
		const r = await runRm([".dev.zai.token"]);
		expect(r.isOk()).toBe(true);
		const gone = await runGet([".dev.zai.token"]);
		expect(gone.isErr()).toBe(true);
	});
});

describe("v2 init and unlock (fake secure enclave helper)", () => {
	let v2home = "";
	let savedHome: string | undefined;
	beforeAll(() => {
		v2home = mkdtempSync(join(tmpdir(), "dogsout-cli-v2-"));
		savedHome = process.env.DOGSOUT_HOME;
		process.env.DOGSOUT_HOME = v2home;
		process.env.DOGSOUT_SE_HELPER = FAKE_SE;
	});
	afterAll(() => {
		process.env.DOGSOUT_HOME = savedHome;
		rmSync(v2home, { recursive: true, force: true });
	});

	test("init needs no password, prints the fingerprint and the single-factor warning", async () => {
		const r = await runInit([], stdinOf(""));
		const out = r._unsafeUnwrap();
		expect(out).toMatch(/vault v2, fingerprint [0-9A-F]{4}-[0-9A-F]{4}/);
		expect(out).toContain("one unlock factor");
		expect(JSON.parse(await Bun.file(vaultPath(v2home)).text()).version).toBe(2);
	});

	test("cancelled Touch ID fails closed", async () => {
		expect((await runSet(["dogsout://dev/gh/token", "--stdin"], stdinOf("FAKE-ghp\n"))).isOk()).toBe(true);
		process.env.FAKE_SE_MODE = "deny";
		try {
			const g = await runGet(["dogsout://dev/gh/token", "--reveal"]);
			expect(g._unsafeUnwrapErr()).toContain("vault unlock failed");
		} finally {
			delete process.env.FAKE_SE_MODE;
		}
	});
});

describe("ls glob and the legacy violation report", () => {
	let lsHome = "";
	let savedHome: string | undefined;
	const errLines: string[] = [];
	const io: Io = { stdin: async () => "", stdout: () => {}, stderr: (l) => errLines.push(l) };

	beforeAll(async () => {
		lsHome = mkdtempSync(join(tmpdir(), "dogsout-ls-"));
		savedHome = process.env.DOGSOUT_HOME;
		process.env.DOGSOUT_HOME = lsHome;
		process.env.DOGSOUT_SE_HELPER = FAKE_SE;
		await runInit([], stdinOf(""));
		await runSet(["dogsout://dev/gh/pat", "--stdin"], stdinOf("ghp_1"));
		await runSet(["dogsout://dev/gh/token", "--stdin"], stdinOf("tok_2"));
		await runSet(["dogsout://dev/zai/api_key", "--stdin"], stdinOf("sk_3"));
		// Pre-charset data, written the way it exists in the wild: straight into the vault.
		const ctx = { home: lsHome };
		const opened = await openData(ctx);
		if (opened.isErr()) throw new Error(opened.error);
		opened.value.data.vaults.e2e = { misc: { fields: { DIRECT_ONE: "legacy" }, updated_at: nowIso() } };
		const saved = await saveData(ctx, opened.value.envelope, opened.value.data);
		if (saved.isErr()) throw new Error(saved.error);
	});

	afterAll(() => {
		if (savedHome === undefined) delete process.env.DOGSOUT_HOME;
		else process.env.DOGSOUT_HOME = savedHome;
		delete process.env.DOGSOUT_SE_HELPER;
		rmSync(lsHome, { recursive: true, force: true });
	});

	test("a one-level glob lists that item, a recursive glob lists its subtree", async () => {
		const one = await runLs(["dev.zai.*"], io);
		expect(one.isOk()).toBe(true);
		if (one.isOk()) expect(one.value).toBe("dogsout://dev/zai/api_key");
		const deep = await runLs(["dev.**"], io);
		expect(deep.isOk()).toBe(true);
		if (deep.isOk()) {
			const lines = deep.value.split("\n");
			expect(lines).toEqual(["dogsout://dev/gh/pat", "dogsout://dev/gh/token", "dogsout://dev/zai/api_key"]);
		}
	});

	test("--json is the metadata trie, rooted where the pattern pinned it", async () => {
		const r = await runLs(["--json", "dev.gh"], io);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			const trie = JSON.parse(r.value) as TreeNode;
			expect(Object.keys(trie).sort()).toEqual(["pat", "token"]);
			expect((trie.pat as FieldMeta).address).toBe("dogsout://dev/gh/pat");
		}
	});

	test("a literal field address that matches nothing is a miss, not an empty listing", async () => {
		const r = await runLs(["dogsout://e2e/misc/direct_one"], io);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("not found");
	});

	test("stored charset violations are reported on stderr and left alone on stdout", async () => {
		errLines.length = 0;
		const r = await runLs([], io);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			expect(r.value).toContain("dogsout://e2e/misc/DIRECT_ONE");
			expect(r.value).not.toContain("warning:");
		}
		const said = errLines.join("\n");
		expect(said).toContain("violate the segment charset");
		expect(said).toContain('field "DIRECT_ONE"');
	});

	test("a legacy field stays readable and removable, so the report is actionable", async () => {
		const got = await runGet(["dogsout://e2e/misc/DIRECT_ONE", "--reveal"]);
		expect(got.isOk()).toBe(true);
		if (got.isOk()) expect(got.value).toBe("legacy");
		const moved = await runSet(["dogsout://e2e/misc/direct_one", "--stdin"], stdinOf("legacy"));
		expect(moved.isOk()).toBe(true);
		const removed = await runRm(["dogsout://e2e/misc/DIRECT_ONE"]);
		expect(removed.isOk()).toBe(true);
		const gone = await runGet(["dogsout://e2e/misc/DIRECT_ONE"]);
		expect(gone.isErr()).toBe(true);
		const clean = await runLs([], io);
		expect(clean.isOk()).toBe(true);
		if (clean.isOk()) expect(clean.value).toContain("dogsout://e2e/misc/direct_one");
	});
});
