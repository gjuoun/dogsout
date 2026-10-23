/** .env line classification for import-env / export round-trips (spec §5.6). */
export interface EnvLine {
	key: string;
	value: string;
}

export interface ImportPlan {
	directs: EnvLine[];
	refs: EnvLine[];
	skipped: EnvLine[];
	/** Pre-rename `jtk://` refs: never a literal, never a ref — the caller must fail closed. */
	legacy: EnvLine[];
}

/**
 * Classify .env lines. `dogsout://` is a vault ref, `op://` is skipped (F6 adapter),
 * `jtk://` is the pre-2026-10-23 address scheme: a stale ref must not be silently
 * imported as a literal value (that would mint a second copy of a secret), so it lands
 * in `legacy` and every caller refuses loudly.
 */
export function parseEnvFile(text: string): ImportPlan {
	const plan: ImportPlan = { directs: [], refs: [], skipped: [], legacy: [] };
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq);
		const value = trimmed.slice(eq + 1);
		if (value.startsWith("dogsout://")) plan.refs.push({ key, value });
		else if (value.startsWith("jtk://")) plan.legacy.push({ key, value });
		else if (value.startsWith("op://")) plan.skipped.push({ key, value });
		else plan.directs.push({ key, value });
	}
	return plan;
}

export function formatEnvRef(aliases: Record<string, string>): string {
	return (
		Object.keys(aliases)
			.sort()
			.map((k) => `${k}=${aliases[k] ?? ""}`)
			.join("\n") + "\n"
	);
}

export function formatJsonRef(aliases: Record<string, string>): string {
	const sorted: Record<string, string> = {};
	for (const k of Object.keys(aliases).sort()) {
		const v = aliases[k];
		if (v !== undefined) sorted[k] = v;
	}
	return JSON.stringify(sorted, null, 2) + "\n";
}
