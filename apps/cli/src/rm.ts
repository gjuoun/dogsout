import { formatAddress, loadConfig, nowIso, openData, refKeyOf, saveData, writeConfig } from "@dogsout/core";
import { command, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { desugarAddress } from "./address-input.ts";
import { fail, runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

export function rmCommand() {
	return withMeta(
		command({
			name: "rm",
			description: "remove one field (a 1password ref if the address is served by one)",
			args: {
				addr: positional({ type: string, displayName: "dogsout://vault/item/field | .vault.item.field" }),
			},
			handler: async ({ addr }): Promise<Result<string, string>> => {
				const parsed = desugarAddress(addr);
				if (parsed.isErr()) return err(parsed.error);
				if (parsed.value.subpath.length > 0) return fail("rm targets a field, not a subpath");
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const key = refKeyOf(formatAddress(parsed.value));
				// A reference is the whole leaf for that address: removing the leaf removes the ref,
				// and no vault is opened to do it.
				if (key !== null) {
					const cfg = await loadConfig(ctxR.value.home);
					if (cfg.isErr()) return err(cfg.error);
					if (cfg.value.refs[key] !== undefined) {
						delete cfg.value.refs[key];
						const w = await writeConfig(ctxR.value.home, cfg.value);
						if (w.isErr()) return err(w.error);
						return ok(`removed ${key} (1password ref)`);
					}
				}
				const opened = await openData(ctxR.value);
				if (opened.isErr()) return err(opened.error);
				const { vault, item, field } = parsed.value;
				const target = opened.value.data.vaults[vault]?.[item];
				if (!target || target.fields[field] === undefined) return fail(`not found: ${addr}`);
				delete target.fields[field];
				target.updated_at = nowIso();
				const saved = await saveData(ctxR.value, opened.value.envelope, opened.value.data);
				if (saved.isErr()) return err(saved.error);
				return ok(`removed ${addr}`);
			},
		}),
		{ reads: ["config"], writes: ["vault", "config"], env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER"] },
	);
}

export async function runRm(argv: string[]): Promise<Result<string, string>> {
	return runDogsout<string>(rmCommand(), argv);
}
