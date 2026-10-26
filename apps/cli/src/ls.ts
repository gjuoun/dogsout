import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	buildListing,
	groupViolations,
	type ListingNode,
	listingToTrie,
	loadConfig,
	openData,
	type PathEntry,
	refEntries,
	scanAddress,
	selectEntries,
	vaultStore,
} from "@dogsout/core";
import { command, flag, optional, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { expandPattern } from "./address-input.ts";
import { defaultIo, fail, type Io, runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

/** How many leading segments the pattern pinned before its first glob (the listing's root). */
function pinnedDepth(pattern: readonly string[]): number {
	const glob = pattern.findIndex((seg) => seg === "*" || seg === "**");
	return glob === -1 ? pattern.length : glob;
}

/**
 * `dogsout ls [path] [--json]` — one listing, three views, never a value: a TTY gets a connector
 * tree that grows into JSON objects, a pipe gets one jq dot path per leaf (feed it to `get`),
 * and `--json` gets the same structure with metadata leaves / nulls. `*` / `**` glob in every view.
 */
export function lsCommand(io: Io = defaultIo) {
	return withMeta(
		command({
			name: "ls",
			description:
				"list field paths without revealing values (tree on a TTY, one jq path per line when piped; --json for the structure)",
			args: {
				path: positional({
					type: optional(string),
					displayName: "[vault.item.field | .vault.item.* | .vault.**]",
				}),
				json: flag({
					long: "json",
					description: "machine-readable structure: stored fields carry metadata, a JSON object grows with null leaves",
				}),
			},
			handler: async ({ path, json }): Promise<Result<string, string>> => {
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const cfg = await loadConfig(ctxR.value.home);
				if (cfg.isErr()) return err(cfg.error);
				// Two stores, one listing: the refs table is config-only (never a 1Password read), the
				// vault is opened only when this home actually has one.
				const vaultFile = join(ctxR.value.home, "vault.enc");
				const vaultLeafs: PathEntry[] = [];
				if (existsSync(vaultFile)) {
					const opened = await openData(ctxR.value);
					if (opened.isErr()) return err(opened.error);
					vaultLeafs.push(...vaultStore(opened.value.data).list());
				}
				const configMtime = new Date(
					Bun.file(join(ctxR.value.home, "config.json")).lastModified || Date.now(),
				).toISOString();
				const refs = refEntries(cfg.value.refs, configMtime);
				const store = mergedStore(refs, vaultLeafs);
				const selected =
					path === undefined ? ok<Selection>({ entries: store.list(), depth: 0 }) : selectFor(path, store);
				if (selected.isErr()) return err(selected.error);
				const { entries, depth } = selected.value;
				reportViolations(io, store.list());
				// The listing is rooted where the pattern pinned it: no path -> vaults, `dev` -> that vault's items,
				// `.dev.gh` -> that item's fields, `.dev.gh.field` -> the field's own JSON structure.
				const built = await buildListing(entries, depth);
				if (built.isErr()) return err(built.error);
				const roots = built.value;
				if (json) return ok(JSON.stringify(listingToTrie(roots), null, 2));
				return ok(ttyOf(io) ? asTree(roots, depth === 0) : leavesOf(roots).join("\n"));
			},
		}),
		{ reads: ["vault", "config"], writes: [], env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER"] },
	);
}

/**
 * One store over both sources: refs first (they are the authoritative answer for an address), then
 * vault leaves that no ref shadows. Sorted by address so the tree and the pipe view stay stable.
 */
function mergedStore(refs: PathEntry[], vaultLeafs: PathEntry[]): ReturnType<typeof vaultStore> {
	const byAddress = new Map<string, PathEntry>();
	for (const entry of vaultLeafs) byAddress.set(entry.address, entry);
	for (const entry of refs) byAddress.set(entry.address, entry);
	const entries = [...byAddress.values()].sort((a, b) => a.address.localeCompare(b.address));
	return {
		list: () => entries,
		get: (p) => entries.find((e) => e.path.length === p.length && e.path.every((s, i) => s === p[i])),
	};
}

/** The listing plus where it is rooted (0 = vaults, 2 = the field itself). */
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
	// A full 3-segment field address pins the leaf itself: its own key is the listing root.
	return ok({ entries, depth: Math.min(pinnedDepth(parsed.value.pattern), 2) });
}

function ttyOf(io: Io): boolean {
	return io.tty ?? process.stdout.isTTY === true;
}

/**
 * Human view: a connector tree rooted where the path pinned it (vaults keep their leading dot —
 * that is the jq root). Only a stored field holding non-object JSON carries a type note; keys
 * inside a JSON value never do, so the shape reads like the value's own structure.
 */
function asTree(roots: readonly ListingNode[], dotRoots: boolean): string {
	const lines: string[] = [];
	const walk = (nodes: readonly ListingNode[], prefix: string) => {
		nodes.forEach((node, index) => {
			const branch = index === nodes.length - 1 ? "└─ " : "├─ ";
			lines.push(`${prefix}${branch}${node.name}${note(node)}`);
			walk(node.children, `${prefix}   `);
		});
	};
	for (const root of roots) {
		lines.push(`${dotRoots ? "." : ""}${root.name}${note(root)}`);
		walk(root.children, "");
	}
	return lines.join("\n");
}

/** The type note a stored field carries when its value is array / scalar JSON (never a value). */
function note(node: ListingNode): string {
	return node.annotation === undefined ? "" : ` · ${node.annotation}`;
}

/** Machine view: every leaf is a jq dot path, in listing order — `xargs -n1 dogsout get` feeds back. */
function leavesOf(nodes: readonly ListingNode[]): string[] {
	return nodes.flatMap((node) => (node.children.length === 0 ? [node.jq] : leavesOf(node.children)));
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
