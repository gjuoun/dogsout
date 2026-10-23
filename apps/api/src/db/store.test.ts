import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openApiDb } from "./client.ts";
import { migrateApiDb, migrationsFolder } from "./migrate.ts";
import { decideAsk, insertAsk, listRecent } from "./store.ts";

function freshDb() {
	const { db, sqlite } = openApiDb(":memory:");
	migrateApiDb(db);
	return { db, sqlite };
}

const KEYS = [{ alias: "gh", address: "dogsout://dev/gh/pat", note: "github.com PAT", value_hash: "aa11" }];

describe("ask_log store", () => {
	test("migration creates ask_log with the schema's columns", () => {
		const { sqlite } = freshDb();
		const cols = sqlite.query("PRAGMA table_info(ask_log)").all() as Array<{ name: string }>;
		expect(cols.map((c) => c.name)).toEqual([
			"id",
			"principal",
			"session_id",
			"requested_at",
			"keys_json",
			"key_count",
			"decision",
			"ttl",
			"decided_at",
			"decided_via",
		]);
	});

	test("insertAsk → listRecent round trip keeps metadata only", () => {
		const { db } = freshDb();
		insertAsk(db, {
			id: "a_1",
			principal: "claude-code@laptop",
			sessionId: "sess_1",
			requestedAt: "2026-10-22T10:00:00Z",
			keys: KEYS,
		});
		const rows = listRecent(db);
		expect(rows.length).toBe(1);
		expect(rows[0]?.principal).toBe("claude-code@laptop");
		expect(rows[0]?.key_count).toBe(1);
		expect(JSON.parse(rows[0]?.keys_json ?? "[]")[0].alias).toBe("gh");
		expect(rows[0]?.decision).toBe("deny");
		expect(rows[0]?.decided_at).toBeNull();
	});

	test("decideAsk records the outcome and the via", () => {
		const { db } = freshDb();
		insertAsk(db, { id: "a_2", principal: "p", requestedAt: "2026-10-22T10:00:00Z", keys: KEYS });
		decideAsk(db, "a_2", { decision: "approve", ttl: "10m", via: "webui", at: "2026-10-22T10:00:30Z" });
		const row = listRecent(db)[0];
		expect(row?.decision).toBe("approve");
		expect(row?.ttl).toBe("10m");
		expect(row?.decided_via).toBe("webui");
		expect(row?.decided_at).toBe("2026-10-22T10:00:30Z");
	});

	test("migrateApiDb is idempotent", () => {
		const { db, sqlite } = openApiDb(":memory:");
		migrateApiDb(db);
		const first = (sqlite.query("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n;
		migrateApiDb(db);
		const second = (sqlite.query("SELECT count(*) AS n FROM __drizzle_migrations").get() as { n: number }).n;
		expect(second).toBe(first);
		// ask_log + webauthn_cred are separate migrations today
		expect(first).toBeGreaterThanOrEqual(2);
	});

	test("the on-disk store is 0600 and lives under DOGSOUT_API_DB", () => {
		const dir = mkdtempSync(join(tmpdir(), "dogsout-api-db-"));
		const path = join(dir, "webui.db");
		try {
			const { db, sqlite } = openApiDb(path);
			migrateApiDb(db);
			sqlite.close();
			expect(statSync(path).mode & 0o777).toBe(0o600);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("migrations folder resolves from this package, not from cwd", () => {
		expect(migrationsFolder().endsWith(join("apps", "api", "drizzle"))).toBe(true);
	});
});
