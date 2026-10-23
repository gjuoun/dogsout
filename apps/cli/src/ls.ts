import { groupViolations, openData, type PathEntry, scanAddress, selectEntries, vaultStore } from "@dogsout/core";
import { command, flag, optional, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { expandPattern } from "./address-input.ts";
import { defaultIo, fail, type Io, runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

export function lsCommand(io: Io = defaultIo) {
	return withMeta(
		command({
			name: "ls",
			description: "list field addresses without revealing values (optional glob: .vault.item.*, .vault.**)",
			args: {
				path: positional({
					type: optional(string),
					displayName: "[vault.item.field | .vault.item.* | .vault.**]",
				}),
				json: flag({ long: "json", description: "machine-readable vault summary" }),
			},
			handler: async ({ path, json }): Promise<Result<string, string>> => {
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const opened = await openData(ctxR.value);
				if (opened.isErr()) return err(opened.error);
				const store = vaultStore(opened.value.data);
				const selected = path === undefined ? ok<PathEntry[]>(store.list()) : selectFor(path, store);
				if (selected.isErr()) return err(selected.error);
				const entries = selected.value;
				reportViolations(io, store.list());
				const summary: Record<string, Record<string, string[]>> = {};
				for (const entry of entries) {
					const [vault, item, field] = entry.path as [string, string, string];
					summary[vault] ??= {};
					const items = summary[vault] as Record<string, string[]>;
					items[item] ??= [];
					(items[item] as string[]).push(field);
				}
				const text = json ? JSON.stringify({ vaults: summary }, null, 2) : entries.map((e) => e.address).join("\n");
				return ok(text);
			},
		}),
		{ reads: ["vault"], writes: [], env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER"] },
	);
}

/** Entries for the optional glob argument; a literal field address that matches nothing is a miss. */
function selectFor(path: string, store: ReturnType<typeof vaultStore>): Result<PathEntry[], string> {
	const parsed = expandPattern(path);
	if (parsed.isErr()) return err(parsed.error);
	const entries = selectEntries(store, parsed.value.pattern);
	if (entries.length === 0 && parsed.value.literalField) return fail(`not found: ${parsed.value.source}`);
	return ok(entries);
}

/**
 * Legacy charset violations: reported on stderr, never rewritten and never on stdout, so the
 * listing (and `--json`) stays machine-readable. `migrate` reports the plaintext-file half.
 */
function reportViolations(io: Io, entries: readonly PathEntry[]) {
	const groups = groupViolations(entries.flatMap((e) => scanAddress(e.address)));
	if (groups.length === 0) return;
	io.stderr?.(
		`warning: ${groups.length} stored address(es) violate the segment charset [a-z0-9_-] — nothing was changed (get the value, set it at a lowercase address, then rm the old one)`,
	);
	for (const g of groups) io.stderr?.(`  ${g.address} (${g.segments.join(", ")})`);
}

export async function runLs(argv: string[], io: Io = defaultIo): Promise<Result<string, string>> {
	return runDogsout<string>(lsCommand(io), argv);
}
