import { subcommands } from "cmd-ts";
import type { Result } from "neverthrow";
import { runJtk, withMeta } from "../cmd.ts";
import { vaultMigrateCommand } from "./migrate.ts";
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
			description: "vault envelope: status, migrate (v1→v2), rekey, slot rm, restore",
			cmds: {
				status: vaultStatusCommand(),
				migrate: vaultMigrateCommand(),
				rekey: vaultRekeyCommand(),
				restore: vaultRestoreCommand(),
				slot: vaultSlotCommand(),
			},
		}),
		{ reads: ["vault"], writes: ["vault"], env: ["JTK_HOME", "JTK_MASTER", "JTK_VAULT_V2", "JTK_SE_HELPER"] },
	);
}

export async function runVault(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(vaultCommand(), argv);
}
