import { chmodSync, copyFileSync, existsSync, renameSync } from "node:fs";
import { listVaultBackups, openDataAt, vaultBackupPath, vaultBrokenPath, vaultPath } from "@jtk/core";
import { command, number, option, optional } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { ctxFromEnv } from "../context.ts";

/** Promote a rolling backup after verifying it opens; the replaced file is parked as vault.enc.broken. */
async function restoreCore(a: { from?: number | undefined }): Promise<Result<string, string>> {
	const ctxR = ctxFromEnv();
	if (ctxR.isErr()) return err(ctxR.error);
	const home = ctxR.value.home;
	const backups = listVaultBackups(home);
	if (backups.length === 0) return err("no backups to restore");
	const n = a.from ?? backups[0];
	if (n !== 1 && n !== 2) return err("--from must be 1 or 2");
	if (!backups.includes(n)) return err(`vault.enc.bak.${n} does not exist`);
	const verified = await openDataAt(ctxR.value, vaultBackupPath(home, n));
	if (verified.isErr()) return err(`vault.enc.bak.${n} does not open: ${verified.error}`);
	if (existsSync(vaultPath(home))) renameSync(vaultPath(home), vaultBrokenPath(home));
	copyFileSync(vaultBackupPath(home, n), vaultPath(home));
	chmodSync(vaultPath(home), 0o600);
	return ok(`restored vault.enc.bak.${n} → vault.enc (previous file kept as vault.enc.broken)`);
}

export function vaultRestoreCommand() {
	return command({
		name: "restore",
		description: "promote a verified rolling backup (newest by default) to vault.enc",
		args: { from: option({ long: "from", type: optional(number), description: "backup number: 1 (newest) or 2" }) },
		handler: restoreCore,
	});
}
