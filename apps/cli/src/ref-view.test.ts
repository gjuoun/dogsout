import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, writeConfig } from "@dogsout/core";
import type { Io } from "./cmd.ts";
import { runInit } from "./init.ts";
import { runLs } from "./ls.ts";
import { runPolicy } from "./policy/policy.ts";
import { runSet } from "./set.ts";

const FAKE_SE = join(import.meta.dir, "..", "..", "..", "packages", "core", "src", "vault", "helper", "fake-se.ts");
const FAKE_1P = join(import.meta.dir, "..", "..", "..", "packages", "core", "src", "vault", "helper", "fake-1p.ts");
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
const REF = "op://dev/api_key/refkey";
const VALUE = "resolved-ref-value-123";
let home = "";
let callsPath = "";

async function callLines(): Promise<string[]> {
	try {
		const text = await Bun.file(callsPath).text();
		return text.split("\n").filter((l) => l.length > 0);
	} catch {
		return [];
	}
}

beforeAll(async () => {
	home = mkdtempSync(join(tmpdir(), "dogsout-refui-"));
	process.env.DOGSOUT_HOME = home;
	process.env.DOGSOUT_SE_HELPER = FAKE_SE;
	process.env.DOGSOUT_1P_HELPER = FAKE_1P;
	await runInit([], stdinOf(""));
	const stored = await runSet(["dogsout://op/dev/deepseek_api_key"], stdinOf(REF));
	if (stored.isErr()) throw new Error(stored.error);

	callsPath = join(home, "calls.txt");
	const mapPath = join(home, "map.json");
	await Bun.write(mapPath, JSON.stringify({ [REF]: VALUE }));
	process.env.FAKE_1P_MAP = mapPath;
	process.env.FAKE_1P_CALLS = callsPath;

	const cfg = await loadConfig(home);
	if (cfg.isErr()) throw new Error(cfg.error);
	cfg.value.aliases.REF_KEY = "dogsout://op/dev/deepseek_api_key";
	cfg.value.rules = [{ id: "allow-refs", principal: "*", resource: "dogsout://op/**", decide: "allow" }];
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

describe("ls over the refs table", () => {
	test("--json names the source and the reference, and never resolves", async () => {
		const r = await runLs(["--json"]);
		expect(r.isOk()).toBe(true);
		if (r.isErr()) return;
		const tree = JSON.parse(r.value) as Record<string, Record<string, Record<string, unknown>>>;
		const leaf = tree.op?.dev?.deepseek_api_key as Record<string, unknown>;
		expect(leaf.source).toBe("1password");
		expect(leaf.ref).toBe(REF);
		expect(leaf.address).toBe("dogsout://op/dev/deepseek_api_key");
		expect(String(leaf.value_hash).startsWith("sha256:")).toBe(true);
		expect(leaf.bytes).toBe(REF.length);
		expect(JSON.stringify(tree)).not.toContain(VALUE);
		expect(await callLines()).toEqual([]);
	});

	test("the piped view is a jq path feedable to get", async () => {
		const r = await runLs([]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) expect(r.value).toBe(".op.dev.deepseek_api_key");
	});
});

describe("policy on ref-served aliases", () => {
	test("why reads the resolved value and reports the grant/allow", async () => {
		const r = await runPolicy(["why", "--alias", "REF_KEY"]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			expect(r.value).toContain("allow");
			expect(r.value).toContain(`1password ref ${REF}`);
			expect(r.value).not.toContain(VALUE);
		}
	});

	test("simulate reads refs in one batch and marks the source", async () => {
		const before = (await callLines()).length;
		const r = await runPolicy(["simulate", "--principal", "sim@unit"]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			expect(r.value).toContain("REF_KEY: allow");
			expect(r.value).toContain("(1password ref)");
		}
		const after = await callLines();
		expect(after.length - before).toBeGreaterThanOrEqual(1);
	});

	test("an unresolvable ref is an ERROR line, not a verdict", async () => {
		process.env.FAKE_1P_MODE = "deny";
		try {
			const r = await runPolicy(["why", "--alias", "REF_KEY"]);
			expect(r.isOk()).toBe(true);
			if (r.isOk()) {
				expect(r.value).toContain("ERROR 1password:");
				expect(r.value).not.toContain("allow");
			}
		} finally {
			delete process.env.FAKE_1P_MODE;
		}
	});
});
