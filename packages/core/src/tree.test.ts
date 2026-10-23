import { describe, expect, test } from "bun:test";
import { type FieldMeta, parseTreeNode, type TreeNode, type VaultData } from "@dogsout/type-contracts";
import { buildTree, fieldMeta, maskHash, matchPattern, type PathEntry, selectEntries, vaultStore } from "./tree.ts";

const data = (): VaultData => ({
	version: 1,
	vaults: {
		dev: {
			gh: { fields: { pat: "ghp_secret_value", token: "tok-2" }, updated_at: "2026-10-23T10:00:00.000Z" },
			zai: { fields: { api_key: "sk-live-1" }, updated_at: "2026-10-23T11:00:00.000Z" },
		},
		prod: { aws: { fields: { key: "AKIA-fake" }, updated_at: "2026-10-22T09:00:00.000Z" } },
	},
});

const leaf = (tree: TreeNode, ...segments: string[]): FieldMeta => {
	let cur: FieldMeta | TreeNode = tree;
	for (const seg of segments) cur = (cur as TreeNode)[seg] as FieldMeta | TreeNode;
	return cur as FieldMeta;
};

describe("vaultStore (the path-keyed seam)", () => {
	test("exposes one entry per field, keyed by [vault, item, field] and sorted by address", () => {
		const store = vaultStore(data());
		expect(store.list().map((e) => e.path.join("/"))).toEqual([
			"dev/gh/pat",
			"dev/gh/token",
			"dev/zai/api_key",
			"prod/aws/key",
		]);
		expect(store.list()[0]?.address).toBe("dogsout://dev/gh/pat");
		expect(store.list()[0]?.value).toBe("ghp_secret_value");
	});

	test("get() looks an entry up by path", () => {
		const store = vaultStore(data());
		expect(store.get(["dev", "zai", "api_key"])?.value).toBe("sk-live-1");
		expect(store.get(["dev", "zai", "missing"])).toBeUndefined();
	});
});

describe("glob matching", () => {
	test("* matches exactly one segment, ** matches the subtree", () => {
		expect(matchPattern(["dev", "gh", "*"], ["dev", "gh", "pat"])).toBe(true);
		expect(matchPattern(["dev", "gh", "*"], ["dev", "gh"])).toBe(false);
		expect(matchPattern(["dev", "**"], ["dev", "gh", "pat"])).toBe(true);
		expect(matchPattern(["dev", "**"], ["prod", "aws", "key"])).toBe(false);
		expect(matchPattern(["*", "zai", "api_key"], ["dev", "zai", "api_key"])).toBe(true);
	});

	test("a literal 3-segment pattern matches exactly one field, and one level stays one level", () => {
		const store = vaultStore(data());
		expect(selectEntries(store, ["dev", "gh", "pat"]).map((e) => e.address)).toEqual(["dogsout://dev/gh/pat"]);
		expect(selectEntries(store, ["dev", "gh", "*"]).length).toBe(2);
		expect(selectEntries(store, ["dev", "**"]).length).toBe(3);
		expect(selectEntries(store, ["**"]).length).toBe(4);
	});
});

describe("leaf metadata (values never leave)", () => {
	test("maskHash prints sha256: plus 8 hex and never the value", async () => {
		const hash = await maskHash("ghp_secret_value");
		expect(hash).toMatch(/^sha256:[0-9a-f]{8}$/);
		expect(hash).not.toContain("ghp_secret_value");
		expect(await maskHash("ghp_secret_value")).toBe(hash);
		expect(await maskHash("tok-2")).not.toBe(hash);
	});

	test("fieldMeta carries address, hash, byte length and updated_at", async () => {
		const entry = vaultStore(data()).get(["dev", "gh", "pat"]) as PathEntry;
		const meta = await fieldMeta(entry);
		expect(meta).toEqual({
			address: "dogsout://dev/gh/pat",
			value_hash: await maskHash("ghp_secret_value"),
			bytes: "ghp_secret_value".length,
			updated_at: "2026-10-23T10:00:00.000Z",
		});
	});
});

describe("buildTree", () => {
	test("nests vault -> item -> field with metadata leaves", async () => {
		const tree = (await buildTree(vaultStore(data()).list()))._unsafeUnwrap();
		const pat = leaf(tree, "dev", "gh", "pat");
		expect(pat.address).toBe("dogsout://dev/gh/pat");
		expect(pat.bytes).toBe("ghp_secret_value".length);
		expect(Object.keys(pat).sort()).toEqual(["address", "bytes", "updated_at", "value_hash"]);
		expect(Object.keys(tree).sort()).toEqual(["dev", "prod"]);
	});

	test("the serialized tree is valid per the contract and carries no plaintext", async () => {
		const tree = (await buildTree(vaultStore(data()).list()))._unsafeUnwrap();
		const json = JSON.stringify(tree);
		expect(json).not.toContain("ghp_secret_value");
		expect(json).not.toContain("sk-live-1");
		expect(parseTreeNode(JSON.parse(json)).ok).toBe(true);
	});

	test("refuses a path that is both a value and a branch", async () => {
		const entries: PathEntry[] = [
			{ path: ["dev", "gh"], address: "dogsout://dev/gh", value: "x", updated_at: "t" },
			{ path: ["dev", "gh", "pat"], address: "dogsout://dev/gh/pat", value: "y", updated_at: "t" },
		];
		const r = await buildTree(entries);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("is both a value and a branch");
	});
});
