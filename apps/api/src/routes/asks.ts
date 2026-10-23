import type { Decision } from "@dogsout/type-contracts";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import type { ApiDb } from "../db/client.ts";
import { decideAsk, listRecent } from "../db/store.ts";
import { AskLogRowList, Decision as DecisionSchema, ErrorBody, PendingAskList } from "../openapi.ts";
import { listPending, takePending } from "../pending.ts";

const listRoute = createRoute({
	method: "get",
	path: "/asks",
	tags: ["ask"],
	summary: "asks waiting for a human decision",
	responses: {
		200: { content: { "application/json": { schema: PendingAskList } }, description: "pending asks, oldest first" },
	},
});

const decideRoute = createRoute({
	method: "post",
	path: "/asks/{id}/decision",
	tags: ["ask"],
	summary: "answer a pending ask (the blocked POST /ask resolves with this)",
	request: {
		params: z.object({ id: z.string().min(1) }),
		body: { content: { "application/json": { schema: DecisionSchema } }, required: true },
	},
	responses: {
		200: { content: { "application/json": { schema: DecisionSchema } }, description: "the decision that was applied" },
		401: { content: { "application/json": { schema: ErrorBody } }, description: "missing or invalid human assertion" },
		404: {
			content: { "application/json": { schema: ErrorBody } },
			description: "no such pending ask (decided already, or timed out)",
		},
	},
});

const historyRoute = createRoute({
	method: "get",
	path: "/asks/history",
	tags: ["ask"],
	summary: "recent asks and their outcomes (append-only log)",
	request: { query: z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }) },
	responses: {
		200: { content: { "application/json": { schema: AskLogRowList } }, description: "newest first" },
	},
});

export interface AsksDeps {
	db: ApiDb;
	/** Gate a decision behind the human assertion (WebAuthn). Omitted = open (tests only). */
	authorize?: ((request: Request, decision: Decision) => Promise<boolean>) | undefined;
	/** Called after a decision is applied so the socket hears it. */
	onDecided?: ((id: string, decision: Decision) => void) | undefined;
}

export function registerAsks(app: OpenAPIHono, deps: AsksDeps): void {
	app.openapi(listRoute, (c) =>
		c.json(
			listPending().map((p) => ({ id: p.id, at: p.at, request: p.request })),
			200,
		),
	);

	app.openapi(decideRoute, async (c) => {
		const { id } = c.req.valid("param");
		const decision = c.req.valid("json");
		if (deps.authorize && !(await deps.authorize(c.req.raw, decision))) {
			return c.json({ error: "human assertion required" }, 401);
		}
		const entry = takePending(id);
		if (!entry) {
			return c.json({ error: "no pending ask: " + id }, 404);
		}
		const at = new Date().toISOString();
		decideAsk(deps.db, id, {
			decision: decision.decision,
			ttl: decision.decision === "approve" ? decision.ttl : undefined,
			via: "webui",
			at,
		});
		entry.settle(
			decision.decision === "approve"
				? { decision: "approve", ttl: decision.ttl, keys: decision.keys }
				: { decision: "deny" },
		);
		deps.onDecided?.(id, decision);
		return c.json(decision, 200);
	});

	app.openapi(historyRoute, (c) => {
		const { limit } = c.req.valid("query");
		return c.json(listRecent(deps.db, limit ?? 50), 200);
	});
}
