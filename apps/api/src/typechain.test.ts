import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createClient } from "@hey-api/openapi-ts";
import { openApiDb } from "./db/client.ts";
import { migrateApiDb } from "./db/migrate.ts";
import { openApiDocument } from "./openapi.ts";
import { createServer } from "./server.ts";

const API_DIR = join(import.meta.dir, "..");
const REPO = join(API_DIR, "..", "..");
const SPEC_FILE = join(API_DIR, "openapi.json");
const CHECKED_IN = join(REPO, "packages", "api-client", "src", "generated");

const PLUGINS = ["@hey-api/typescript", "zod", "@hey-api/sdk", "@hey-api/client-fetch"] as const;

function walk(dir: string, base = dir): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...walk(full, base));
		else out.push(relative(base, full));
	}
	return out.sort();
}

const tmpDirs: string[] = [];
afterAll(() => {
	for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe("type chain gate", () => {
	test("openapi.json equals the document the live routes produce", () => {
		const { db, sqlite } = openApiDb(":memory:");
		migrateApiDb(db);
		const fresh = JSON.stringify(openApiDocument(createServer({ db })), null, 2) + "\n";
		sqlite.close();
		expect(fresh).toBe(readFileSync(SPEC_FILE, "utf8"));
	});

	test("checked-in client equals a fresh generation from openapi.json", async () => {
		const out = mkdtempSync(join(tmpdir(), "jtk-codegen-"));
		tmpDirs.push(out);
		await createClient({ input: SPEC_FILE, output: { path: out, clean: true }, plugins: [...PLUGINS] });
		const fresh = walk(out);
		const checked = walk(CHECKED_IN);
		expect(fresh).toEqual(checked);
		for (const rel of fresh) {
			expect(readFileSync(join(out, rel), "utf8")).toBe(readFileSync(join(CHECKED_IN, rel), "utf8"));
		}
	});
});
