import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyVault } from "@jtk/type-contracts";
import { vaultBackupPath } from "../paths.ts";
import { createVault, listVaultBackups, writeVaultFile } from "./vault.ts";

const MASTER = "backup-test-master";

describe("rolling backups (2 copies)", () => {
	test("first write makes no backup; later writes keep the previous two files", async () => {
		const home = mkdtempSync(join(tmpdir(), "jtk-bak-"));
		try {
			const path = join(home, "vault.enc");
			const v = [0, 1, 2].map(async () => createVault(MASTER, emptyVault()));
			const [a, b, c] = await Promise.all(v);
			await writeVaultFile(path, a as never);
			expect(listVaultBackups(home)).toEqual([]);
			await writeVaultFile(path, b as never);
			await writeVaultFile(path, c as never);
			expect(listVaultBackups(home)).toEqual([1, 2]);
			expect(JSON.parse(readFileSync(vaultBackupPath(home, 1), "utf8")).iv_b64).toBe(b?.iv_b64);
			expect(JSON.parse(readFileSync(vaultBackupPath(home, 2), "utf8")).iv_b64).toBe(a?.iv_b64);
			expect(JSON.parse(readFileSync(path, "utf8")).iv_b64).toBe(c?.iv_b64);
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
		const home = mkdtempSync(join(tmpdir(), "jtk-bak-"));
		const path = join(home, "vault.enc");
		try {
			const a = await createVault(MASTER, emptyVault());
			const b = await createVault(MASTER, emptyVault());
			await writeVaultFile(path, a);
			chmodSync(home, 0o500); // tmp file cannot be created
			const r = await writeVaultFile(path, b);
			chmodSync(home, 0o700);
			expect(r.isErr()).toBe(true);
			expect(JSON.parse(readFileSync(path, "utf8")).iv_b64).toBe(a.iv_b64);
			expect(existsSync(vaultBackupPath(home, 1))).toBe(false);
		} finally {
			chmodSync(home, 0o700);
			rmSync(home, { recursive: true, force: true });
		}
	});
});
