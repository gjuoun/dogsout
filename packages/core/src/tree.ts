import type { FieldMeta, VaultData } from "@dogsout/type-contracts";
/**
 * One stored field as a path — the shape a SQLite store would keep with `path` as primary key.
 * Today every entry is [vault, item, field]; the type stays variable-depth so a store that keys on
 * a joined path can be checked against the same value/branch invariant. The plaintext value never
 * leaves this module except through `maskHash`, so output is metadata only (PRD red line 1).
 */
export interface PathEntry {
	path: readonly string[];
	address: string;
	value: string;
	updated_at: string;
}

/** The read surface tree/glob/ls share — the seam a future SQLite-backed store implements. */
export interface EntryStore {
	list(): PathEntry[];
	get(path: readonly string[]): PathEntry | undefined;
}

/** Read the vault as a flat, sorted list of path-keyed entries. */
export function vaultStore(data: VaultData): EntryStore {
	const entries: PathEntry[] = [];
	for (const [vault, items] of Object.entries(data.vaults)) {
		for (const [item, meta] of Object.entries(items)) {
			for (const field of Object.keys(meta.fields).sort()) {
				entries.push({
					path: [vault, item, field],
					address: `dogsout://${vault}/${item}/${field}`,
					value: meta.fields[field] ?? "",
					updated_at: meta.updated_at,
				});
			}
		}
	}
	entries.sort((a, b) => a.address.localeCompare(b.address));
	return {
		list: () => entries,
		get: (p) => entries.find((e) => e.path.length === p.length && e.path.every((s, i) => s === p[i])),
	};
}

/**
 * Glob a path against a segment pattern: `*` matches exactly one segment, `**` matches zero or
 * more (so `dev.gh.*` is one level and `dev.**` is the whole subtree), anything else is literal.
 */
export function matchPattern(pattern: readonly string[], path: readonly string[]): boolean {
	function match(pi: number, si: number): boolean {
		if (pi === pattern.length) return si === path.length;
		const seg = pattern[pi];
		if (seg === "**") {
			for (let k = si; k <= path.length; k++) if (match(pi + 1, k)) return true;
			return false;
		}
		if (si >= path.length) return false;
		if (seg !== "*" && seg !== path[si]) return false;
		return match(pi + 1, si + 1);
	}
	return match(0, 0);
}

/** Entries whose path matches the pattern, in address order. */
export function selectEntries(store: EntryStore, pattern: readonly string[]): PathEntry[] {
	return store.list().filter((e) => matchPattern(pattern, e.path));
}

/** "sha256:" + the first 8 hex chars — the same mask `get` prints, never reversible. */
export async function maskHash(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return `sha256:${Buffer.from(digest).toString("hex").slice(0, 8)}`;
}

export async function fieldMeta(entry: PathEntry): Promise<FieldMeta> {
	return {
		address: entry.address,
		value_hash: await maskHash(entry.value),
		bytes: Buffer.byteLength(entry.value, "utf8"),
		updated_at: entry.updated_at,
	};
}
