import { configPath, initFiles, jtkHome } from "@jtk/core";
import { command, flag } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { defaultIo, fail, type Io, runJtk, withMeta } from "./cmd.ts";

/**
 * init: no password. Mints a Secure Enclave key, seals an empty vault under a fresh DEK and
 * unlocks it once (Touch ID) before reporting success. `io` is kept for the shared command seam.
 */
export function initCommand(_io: Io = defaultIo) {
	return withMeta(
		command({
			name: "init",
			description: "create vault.enc + config.json — Touch ID (Secure Enclave), no password",
			args: { force: flag({ long: "force", description: "reset an already-initialized home (destructive)" }) },
			handler: async ({ force }): Promise<Result<string, string>> => {
				const home = jtkHome();
				if ((await Bun.file(configPath(home)).exists()) && !force) {
					return fail(`already initialized: ${configPath(home)} (use --force to reset)`);
				}
				const r = await initFiles(home);
				if (r.isErr()) return err(r.error);
				return ok(
					`initialized ${home} (vault v2, fingerprint ${r.value.fingerprint})\n` +
						"warning: one unlock factor only (this Mac's Touch ID) — losing this Mac loses the vault until passkey enrollment lands with the WebUI (F3)",
				);
			},
		}),
		{ reads: [], writes: ["config", "vault"], env: ["JTK_HOME", "JTK_SE_HELPER"] },
	);
}

export async function runInit(argv: string[], io: Io = defaultIo): Promise<Result<string, string>> {
	return runJtk<string>(initCommand(io), argv);
}
