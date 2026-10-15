import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listVaultBackups, vaultBrokenPath, vaultPath, vaultV1Path } from "@jtk/core";
import type { Io } from "./cmd.ts";
import { runGet } from "./get.ts";
import { runInit } from "./init.ts";
import { runSet } from "./set.ts";
import { runVault } from "./vault/vault.ts";

const FAKE_SE = join(import.meta.dir, "..", "..", "..", "packages", "core", "src", "vault", "helper", "fake-se.ts");
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
const saved = { home: process.env.JTK_HOME, master: process.env.JTK_MASTER };
const homes: string[] = [];

function freshHome(v2: boolean): string {
	const h = mkdtempSync(join(tmpdir(), "jtk-vault-cmd-"));
	homes.push(h);
	process.env.JTK_HOME = h;
	if (v2) {
		process.env.JTK_VAULT_V2 = "1";
		delete process.env.JTK_MASTER;
	} else {
		delete process.env.JTK_VAULT_V2;
		process.env.JTK_MASTER = "vault-cmd-master";
	}
	return h;
}

beforeAll(() => {
	process.env.JTK_SE_HELPER = FAKE_SE;
});
afterEach(() => {
	delete process.env.FAKE_SE_MODE;
});
afterAll(() => {
	process.env.JTK_HOME = saved.home;
	if (saved.master === undefined) delete process.env.JTK_MASTER;
	else process.env.JTK_MASTER = saved.master;
	delete process.env.JTK_VAULT_V2;
	delete process.env.JTK_SE_HELPER;
	for (const h of homes) rmSync(h, { recursive: true, force: true });
});

async function v2WithSecret(): Promise<string> {
	const h = freshHome(true);
	expect((await runInit([], stdinOf(""))).isOk()).toBe(true);
	expect((await runSet(["jtk://dev/gh/token", "--stdin"], stdinOf("FAKE-ghp\n"))).isOk()).toBe(true);
	return h;
}

describe("jtk vault (JTK_VAULT_V2, fake secure enclave)", () => {
	test("status lists one se slot on this Mac, the fingerprint and the <2-factor warning", async () => {
		await v2WithSecret();
		const r = await runVault(["status"]);
		const out = r._unsafeUnwrap();
		expect(out).toMatch(/vault v2 · fingerprint [0-9A-F]{4}-[0-9A-F]{4}/);
		expect(out).toMatch(/se\s+\S+\s+.*this Mac/);
		expect(out).toContain("1 unlock factor");
	});

	test("migrate turns a v1 vault into v2, keeps the data and vault.v1.enc", async () => {
		const h = freshHome(false);
		expect((await runInit([], stdinOf(""))).isOk()).toBe(true);
		expect((await runSet(["jtk://dev/zai/key", "--stdin"], stdinOf("FAKE-zai\n"))).isOk()).toBe(true);
		process.env.JTK_VAULT_V2 = "1";
		const m = await runVault(["migrate"]);
		expect(m._unsafeUnwrap()).toMatch(/migrated to vault v2, fingerprint [0-9A-F]{4}-[0-9A-F]{4}/);
		expect(existsSync(vaultV1Path(h))).toBe(true);
		expect(JSON.parse(await Bun.file(vaultPath(h)).text()).version).toBe(2);
		delete process.env.JTK_MASTER;
		expect((await runGet(["jtk://dev/zai/key", "--reveal"]))._unsafeUnwrap()).toBe("FAKE-zai");
	});

	test("migrate is refused without the experimental switch", async () => {
		freshHome(false);
		expect((await runInit([], stdinOf(""))).isOk()).toBe(true);
		const m = await runVault(["migrate"]);
		expect(m._unsafeUnwrapErr()).toContain("JTK_VAULT_V2");
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
		expect((await runGet(["jtk://dev/gh/token", "--reveal"]))._unsafeUnwrap()).toBe("FAKE-ghp");
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
		expect((await runSet(["jtk://dev/gh/other", "--stdin"], stdinOf("FAKE-2\n"))).isOk()).toBe(true);
		writeFileSync(vaultPath(h), "{ broken");
		expect((await runGet(["jtk://dev/gh/token"]))._unsafeUnwrapErr()).toContain("jtk vault restore");
		const r = await runVault(["restore"]);
		expect(r._unsafeUnwrap()).toContain("restored vault.enc.bak.1");
		expect(existsSync(vaultBrokenPath(h))).toBe(true);
		expect((await runGet(["jtk://dev/gh/token"])).isOk()).toBe(true);
	});
});
