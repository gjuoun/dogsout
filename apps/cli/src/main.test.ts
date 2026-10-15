import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, vaultPath } from "@jtk/core";
import { runAlias } from "./alias.ts";
import type { Io } from "./cmd.ts";
import { runGet } from "./get.ts";
import { runInit } from "./init.ts";
import { runLs } from "./ls.ts";
import { runRm } from "./rm.ts";
import { runSet } from "./set.ts";

const FAKE_SE = join(import.meta.dir, "..", "..", "..", "packages", "core", "src", "vault", "helper", "fake-se.ts");
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
let home = "";

beforeAll(() => {
	home = mkdtempSync(join(tmpdir(), "jtk-cli-"));
	process.env.JTK_HOME = home;
	process.env.JTK_SE_HELPER = FAKE_SE;
});

afterAll(() => {
	delete process.env.JTK_HOME;
	delete process.env.JTK_SE_HELPER;
	rmSync(home, { recursive: true, force: true });
});

describe("F1 CLI monolith (JTK_HOME isolated)", () => {
	test("init creates config + vault, both 0600", async () => {
		const r = await runInit([], stdinOf(""));
		expect(r.isOk()).toBe(true);
		expect(statSync(configPath(home)).mode & 0o077).toBe(0);
		expect(statSync(vaultPath(home)).mode & 0o077).toBe(0);
	});

	test("init twice without --force refused", async () => {
		const r = await runInit([]);
		expect(r.isErr()).toBe(true);
	});

	test("set → get --reveal returns original value", async () => {
		const s = await runSet(["jtk://dev/zai/api_key", "--stdin"], stdinOf("sk-test-123\n"));
		expect(s.isOk()).toBe(true);
		const g = await runGet(["jtk://dev/zai/api_key", "--reveal"]);
		expect(g.isOk()).toBe(true);
		if (g.isOk()) expect(g.value).toBe("sk-test-123");
	});

	test("get masked by default (no plaintext)", async () => {
		const g = await runGet(["jtk://dev/zai/api_key"]);
		expect(g.isOk()).toBe(true);
		if (g.isOk()) {
			expect(g.value.startsWith("sha256:")).toBe(true);
			expect(g.value.includes("sk-test-123")).toBe(false);
		}
	});

	test("alias registers and resolves", async () => {
		const a = await runAlias(["ZAI_API_KEY", "jtk://dev/zai/api_key"]);
		expect(a.isOk()).toBe(true);
		const g = await runGet(["ZAI_API_KEY", "--reveal"]);
		expect(g.isOk()).toBe(true);
		if (g.isOk()) expect(g.value).toBe("sk-test-123");
	});

	test("ls --json lists the stored field", async () => {
		const r = await runLs(["--json"]);
		expect(r.isOk()).toBe(true);
		if (r.isOk()) {
			const parsed = JSON.parse(r.value) as { vaults: Record<string, Record<string, string[]>> };
			expect(parsed.vaults.dev?.zai).toContain("api_key");
		}
	});

	test("rm removes; subsequent get fails with not-found", async () => {
		const rm = await runRm(["jtk://dev/zai/api_key"]);
		expect(rm.isOk()).toBe(true);
		const g = await runGet(["jtk://dev/zai/api_key"]);
		expect(g.isErr()).toBe(true);
		if (g.isErr()) expect(g.error).toContain("not found");
	});
});

describe("v2 init and unlock (fake secure enclave helper)", () => {
	let v2home = "";
	let savedHome: string | undefined;
	beforeAll(() => {
		v2home = mkdtempSync(join(tmpdir(), "jtk-cli-v2-"));
		savedHome = process.env.JTK_HOME;
		process.env.JTK_HOME = v2home;
		process.env.JTK_SE_HELPER = FAKE_SE;
	});
	afterAll(() => {
		process.env.JTK_HOME = savedHome;
		rmSync(v2home, { recursive: true, force: true });
	});

	test("init needs no password, prints the fingerprint and the single-factor warning", async () => {
		const r = await runInit([], stdinOf(""));
		const out = r._unsafeUnwrap();
		expect(out).toMatch(/vault v2, fingerprint [0-9A-F]{4}-[0-9A-F]{4}/);
		expect(out).toContain("one unlock factor");
		expect(JSON.parse(await Bun.file(vaultPath(v2home)).text()).version).toBe(2);
	});

	test("cancelled Touch ID fails closed", async () => {
		expect((await runSet(["jtk://dev/gh/token", "--stdin"], stdinOf("FAKE-ghp\n"))).isOk()).toBe(true);
		process.env.FAKE_SE_MODE = "deny";
		try {
			const g = await runGet(["jtk://dev/gh/token", "--reveal"]);
			expect(g._unsafeUnwrapErr()).toContain("vault unlock failed");
		} finally {
			delete process.env.FAKE_SE_MODE;
		}
	});
});
