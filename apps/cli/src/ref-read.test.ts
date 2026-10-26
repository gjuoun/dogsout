import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, writeConfig } from "@dogsout/core";
import type { Io } from "./cmd.ts";
import { runGet } from "./get.ts";
import { runInit } from "./init.ts";
import { runRun } from "./run.ts";
import { runSet } from "./set.ts";

const FAKE_SE = join(import.meta.dir, "..", "..", "..", "packages", "core", "src", "vault", "helper", "fake-se.ts");
const FAKE_1P = join(import.meta.dir, "..", "..", "..", "packages", "core", "src", "vault", "helper", "fake-1p.ts");
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
const REF = "op://dev/api_key/refkey";
const VALUE = "resolved-ref-value-123";
let home = "";
let mapPath = "";
let callsPath = "";

beforeAll(async () => {
	home = mkdtempSync(join(tmpdir(), "dogsout-refread-"));
	process.env.DOGSOUT_HOME = home;
	process.env.DOGSOUT_SE_HELPER = FAKE_SE;
	process.env.DOGSOUT_1P_HELPER = FAKE_1P;
	await runInit([], stdinOf(""));

	// The ref is stored by `set` (a value starting with op:// goes to config), then the vault is
	// taken away: anything that still tries to unlock fails loudly instead of quietly prompting.
	const stored = await runSet(["dogsout://op/dev/deepseek_api_key"], stdinOf(REF));
	if (stored.isErr()) throw new Error(stored.error);

	mapPath = join(home, "map.json");
	callsPath = join(home, "calls.txt");
	await Bun.write(mapPath, JSON.stringify({ [REF]: VALUE }));
	process.env.FAKE_1P_MAP = mapPath;
	process.env.FAKE_1P_CALLS = callsPath;

	const cfg = await loadConfig(home);
	if (cfg.isErr()) throw new Error(cfg.error);
	cfg.value.rules = [{ id: "allow-all", principal: "*", resource: "*", decide: "allow" }];
	const w = await writeConfig(home, cfg.value);
	if (w.isErr()) throw new Error(w.error);

	renameSync(join(home, "vault.enc"), join(home, "vault.enc.moved"));
});

afterAll(() => {
	delete process.env.DOGSOUT_HOME;
	delete process.env.DOGSOUT_SE_HELPER;
	delete process.env.DOGSOUT_1P_HELPER;
	delete process.env.FAKE_1P_MAP;
	delete process.env.FAKE_1P_CALLS;
	rmSync(home, { recursive: true, force: true });
});

describe("get on a ref-served address", () => {
	test("prints the reference and the resolved digest, never the value", async () => {
		const r = await runGet(["dogsout://op/dev/deepseek_api_key"]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			expect(r.value.startsWith(REF + " → sha256:")).toBe(true);
			expect(r.value).toContain("--reveal to show");
			expect(r.value).not.toContain(VALUE);
		}
	});

	test("--reveal prints the resolved value", async () => {
		const r = await runGet(["dogsout://op/dev/deepseek_api_key", "--reveal"]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) expect(r.value).toBe(VALUE);
	});

	test("a vault address on the same home fails with vault not found (no silent prompt)", async () => {
		const r = await runGet(["dogsout://dev/zai/api_key"]);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("vault not found");
	});
});

describe("run on a ref-served env file", () => {
	test("injects the resolved value into the child without opening the vault", async () => {
		const envFile = join(home, "run-refs.env");
		await Bun.write(envFile, "DEEPSEEK_API_KEY=dogsout://op/dev/deepseek_api_key\n");
		const r = await runRun(["--from-env", envFile, "--", "sh", "-c", 'test "$DEEPSEEK_API_KEY" = ' + VALUE]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) expect(r.value).toBe(0);
	});

	test("missing token fails closed before the child runs", async () => {
		const envFile = join(home, "run-refs2.env");
		await Bun.write(envFile, "DEEPSEEK_API_KEY=dogsout://op/dev/deepseek_api_key\n");
		process.env.FAKE_1P_MODE = "missing-token";
		const marker = join(home, "child-ran.txt");
		try {
			const r = await runRun(["--from-env", envFile, "--", "sh", "-c", `touch ${marker}`]);
			expect(r.isErr()).toBe(true);
			if (r.isErr()) {
				expect(r.error).toContain("OP_SERVICE_ACCOUNT_TOKEN");
				expect(r.error).toContain("sa-token");
			}
			expect(await Bun.file(marker).exists()).toBe(false);
		} finally {
			delete process.env.FAKE_1P_MODE;
		}
	});
});
