import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FieldMeta, TreeNode } from "@dogsout/type-contracts";
import type { Io } from "./cmd.ts";
import { runGet } from "./get.ts";
import { runInit } from "./init.ts";
import { runLs } from "./ls.ts";
import { runSet } from "./set.ts";

const FAKE_SE = join(import.meta.dir, "..", "..", "..", "packages", "core", "src", "vault", "helper", "fake-se.ts");
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
let home = "";

/** Piped stdout (no tty) is the machine view; the tty fake asks for the human view. */
const pipeIo: Io = { stdin: async () => "", stdout: () => {} };
const ttyIo: Io = { stdin: async () => "", stdout: () => {}, tty: true };

beforeAll(async () => {
	home = mkdtempSync(join(tmpdir(), "dogsout-ls-tree-"));
	process.env.DOGSOUT_HOME = home;
	process.env.DOGSOUT_SE_HELPER = FAKE_SE;
	await runInit([], stdinOf(""));
	await runSet(["dogsout://dev/gh/pat", "--stdin"], stdinOf("ghp_secret_tree"));
	await runSet(["dogsout://dev/gh/token", "--stdin"], stdinOf("tok-2"));
	await runSet(["dogsout://prod/aws/key", "--stdin"], stdinOf("AKIA-fake"));
});

afterAll(() => {
	delete process.env.DOGSOUT_HOME;
	delete process.env.DOGSOUT_SE_HELPER;
	rmSync(home, { recursive: true, force: true });
});

const jsonOf = async (argv: string[]): Promise<TreeNode> => {
	const r = await runLs(["--json", ...argv], pipeIo);
	if (r.isErr()) throw new Error(r.error);
	return JSON.parse(r.value) as TreeNode;
};

const leaf = (tree: TreeNode, ...segments: string[]): FieldMeta => {
	let cur: FieldMeta | TreeNode | null = tree;
	for (const seg of segments) cur = (cur as TreeNode)[seg] as FieldMeta | TreeNode | null;
	return cur as FieldMeta;
};

describe("dogsout ls --json (the structure view)", () => {
	test("the root trie nests vault -> item -> field", async () => {
		const tree = await jsonOf([]);
		expect(Object.keys(tree).sort()).toEqual(["dev", "prod"]);
		const meta = leaf(tree, "dev", "gh", "pat");
		expect(Object.keys(meta).sort()).toEqual(["address", "bytes", "updated_at", "value_hash"]);
		expect(meta.address).toBe("dogsout://dev/gh/pat");
		expect(meta.bytes).toBe("ghp_secret_tree".length);
		expect(meta.value_hash).toMatch(/^sha256:[0-9a-f]{8}$/);
		expect(meta.updated_at.length).toBeGreaterThan(0);
	});

	test("a path roots the trie where it was asked: item, then field", async () => {
		const item = await jsonOf(["dev.gh"]);
		expect(Object.keys(item).sort()).toEqual(["pat", "token"]);
		const field = await jsonOf(["dogsout://dev/gh/pat"]);
		expect(Object.keys(field)).toEqual(["pat"]);
	});

	test("a glob renders the matching subtree", async () => {
		const dev = await jsonOf(["dev.**"]);
		expect(Object.keys(dev)).toEqual(["gh"]);
		expect(Object.keys(dev.gh as TreeNode).sort()).toEqual(["pat", "token"]);
		const oneLevel = await jsonOf([".dev.*.token"]);
		expect(leaf(oneLevel, "gh", "token").address).toBe("dogsout://dev/gh/token");
	});

	test("the trie carries metadata only — never a value", async () => {
		const r = await runLs(["--json"], pipeIo);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			expect(r.value).not.toContain("ghp_secret_tree");
			expect(r.value).not.toContain("AKIA-fake");
			expect(r.value).toContain("sha256:");
		}
	});

	test("--json is the same text on a tty and on a pipe", async () => {
		const piped = await runLs(["--json", "dev.gh"], pipeIo);
		const terminal = await runLs(["--json", "dev.gh"], ttyIo);
		expect(piped._unsafeUnwrap()).toBe(terminal._unsafeUnwrap());
	});

	test("a literal field that matches nothing is a miss", async () => {
		const r = await runLs(["--json", "dev.gh.nope"], pipeIo);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("not found");
	});

	test("a subpath is not a listing argument", async () => {
		const r = await runLs(["dev.gh.pat.x"], pipeIo);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("not subpaths");
	});
});

describe("dogsout ls output modes", () => {
	test("a pipe prints one jq dot path per leaf", async () => {
		const r = await runLs([], pipeIo);
		expect(r._unsafeUnwrap().split("\n")).toEqual([".dev.gh.pat", ".dev.gh.token", ".prod.aws.key"]);
	});

	test("a tty prints the connector tree, human-only", async () => {
		const r = await runLs([], ttyIo);
		expect(r._unsafeUnwrap()).toBe(
			[".dev", "└─ gh", "   ├─ pat", "   └─ token", ".prod", "└─ aws", "   └─ key"].join("\n"),
		);
	});

	test("every piped path appears as one connector leaf in the tty tree", async () => {
		const piped = (await runLs([], pipeIo))._unsafeUnwrap().split("\n");
		const terminal = (await runLs([], ttyIo))._unsafeUnwrap().split("\n");
		for (const path of piped) {
			const field = path.split(".").pop() ?? "";
			const bare = terminal.map((l) => l.replace(/^[│├└─\s]+/, ""));
			expect(bare).toContain(field);
		}
	});

	test("a glob narrows the tty tree to the pinned depth", async () => {
		const r = await runLs(["dev.gh.*"], ttyIo);
		expect(r._unsafeUnwrap()).toBe("pat\ntoken");
	});
});

describe("dogsout ls — JSON drilling, three views ", () => {
	const CONFIG = '{"db_host":"db.internal","db_port":5432,"api":{"retry":3,"timeout":30}}';
	let jsonHome = "";

	beforeAll(async () => {
		jsonHome = mkdtempSync(join(tmpdir(), "dogsout-ls-drill-"));
		process.env.DOGSOUT_HOME = jsonHome;
		process.env.DOGSOUT_SE_HELPER = FAKE_SE;
		await runInit([], stdinOf(""));
		await runSet(["dogsout://dev/gh/config", "--stdin"], stdinOf(CONFIG));
		await runSet(["dogsout://dev/gh/hosts", "--stdin"], stdinOf('["a","b"]'));
		await runSet(["dogsout://dev/gh/meta", "--stdin"], stdinOf('{"client.email":"a@b"}'));
		await runSet(["dogsout://dev/gh/pat", "--stdin"], stdinOf("ghp_secret_drill"));
	});

	afterAll(() => {
		delete process.env.DOGSOUT_HOME;
		delete process.env.DOGSOUT_SE_HELPER;
		rmSync(jsonHome, { recursive: true, force: true });
	});

	test("tty: the tree keeps growing inward through the JSON object", async () => {
		const r = await runLs([".dev.gh.config"], ttyIo);
		expect(r._unsafeUnwrap()).toBe(
			["config", "├─ db_host", "├─ db_port", "└─ api", "   ├─ retry", "   └─ timeout"].join("\n"),
		);
	});

	test("--json: real structure with null leaves, no metadata inside a JSON field", async () => {
		const r = await runLs(["--json", ".dev.gh.config"], pipeIo);
		expect(r.isOk()).toBe(true);
		if (r.isErr()) return;
		expect(JSON.parse(r.value)).toEqual({
			config: { db_host: null, db_port: null, api: { retry: null, timeout: null } },
		});
		expect(r.value).not.toContain("db.internal");
	});

	test("pipe: one jq dot path per leaf, in listing order", async () => {
		const r = await runLs([".dev.gh.config"], pipeIo);
		expect(r._unsafeUnwrap().split("\n")).toEqual([
			".dev.gh.config.db_host",
			".dev.gh.config.db_port",
			".dev.gh.config.api.retry",
			".dev.gh.config.api.timeout",
		]);
	});

	test("every piped path feeds back into get as a masked digest", async () => {
		const listed = await runLs([".dev.gh.config"], pipeIo);
		const paths = listed._unsafeUnwrap().split("\n");
		expect(paths.length).toBe(4);
		for (const path of paths) {
			const got = await runGet([path]);
			expect(got.isOk()).toBe(true);
			if (got.isOk()) expect(got.value.startsWith("sha256:")).toBe(true);
		}
	});

	test("a key that is not an identifier is bracket-quoted and still feedable", async () => {
		const listed = await runLs([".dev.gh.meta"], pipeIo);
		expect(listed._unsafeUnwrap()).toBe('.dev.gh.meta["client.email"]');
		const got = await runGet([listed._unsafeUnwrap()]);
		expect(got.isOk()).toBe(true);
	});

	test("an array field is one annotated leaf, not a subtree", async () => {
		expect((await runLs([".dev.gh.hosts"], ttyIo))._unsafeUnwrap()).toBe("hosts · array(2)");
		expect((await runLs([".dev.gh.hosts"], pipeIo))._unsafeUnwrap()).toBe(".dev.gh.hosts");
		const trie = await jsonOf([".dev.gh.hosts"]);
		expect((trie.hosts as FieldMeta).address).toBe("dogsout://dev/gh/hosts");
	});

	test("the standard index form reaches an array element", async () => {
		const got = await runGet([".dev.gh.hosts.[0]", "--reveal"]);
		expect(got.isOk()).toBe(true);
		if (got.isOk()) expect(got.value).toBe("a");
		const masked = await runGet([".dev.gh.hosts.[0]"]);
		expect(masked.isOk()).toBe(true);
		if (masked.isOk()) expect(masked.value.startsWith("sha256:")).toBe(true);
	});

	test("a plain field leaf carries no type note", async () => {
		expect((await runLs([".dev.gh.pat"], ttyIo))._unsafeUnwrap()).toBe("pat");
	});

	test("the whole listing mixes metadata leaves and JSON structure", async () => {
		const trie = await jsonOf([]);
		const dev = trie.dev as TreeNode;
		expect(Object.keys(dev).sort()).toEqual(["gh"]);
		const gh = dev.gh as TreeNode;
		expect(Object.keys(gh).sort()).toEqual(["config", "hosts", "meta", "pat"]);
		expect(gh.config).toEqual({ db_host: null, db_port: null, api: { retry: null, timeout: null } });
		expect((gh.hosts as FieldMeta).address).toBe("dogsout://dev/gh/hosts");
		expect((gh.pat as FieldMeta).address).toBe("dogsout://dev/gh/pat");
	});

	test("no value of any JSON field reaches the machine views", async () => {
		const shown = [
			(await runLs([], pipeIo))._unsafeUnwrap(),
			(await runLs(["--json"], pipeIo))._unsafeUnwrap(),
			(await runLs([], ttyIo))._unsafeUnwrap(),
		].join("\n");
		for (const secret of ["db.internal", "a@b", "ghp_secret_drill", '"a","b"']) {
			expect(shown).not.toContain(secret);
		}
	});
});
