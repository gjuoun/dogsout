import { nowIso, openData, parseAddress, saveData } from "@jtk/core";
import { command, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { fail, runJtk, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

export function rmCommand() {
	return withMeta(
		command({
			name: "rm",
			description: "remove one field",
			args: { addr: positional({ type: string, displayName: "jtk://vault/item/field" }) },
			handler: async ({ addr }): Promise<Result<string, string>> => {
				const parsed = parseAddress(addr);
				if (parsed.isErr()) return err(parsed.error);
				if (parsed.value.subpath.length > 0) return fail("rm targets a field, not a subpath");
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
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
		{ reads: [], writes: ["vault"], env: ["JTK_HOME", "JTK_MASTER"] },
	);
}

export async function runRm(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(rmCommand(), argv);
}
