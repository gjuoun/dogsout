import { describe, expect, test } from "bun:test";
import { createServer } from "./server.ts";

const app = createServer();

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

	test("GET /doc exposes the ask contract (neutral OpenAPI boundary)", async () => {
		const r = await call("get", "/doc");
		expect(r.status).toBe(200);
		const doc = (await r.json()) as { paths?: Record<string, unknown> };
		expect(Object.keys(doc.paths ?? {})).toContain("/ask");
	});

	test("POST /ask validates and fail-closed denies in the skeleton", async () => {
		const ok1 = await call("post", "/ask", REQ);
		expect(ok1.status).toBe(200);
		expect(await ok1.json()).toEqual({ decision: "deny" });

		const bad = await call("post", "/ask", { principal: "x" });
		expect(bad.status).toBe(400);
	});
});
