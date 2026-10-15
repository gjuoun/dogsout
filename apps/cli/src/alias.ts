import { loadConfig, parseAddress, writeConfig } from "@jtk/core";
import { command, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { runJtk, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

export function aliasCommand() {
	return withMeta(
		command({
			name: "alias",
			description: "register an alias for a jtk:// address in config.json",
			args: {
				name: positional({ type: string, displayName: "NAME" }),
				addr: positional({ type: string, displayName: "jtk://vault/item/field" }),
			},
			handler: async ({ name, addr }): Promise<Result<string, string>> => {
				const parsed = parseAddress(addr);
				if (parsed.isErr()) return err(parsed.error);
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const cfg = await loadConfig(ctxR.value.home);
				if (cfg.isErr()) return err(cfg.error);
				cfg.value.aliases[name] = addr;
				const w = await writeConfig(ctxR.value.home, cfg.value);
				if (w.isErr()) return err(w.error);
				return ok(`${name} -> ${addr}`);
			},
		}),
		{ reads: [], writes: ["config"], env: ["JTK_HOME"] },
	);
}

export async function runAlias(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(aliasCommand(), argv);
}
