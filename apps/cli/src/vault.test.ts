import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listVaultBackups, vaultBrokenPath, vaultPath } from "@dogsout/core";
import type { Io } from "./cmd.ts";
import { runGet } from "./get.ts";
import { runInit } from "./init.ts";
import { runSet } from "./set.ts";
import { runVault } from "./vault/vault.ts";

const FAKE_SE = join(import.meta.dir, "..", "..", "..", "packages", "core", "src", "vault", "helper", "fake-se.ts");
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
const savedHome = process.env.DOGSOUT_HOME;
const homes: string[] = [];

function freshHome(): string {
	const h = mkdtempSync(join(tmpdir(), "dogsout-vault-cmd-"));
	homes.push(h);
	process.env.DOGSOUT_HOME = h;
	return h;
}

beforeAll(() => {
	process.env.DOGSOUT_SE_HELPER = FAKE_SE;
});
afterEach(() => {
	delete process.env.FAKE_SE_MODE;
});
afterAll(() => {
	process.env.DOGSOUT_HOME = savedHome;
	delete process.env.DOGSOUT_SE_HELPER;
	for (const h of homes) rmSync(h, { recursive: true, force: true });
});

async function v2WithSecret(): Promise<string> {
	const h = freshHome();
	expect((await runInit([], stdinOf(""))).isOk()).toBe(true);
	expect((await runSet(["dogsout://dev/gh/token", "--stdin"], stdinOf("FAKE-ghp\n"))).isOk()).toBe(true);
	return h;
}

describe("dogsout vault (fake secure enclave)", () => {
	test("status lists one se slot on this Mac, the fingerprint and the <2-factor warning", async () => {
		await v2WithSecret();
		const r = await runVault(["status"]);
		const out = r._unsafeUnwrap();
		expect(out).toMatch(/vault v2 · fingerprint [0-9A-F]{4}-[0-9A-F]{4}/);
		expect(out).toMatch(/se\s+\S+\s+.*this Mac/);
		expect(out).toContain("1 unlock factor");
	});

	test("status reports a v1 (password) file as unsupported", async () => {
		const h = freshHome();
		writeFileSync(vaultPath(h), JSON.stringify({ version: 1, kdf: {}, iv_b64: "x", ct_b64: "y" }));
		expect((await runVault(["status"]))._unsafeUnwrapErr()).toContain("no longer supported");
	});

	test("rekey changes the fingerprint, keeps the data and leaves no backups", async () => {
		const h = await v2WithSecret();
		const before = JSON.parse(await Bun.file(vaultPath(h)).text()).fingerprint;
		expect(listVaultBackups(h).length).toBeGreaterThan(0);
		const r = await runVault(["rekey"]);
		expect(r.isOk()).toBe(true);
		const after = JSON.parse(await Bun.file(vaultPath(h)).text()).fingerprint;
		expect(after).not.toBe(before);
		expect(listVaultBackups(h)).toEqual([]);
		expect((await runGet(["dogsout://dev/gh/token", "--reveal"]))._unsafeUnwrap()).toBe("FAKE-ghp");
	});

	test("slot rm refuses the last slot", async () => {
		const h = await v2WithSecret();
		const id = JSON.parse(await Bun.file(vaultPath(h)).text()).slots[0].id;
		const r = await runVault(["slot", "rm", id]);
		expect(r._unsafeUnwrapErr()).toContain("last slot");
	});

	test("restore promotes the newest backup after a corruption and parks the broken file", async () => {
		const h = await v2WithSecret();
		// .bak.1 holds the state BEFORE the last write: write once more so it contains the token.
		expect((await runSet(["dogsout://dev/gh/other", "--stdin"], stdinOf("FAKE-2\n"))).isOk()).toBe(true);
		writeFileSync(vaultPath(h), "{ broken");
		expect((await runGet(["dogsout://dev/gh/token"]))._unsafeUnwrapErr()).toContain("dogsout vault restore");
		const r = await runVault(["restore"]);
		expect(r._unsafeUnwrap()).toContain("restored vault.enc.bak.1");
		expect(existsSync(vaultBrokenPath(h))).toBe(true);
		expect((await runGet(["dogsout://dev/gh/token"])).isOk()).toBe(true);
	});
});
