import { describe, expect, test } from "bun:test";
import type { FieldMeta, TreeNode, VaultData } from "@dogsout/type-contracts";
import { parseTreeNode } from "@dogsout/type-contracts";
import { buildListing, listingToTrie } from "./listing.ts";
import { type PathEntry, vaultStore } from "./tree.ts";

const CONFIG = '{"db_host":"db.internal","db_port":5432,"api":{"retry":3,"timeout":30}}';

const data = (): VaultData => ({
	version: 1,
	vaults: {
		dev: {
			gh: {
				fields: { pat: "ghp_secret_value", token: "tok-2", config: CONFIG },
				updated_at: "2026-10-23T10:00:00.000Z",
			},
			zai: { fields: { api_key: "sk-live-1", hosts: '["a","b","c"]' }, updated_at: "2026-10-23T11:00:00.000Z" },
		},
		prod: { aws: { fields: { key: "AKIA-fake" }, updated_at: "2026-10-22T09:00:00.000Z" } },
	},
});

const entries = () => vaultStore(data()).list();

const nodeAt = async (depth: number, ...names: string[]) => {
	const roots = (await buildListing(entries(), depth))._unsafeUnwrap();
	const level = roots;
	let found = level.find((n) => n.name === names[0]);
	for (const name of names.slice(1)) {
		found = found?.children.find((n) => n.name === name);
	}
	if (!found) throw new Error(`no node ${names.join("/")} at depth ${depth}`);
	return found;
};

describe("buildListing (one tree, three renderings)", () => {
	test("depth 0 roots at the vaults and nests vault -> item -> field", async () => {
		const roots = (await buildListing(entries(), 0))._unsafeUnwrap();
		expect(roots.map((n) => n.name)).toEqual(["dev", "prod"]);
		const pat = await nodeAt(0, "dev", "gh", "pat");
		expect(pat.children).toHaveLength(0);
		expect(pat.meta?.address).toBe("dogsout://dev/gh/pat");
		expect(pat.meta?.bytes).toBe("ghp_secret_value".length);
	});

	test("depth 1 roots at the items, depth 2 at the fields, and jq paths stay absolute", async () => {
		const items = (await buildListing(entries(), 1))._unsafeUnwrap();
		expect(items.map((n) => n.name)).toEqual(["gh", "zai", "aws"]);
		const fields = (await buildListing(entries(), 2))._unsafeUnwrap();
		expect(fields.map((n) => n.name)).toContain("pat");
		expect((await nodeAt(2, "pat")).jq).toBe(".dev.gh.pat");
		expect((await nodeAt(2, "api_key")).jq).toBe(".dev.zai.api_key");
	});

	test("a JSON object field grows inward with no metadata of its own", async () => {
		const config = await nodeAt(0, "dev", "gh", "config");
		expect(config.meta).toBeNull();
		expect(config.children.map((n) => n.name)).toEqual(["db_host", "db_port", "api"]);
		expect(config.children.map((n) => n.jq)).toEqual([
			".dev.gh.config.db_host",
			".dev.gh.config.db_port",
			".dev.gh.config.api",
		]);
		const retry = await nodeAt(0, "dev", "gh", "config", "api", "retry");
		expect(retry.meta).toBeNull();
		expect(retry.annotation).toBeUndefined();
		expect(retry.jq).toBe(".dev.gh.config.api.retry");
	});

	test("a non-object JSON field is one annotated leaf; plain text is not annotated", async () => {
		const hosts = await nodeAt(0, "dev", "zai", "hosts");
		expect(hosts.children).toHaveLength(0);
		expect(hosts.annotation).toBe("array(3)");
		expect(hosts.meta?.address).toBe("dogsout://dev/zai/hosts");
		const pat = await nodeAt(0, "dev", "gh", "pat");
		expect(pat.annotation).toBeUndefined();
	});

	test("a JSON key that is not an identifier keeps the bracket spelling", async () => {
		const shaped: PathEntry[] = [
			{
				path: ["dev", "svc", "cfg"],
				address: "dogsout://dev/svc/cfg",
				value: '{"client.email":"a@b","__proto__":{"x":1}}',
				updated_at: "t",
			},
		];
		const roots = (await buildListing(shaped, 2))._unsafeUnwrap();
		const cfg = roots[0];
		expect(cfg?.children.map((n) => n.jq)).toEqual(['.dev.svc.cfg["client.email"]', ".dev.svc.cfg.__proto__"]);
		const trie = listingToTrie(roots);
		const node = trie.cfg as TreeNode;
		expect(Object.keys(node)).toEqual(["client.email", "__proto__"]);
		expect(JSON.parse(JSON.stringify(trie))).toEqual({
			cfg: { "client.email": null, ["__proto__"]: { x: null } },
		});
	});
});

describe("listingToTrie (the --json view)", () => {
	test("a JSON field is structure with null leaves, a plain field is metadata", async () => {
		const roots = (await buildListing(entries(), 2))._unsafeUnwrap();
		const trie = listingToTrie(roots);
		expect(trie.config).toEqual({ db_host: null, db_port: null, api: { retry: null, timeout: null } });
		expect((trie.pat as FieldMeta).address).toBe("dogsout://dev/gh/pat");
		expect((trie.hosts as FieldMeta).address).toBe("dogsout://dev/zai/hosts");
	});

	test("the serialized trie carries no plaintext and is legal per the contract", async () => {
		const trie = listingToTrie((await buildListing(entries(), 0))._unsafeUnwrap());
		const json = JSON.stringify(trie);
		expect(json).not.toContain("ghp_secret_value");
		expect(json).not.toContain("sk-live-1");
		expect(json).not.toContain("db.internal");
	});

	test("a null leaf is legal per the contract: it is a node inside a JSON value", async () => {
		const trie = listingToTrie((await buildListing(entries(), 2))._unsafeUnwrap());
		expect(parseTreeNode(JSON.parse(JSON.stringify(trie))).ok).toBe(true);
		expect(parseTreeNode({ dev: { config: "plain" } }).ok).toBe(false);
	});

	test("refuses a path that is both a value and a branch", async () => {
		const shaped: PathEntry[] = [
			{ path: ["dev", "gh"], address: "dogsout://dev/gh", value: "x", updated_at: "t" },
			{ path: ["dev", "gh", "pat"], address: "dogsout://dev/gh/pat", value: "y", updated_at: "t" },
		];
		const r = await buildListing(shaped, 0);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("is both a value and a branch");
	});

	test("refuses a duplicate path", async () => {
		const dup: PathEntry[] = [
			{ path: ["dev", "gh", "pat"], address: "dogsout://dev/gh/pat", value: "x", updated_at: "t" },
			{ path: ["dev", "gh", "pat"], address: "dogsout://dev/gh/pat", value: "y", updated_at: "t" },
		];
		const r = await buildListing(dup, 0);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("duplicate path");
	});
});
