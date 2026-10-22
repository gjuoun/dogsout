import type { OpenAPIHono } from "@hono/zod-openapi";
import { upgradeWebSocket } from "hono/bun";
import { subscribe } from "../events/bus.ts";
import { snapshots } from "../events/snapshot.ts";

/**
 * `GET /events` — the WebUI's live channel. Not part of the OpenAPI document (browsers
 * and the generated client do not model a WS upgrade), so it is registered as a plain
 * route next to the documented ones.
 *
 * Every connection gets the current grant/session snapshot first: a panel that connects
 * late is immediately correct instead of waiting for the next change.
 */
export function registerEvents(app: OpenAPIHono, deps: { home: string }): void {
	app.get(
		"/events",
		upgradeWebSocket(() => {
			let unsubscribe: (() => void) | undefined;
			return {
				onOpen(_event, ws) {
					unsubscribe = subscribe((event) => ws.send(JSON.stringify(event)));
					void (async () => {
						for (const event of await snapshots(deps.home)) ws.send(JSON.stringify(event));
					})();
				},
				onClose() {
					unsubscribe?.();
				},
			};
		}),
	);
}
