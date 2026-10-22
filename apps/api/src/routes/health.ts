import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { Health } from "../openapi.ts";

const route = createRoute({
	method: "get",
	path: "/health",
	tags: ["meta"],
	summary: "liveness + milestone",
	responses: {
		200: { content: { "application/json": { schema: Health } }, description: "the server is up" },
	},
});

export function registerHealth(app: OpenAPIHono): void {
	app.openapi(route, (c) => c.json({ ok: true, milestone: "F3-preview", webui: "preview" }, 200));
}
