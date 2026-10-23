import { formatAddress, loadConfig, writeConfig } from "@dogsout/core";
import { command, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { desugarAddress } from "./address-input.ts";
import { runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

export function aliasCommand() {
	return withMeta(
		command({
			name: "alias",
			description: "register an alias for a dogsout:// address in config.json",
			args: {
				name: positional({ type: string, displayName: "NAME" }),
				addr: positional({ type: string, displayName: "dogsout://vault/item/field | .vault.item.field" }),
			},
			handler: async ({ name, addr }): Promise<Result<string, string>> => {
				const parsed = desugarAddress(addr, { strict: true });
				if (parsed.isErr()) return err(parsed.error);
				// Store the canonical form, whatever sugar the caller used.
				const canonical = formatAddress(parsed.value);
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const cfg = await loadConfig(ctxR.value.home);
				if (cfg.isErr()) return err(cfg.error);
				cfg.value.aliases[name] = canonical;
				const w = await writeConfig(ctxR.value.home, cfg.value);
				if (w.isErr()) return err(w.error);
				return ok(`${name} -> ${canonical}`);
			},
		}),
		{ reads: [], writes: ["config"], env: ["DOGSOUT_HOME"] },
	);
}

export async function runAlias(argv: string[]): Promise<Result<string, string>> {
	return runDogsout<string>(aliasCommand(), argv);
}
