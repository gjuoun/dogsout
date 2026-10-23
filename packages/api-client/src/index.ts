/**
 * The only API surface the WebUI imports. Everything here is generated from
 * `apps/api/openapi.json` — no server code, no drizzle, no `@dogsout/core`.
 */

export { client } from "./generated/client.gen.ts";
export * from "./generated/index.ts";
export * from "./generated/zod.gen.ts";

import { client } from "./generated/client.gen.ts";

/** Point the generated SDK at the broker API (`http://127.0.0.1:8787` by default). */
export function configureApi(baseUrl: string): void {
	client.setConfig({ baseUrl });
}
