import { openData } from "@jtk/core";
import { command, flag } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { runJtk, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

export function lsCommand() {
	return withMeta(
		command({
			name: "ls",
			description: "list field addresses without revealing values",
			args: { json: flag({ long: "json", description: "machine-readable vault summary" }) },
			handler: async ({ json }): Promise<Result<string, string>> => {
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const opened = await openData(ctxR.value);
				if (opened.isErr()) return err(opened.error);
				const lines: string[] = [];
				const summary: Record<string, Record<string, string[]>> = {};
				for (const [v, items] of Object.entries(opened.value.data.vaults)) {
					summary[v] = {};
					for (const [i, item] of Object.entries(items)) {
						summary[v][i] = Object.keys(item.fields);
						for (const f of Object.keys(item.fields)) lines.push(`jtk://${v}/${i}/${f}`);
					}
				}
				return ok(json ? JSON.stringify({ vaults: summary }, null, 2) : lines.join("\n"));
			},
		}),
		{ reads: ["vault"], writes: [], env: ["JTK_HOME", "JTK_MASTER"] },
	);
}

export async function runLs(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(lsCommand(), argv);
}
