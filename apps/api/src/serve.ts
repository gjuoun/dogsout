import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Server, WebSocketHandler } from "bun";
import type { BunWebSocketData, BunWebSocketHandler } from "hono/bun";

/** Keep the server plumbing tiny and testable: createServer() covers the routes. */
export function serve(app: OpenAPIHono, port: number, websocket?: BunWebSocketHandler<BunWebSocketData>) {
	// Hono's bun websocket helper reads the server off the fetch env. Runtime-compatible
	// with Bun.serve's handler (verified live); the cast bridges hono's data generic.
	const fetch = (req: Request, srv: Server<unknown>) => app.fetch(req, { server: srv });
	const server = websocket
		? Bun.serve({ port, fetch, websocket: websocket as unknown as WebSocketHandler<unknown> })
		: Bun.serve({ port, fetch });
	console.log(`jtk api on http://127.0.0.1:${server.port} (/health, /ask, /asks, /doc, /events)`);
	return server;
}
