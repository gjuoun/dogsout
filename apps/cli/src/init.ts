import {
	configPath,
	createEnvelopeV2,
	initFiles,
	jtkHome,
	pickLocalSeSlot,
	seCreate,
	seEcdh,
	unlockWithSe,
	vaultPath,
	writeConfig,
	writeVaultFile,
} from "@jtk/core";
import { emptyVault } from "@jtk/type-contracts";
import { command, flag } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { defaultIo, fail, type Io, runJtk, withMeta } from "./cmd.ts";

/** Experimental switch for the vault v2 envelope (PRD §2.1): v1 stays the default until F3. */
export const VAULT_V2_ENV = "JTK_VAULT_V2";

/** Interactive prompt when no JTK_MASTER and we have a TTY (reads one line, not EOF). */
async function readMasterInteractive(): Promise<string> {
	const { createInterface } = await import("node:readline");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((resolve) => {
		rl.question("master password (min 8 chars): ", (a: string) => resolve(a));
	});
	rl.close();
	return answer.trim();
}

/**
 * v2 init: no password. Mint a Secure Enclave key, seal an empty vault under a fresh DEK, then
 * immediately unlock once (one Touch ID) — init only succeeds if the slot really opens.
 */
async function initV2(home: string): Promise<Result<string, string>> {
	const { mkdirSync, rmSync } = await import("node:fs");
	mkdirSync(home, { recursive: true });
	const se = await seCreate();
	if (se.isErr()) return err(se.error);
	const { file } = await createEnvelopeV2(emptyVault(), se.value);
	const cfgR = await writeConfig(home, { version: 1, aliases: {}, maps: {} });
	if (cfgR.isErr()) return err(cfgR.error);
	const w = await writeVaultFile(vaultPath(home), file, { rotate: false });
	if (w.isErr()) return err(w.error.kind);
	const slot = await pickLocalSeSlot(file);
	const dek = slot ? await unlockWithSe(file, slot, seEcdh) : null;
	if (!dek || dek.isErr()) {
		rmSync(vaultPath(home), { force: true });
		rmSync(configPath(home), { force: true });
		return err(
			`init aborted: the new Touch ID slot did not open (${dek?.isErr() ? dek.error.kind : "slot not usable on this Mac"})`,
		);
	}
	return ok(
		`initialized ${home} (vault v2, fingerprint ${file.fingerprint})\n` +
			"warning: one unlock factor only (this Mac's Touch ID) — losing this Mac loses the vault until passkey enrollment lands with the WebUI (F3)",
	);
}

export function initCommand(io: Io = defaultIo) {
	return withMeta(
		command({
			name: "init",
			description:
				"create vault.enc + config.json (master via JTK_MASTER, prompt, or stdin; JTK_VAULT_V2=1: Touch ID, no password)",
			args: { force: flag({ long: "force", description: "reset an already-initialized home (destructive)" }) },
			handler: async ({ force }): Promise<Result<string, string>> => {
				const home = jtkHome();
				if ((await Bun.file(configPath(home)).exists()) && !force) {
					return fail(`already initialized: ${configPath(home)} (use --force to reset)`);
				}
				if (process.env[VAULT_V2_ENV] === "1") return initV2(home);
				let master = process.env.JTK_MASTER;
				if (!master) {
					master = process.stdin.isTTY ? await readMasterInteractive() : (await io.stdin()).trim();
				}
				if (!master || master.length < 8) return fail("master password too short (min 8)");
				const r = await initFiles(home, master);
				if (r.isErr()) return err(r.error);
				return ok(`initialized ${home}`);
			},
		}),
		{ reads: [], writes: ["config", "vault"], env: ["JTK_HOME", "JTK_MASTER", "JTK_VAULT_V2", "JTK_SE_HELPER"] },
	);
}

export async function runInit(argv: string[], io: Io = defaultIo): Promise<Result<string, string>> {
	return runJtk<string>(initCommand(io), argv);
}
