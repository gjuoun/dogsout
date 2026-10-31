import {
	addSlot,
	dogsoutHome,
	mintUnlockToken,
	newSlotId,
	openData,
	pickTokenSlot,
	readUnlockToken,
	unlockTokenPath,
	vaultPath,
	wrapToken,
	writeVaultFile,
} from "@dogsout/core";
import { command } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { ctxFromEnv } from "../context.ts";

/**
 * One-time migration from Touch ID to a local token: open the vault with its legacy Secure
 * Enclave slot (the ONLY place that opts into DOGSOUT_ALLOW_SE), mint or reuse the local token,
 * wrap an additional token slot and write the vault back. After this every command opens with
 * the token — no biometrics.
 */
async function tokenAddCore(): Promise<Result<string, string>> {
	const ctxR = ctxFromEnv();
	if (ctxR.isErr()) return err(ctxR.error);
	const home = ctxR.value.home;
	process.env.DOGSOUT_ALLOW_SE = "1";
	const opened = await openData(ctxR.value);
	if (opened.isErr()) return err(opened.error);
	const { envelope, data } = opened.value;

	let token: string;
	const existing = readUnlockToken(home);
	if (existing.isOk()) {
		token = existing.value;
	} else {
		const minted = await mintUnlockToken(home);
		if (minted.isErr()) return err(minted.error);
		token = minted.value;
	}
	if (pickTokenSlot(envelope.file, token)) {
		return ok(`a token slot for the local unlock token already exists (vault ${envelope.file.fingerprint})`);
	}

	const slot = await wrapToken(envelope.dek, envelope.file.vault_id, newSlotId(), token);
	const w = await writeVaultFile(vaultPath(home), addSlot(envelope.file, slot));
	if (w.isErr()) return err(w.error.kind === "io" ? w.error.message : w.error.kind);
	return ok(
		`token slot added (${slot.id}) to vault ${envelope.file.fingerprint}\n` +
			`unlock token: ${unlockTokenPath(home)} (0600) — no Touch ID from now on`,
	);
}

export function vaultTokenAddCommand() {
	return command({
		name: "add",
		description: "add a local-token slot (last Touch ID; afterwards unlocks without biometrics)",
		args: {},
		handler: tokenAddCore,
	});
}
