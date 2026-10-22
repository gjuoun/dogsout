#!/usr/bin/env bun
/**
 * Generate the client artifacts from the published OpenAPI 3.1 contract.
 *
 * Input is the checked-in `apps/api/openapi.json` (written by `bun run openapi:write`
 * from the live Hono app), never a running server: codegen has to work offline and in CI.
 * Output is committed; `apps/api/src/typechain.test.ts` fails when it drifts.
 */
import { join } from "node:path";
import { createClient } from "@hey-api/openapi-ts";

const repoRoot = join(import.meta.dir, "..");

await createClient({
	input: join(repoRoot, "apps/api/openapi.json"),
	output: { path: join(repoRoot, "packages/api-client/src/generated"), clean: true },
	plugins: ["@hey-api/typescript", "zod", "@hey-api/sdk", "@hey-api/client-fetch"],
});

console.log("codegen: packages/api-client/src/generated");
