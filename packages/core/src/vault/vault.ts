import { existsSync } from "node:fs";
import { join } from "node:path";
import type { VaultFileV2 } from "@jtk/type-contracts";
import { err, ok, type Result } from "neverthrow";

/** File-level failures; crypto failures live in envelope.ts. */
export type VaultFailure = { kind: "corrupt" } | { kind: "io"; message: string };

/**
 * 0600 atomic write with 2 rolling backups (PRD §2.1): write tmp → read it back and compare →
 * rotate `.bak.1 → .bak.2`, copy the current vault.enc to `.bak.1` → rename tmp over vault.enc.
 * Writes only happen after a successful open in the same process, so `.bak.1` is always a copy
 * that opened. A failure before the rename leaves vault.enc and the backups untouched.
 * `rotate: false` is for init, which creates a fresh vault.
 */
export async function writeVaultFile(
	path: string,
	envelope: VaultFileV2,
	opts: { rotate?: boolean } = {},
): Promise<Result<void, VaultFailure>> {
	const { chmodSync, copyFileSync, renameSync, unlinkSync } = await import("node:fs");
	const tmp = `${path}.tmp.${process.pid}`;
	try {
		const text = JSON.stringify(envelope, null, 2);
		await Bun.write(tmp, text);
		chmodSync(tmp, 0o600);
		if ((await Bun.file(tmp).text()) !== text) {
			unlinkSync(tmp);
			return err({ kind: "io", message: "vault write verification failed — vault.enc left untouched" });
		}
		if ((opts.rotate ?? true) && existsSync(path)) {
			const bak1 = `${path}.bak.1`;
			if (existsSync(bak1)) renameSync(bak1, `${path}.bak.2`);
			copyFileSync(path, bak1);
			chmodSync(bak1, 0o600);
		}
		renameSync(tmp, path);
		return ok(undefined);
	} catch (e) {
		if (existsSync(tmp)) unlinkSync(tmp);
		return err({ kind: "io", message: String(e) });
	}
}

/** Which rolling backups exist for this home's vault.enc (newest first). */
export function listVaultBackups(home: string): (1 | 2)[] {
	return ([1, 2] as const).filter((n) => existsSync(join(home, `vault.enc.bak.${n}`)));
}

/** Raw parsed JSON of a vault file — the caller sniffs the version. */
export async function readVaultRaw(path: string): Promise<Result<unknown, VaultFailure>> {
	try {
		const text = await Bun.file(path).text();
		try {
			return ok(JSON.parse(text));
		} catch {
			return err({ kind: "corrupt" });
		}
	} catch (e) {
		return err({ kind: "io", message: String(e) });
	}
}
