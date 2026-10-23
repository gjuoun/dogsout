import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FieldMeta, TreeNode } from "@dogsout/type-contracts";
import type { Io } from "./cmd.ts";
import { runInit } from "./init.ts";
import { runSet } from "./set.ts";
import { runTree } from "./tree.ts";

const FAKE_SE = join(import.meta.dir, "..", "..", "..", "packages", "core", "src", "vault", "helper", "fake-se.ts");
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
let home = "";

beforeAll(async () => {
	home = mkdtempSync(join(tmpdir(), "dogsout-tree-"));
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

const treeOf = async (argv: string[]): Promise<TreeNode> => {
	const r = await runTree(argv);
	if (r.isErr()) throw new Error(r.error);
	return JSON.parse(r.value) as TreeNode;
};

const leaf = (tree: TreeNode, ...segments: string[]): FieldMeta => {
	let cur: FieldMeta | TreeNode = tree;
	for (const seg of segments) cur = (cur as TreeNode)[seg] as FieldMeta | TreeNode;
	return cur as FieldMeta;
};

describe("dogsout tree", () => {
	test("the root tree nests vault -> item -> field", async () => {
		const tree = await treeOf([]);
		expect(Object.keys(tree).sort()).toEqual(["dev", "prod"]);
		const meta = leaf(tree, "dev", "gh", "pat");
		expect(Object.keys(meta).sort()).toEqual(["address", "bytes", "updated_at", "value_hash"]);
		expect(meta.address).toBe("dogsout://dev/gh/pat");
		expect(meta.bytes).toBe("ghp_secret_tree".length);
		expect(meta.value_hash).toMatch(/^sha256:[0-9a-f]{8}$/);
		expect(meta.updated_at.length).toBeGreaterThan(0);
	});

	test("a path roots the tree where it was asked: item, then field", async () => {
		const item = await treeOf(["dev.gh"]);
		expect(Object.keys(item).sort()).toEqual(["pat", "token"]);
		const field = await treeOf(["dogsout://dev/gh/pat"]);
		expect(Object.keys(field)).toEqual(["pat"]);
	});

	test("a glob renders the matching subtree", async () => {
		const dev = await treeOf(["dev.**"]);
		expect(Object.keys(dev)).toEqual(["gh"]);
		expect(Object.keys(dev.gh as TreeNode).sort()).toEqual(["pat", "token"]);
		const oneLevel = await treeOf([".dev.*.token"]);
		expect(leaf(oneLevel, "gh", "token").address).toBe("dogsout://dev/gh/token");
	});

	test("the tree carries metadata only — never a value", async () => {
		const r = await runTree([]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			expect(r.value).not.toContain("ghp_secret_tree");
			expect(r.value).not.toContain("AKIA-fake");
			expect(r.value).toContain("sha256:");
		}
	});

	test("a literal field that matches nothing is a miss", async () => {
		const r = await runTree(["dev.gh.nope"]);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("not found");
	});

	test("a subpath is not a tree argument", async () => {
		const r = await runTree(["dev.gh.pat.x"]);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("not subpaths");
	});
});
