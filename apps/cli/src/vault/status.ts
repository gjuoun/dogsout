import { dogsoutHome, listVaultBackups, readVaultRaw, seProbe, V1_UNSUPPORTED, vaultPath } from "@dogsout/core";
import { parseVaultFileV2, vaultFileVersion } from "@dogsout/type-contracts";
import { command } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";

/** Read-only overview: never unlocks, never shows Touch ID (slot metadata is plaintext by design). */
async function statusCore(): Promise<Result<string, string>> {
	const home = dogsoutHome();
	const backups = listVaultBackups(home);
	const backupLine = `backups: ${backups.length}${backups.length > 0 ? ` (${backups.map((n) => `vault.enc.bak.${n}`).join(", ")})` : ""}`;
	const raw = await readVaultRaw(vaultPath(home));
	if (raw.isErr()) {
		if (raw.error.kind === "corrupt")
			return err(`vault.enc unreadable\n${backupLine}${backups.length > 0 ? "\nrun: dogsout vault restore" : ""}`);
		return err(`vault not found: ${vaultPath(home)} — run: dogsout init`);
	}
	const version = vaultFileVersion(raw.value);
	if (version === 1) return err(V1_UNSUPPORTED);
	const parsed = version === 2 ? parseVaultFileV2(raw.value) : null;
	if (!parsed?.ok) return err(`vault.enc unreadable\n${backupLine}`);
	const file = parsed.file;
	const rows: string[] = [];
	for (const s of file.slots) {
		const created = s.created_at.slice(0, 10);
		if (s.kind === "se") {
			const here = (await seProbe(s.blob)) ? "this Mac" : "other Mac";
			rows.push(`  se       ${s.id}  created ${created}  Touch ID · ${here}`);
		} else if (s.kind === "token") {
			const exp = s.expires_at ? ` · expires ${new Date(s.expires_at * 1000).toISOString().slice(0, 10)}` : "";
			rows.push(`  token    ${s.id}  created ${created}  local token · ${s.token_id}${exp}`);
		} else {
			rows.push(`  passkey  ${s.id}  created ${created}  passkey (WebUI)`);
		}
	}
	const lines = [`vault v2 · fingerprint ${file.fingerprint}`, "slots:", ...rows, backupLine];
	if (file.slots.length < 2) {
		lines.push(
			`warning: ${file.slots.length} unlock factor — a second one (another token, or a passkey in the WebUI/F3) keeps the vault readable if this one is lost`,
		);
	}
	return ok(lines.join("\n"));
}

export function vaultStatusCommand() {
	return command({
		name: "status",
		description: "show vault version, fingerprint, unlock slots and backups (no unlock)",
		args: {},
		handler: statusCore,
	});
}
