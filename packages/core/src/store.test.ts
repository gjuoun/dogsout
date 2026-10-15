import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VaultData, VaultFileV2 } from "@jtk/type-contracts";
import { vaultPath } from "./paths.ts";
import { initFiles, openData, saveData } from "./store.ts";
import { createEnvelopeV2 } from "./vault/envelope.ts";
import { SE_HELPER_ENV, seCreate } from "./vault/se.ts";
import { listVaultBackups, writeVaultFile } from "./vault/vault.ts";

const FAKE = join(import.meta.dir, "vault", "helper", "fake-se.ts");
const prev = process.env[SE_HELPER_ENV];
beforeAll(() => {
	process.env[SE_HELPER_ENV] = FAKE;
});
afterAll(() => {
	if (prev === undefined) delete process.env[SE_HELPER_ENV];
	else process.env[SE_HELPER_ENV] = prev;
});

const data = (): VaultData => ({
	version: 1,
	vaults: { dev: { gh: { fields: { token: "FAKE-ghp" }, updated_at: "t" } } },
});

async function v2Home(): Promise<{ home: string; file: VaultFileV2 }> {
	const home = mkdtempSync(join(tmpdir(), "jtk-store-v2-"));
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
			expect(envelope.version).toBe(2);
			expect(d.vaults.dev?.gh?.fields.token).toBe("FAKE-ghp");
			if (envelope.version === 2) expect(envelope.file.fingerprint).toBe(file.fingerprint);
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

	test("v2 with no slot for this Mac points at the passkey reset", async () => {
		const { home, file } = await v2Home();
		try {
			const foreign = { ...file, slots: file.slots.map((s) => ({ ...s, blob: "Zm9yZWlnbg==" })) };
			await writeVaultFile(vaultPath(home), foreign);
			const r = await openData({ home });
			expect(r.isErr()).toBe(true);
			expect(r._unsafeUnwrapErr()).toContain("passkey");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("unreadable vault.enc names the backup and jtk vault restore, never substitutes silently", async () => {
		const { home } = await v2Home();
		try {
			const { envelope, data: d } = (await openData({ home }))._unsafeUnwrap();
			await saveData({ home }, envelope, d);
			writeFileSync(vaultPath(home), "{ not json");
			const r = await openData({ home });
			expect(r.isErr()).toBe(true);
			expect(r._unsafeUnwrapErr()).toContain("jtk vault restore");
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("v1 still needs the master and keeps its error text", async () => {
		const home = mkdtempSync(join(tmpdir(), "jtk-store-v1-"));
		try {
			expect((await initFiles(home, "store-test-master")).isOk()).toBe(true);
			expect((await openData({ home }))._unsafeUnwrapErr()).toContain("JTK_MASTER not set");
			expect((await openData({ home, master: "wrong-master-xx" }))._unsafeUnwrapErr()).toBe("wrong master password");
			const ok1 = await openData({ home, master: "store-test-master" });
			expect(ok1._unsafeUnwrap().envelope.version).toBe(1);
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
