import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FieldMeta, TreeNode } from "@dogsout/type-contracts";
import type { Io } from "./cmd.ts";
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
	let cur: FieldMeta | TreeNode = tree;
	for (const seg of segments) cur = (cur as TreeNode)[seg] as FieldMeta | TreeNode;
	return cur as FieldMeta;
};

describe("dogsout ls --json (the retired tree view)", () => {
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
	test("a pipe prints one canonical address per line", async () => {
		const r = await runLs([], pipeIo);
		expect(r._unsafeUnwrap().split("\n")).toEqual([
			"dogsout://dev/gh/pat",
			"dogsout://dev/gh/token",
			"dogsout://prod/aws/key",
		]);
	});

	test("a tty prints the indented tree, human-only", async () => {
		const r = await runLs([], ttyIo);
		expect(r._unsafeUnwrap()).toBe(
			[".dev", "  .gh", "    .pat", "    .token", ".prod", "  .aws", "    .key"].join("\n"),
		);
	});

	test("every address appears as one indented leaf in the tty tree", async () => {
		const piped = (await runLs([], pipeIo))._unsafeUnwrap().split("\n");
		const terminal = (await runLs([], ttyIo))._unsafeUnwrap().split("\n");
		expect(terminal.filter((l) => l.trim().startsWith(".") && l.startsWith("    ")).length).toBe(piped.length);
	});

	test("a glob narrows the tty tree without losing the vault root", async () => {
		const r = await runLs(["dev.gh.*"], ttyIo);
		expect(r._unsafeUnwrap()).toBe(".dev\n  .gh\n    .pat\n    .token");
	});
});
