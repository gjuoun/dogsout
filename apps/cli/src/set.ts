import { formatAddress, nowIso, openData, parseAddress, saveData } from "@dogsout/core";
import { command, flag, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { defaultIo, fail, type Io, runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

export function setCommand(io: Io = defaultIo) {
	return withMeta(
		command({
			name: "set",
			description: "store a secret from stdin at a dogsout:// address",
			args: {
				addr: positional({ type: string, displayName: "dogsout://vault/item/field" }),
				stdin: flag({ long: "stdin", description: "value is read from stdin (default behavior)" }),
			},
			handler: async ({ addr }): Promise<Result<string, string>> => {
				const parsed = parseAddress(addr);
				if (parsed.isErr()) return err(parsed.error);
				const value = (await io.stdin()).replace(/\n$/, "");
				if (value.length === 0) return fail("empty value refused");
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const opened = await openData(ctxR.value);
				if (opened.isErr()) return err(opened.error);
				const { envelope, data } = opened.value;
				const { vault, item, field } = parsed.value;
				data.vaults[vault] ??= {};
				const items = data.vaults[vault];
				if (!items[item]) items[item] = { fields: {}, updated_at: nowIso() };
				items[item].fields[field] = value;
				items[item].updated_at = nowIso();
				const saved = await saveData(ctxR.value, envelope, data);
				if (saved.isErr()) return err(saved.error);
				return ok(`set ${formatAddress(parsed.value)}`);
			},
		}),
		{ reads: [], writes: ["vault"], env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER"] },
	);
}

export async function runSet(argv: string[], io: Io = defaultIo): Promise<Result<string, string>> {
	return runDogsout<string>(setCommand(io), argv);
}
