import { describe, expect, test } from "bun:test";
import { resolveToAddress } from "./resolve.ts";

describe("map resolution", () => {
	test("slot -> alias -> address resolves through the chain", () => {
		const cfg = { aliases: { ZAI_API_KEY: "jtk://dev/zai/api_key" }, maps: { zai: "ZAI_API_KEY" } };
		const r = resolveToAddress("zai", cfg);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			expect(r.value.address).toBe("jtk://dev/zai/api_key");
			expect(r.value.chain).toEqual(["zai", "ZAI_API_KEY", "jtk://dev/zai/api_key"]);
		}
	});

	test("slot chains compose slot -> slot -> address", () => {
		const cfg = { aliases: { A: "jtk://v/i/f" }, maps: { b: "a", a: "A" } };
		const r = resolveToAddress("b", cfg);
		expect(r.isOk() && r.value.address).toBe("jtk://v/i/f");
	});

	test("cycles are detected, not hung", () => {
		const r = resolveToAddress("x", { aliases: {}, maps: { x: "y", y: "x" } });
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("cycle");
	});

	test("self-reference is rejected", () => {
		const r = resolveToAddress("x", { aliases: {}, maps: { x: "x" } });
		expect(r.isErr()).toBe(true);
	});

	test("unknown names fail with the walked chain", () => {
		const r = resolveToAddress("ghost", { aliases: {}, maps: {} });
		expect(r.isErr()).toBe(true);
	});
});
