import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Server, WebSocketHandler } from "bun";

/** Keep the server plumbing tiny and testable: createServer() covers the routes. */
export function serve(app: OpenAPIHono, port: number, websocket?: WebSocketHandler<unknown>) {
	// Hono's bun websocket helper reads the server off the fetch env.
	const fetch = (req: Request, srv: Server<unknown>) => app.fetch(req, { server: srv });
	const server = websocket ? Bun.serve({ port, fetch, websocket }) : Bun.serve({ port, fetch });
	console.log(`jtk api on http://127.0.0.1:${server.port} (/health, /ask, /asks, /doc, /events)`);
	return server;
}
