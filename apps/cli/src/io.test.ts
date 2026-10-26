import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dogsoutHome, loadConfig } from "@dogsout/core";
import type { Io } from "./cmd.ts";
import { runExport } from "./export.ts";
import { runGet } from "./get.ts";
import { runImportEnv } from "./import-env.ts";
import { runInit } from "./init.ts";

const FAKE_SE = join(import.meta.dir, "..", "..", "..", "packages", "core", "src", "vault", "helper", "fake-se.ts");
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
// Env keys are UPPER_SNAKE; the field they land in is the lowercased key.
const FIXTURE = ["DIRECT_ONE=hello123", "REF_ONE=dogsout://e2e/misc/direct_one", "OP_X=op://dev/a/b"].join("\n");
let home = "";
let fixturePath = "";

beforeAll(async () => {
	home = mkdtempSync(join(tmpdir(), "dogsout-io-"));
	process.env.DOGSOUT_HOME = home;
	process.env.DOGSOUT_SE_HELPER = FAKE_SE;
	await runInit([], stdinOf(""));
	fixturePath = join(home, "fixture.env");
	await Bun.write(fixturePath, FIXTURE + "\n");
});

afterAll(() => {
	delete process.env.DOGSOUT_HOME;
	delete process.env.DOGSOUT_SE_HELPER;
	rmSync(home, { recursive: true, force: true });
});

describe("import-env / export round-trip", () => {
	test("import classifies directs / refs / op refs", async () => {
		const r = await runImportEnv([fixturePath, "--vault", "e2e", "--item", "misc"]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			expect(r.value).toContain("imported 1 values, 1 refs");
			expect(r.value).toContain("1 1password refs");
		}
		// OP_X=op://dev/a/b became a config ref at .e2e.dev.op_x, with no value anywhere.
		const cfg = await loadConfig(home);
		expect(cfg.isOk()).toBe(true);
		if (cfg.isOk()) expect(cfg.value.refs["dogsout://op/dev/op_x"]).toBe("op://dev/a/b");
	});

	test("env-ref export is sorted aliases only (no op://, no direct values)", async () => {
		const r = await runExport(["--format", "env-ref"]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			expect(r.value).toBe("REF_ONE=dogsout://e2e/misc/direct_one");
		}
	});

	test("export -> import -> export is byte-identical", async () => {
		const e1 = await runExport(["--format", "env-ref"]);
		if (e1.isErr()) throw new Error(e1.error);
		const p2 = join(home, "round2.env");
		await Bun.write(p2, e1.value + "\n");
		const imp = await runImportEnv([p2, "--vault", "zz", "--item", "zz"]);
		if (imp.isErr()) throw new Error(imp.error);
		const e2 = await runExport(["--format", "env-ref"]);
		expect(e2.isOk()).toBe(true);
		if (e2.isOk()) expect(e2.value).toBe(e1.value);
	});

	test("an env key that cannot become a field aborts the whole import", async () => {
		const bad = join(home, "bad-key.env");
		await Bun.write(bad, "A.B=value\n");
		const r = await runImportEnv([bad, "--vault", "e2e", "--item", "misc"]);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) {
			expect(r.error).toContain("import aborted");
			expect(r.error).toContain('invalid field segment "a.b"');
		}
	});

	test("two keys that fold onto one field abort instead of overwriting", async () => {
		const bad = join(home, "fold.env");
		await Bun.write(bad, "Token=one\nTOKEN=two\n");
		const r = await runImportEnv([bad, "--vault", "e2e", "--item", "misc"]);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain("both become field");
	});

	test("a ref address that violates the charset aborts before anything is written", async () => {
		const bad = join(home, "bad-ref.env");
		await Bun.write(bad, "LEGACY=dogsout://e2e/misc/DIRECT_ONE\n");
		const r = await runImportEnv([bad, "--vault", "e2e", "--item", "misc"]);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain('invalid field segment "DIRECT_ONE"');
	});

	test("--vault is validated too", async () => {
		const r = await runImportEnv([fixturePath, "--vault", "Bad", "--item", "misc"]);
		expect(r.isErr()).toBe(true);
		if (r.isErr()) expect(r.error).toContain('invalid vault segment "Bad"');
	});

	test("an UPPER_SNAKE key lands under its lowercase field name", async () => {
		const good = join(home, "upper.env");
		await Bun.write(good, "GITHUB_TOKEN=ghp_x\n");
		const r = await runImportEnv([good, "--vault", "dev", "--item", "gh"]);
		expect(r.isOk()).toBe(true);
		const g = await runGet(["dogsout://dev/gh/github_token", "--reveal"]);
		if (g.isOk()) expect(g.value).toBe("ghp_x");
		else throw new Error(g.error);
	});

	test("json-ref parses and matches aliases", async () => {
		const r = await runExport(["--format", "json-ref"]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			const parsed = JSON.parse(r.value) as Record<string, string>;
			const cfg = await loadConfig(dogsoutHome());
			if (cfg.isErr()) throw new Error(cfg.error);
			expect(parsed).toEqual(cfg.value.aliases);
		}
	});
});
