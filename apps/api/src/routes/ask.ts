import type { AskRequest as AskRequestData, Decision as DecisionData } from "@dogsout/type-contracts";
import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { AskRequest, Decision, ErrorBody } from "../openapi.ts";

const route = createRoute({
	method: "post",
	path: "/ask",
	tags: ["ask"],
	summary: "ask a human to approve keys (blocks until decided, fail-closed on timeout)",
	request: { body: { content: { "application/json": { schema: AskRequest } }, required: true } },
	responses: {
		200: { content: { "application/json": { schema: Decision } }, description: "the approver's decision" },
		400: { content: { "application/json": { schema: ErrorBody } }, description: "malformed ask" },
	},
});

export type AskHandler = (request: AskRequestData, budgetMs: number) => Promise<DecisionData>;

/** Ask budget from `?budget_ms=`, default 120s, clamped to [100ms, 10min]. */
export function askBudget(raw: string | undefined): number {
	const parsed = raw === undefined ? Number.NaN : Number(raw);
	return Number.isFinite(parsed) ? Math.max(100, Math.min(600_000, parsed)) : 120_000;
}

export function registerAsk(app: OpenAPIHono, handle: AskHandler): void {
	app.openapi(route, async (c) => {
		const decision = await handle(c.req.valid("json"), askBudget(c.req.query("budget_ms")));
		return c.json(decision, 200);
	});
}
