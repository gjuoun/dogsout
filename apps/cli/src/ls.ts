import {
	buildTree,
	groupViolations,
	openData,
	type PathEntry,
	scanAddress,
	selectEntries,
	vaultStore,
} from "@dogsout/core";
import { command, flag, optional, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { expandPattern } from "./address-input.ts";
import { defaultIo, fail, type Io, runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

/** How many leading segments the pattern pinned before its first glob (the JSON trie's root). */
function pinnedDepth(pattern: readonly string[]): number {
	const glob = pattern.findIndex((seg) => seg === "*" || seg === "**");
	return glob === -1 ? pattern.length : glob;
}

/**
 * `dogsout ls [path] [--json]` — field addresses without values, three views of one listing:
 * a TTY gets an indented tree, a pipe gets one canonical address per line (grep/xargs), and
 * `--json` gets the metadata trie agents consume. `*` / `**` glob in every view.
 */
export function lsCommand(io: Io = defaultIo) {
	return withMeta(
		command({
			name: "ls",
			description:
				"list field addresses without revealing values (tree on a TTY, one address per line when piped; --json for metadata)",
			args: {
				path: positional({
					type: optional(string),
					displayName: "[vault.item.field | .vault.item.* | .vault.**]",
				}),
				json: flag({ long: "json", description: "machine-readable trie: leaves carry metadata, never values" }),
			},
			handler: async ({ path, json }): Promise<Result<string, string>> => {
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const opened = await openData(ctxR.value);
				if (opened.isErr()) return err(opened.error);
				const store = vaultStore(opened.value.data);
				const selected =
					path === undefined ? ok<Selection>({ entries: store.list(), depth: 0 }) : selectFor(path, store);
				if (selected.isErr()) return err(selected.error);
				const { entries, depth } = selected.value;
				reportViolations(io, store.list());
				// The trie is rooted where the pattern pinned it, so `ls --json dev.gh` is that item, not the vault.
				if (json) {
					const scoped = entries.map((entry) => ({ ...entry, path: entry.path.slice(depth) }));
					const built = await buildTree(scoped);
					if (built.isErr()) return err(built.error);
					return ok(JSON.stringify(built.value, null, 2));
				}
				// TTY: indented tree (human view); pipe/redirect: one canonical address per line.
				const text = ttyOf(io) ? asTree(entries) : entries.map((e) => e.address).join("\n");
				return ok(text);
			},
		}),
		{ reads: ["vault"], writes: [], env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER"] },
	);
}

/** The listing plus where its JSON trie is rooted (0 = vaults, 2 = the field itself). */
interface Selection {
	entries: PathEntry[];
	depth: number;
}

/** Entries for the optional glob argument; a literal field address that matches nothing is a miss. */
function selectFor(path: string, store: ReturnType<typeof vaultStore>): Result<Selection, string> {
	const parsed = expandPattern(path);
	if (parsed.isErr()) return err(parsed.error);
	const entries = selectEntries(store, parsed.value.pattern);
	if (entries.length === 0 && parsed.value.literalField) return fail(`not found: ${parsed.value.source}`);
	// A full 3-segment field address pins the leaf itself: its own key is the trie root.
	return ok({ entries, depth: Math.min(pinnedDepth(parsed.value.pattern), 2) });
}

function ttyOf(io: Io): boolean {
	return io.tty ?? process.stdout.isTTY === true;
}

/** vault -> item -> field, dot-prefixed and indented — readable, not parseable (use the pipe view). */
function asTree(entries: readonly PathEntry[]): string {
	// compact tree: fields fold inline onto their item line (leaves are often just 1-2);
	// a bare item keeps its own line so structure never collapses.
	const inline = (fields: string[]) => {
		const shown = fields.slice(0, 3).join(", ");
		return fields.length > 3 ? `${shown} +${fields.length - 3}` : shown;
	};
	const lines: string[] = [];
	const vaults = [...groupBy(entries).entries()];
	vaults.forEach(([vault, items], vi) => {
		const vLast = vi === vaults.length - 1;
		lines.push(`.${vault}`);
		const itemEntries = Object.entries(items);
		itemEntries.forEach(([item, fields], ii) => {
			const iLast = ii === itemEntries.length - 1;
			const branch = vLast ? (iLast ? "  └─ " : "  ├─ ") : iLast ? "│ └─ " : "│ ├─ ";
			lines.push(`${branch}${item}${fields.length > 0 ? ` · ${inline(fields)}` : ""}`);
		});
	});
	return lines.join("\n");
}

function groupBy(entries: readonly PathEntry[]): Map<string, Record<string, string[]>> {
	const summary = new Map<string, Record<string, string[]>>();
	for (const entry of entries) {
		const [vault, item, field] = entry.path as [string, string, string];
		const items = summary.get(vault) ?? {};
		items[item] ??= [];
		(items[item] as string[]).push(field);
		summary.set(vault, items);
	}
	return summary;
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
