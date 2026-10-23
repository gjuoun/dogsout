#!/usr/bin/env bun
/**
 * Scan the built client assets for server-side markers.
 *
 * The import allowlist (packages/api-client/src/boundary.test.ts) proves the *generated*
 * code is clean; this proves the *bundled* result is. It reads the Nitro client output
 * (`apps/web/.output/public`) — the exact files a browser downloads.
 *
 * Run `bun run --cwd apps/web build` first (the gate does).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = join(import.meta.dir, "..");
const PUBLIC_DIR = join(REPO, "apps", "web", ".output", "public");

const FORBIDDEN: Array<{ marker: string; why: string }> = [
	{ marker: "drizzle-orm", why: "server-only ORM" },
	{ marker: "drizzle-zod", why: "server-only schema" },
	{ marker: "bun:sqlite", why: "server-only database" },
	{ marker: "@dogsout/core", why: "broker engine (vault/policy)" },
	{ marker: "@dogsout/api/", why: "the server app" },
	{ marker: "node:fs", why: "node builtin (unbundlable in a browser)" },
	{ marker: "node:crypto", why: "node builtin (unbundlable in a browser)" },
	{ marker: "node:os", why: "node builtin (unbundlable in a browser)" },
];

function walk(dir: string, base = dir): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...walk(full, base));
		else out.push(relative(base, full));
	}
	return out;
}

if (!statSync(PUBLIC_DIR, { throwIfNoEntry: false })) {
	console.error(
		`BUNDLE-BOUNDARY: FAIL — no build at ${relative(REPO, PUBLIC_DIR)} (run: bun run --cwd apps/web build)`,
	);
	process.exit(1);
}

const files = walk(PUBLIC_DIR).filter((f) => f.endsWith(".js") || f.endsWith(".mjs") || f.endsWith(".css"));
const hits: string[] = [];
for (const file of files) {
	const source = readFileSync(join(PUBLIC_DIR, file), "utf8");
	for (const { marker, why } of FORBIDDEN) {
		if (source.includes(marker)) hits.push(`${file}: ${marker} (${why})`);
	}
}

if (hits.length > 0) {
	for (const hit of hits) console.error(`BUNDLE-BOUNDARY: leak — ${hit}`);
	process.exit(1);
}

console.log(`BUNDLE-BOUNDARY: PASS (${files.length} client assets scanned, ${FORBIDDEN.length} markers)`);
