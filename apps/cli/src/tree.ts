import { buildTree, openData, selectEntries, vaultStore } from "@dogsout/core";
import { command, optional, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { expandPattern } from "./address-input.ts";
import { fail, runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

/** How many leading segments the pattern pinned before its first glob (the subtree root). */
function pinnedDepth(pattern: readonly string[]): number {
	const glob = pattern.findIndex((seg) => seg === "*" || seg === "**");
	return glob === -1 ? pattern.length : glob;
}

/**
 * `dogsout tree [path]` — the vault as a JSON trie for agent consumers: nested maps down to one
 * leaf per field, each leaf carrying metadata (address, value_hash, bytes, updated_at) and never a
 * value. `tree` = vaults, `tree dev` = items, `tree dev.gh` = fields; `*` / `**` glob like `ls`.
 */
export function treeCommand() {
	return withMeta(
		command({
			name: "tree",
			description: "print the vault as a JSON tree of addresses with per-field metadata (no values)",
			args: {
				path: positional({
					type: optional(string),
					displayName: "[vault | vault.item | .vault.item.* | .vault.**]",
				}),
			},
			handler: async ({ path }): Promise<Result<string, string>> => {
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const opened = await openData(ctxR.value);
				if (opened.isErr()) return err(opened.error);
				const store = vaultStore(opened.value.data);
				let entries = store.list();
				let depth = 0;
				if (path !== undefined) {
					const parsed = expandPattern(path);
					if (parsed.isErr()) return err(parsed.error);
					entries = selectEntries(store, parsed.value.pattern);
					if (entries.length === 0 && parsed.value.literalField) return fail(`not found: ${parsed.value.source}`);
					// A full 3-segment field address pins the leaf itself: its own key is the tree root.
					depth = Math.min(pinnedDepth(parsed.value.pattern), 2);
				}
				// The tree is rooted where the pattern pinned it, so `tree dev.gh` is that item, not the vault.
				const scoped = entries.map((entry) => ({ ...entry, path: entry.path.slice(depth) }));
				const built = await buildTree(scoped);
				if (built.isErr()) return err(built.error);
				return ok(JSON.stringify(built.value, null, 2));
			},
		}),
		{ reads: ["vault"], writes: [], env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER"] },
	);
}

export async function runTree(argv: string[]): Promise<Result<string, string>> {
	return runDogsout<string>(treeCommand(), argv);
}
