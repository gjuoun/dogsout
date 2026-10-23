import { subcommands } from "cmd-ts";
import type { Result } from "neverthrow";
import { runDogsout, withMeta } from "../cmd.ts";
import { vaultRekeyCommand } from "./rekey.ts";
import { vaultRestoreCommand } from "./restore.ts";
import { vaultSlotRmCommand } from "./slot-rm.ts";
import { vaultStatusCommand } from "./status.ts";

export function vaultSlotCommand() {
	return subcommands({ name: "slot", description: "manage unlock slots", cmds: { rm: vaultSlotRmCommand() } });
}

export function vaultCommand() {
	return withMeta(
		subcommands({
			name: "vault",
			description: "vault envelope: status, rekey, slot rm, restore",
			cmds: {
				status: vaultStatusCommand(),
				rekey: vaultRekeyCommand(),
				restore: vaultRestoreCommand(),
				slot: vaultSlotCommand(),
			},
		}),
		{ reads: ["vault"], writes: ["vault"], env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER"] },
	);
}

export async function runVault(argv: string[]): Promise<Result<string, string>> {
	return runDogsout<string>(vaultCommand(), argv);
}
