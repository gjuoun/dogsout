import { beforeAll, describe, expect, test } from "bun:test";
import type { ApiDb } from "./db/client.ts";
import { openApiDb } from "./db/client.ts";
import { migrateApiDb } from "./db/migrate.ts";
import { normalizeNullable } from "./openapi.ts";
import { createServer } from "./server.ts";

let db: ApiDb;
let app: ReturnType<typeof createServer>;

beforeAll(() => {
	const opened = openApiDb(":memory:");
	db = opened.db;
	migrateApiDb(db);
	app = createServer({ db, authorize: async () => true });
});

async function call(method: string, path: string, body?: unknown): Promise<Response> {
	const init: RequestInit = { method, headers: { "content-type": "application/json" } };
	if (body !== undefined) init.body = JSON.stringify(body);
	return app.request(new Request("http://x" + path, init));
}

const REQ = {
	principal: "agent@laptop",
	session: "sess_1",
	at: "2026-10-10T00:00:00Z",
	keys: [{ alias: "gh", address: "jtk://dev/gh/pat", note: "", value_hash: "aa" }],
	granted: [],
};

describe("api skeleton", () => {
	test("GET /health", async () => {
		const r = await call("get", "/health");
		expect(r.status).toBe(200);
		expect(await r.json()).toMatchObject({ ok: true });
	});

	test("GET /doc is OpenAPI 3.1 and covers every route", async () => {
		const r = await call("get", "/doc");
		expect(r.status).toBe(200);
		const doc = (await r.json()) as {
			openapi?: string;
			paths?: Record<string, unknown>;
			components?: { schemas?: Record<string, unknown> };
		};
		expect(doc.openapi).toBe("3.1.0");
		expect(Object.keys(doc.paths ?? {})).toEqual(
			expect.arrayContaining(["/health", "/ask", "/asks", "/asks/{id}/decision", "/asks/history"]),
		);
		const schemas = Object.keys(doc.components?.schemas ?? {});
		expect(schemas).toEqual(
			expect.arrayContaining(["AskRequest", "Decision", "AskLogRow", "AskLogRowList", "PendingAskList"]),
		);
	});

	test("/doc has no 3.0-only nullable keyword (generated client would drop the null branch)", async () => {
		const r = await call("get", "/doc");
		const text = await r.text();
		expect(text.includes('"nullable"')).toBe(false);
	});

	test("POST /ask with nobody answering times out to deny (fail-closed)", async () => {
		const ok1 = await call("post", "/ask?budget_ms=100", REQ);
		expect(ok1.status).toBe(200);
		expect(await ok1.json()).toEqual({ decision: "deny" });

		const bad = await call("post", "/ask?budget_ms=100", { principal: "x" });
		expect(bad.status).toBe(400);
	});

	test("POST /ask → GET /asks → decision resolves the blocked caller", async () => {
		const pending = call("post", "/ask?budget_ms=5000", REQ);
		let id: string | undefined;
		for (let i = 0; i < 50 && id === undefined; i++) {
			const r = await call("get", "/asks");
			const list = (await r.json()) as Array<{ id: string; request: { principal: string } }>;
			id = list.find((x) => x.request.principal === REQ.principal)?.id;
			if (id === undefined) await Bun.sleep(10);
		}
		expect(id).toBeDefined();

		const decided = await call("post", `/asks/${id}/decision`, {
			decision: "approve",
			ttl: "10m",
			renew_existing: false,
			keys: { gh: "ttl" },
		});
		expect(decided.status).toBe(200);

		const answer = (await (await pending).json()) as Record<string, unknown>;
		expect(answer).toEqual({ decision: "approve", ttl: "10m", renew_existing: false, keys: { gh: "ttl" } });

		const again = await call("post", `/asks/${id}/decision`, { decision: "deny" });
		expect(again.status).toBe(404);
	});

	test("GET /asks is empty until something is waiting", async () => {
		const r = await call("get", "/asks");
		expect(r.status).toBe(200);
		expect(await r.json()).toEqual([]);
	});

	test("POST /asks/{id}/decision on an unknown ask is 404 (fail-closed)", async () => {
		const r = await call("post", "/asks/a_missing/decision", { decision: "deny" });
		expect(r.status).toBe(404);
	});

	test("GET /asks/history returns the recorded ask, newest first", async () => {
		await call("post", "/ask?budget_ms=100", REQ);
		const r = await call("get", "/asks/history?limit=5");
		expect(r.status).toBe(200);
		const rows = (await r.json()) as Array<{ decision: string; decided_via: string; key_count: number }>;
		expect(rows.length).toBeGreaterThan(0);
		expect(rows[0]?.decision).toBe("deny");
		expect(rows[0]?.key_count).toBe(1);
		expect(["timeout", "webui"]).toContain(rows[0]?.decided_via ?? "");
	});
});

describe("normalizeNullable", () => {
	test("rewrites 3.0 nullable into a 3.1 type union", () => {
		const out = normalizeNullable({ type: "string", nullable: true }) as Record<string, unknown>;
		expect(out).toEqual({ type: ["string", "null"] });
	});

	test("recurses through arrays and objects", () => {
		const out = normalizeNullable({
			properties: { a: { type: "string", nullable: true }, b: { type: "integer" } },
			items: [{ type: "string", nullable: true }],
		}) as Record<string, unknown>;
		const props = out.properties as Record<string, Record<string, unknown>>;
		expect(props.a).toEqual({ type: ["string", "null"] });
		expect(props.b).toEqual({ type: "integer" });
		const items = out.items as Array<Record<string, unknown>>;
		expect(items[0]).toEqual({ type: ["string", "null"] });
	});

	test("a nullable without a type becomes an anyOf with a null branch", () => {
		const out = normalizeNullable({ nullable: true, enum: ["a"] }) as Record<string, unknown>;
		expect(out.anyOf).toEqual([{ enum: ["a"] }, { type: "null" }]);
	});
});
