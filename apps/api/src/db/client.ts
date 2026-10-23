import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { dogsoutHome } from "@dogsout/core";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

/** `DOGSOUT_API_DB` overrides the store (`:memory:` for tests). Default lives beside the vault. */
export function apiDbPath(): string {
	return process.env.DOGSOUT_API_DB ?? join(dogsoutHome(), "webui.db");
}

export type ApiDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Open (and create) the WebUI store. 0600 + WAL: the file never holds a value, but it
 * does hold who asked for what, so it gets the same permission discipline as grants.json.
 */
export function openApiDb(path: string = apiDbPath()): { db: ApiDb; sqlite: Database } {
	const inMemory = path === ":memory:";
	if (!inMemory) mkdirSync(dirname(path), { recursive: true });
	const sqlite = new Database(path, { create: true });
	sqlite.exec("PRAGMA journal_mode = WAL");
	sqlite.exec("PRAGMA foreign_keys = ON");
	if (!inMemory) chmodSync(path, 0o600);
	return { db: drizzle(sqlite, { schema }), sqlite };
}
