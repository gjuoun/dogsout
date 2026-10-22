import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openApiDb } from "./db/client.ts";
import { migrateApiDb } from "./db/migrate.ts";
import { openApiDocument } from "./openapi.ts";
import { createServer } from "./server.ts";

/** Idempotent: writes the same bytes for the same routes. `bun run codegen` consumes it. */
const { db, sqlite } = openApiDb(":memory:");
migrateApiDb(db);
const doc = openApiDocument(createServer({ db }));
const out = join(import.meta.dir, "..", "openapi.json");
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
sqlite.close();
console.log("wrote " + out);
