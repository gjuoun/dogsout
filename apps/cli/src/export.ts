import { formatEnvRef, formatJsonRef, jtkHome, loadConfig } from "@jtk/core";
import { command, option, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { runJtk, withMeta } from "./cmd.ts";

export function exportCommand() {
	return withMeta(
		command({
			name: "export",
			description: "export aliases as references only (never values)",
			args: {
				format: option({
					long: "format",
					type: string,
					defaultValue: () => "env-ref",
					description: "env-ref | json-ref",
				}),
			},
			handler: async ({ format }): Promise<Result<string, string>> => {
				if (format !== "env-ref" && format !== "json-ref")
					return err("--format must be env-ref|json-ref (--reveal values arrive with the daemon feature)");
				const home = jtkHome();
				const cfg = await loadConfig(home);
				if (cfg.isErr()) return err(cfg.error);
				const body = format === "env-ref" ? formatEnvRef(cfg.value.aliases) : formatJsonRef(cfg.value.aliases);
				return ok(body.trimEnd());
			},
		}),
		{ reads: ["config"], writes: [], env: ["JTK_HOME"] },
	);
}

export async function runExport(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(exportCommand(), argv);
}
