import type { Serve } from "bun";

/** Keep the server plumbing tiny and testable: createServer() covers the routes. */
export function serve(app: { fetch: (req: Request) => Response | Promise<Response> }, port: number) {
	const server = Bun.serve({ port, fetch: (req) => app.fetch(req) });
	console.log("jtk api skeleton on http://127.0.0.1:" + server.port + " (/health, /ask, /doc)");
	return server;
}
