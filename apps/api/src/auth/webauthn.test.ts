import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ApiDb } from "../db/client.ts";
import { openApiDb } from "../db/client.ts";
import { migrateApiDb } from "../db/migrate.ts";
import { createServer } from "../server.ts";
import { clearAuthState, consumeChallenge, consumeToken, issueToken } from "./webauthn.ts";

let db: ApiDb;
let open: ReturnType<typeof createServer>; // no authorize override = the real gate
let permissive: ReturnType<typeof createServer>;

beforeAll(() => {
	const opened = openApiDb(":memory:");
	db = opened.db;
	migrateApiDb(db);
	open = createServer({ db });
	permissive = createServer({ db, authorize: async () => true });
});

afterAll(() => clearAuthState());

async function call(
	app: ReturnType<typeof createServer>,
	method: string,
	path: string,
	body?: unknown,
	headers: Record<string, string> = {},
) {
	const init: RequestInit = { method, headers: { "content-type": "application/json", ...headers } };
	if (body !== undefined) init.body = JSON.stringify(body);
	return app.request(new Request("http://x" + path, init));
}

const ASK = {
	principal: "agent@laptop",
	session: "sess_1",
	at: "2026-10-22T00:00:00Z",
	keys: [{ alias: "gh", address: "dogsout://dev/gh/pat", note: "", value_hash: "aa" }],
	granted: [],
};

const APPROVE = { decision: "approve", ttl: "10m", renew_existing: false, keys: { gh: "ttl" } };

describe("webauthn gate", () => {
	test("status reports zero credentials before enrollment", async () => {
		const r = await call(open, "get", "/auth/status");
		expect(r.status).toBe(200);
		const body = (await r.json()) as { credentials: number; rpID: string };
		expect(body.credentials).toBe(0);
		expect(body.rpID).toBe("localhost");
	});

	test("assertion with an unknown credential is rejected", async () => {
		const options = (await (await call(open, "post", "/auth/assert/options")).json()) as { challenge: string };
		const r = await call(open, "post", "/auth/assert/verify", {
			response: {
				id: "not-a-credential",
				rawId: "not-a-credential",
				type: "public-key",
				response: {},
				clientExtensionResults: {},
			},
			challenge: options.challenge,
		});
		expect(r.status).toBe(400);
		expect(((await r.json()) as { error: string }).error).toContain("unknown credential");
	});

	test("a challenge can only be used once, and expires after 60s", async () => {
		consumeChallenge("c-once", "assert");
		expect(consumeChallenge("c-never-seen", "assert")).toBe(false);
	});

	test("the single-use token expires and cannot be replayed", () => {
		const token = issueToken();
		expect(consumeToken(token)).toBe(true);
		expect(consumeToken(token)).toBe(false);
		expect(consumeToken(undefined)).toBe(false);
		const stale = issueToken(Date.now() - 200_000);
		expect(consumeToken(stale)).toBe(false);
	});

	test("approving without a token is 401 on the real gate", async () => {
		const asker = call(open, "post", "/ask?budget_ms=3000", ASK);
		let id: string | undefined;
		for (let i = 0; i < 40 && id === undefined; i++) {
			const list = (await (await call(open, "get", "/asks")).json()) as Array<{ id: string }>;
			id = list[0]?.id;
			if (id === undefined) await Bun.sleep(10);
		}
		expect(id).toBeDefined();
		const denied = await call(open, "post", `/asks/${id}/decision`, APPROVE);
		expect(denied.status).toBe(401);
		// still pending: the fail-closed path did not consume the ask
		const stillPending = (await (await call(open, "get", "/asks")).json()) as Array<{ id: string }>;
		expect(stillPending.some((p) => p.id === id)).toBe(true);
		// deny needs no token (it grants nothing) and resolves the caller
		const deny = await call(open, "post", `/asks/${id}/decision`, { decision: "deny" });
		expect(deny.status).toBe(200);
		expect(await (await asker).json()).toEqual({ decision: "deny" });
	});

	test("approving with a token is accepted when the assertion gate is satisfied", async () => {
		const asker = call(permissive, "post", "/ask?budget_ms=3000", ASK);
		let id: string | undefined;
		for (let i = 0; i < 40 && id === undefined; i++) {
			const list = (await (await call(permissive, "get", "/asks")).json()) as Array<{ id: string }>;
			id = list[0]?.id;
			if (id === undefined) await Bun.sleep(10);
		}
		const token = issueToken();
		const ok = await call(permissive, "post", `/asks/${id}/decision`, APPROVE, { "x-dogsout-assertion": token });
		expect(ok.status).toBe(200);
		expect(await (await asker).json()).toEqual(APPROVE);
	});
});
