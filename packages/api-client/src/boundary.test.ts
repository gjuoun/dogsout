import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * The generated artifacts are the *only* thing the browser imports from this package's
 * chain. If a generator ever emits a server import (drizzle, bun:sqlite, @dogsout/core), the
 * client bundle would start failing or — worse — silently grow a server dependency.
 * This test is the structural gate the plan calls "bundle has zero server imports";
 * the built-asset scan (`bun run check:bundle`) covers the other half.
 */
const GENERATED = join(import.meta.dir, "generated");

/** Relative imports plus exactly one bare package (the zod runtime). Nothing else. */
const ALLOWED_BARE = new Set(["zod"]);
const FORBIDDEN = [
	/^drizzle-orm/,
	/^drizzle-zod/,
	/^bun:/,
	/^node:/,
	/^@dogsout\/core$/,
	/^@dogsout\/api$/,
	/^@dogsout\/type-contracts$/,
];

function walk(dir: string, base = dir): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...walk(full, base));
		else if (full.endsWith(".ts")) out.push(relative(base, full));
	}
	return out;
}

function importsOf(source: string): string[] {
	const out: string[] = [];
	for (const match of source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) {
		const spec = match[1];
		if (spec !== undefined) out.push(spec);
	}
	return out;
}

describe("generated client boundary", () => {
	test("generation produced the expected artifacts", () => {
		const files = walk(GENERATED);
		for (const expected of ["index.ts", "sdk.gen.ts", "types.gen.ts", "zod.gen.ts", "client.gen.ts"]) {
			expect(files).toContain(expected);
		}
	});

	test("every import is relative or the zod runtime — no server package can sneak in", () => {
		const violations: string[] = [];
		for (const file of walk(GENERATED)) {
			for (const spec of importsOf(readFileSync(join(GENERATED, file), "utf8"))) {
				if (spec.startsWith(".")) continue;
				if (ALLOWED_BARE.has(spec)) continue;
				if (FORBIDDEN.some((re) => re.test(spec))) violations.push(`${file} -> ${spec}`);
				else violations.push(`${file} -> ${spec} (not in allowlist)`);
			}
		}
		expect(violations).toEqual([]);
	});
});
