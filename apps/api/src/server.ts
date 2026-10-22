import { OpenAPIHono } from "@hono/zod-openapi";
import { jtkHome } from "@jtk/core";
import { type AskRequest, DEFAULT_TTL, type Decision, type KeyChoice } from "@jtk/type-contracts";
import { cors } from "hono/cors";
import { consumeToken } from "./auth/webauthn.ts";
import type { ApiDb } from "./db/client.ts";
import { openApiDb } from "./db/client.ts";
import { migrateApiDb } from "./db/migrate.ts";
import { decideAsk, insertAsk } from "./db/store.ts";
import { broadcast } from "./events/bus.ts";
import { openApiDocument } from "./openapi.ts";
import { addPending, type PendingOutcome, takePending } from "./pending.ts";
import { type AskHandler, registerAsk } from "./routes/ask.ts";
import { registerAsks } from "./routes/asks.ts";
import { registerAuth } from "./routes/auth.ts";
import { registerEvents } from "./routes/events.ts";
import { registerHealth } from "./routes/health.ts";
import { serve } from "./serve.ts";
import { watchHome } from "./watch.ts";

export interface ServerOptions {
	/** Caller owns the store (and runs migrations): keeps the app testable with `:memory:`. */
	db: ApiDb;
	/** Broker home (grants.json / sessions.json). Defaults to `JTK_HOME` / ~/.config/junethekey. */
	home?: string;
	/** Human-assertion gate for decisions; omitted in unit tests, wired to WebAuthn in main. */
	authorize?: ((request: Request, decision: Decision) => Promise<boolean>) | undefined;
}

/**
 * The F3 daemon seed. Routes are declared with `createRoute` so `/doc` is generated,
 * never hand-maintained; `/doc` and `openapi.json` come from the same builder.
 *
 * The approval flow is a long poll: POST /ask blocks while the ask sits in the pending
 * registry, a human answers POST /asks/{id}/decision, and the blocked caller gets the
 * decision. No human, no decision: the budget expires and the ask is recorded as a
 * timeout-deny (PRD red line 3 — fail closed).
 */
export function createServer(options: ServerOptions) {
	const { db } = options;
	const home = options.home ?? jtkHome();
	const app = new OpenAPIHono();

	app.use(
		"*",
		cors({
			origin: process.env.JTK_WEB_ORIGIN ?? "http://localhost:5173",
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: ["content-type", "x-jtk-assertion"],
		}),
	);

	registerHealth(app);
	registerAuth(app, { db });

	const handleAsk: AskHandler = async (request: AskRequest, budgetMs: number): Promise<Decision> => {
		const id = "a_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
		const at = new Date().toISOString();
		insertAsk(db, {
			id,
			principal: request.principal,
			sessionId: request.session,
			requestedAt: request.at,
			keys: request.keys,
		});
		broadcast({ type: "ask.pending", at, ask: { id, at, request } });

		const outcome = await new Promise<PendingOutcome>((resolve) => {
			const timer = setTimeout(() => {
				if (!takePending(id)) return; // a human answered first
				const decidedAt = new Date().toISOString();
				decideAsk(db, id, { decision: "deny", via: "timeout", at: decidedAt });
				broadcast({ type: "ask.decided", at: decidedAt, id, decision: { decision: "deny" } });
				resolve({ decision: "deny" });
			}, budgetMs);
			addPending({
				id,
				at,
				request,
				settle: (settled) => {
					clearTimeout(timer);
					resolve(settled);
				},
			});
		});

		if (outcome.decision === "deny") return { decision: "deny" };
		// Fail closed per key: anything the approver did not explicitly allow is denied.
		const keys: Record<string, KeyChoice> = {};
		for (const key of request.keys) keys[key.alias] = outcome.keys?.[key.alias] ?? "deny";
		return { decision: "approve", ttl: outcome.ttl ?? DEFAULT_TTL, renew_existing: false, keys };
	};

	registerAsk(app, handleAsk);
	registerAsks(app, {
		db,
		// Denying needs no human proof (it grants nothing); approving does. No token, no approval.
		authorize:
			options.authorize ??
			(async (request, decision) =>
				decision.decision === "deny" || consumeToken(request.headers.get("x-jtk-assertion") ?? undefined)),
		onDecided: (id, decision) => broadcast({ type: "ask.decided", at: new Date().toISOString(), id, decision }),
	});
	registerEvents(app, { home });

	app.get("/doc", (c) => c.json(openApiDocument(app)));
	return app;
}

// Entry: bun src/server.ts [port]
if (import.meta.main) {
	const port = Number(process.argv[2] ?? 8787);
	const { db } = openApiDb();
	migrateApiDb(db);
	const home = jtkHome();
	watchHome(home);
	// Same wiring drive:ui uses: without the hono/bun websocket handler the /events
	// upgrade never reaches the route and the agent panel gets no frames.
	const { websocket } = await import("hono/bun");
	serve(createServer({ db, home }), port, websocket);
}
