import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyVault } from "@dogsout/type-contracts";
import { vaultBackupPath } from "../paths.ts";
import { createEnvelopeV2 } from "./envelope.ts";
import { listVaultBackups, writeVaultFile } from "./vault.ts";

async function envelope() {
	const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
	const b64 = (u: ArrayBuffer) => Buffer.from(new Uint8Array(u)).toString("base64");
	const ref = {
		blob: b64(await crypto.subtle.exportKey("pkcs8", kp.privateKey)),
		pub: b64(await crypto.subtle.exportKey("raw", kp.publicKey)),
	};
	return (await createEnvelopeV2(emptyVault(), ref)).file;
}

describe("rolling backups (2 copies)", () => {
	test("first write makes no backup; later writes keep the previous two files", async () => {
		const home = mkdtempSync(join(tmpdir(), "dogsout-bak-"));
		try {
			const path = join(home, "vault.enc");
			const v = [0, 1, 2].map(async () => envelope());
			const [a, b, c] = await Promise.all(v);
			await writeVaultFile(path, a as NonNullable<typeof a>);
			expect(listVaultBackups(home)).toEqual([]);
			await writeVaultFile(path, b as NonNullable<typeof b>);
			await writeVaultFile(path, c as NonNullable<typeof c>);
			expect(listVaultBackups(home)).toEqual([1, 2]);
			expect(JSON.parse(readFileSync(vaultBackupPath(home, 1), "utf8")).data.iv).toBe(b?.data.iv);
			expect(JSON.parse(readFileSync(vaultBackupPath(home, 2), "utf8")).data.iv).toBe(a?.data.iv);
			expect(JSON.parse(readFileSync(path, "utf8")).data.iv).toBe(c?.data.iv);
			for (const p of [path, vaultBackupPath(home, 1), vaultBackupPath(home, 2)]) {
				expect(Bun.file(p).size).toBeGreaterThan(0);
				const { statSync } = await import("node:fs");
				expect(statSync(p).mode & 0o777).toBe(0o600);
			}
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});

	test("a failed write never replaces vault.enc and never rotates backups", async () => {
		const home = mkdtempSync(join(tmpdir(), "dogsout-bak-"));
		const path = join(home, "vault.enc");
		try {
			const a = await envelope();
			const b = await envelope();
			await writeVaultFile(path, a);
			chmodSync(home, 0o500); // tmp file cannot be created
			const r = await writeVaultFile(path, b);
			chmodSync(home, 0o700);
			expect(r.isErr()).toBe(true);
			expect(JSON.parse(readFileSync(path, "utf8")).data.iv).toBe(a.data.iv);
			expect(existsSync(vaultBackupPath(home, 1))).toBe(false);
		} finally {
			chmodSync(home, 0o700);
			rmSync(home, { recursive: true, force: true });
		}
	});
});
