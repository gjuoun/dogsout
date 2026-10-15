import { openData, removeSlot, vaultPath, writeVaultFile } from "@jtk/core";
import { command, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { ctxFromEnv } from "../context.ts";

/** Remove one unlock slot; the last one is always refused. */
async function slotRmCore(a: { id: string }): Promise<Result<string, string>> {
	const ctxR = ctxFromEnv();
	if (ctxR.isErr()) return err(ctxR.error);
	const opened = await openData(ctxR.value);
	if (opened.isErr()) return err(opened.error);
	const { envelope } = opened.value;
	const next = removeSlot(envelope.file, a.id);
	if (next.isErr()) return err(next.error);
	const w = await writeVaultFile(vaultPath(ctxR.value.home), next.value);
	return w.isErr() ? err(w.error.kind) : ok(`removed slot ${a.id} — ${next.value.slots.length} slot(s) left`);
}

export function vaultSlotRmCommand() {
	return command({
		name: "rm",
		description: "remove an unlock slot (the last slot is refused)",
		args: { id: positional({ type: string, displayName: "SLOT_ID" }) },
		handler: slotRmCore,
	});
}
