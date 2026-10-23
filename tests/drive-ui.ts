#!/usr/bin/env bun
/**
 * Headless drive of the F3-preview approval surface: no browser, no fake decisions.
 *
 * asker (this script) POSTs /ask → the ask blocks → this script plays the human and
 * POSTs the decision the mockup produces → the asker receives it → the asker applies it
 * exactly as the CLI would (core.recordApproval) → the DOGSOUT_HOME watcher pushes
 * grant.changed to the WebSocket. Every frame here is one the browser would render.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { websocket } from "hono/bun";
// The ceremony itself needs a browser (platform authenticator), so this harness mints the
// same single-use token /auth/assert/verify would return and sends it on the decision. The
// real gate rejecting a missing token is covered by apps/api/src/auth/webauthn.test.ts.
import { issueToken } from "../apps/api/src/auth/webauthn.ts";
import { openApiDb } from "../apps/api/src/db/client.ts";
import { migrateApiDb } from "../apps/api/src/db/migrate.ts";
import { createServer } from "../apps/api/src/server.ts";
import { watchHome } from "../apps/api/src/watch.ts";
// Relative package paths: the repo root is not a workspace package, so bare
// `@dogsout/*` specifiers do not resolve from here (tests/e2e.ts drives the CLI instead).
import { recordApproval } from "../packages/core/src/index.ts";
import type { UiEvent } from "../packages/type-contracts/src/index.ts";

let failures = 0;
function check(ok: boolean, name: string, detail: string) {
	if (ok) console.log(`PASS: ${name}`);
	else {
		failures++;
		console.error(`FAIL: ${name} — ${detail}`);
	}
}

const ASK = {
	principal: "claude-code@laptop",
	session: "sess_9f2ac31e",
	at: new Date().toISOString(),
	keys: [
		{ alias: "gh", address: "dogsout://dev/gh/pat", note: "dogsout://dev/gh/pat", value_hash: "aa11bb22cc33" },
		{
			alias: "openai",
			address: "dogsout://dev/openai/key",
			note: "dogsout://dev/openai/key",
			value_hash: "dd44ee55ff66",
		},
		{
			alias: "aws",
			address: "dogsout://staging/aws/secret",
			note: "dogsout://staging/aws/secret",
			value_hash: "77889900aabb",
		},
	],
	granted: [
		{ alias: "hf", status: "剩 47m" },
		{ alias: "gemini", status: "长期·30d衰减" },
	],
};

/** Exactly what the mygo helper (apps/ask) --selftest prints (3 keys). */
const MOCKUP_DECISION = {
	decision: "approve",
	ttl: "10m",
	renew_existing: false,
	keys: { gh: "ttl", openai: "once", aws: "deny" },
} as const;

const home = mkdtempSync(join(tmpdir(), "dogsout-drive-ui-"));
const { db, sqlite } = openApiDb(":memory:");
migrateApiDb(db);
const stopWatch = watchHome(home, 100);
const app = createServer({ db, home });
const server = Bun.serve({ port: 0, fetch: (req, srv) => app.fetch(req, { server: srv }), websocket });
const base = `http://127.0.0.1:${server.port}`;

const frames: UiEvent[] = [];
const ws = new WebSocket(`ws://127.0.0.1:${server.port}/events`);
ws.addEventListener("message", (event) => {
	try {
		frames.push(JSON.parse(String(event.data)) as UiEvent);
	} catch {
		failures++;
	}
});

async function waitFor(name: string, predicate: () => boolean, budgetMs = 4000): Promise<boolean> {
	const deadline = Date.now() + budgetMs;
	while (Date.now() < deadline) {
		if (predicate()) return true;
		await Bun.sleep(25);
	}
	console.error(`FAIL: timed out waiting for ${name} (frames: ${frames.map((f) => f.type).join(",")})`);
	failures++;
	return false;
}

try {
	await waitFor("socket open", () => ws.readyState === WebSocket.OPEN);
	// The socket hands out the current snapshot on connect.
	const gotSnapshot = await waitFor("snapshot frames", () => frames.some((f) => f.type === "grant.changed"));
	check(gotSnapshot, "connect delivers a grant snapshot before any change", frames.map((f) => f.type).join(","));

	// The browser half: the page is served from :5173 and calls :8787 cross-origin, and the
	// approve call carries a custom header — both must survive CORS or the UI is dead.
	const cors = await fetch(`${base}/asks`, { headers: { origin: "http://localhost:5173" } });
	check(
		cors.headers.get("access-control-allow-origin") === "http://localhost:5173",
		"CORS allows the web origin to read /asks",
		String(cors.headers.get("access-control-allow-origin")),
	);
	const preflight = await fetch(`${base}/asks/a_x/decision`, {
		method: "OPTIONS",
		headers: {
			origin: "http://localhost:5173",
			"access-control-request-method": "POST",
			"access-control-request-headers": "content-type,x-dogsout-assertion",
		},
	});
	const allowHeaders = preflight.headers.get("access-control-allow-headers") ?? "";
	check(
		preflight.status === 204 || preflight.status === 200,
		"CORS preflight for the decision route succeeds",
		String(preflight.status),
	);
	check(allowHeaders.includes("x-dogsout-assertion"), "preflight permits the assertion header", allowHeaders);

	const asker = fetch(`${base}/ask?budget_ms=8000`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(ASK),
	});

	const sawPending = await waitFor("ask.pending", () => frames.some((f) => f.type === "ask.pending"));
	check(
		sawPending,
		"POST /ask broadcasts ask.pending with the request",
		JSON.stringify(frames.filter((f) => f.type === "ask.pending")),
	);

	const list = (await (await fetch(`${base}/asks`)).json()) as Array<{ id: string; request: { principal: string } }>;
	const pending = list.find((x) => x.request.principal === ASK.principal);
	check(pending !== undefined, "GET /asks lists the blocked ask", JSON.stringify(list));

	const token = issueToken();
	const decided = await fetch(`${base}/asks/${pending?.id}/decision`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-dogsout-assertion": token },
		body: JSON.stringify(MOCKUP_DECISION),
	});
	check(decided.status === 200, "POST decision is accepted", String(decided.status));

	const answer = (await (await asker).json()) as unknown;
	check(
		JSON.stringify(answer) === JSON.stringify(MOCKUP_DECISION),
		"the blocked asker receives exactly the mockup decision JSON",
		JSON.stringify(answer),
	);

	const sawDecided = await waitFor("ask.decided", () => frames.some((f) => f.type === "ask.decided"));
	const decidedFrame = frames.find((f) => f.type === "ask.decided");
	check(
		sawDecided &&
			JSON.stringify(decidedFrame) ===
				JSON.stringify({
					type: "ask.decided",
					at: (decidedFrame as { at: string }).at,
					id: pending?.id,
					decision: MOCKUP_DECISION,
				}),
		"ask.decided carries the same decision to the panel",
		JSON.stringify(decidedFrame),
	);

	const again = await fetch(`${base}/asks/${pending?.id}/decision`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ decision: "deny" }),
	});
	check(again.status === 404, "a decided ask cannot be decided twice (404)", String(again.status));

	// The asker (the CLI, in production) applies the ttl keys; once keys leave no grant.
	const granted = await recordApproval(
		home,
		{
			principal: ASK.principal,
			alias: "gh",
			address: "dogsout://dev/gh/pat",
			valueHash: "aa11bb22cc33aa11bb22cc33aa11bb22cc33aa11bb22cc33aa11bb22cc33aa11",
			ttl: "10m",
			via: "webui",
			session: ASK.session,
		},
		{ always_decay: "720h" },
	);
	check(granted.isOk(), "asker can record the approved grant", granted.isErr() ? granted.error : "ok");

	const sawGrant = await waitFor("grant.changed after CLI-side write", () =>
		frames.some((f) => f.type === "grant.changed" && f.grants.some((g) => g.alias === "gh")),
	);
	const grantFrame = frames.filter((f) => f.type === "grant.changed").at(-1);
	check(
		sawGrant && JSON.stringify(grantFrame?.type === "grant.changed" ? grantFrame.grants : []) !== "[]",
		"a CLI-side grants.json write reaches the panel as grant.changed",
		JSON.stringify(grantFrame),
	);

	const history = (await (await fetch(`${base}/asks/history`)).json()) as Array<{
		decision: string;
		decided_via: string;
		key_count: number;
	}>;
	check(
		history[0]?.decision === "approve" && history[0]?.decided_via === "webui" && history[0]?.key_count === 3,
		"/asks/history records the decision (approve, via webui, 3 keys)",
		JSON.stringify(history[0]),
	);
} finally {
	ws.close();
	server.stop(true);
	stopWatch();
	sqlite.close();
	rmSync(home, { recursive: true, force: true });
}

console.log(failures === 0 ? "DRIVE-UI: PASS" : `DRIVE-UI: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
