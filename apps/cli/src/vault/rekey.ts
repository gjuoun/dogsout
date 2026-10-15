import { rmSync } from "node:fs";
import { openData, rekeyV2, vaultBackupPath, vaultPath, writeVaultFile } from "@jtk/core";
import { command } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { ctxFromEnv } from "../context.ts";

/** Suspected leak: new DEK, data re-sealed, se slots re-wrapped, rolling backups deleted. */
async function rekeyCore(): Promise<Result<string, string>> {
	const ctxR = ctxFromEnv();
	if (ctxR.isErr()) return err(ctxR.error);
	const home = ctxR.value.home;
	const opened = await openData(ctxR.value);
	if (opened.isErr()) return err(opened.error);
	const { envelope, data } = opened.value;
	const r = await rekeyV2(envelope.file, data);
	const w = await writeVaultFile(vaultPath(home), r.file, { rotate: false });
	if (w.isErr()) return err(w.error.kind);
	for (const n of [1, 2] as const) rmSync(vaultBackupPath(home, n), { force: true });
	const dropped = r.dropped.length > 0 ? `; ${r.dropped.length} passkey slot(s) dropped — re-enroll in the WebUI` : "";
	return ok(`rekeyed: fingerprint ${envelope.file.fingerprint} → ${r.file.fingerprint}; backups cleared${dropped}`);
}

export function vaultRekeyCommand() {
	return command({
		name: "rekey",
		description: "new data key, re-wrap slots, clear backups (use after a suspected leak)",
		args: {},
		handler: rekeyCore,
	});
}
