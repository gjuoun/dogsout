import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VaultData, VaultFileV2 } from "@dogsout/type-contracts";
import { vaultPath } from "./paths.ts";
import { initFiles, openData, saveData, V1_UNSUPPORTED } from "./store.ts";
import { createEnvelopeV2 } from "./vault/envelope.ts";
import { SE_HELPER_ENV, seCreate } from "./vault/se.ts";
import { listVaultBackups, writeVaultFile } from "./vault/vault.ts";

const FAKE = join(import.meta.dir, "vault", "helper", "fake-se.ts");
const prev = process.env[SE_HELPER_ENV];
const prevAllowSe = process.env.DOGSOUT_ALLOW_SE;
beforeAll(() => {
	process.env[SE_HELPER_ENV] = FAKE;
	// legacy se-slot tests: the one-shot opt-in that migration commands use
	process.env.DOGSOUT_ALLOW_SE = "1";
});
afterAll(() => {
	if (prev === undefined) delete process.env[SE_HELPER_ENV];
	else process.env[SE_HELPER_ENV] = prev;
	if (prevAllowSe === undefined) delete process.env.DOGSOUT_ALLOW_SE;
	else process.env.DOGSOUT_ALLOW_SE = prevAllowSe;
});

const data = (): VaultData => ({
	version: 1,
	vaults: { dev: { gh: { fields: { token: "FAKE-ghp" }, updated_at: "t" } } },
});

async function v2Home(): Promise<{ home: string; file: VaultFileV2 }> {
	const home = mkdtempSync(join(tmpdir(), "dogsout-store-v2-"));
	const { file } = await createEnvelopeV2(data(), (await seCreate())._unsafeUnwrap());
	await writeVaultFile(vaultPath(home), file);
	return { home, file };
}

describe("store: version-dispatching open/save", () => {
	test("v2 opens through the se slot without any master", async () => {
		const { home, file } = await v2Home();
		try {
			const opened = await openData({ home });
			expect(opened.isOk()).toBe(true);
			const { envelope, data: d } = opened._unsafeUnwrap();
			expect(d.vaults.dev?.gh?.fields.token).toBe("FAKE-ghp");
			expect(envelope.file.fingerprint).toBe(file.fingerprint);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("v2 save reseals under the same DEK and rotates a backup", async () => {
		const { home } = await v2Home();
		try {
			const { envelope, data: d } = (await openData({ home }))._unsafeUnwrap();
			const dev = d.vaults.dev ?? {};
			dev.extra = { fields: { k: "FAKE-2" }, updated_at: "t2" };
			d.vaults.dev = dev;
			expect((await saveData({ home }, envelope, d)).isOk()).toBe(true);
			expect(listVaultBackups(home)).toEqual([1]);
			const again = (await openData({ home }))._unsafeUnwrap();
			expect(again.data.vaults.dev?.extra?.fields.k).toBe("FAKE-2");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("v2 with no usable slot for this Mac points at the token migration", async () => {
		const { home, file } = await v2Home();
		try {
			const foreign = { ...file, slots: file.slots.map((s) => ({ ...s, blob: "Zm9yZWlnbg==" })) };
			await writeVaultFile(vaultPath(home), foreign);
			const r = await openData({ home });
			expect(r.isErr()).toBe(true);
			expect(r._unsafeUnwrapErr()).toContain("token");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("unreadable vault.enc names the backup and dogsout vault restore, never substitutes silently", async () => {
		const { home } = await v2Home();
		try {
			const { envelope, data: d } = (await openData({ home }))._unsafeUnwrap();
			await saveData({ home }, envelope, d);
			writeFileSync(vaultPath(home), "{ not json");
			const r = await openData({ home });
			expect(r.isErr()).toBe(true);
			expect(r._unsafeUnwrapErr()).toContain("dogsout vault restore");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("initFiles defaults to a token slot that opens with no Secure Enclave at all", async () => {
		const home = mkdtempSync(join(tmpdir(), "dogsout-store-init-token-"));
		const prevHelper = process.env[SE_HELPER_ENV];
		process.env[SE_HELPER_ENV] = "/nonexistent/dogsout-se";
		try {
			const r = await initFiles(home);
			expect(r._unsafeUnwrap().fingerprint).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
			const tokenPath = r._unsafeUnwrap().tokenPath;
			expect(tokenPath).toBeDefined();
			expect((await Bun.file(tokenPath ?? "").text()).trim().length).toBeGreaterThanOrEqual(32);
			const opened = (await openData({ home }))._unsafeUnwrap();
			expect(opened.envelope.file.fingerprint).toBe(r._unsafeUnwrap().fingerprint);
			expect(opened.envelope.file.slots.map((s) => s.kind)).toEqual(["token"]);
		} finally {
			if (prevHelper === undefined) delete process.env[SE_HELPER_ENV];
			else process.env[SE_HELPER_ENV] = prevHelper;
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("initFiles creates config + a v2 vault that opens through the se slot (--se)", async () => {
		const home = mkdtempSync(join(tmpdir(), "dogsout-store-init-"));
		try {
			const r = await initFiles(home, { mode: "se" });
			expect(r._unsafeUnwrap().fingerprint).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
			const opened = (await openData({ home }))._unsafeUnwrap();
			expect(opened.envelope.file.fingerprint).toBe(r._unsafeUnwrap().fingerprint);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("a v1 (password) vault file is refused — cold cut, no reader", async () => {
		const home = mkdtempSync(join(tmpdir(), "dogsout-store-v1-"));
		try {
			writeFileSync(
				vaultPath(home),
				JSON.stringify({ version: 1, kdf: { algo: "legacy-password" }, iv_b64: "x", ct_b64: "y" }),
			);
			expect((await openData({ home }))._unsafeUnwrapErr()).toBe(V1_UNSUPPORTED);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("init aborts and cleans up when the new slot cannot be unlocked", async () => {
		const home = mkdtempSync(join(tmpdir(), "dogsout-store-init-deny-"));
		process.env.FAKE_SE_MODE = "deny";
		try {
			const r = await initFiles(home, { mode: "se" });
			expect(r._unsafeUnwrapErr()).toContain("init aborted");
			expect(await Bun.file(vaultPath(home)).exists()).toBe(false);
		} finally {
			delete process.env.FAKE_SE_MODE;
			rmSync(home, { recursive: true, force: true });
		}
	});
});
