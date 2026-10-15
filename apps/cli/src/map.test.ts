import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Io } from "./cmd.ts";
import { runAlias, runGet, runInit, runSet } from "./cmd-crud.ts";
import { runMap } from "./map.ts";

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
