import { subcommands } from "cmd-ts";
import type { Result } from "neverthrow";
import { runDogsout, withMeta } from "../cmd.ts";
import { configCommand } from "./config.ts";
import { simulateCommand } from "./simulate.ts";
import { policyTestCommand } from "./test.ts";
import { whyCommand } from "./why.ts";

export function policyCommand() {
	return withMeta(
		subcommands({
			name: "policy",
			description: "preview, explain and regression-test policy decisions; safe config edits",
			cmds: {
				simulate: simulateCommand(),
				why: whyCommand(),
				test: policyTestCommand(),
				config: configCommand(),
			},
		}),
		{
			reads: ["vault", "config", "grants", "sessions"],
			writes: ["config"],
			env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER"],
		},
	);
}

export async function runPolicy(argv: string[]): Promise<Result<string, string>> {
	return runDogsout<string>(policyCommand(), argv);
}
