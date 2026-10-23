import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAlias } from "./alias.ts";
import type { Io } from "./cmd.ts";
import { runGet } from "./get.ts";
import { runInit } from "./init.ts";
import { runMap } from "./map.ts";
import { runSet } from "./set.ts";

const FAKE_SE = join(import.meta.dir, "..", "..", "..", "packages", "core", "src", "vault", "helper", "fake-se.ts");
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
let home = "";

beforeAll(async () => {
	home = mkdtempSync(join(tmpdir(), "dogsout-map-"));
	process.env.DOGSOUT_HOME = home;
	process.env.DOGSOUT_SE_HELPER = FAKE_SE;
	await runInit([], stdinOf(""));
	await runSet(["dogsout://dev/zai/api_key", "--stdin"], stdinOf("sk-v1"));
	await runAlias(["ZAI_API_KEY", "dogsout://dev/zai/api_key"]);
});

afterAll(() => {
	delete process.env.DOGSOUT_HOME;
	delete process.env.DOGSOUT_SE_HELPER;
	rmSync(home, { recursive: true, force: true });
});

describe("dogsout map + rotation follows the link", () => {
	test("register, read through slot, rotate upstream, slot follows with zero propagation", async () => {
		const set = await runMap(["zai", "ZAI_API_KEY"]);
		expect(set.isOk()).toBe(true);

		const before = await runGet(["zai", "--reveal"]);
		expect(before.isOk() && before.value.startsWith("sk-v1")).toBe(true);

		await runSet(["dogsout://dev/zai/api_key", "--stdin"], stdinOf("sk-v2-rotated"));
		const after = await runGet(["zai", "--reveal"]);
		expect(after.isOk() && after.value === "sk-v2-rotated").toBe(true);

		const rm = await runMap(["--rm", "zai"]);
		expect(rm.isOk()).toBe(true);
		const gone = await runGet(["zai", "--reveal"]);
		expect(gone.isErr()).toBe(true);
	});
});
