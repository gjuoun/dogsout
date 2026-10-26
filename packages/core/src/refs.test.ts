import { describe, expect, test } from "bun:test";
import { parseConfig } from "@dogsout/type-contracts";
import { refFor, refKeyOf } from "./refs.ts";

describe("config refs table", () => {
	test("defaults to empty and accepts an op:// entry", () => {
		const empty = parseConfig({ version: 1, aliases: {}, maps: {} });
		expect(empty.ok).toBe(true);
		if (empty.ok) expect(empty.config.refs).toEqual({});

		const withRef = parseConfig({
			version: 1,
			aliases: {},
			maps: {},
			refs: { "dogsout://op/dev/key": "op://dev/api_key/x" },
		});
		expect(withRef.ok).toBe(true);
		if (withRef.ok) expect(withRef.config.refs["dogsout://op/dev/key"]).toBe("op://dev/api_key/x");
	});

	test("rejects a bad key and a bad value, naming the entry", () => {
		const badKey = parseConfig({ version: 1, aliases: {}, maps: {}, refs: { "not-an-address": "op://dev/a/b" } });
		expect(badKey.ok).toBe(false);
		if (!badKey.ok) expect(badKey.error).toContain("not-an-address");

		const badValue = parseConfig({ version: 1, aliases: {}, maps: {}, refs: { "dogsout://op/dev/key": "sk-live" } });
		expect(badValue.ok).toBe(false);
		if (!badValue.ok) expect(badValue.error).toContain("op://");
	});
});

describe("address -> reference lookup", () => {
	const cfg = { refs: { "dogsout://op/dev/key": "op://dev/api_key/x", "dogsout://op/dev/bad": "not-a-ref" } };

	test("refKeyOf drops the subpath and rejects non-addresses", () => {
		expect(refKeyOf("dogsout://op/dev/key.sub.path")).toBe("dogsout://op/dev/key");
		expect(refKeyOf("dogsout://op/dev/key")).toBe("dogsout://op/dev/key");
		expect(refKeyOf("nonsense")).toBeNull();
	});

	test("refFor finds the entry for a subpath input and ignores a non-op value", () => {
		expect(refFor(cfg, "dogsout://op/dev/key")).toBe("op://dev/api_key/x");
		expect(refFor(cfg, "dogsout://op/dev/key.sub")).toBe("op://dev/api_key/x");
		expect(refFor(cfg, "dogsout://dev/zai/api_key")).toBeNull();
		expect(refFor({ refs: { "dogsout://op/dev/bad": "not-a-ref" } }, "dogsout://op/dev/bad")).toBeNull();
	});
});
