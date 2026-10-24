import { describe, expect, test } from "bun:test";
import type { VaultData } from "@dogsout/type-contracts";
import { fieldMeta, maskHash, matchPattern, type PathEntry, selectEntries, vaultStore } from "./tree.ts";

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
