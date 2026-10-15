import { chmodSync, copyFileSync, rmSync } from "node:fs";
import {
	createEnvelopeV2,
	jtkHome,
	openData,
	pickLocalSeSlot,
	readVaultRaw,
	seCreate,
	seEcdh,
	unlockWithSe,
	vaultBackupPath,
	vaultPath,
	vaultV1Path,
	writeVaultFile,
} from "@jtk/core";
import { vaultFileVersion } from "@jtk/type-contracts";
import { command } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { defaultIo, type Io } from "../cmd.ts";
import { VAULT_V2_ENV } from "../init.ts";

/** Read a secret from a TTY without echoing it. */
async function readSecretSilent(prompt: string): Promise<string> {
	process.stdout.write(prompt);
	const stdin = process.stdin;
	stdin.setRawMode?.(true);
	stdin.resume();
	let buf = "";
	await new Promise<void>((resolve) => {
		const onData = (chunk: Buffer) => {
			for (const ch of chunk.toString("utf8")) {
				if (ch === "\r" || ch === "\n" || ch === "\u0004") {
					stdin.off("data", onData);
					resolve();
					return;
				}
				if (ch === "\u0003") process.exit(130);
				buf = ch === "\u007f" ? buf.slice(0, -1) : buf + ch;
			}
		};
		stdin.on("data", onData);
	});
	stdin.setRawMode?.(false);
	stdin.pause();
	process.stdout.write("\n");
	return buf;
}

/** v1 → v2: old password once, new DEK, Touch ID slot, test unlock; vault.v1.enc kept. */
async function migrateCore(io: Io): Promise<Result<string, string>> {
	if (process.env[VAULT_V2_ENV] !== "1") {
		return err(`vault migrate is experimental: set ${VAULT_V2_ENV}=1 (v2 becomes the default together with F3)`);
	}
	const home = jtkHome();
	const raw = await readVaultRaw(vaultPath(home));
	if (raw.isOk() && vaultFileVersion(raw.value) === 2) return err("already vault v2 — nothing to migrate");
	let master = process.env.JTK_MASTER;
	if (!master)
		master = process.stdin.isTTY ? await readSecretSilent("current master password: ") : (await io.stdin()).trim();
	const opened = await openData({ home, master });
	if (opened.isErr()) return err(opened.error);
	const se = await seCreate();
	if (se.isErr()) return err(se.error);
	const { file } = await createEnvelopeV2(opened.value.data, se.value);
	copyFileSync(vaultPath(home), vaultV1Path(home));
	chmodSync(vaultV1Path(home), 0o600);
	const w = await writeVaultFile(vaultPath(home), file, { rotate: false });
	if (w.isErr()) return err(`migrate aborted, v1 vault untouched: ${w.error.kind}`);
	const slot = await pickLocalSeSlot(file);
	const dek = slot ? await unlockWithSe(file, slot, seEcdh) : null;
	if (!dek || dek.isErr()) {
		copyFileSync(vaultV1Path(home), vaultPath(home));
		rmSync(vaultV1Path(home), { force: true });
		return err("migrate aborted: the new Touch ID slot did not open — v1 vault restored");
	}
	// v1-era backups are password-encrypted copies; vault.v1.enc is the one kept on purpose.
	for (const n of [1, 2] as const) rmSync(vaultBackupPath(home, n), { force: true });
	return ok(
		`migrated to vault v2, fingerprint ${file.fingerprint} — old file kept as vault.v1.enc (delete it once you have checked)`,
	);
}

export function vaultMigrateCommand(io: Io = defaultIo) {
	return command({
		name: "migrate",
		description: "convert a v1 (password) vault to v2 (Touch ID); experimental, needs JTK_VAULT_V2=1",
		args: {},
		handler: () => migrateCore(io),
	});
}
