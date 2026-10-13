import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Io, runAlias, runInit, runSet } from "./cmd-crud.ts";
import { runRun } from "./cmd-run.ts";
import { loadConfig, writeConfig } from "./store.ts";

const MASTER = "run-test-master";
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
let home = "";

beforeAll(async () => {
	home = mkdtempSync(join(tmpdir(), "jtk-run-"));
	process.env.JTK_HOME = home;
	process.env.JTK_MASTER = MASTER;
	await runInit([], stdinOf(""));
	await runSet(["jtk://dev/zai/api_key", "--stdin"], stdinOf("sk-inject-me"));
	await runAlias(["ZAI_API_KEY", "jtk://dev/zai/api_key"]);
	// F2: run is now a policy surface — allow-all rule keeps these injection-mechanics tests focused
	const cfg = await loadConfig(home);
	if (cfg.isErr()) throw new Error(cfg.error);
	cfg.value.rules = [{ id: "test-allow", principal: "*", resource: "*", decide: "allow" }];
	const w = await writeConfig(home, cfg.value);
	if (w.isErr()) throw new Error(w.error);
});

afterAll(() => {
	delete process.env.JTK_HOME;
	delete process.env.JTK_MASTER;
	rmSync(home, { recursive: true, force: true });
});

describe("jtk run env injection", () => {
	test("without any rule or grant, run is fail-closed (no channel decides)", async () => {
		// strip the allow rule for one call
		const cfg = await loadConfig(home);
		if (cfg.isErr()) throw new Error(cfg.error);
		const savedRules = cfg.value.rules;
		cfg.value.rules = [];
		const w = await writeConfig(home, cfg.value);
		if (w.isErr()) throw new Error(w.error);
		process.env.JTK_APPROVE_HELPER = "/nonexistent/jtk-approve";
		const r = await runRun(["--env", "ZAI_API_KEY", "--", "sh", "-c", "exit 0"]);
		delete process.env.JTK_APPROVE_HELPER;
		if (r.isErr()) expect(r.error).toContain("fail-closed");
		else throw new Error("expected fail-closed refusal, got exit " + r.value);
		const restore = await loadConfig(home);
		if (restore.isErr()) throw new Error(restore.error);
		restore.value.rules = savedRules;
		const w2 = await writeConfig(home, restore.value);
		if (w2.isErr()) throw new Error(w2.error);
	});

	test("--env ALIAS injects value into child env (exit 0)", async () => {
		const r = await runRun(["--env", "ZAI_API_KEY", "--", "sh", "-c", 'test "$ZAI_API_KEY" = sk-inject-me']);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) expect(r.value).toBe(0);
	});

	test("--from-item is removed: unknown flag, loud guidance", async () => {
		const r = await runRun(["--from-item", "jtk://dev/zai", "--", "sh", "-c", "true"]);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("removed");
	});

	test("--from-env FILE: literals pass through, jtk:// refs resolve, op:// fails loudly", async () => {
		const envFile = join(home, "run.env");
		await Bun.write(envFile, "LITERAL_X=plain-val\nINJECTED_Y=jtk://dev/zai/api_key\n");
		const r = await runRun([
			"--from-env",
			envFile,
			"--",
			"sh",
			"-c",
			'test "$LITERAL_X" = plain-val && test "$INJECTED_Y" = sk-inject-me',
		]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) expect(r.value).toBe(0);

		const opFile = join(home, "op.env");
		await Bun.write(opFile, "K=op://dev/a/b\n");
		const bad = await runRun(["--from-env", opFile, "--", "sh", "-c", "true"]);
		expect(bad.isErr()).toBe(true);
		if (bad.isErr()) expect(bad.error).toContain("op://");
	});

	test("missing alias -> typed failure, no child spawned", async () => {
		const r = await runRun(["--env", "NOPE_KEY", "--", "sh", "-c", "exit 0"]);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("NOPE_KEY");
	});

	test("address as --env name is rejected with guidance", async () => {
		const r = await runRun(["--env", "jtk://dev/zai/api_key", "--", "sh", "-c", "exit 0"]);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("--from-env");
	});
});
