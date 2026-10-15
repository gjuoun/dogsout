import { subcommands } from "cmd-ts";
import type { Result } from "neverthrow";
import { runJtk, withMeta } from "../cmd.ts";
import { grantsLsCommand } from "./ls.ts";
import { grantsRmCommand } from "./rm.ts";

export function grantsCommand() {
	return withMeta(
		subcommands({
			name: "grants",
			description: "inspect and revoke approvals (metadata only, never values)",
			cmds: { ls: grantsLsCommand(), rm: grantsRmCommand() },
		}),
		{ reads: ["grants", "sessions"], writes: ["grants"], env: ["JTK_HOME"] },
	);
}

export async function runGrants(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(grantsCommand(), argv);
}
