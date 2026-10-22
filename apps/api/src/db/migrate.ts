import { join } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import type { ApiDb } from "./client.ts";

/** Repo-relative so it survives both `cd apps/api && bun test` and the root runner. */
export function migrationsFolder(): string {
	return join(import.meta.dir, "..", "..", "drizzle");
}

/** Idempotent: drizzle records applied migrations in `__drizzle_migrations`. */
export function migrateApiDb(db: ApiDb): void {
	migrate(db, { migrationsFolder: migrationsFolder() });
}
