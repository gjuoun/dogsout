import { configPath, dogsoutHome, initFiles } from "@dogsout/core";
import { command, flag } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { defaultIo, fail, type Io, runDogsout, withMeta } from "./cmd.ts";

/**
 * init: no password, no Touch ID by default. Mints a local 0600 unlock token, seals an empty
 * vault with a token slot and verifies it opens before reporting success. `--se` keeps the
 * legacy Secure Enclave slot for anyone who explicitly wants chip-bound hardware.
 */
export function initCommand(_io: Io = defaultIo) {
	return withMeta(
		command({
			name: "init",
			description: "create vault.enc + config.json — local unlock token, no Touch ID",
			args: {
				force: flag({ long: "force", description: "reset an already-initialized home (destructive)" }),
				se: flag({
					long: "se",
					description: "legacy: wrap the vault with a Secure Enclave (Touch ID) slot instead of a token",
				}),
			},
			handler: async ({ force, se }): Promise<Result<string, string>> => {
				const home = dogsoutHome();
				if ((await Bun.file(configPath(home)).exists()) && !force) {
					return fail(`already initialized: ${configPath(home)} (use --force to reset)`);
				}
				const r = await initFiles(home, { mode: se ? "se" : "token" });
				if (r.isErr()) return err(r.error);
				if (se) {
					return ok(
						`initialized ${home} (vault v2, fingerprint ${r.value.fingerprint})\n` +
							"warning: this vault unlocks with Touch ID; passkey enrollment lands with the WebUI (F3)",
					);
				}
				return ok(
					`initialized ${home} (vault v2, fingerprint ${r.value.fingerprint})\n` +
						`unlock token: ${r.value.tokenPath} (0600 — never printed; no biometrics)`,
				);
			},
		}),
		{
			reads: [],
			writes: ["config", "vault"],
			env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER", "DOGSOUT_UNLOCK_TOKEN"],
		},
	);
}

export async function runInit(argv: string[], io: Io = defaultIo): Promise<Result<string, string>> {
	return runDogsout<string>(initCommand(io), argv);
}
