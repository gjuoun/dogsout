import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Io, runAlias, runGet, runInit, runSet } from "./cmd-crud.ts";
import { resolveToAddress, runMap } from "./map.ts";

const MASTER = "map-test-master";
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
let home = "";

beforeAll(async () => {
	home = mkdtempSync(join(tmpdir(), "jtk-map-"));
	process.env.JTK_HOME = home;
	process.env.JTK_MASTER = MASTER;
	await runInit([], stdinOf(""));
	await runSet(["jtk://dev/zai/api_key", "--stdin"], stdinOf("sk-v1"));
	await runAlias(["ZAI_API_KEY", "jtk://dev/zai/api_key"]);
});

afterAll(() => {
	delete process.env.JTK_HOME;
	delete process.env.JTK_MASTER;
	rmSync(home, { recursive: true, force: true });
});

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

describe("jtk map + rotation follows the link", () => {
	test("register, read through slot, rotate upstream, slot follows with zero propagation", async () => {
		const set = await runMap(["zai", "ZAI_API_KEY"]);
		expect(set.isOk()).toBe(true);

		const before = await runGet(["zai", "--reveal"]);
		expect(before.isOk() && before.value.startsWith("sk-v1")).toBe(true);

		await runSet(["jtk://dev/zai/api_key", "--stdin"], stdinOf("sk-v2-rotated"));
		const after = await runGet(["zai", "--reveal"]);
		expect(after.isOk() && after.value === "sk-v2-rotated").toBe(true);

		const rm = await runMap(["--rm", "zai"]);
		expect(rm.isOk()).toBe(true);
		const gone = await runGet(["zai", "--reveal"]);
		expect(gone.isErr()).toBe(true);
	});
});
