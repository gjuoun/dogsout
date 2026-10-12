import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { AskRequestSchema, DecisionSchema } from "../../contracts/ask.ts";
import { serve } from "./serve.ts";

const app = new OpenAPIHono();

app.get("/health", (c) => c.json({ ok: true, milestone: "F2-skeleton" }));

/**
 * POST /ask — the approval contract endpoint. F2 skeleton is fail-closed:
 * no human is attached to this process, so every well-formed ask is denied
 * until the daemon (F3) wires the AskChannel chain in.
 */
const askRoute = createRoute({
	method: "post",
	path: "/ask",
	request: {
		body: {
			content: { "application/json": { schema: AskRequestSchema } },
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: DecisionSchema } },
			description: "decision (deny in the F2 skeleton — fail-closed)",
		},
	},
});

app.openapi(askRoute, async (c) => {
	const request = c.req.valid("json");
	void request;
	return c.json({ decision: "deny" } as const, 200);
});

app.doc("/doc", {
	openapi: "3.1.0",
	info: { title: "junethekey", version: "0.1.0", description: "credential broker for AI agents — ask contract (F2)" },
});

export function createServer() {
	return app;
}

// Entry: bun src/api/server.ts [port]
if (import.meta.main) {
	const port = Number(process.argv[2] ?? 8787);
	serve(app, port);
}
