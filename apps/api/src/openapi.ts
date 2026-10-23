import { AskRequestSchema, DecisionSchema, PendingAskSchema } from "@dogsout/type-contracts";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createSelectSchema } from "drizzle-zod";
// Plain zod, not @hono/zod-openapi's `z` re-export: that re-export shadows the ZodType
// type binding, so schemas built from it are rejected by createRoute's schema type.
import { z } from "zod";
import { askLog } from "./db/schema.ts";

/**
 * The OpenAPI layer: contracts schemas (hand-written, no table) and drizzle-derived
 * schemas (table is the entity source) meet here, once. Every `.meta({ id })` fixes the
 * component name the generated client will use — rename one and `packages/api-client`
 * is stale until `bun run codegen` runs again (there is a drift gate for that).
 */

export const AskRequest = AskRequestSchema.meta({ id: "AskRequest", description: "what an agent asks for" });
export const Decision = DecisionSchema.meta({ id: "Decision", description: "the approver's answer" });
export const PendingAsk = PendingAskSchema.meta({ id: "PendingAsk", description: "an ask waiting for a human" });
export const PendingAskList = z.array(PendingAsk).meta({ id: "PendingAskList" });
export const AskLogRow = createSelectSchema(askLog).meta({ id: "AskLogRow", description: "one recorded ask" });
export const AskLogRowList = z.array(AskLogRow).meta({ id: "AskLogRowList" });
export const Health = z
	.object({ ok: z.boolean(), milestone: z.string(), webui: z.string() })
	.meta({ id: "Health", description: "liveness + which milestone this server is" });
export const Ack = z.object({ ok: z.boolean() }).meta({ id: "Ack" });
export const ErrorBody = z.object({ error: z.string() }).meta({ id: "ErrorBody" });

export const OPENAPI_INFO = {
	openapi: "3.1.0",
	info: {
		title: "dogsout",
		version: "0.1.0",
		description: "credential broker for agents — ask + approval surface (F3 preview)",
	},
} as const;

/**
 * OpenAPI 3.1 is JSON Schema 2020-12, which has no `nullable` keyword: zod-openapi 1.6
 * still emits 3.0-style `nullable: true`, and a generator that only reads JSON Schema
 * (heyapi) then drops the null branch and types a NULL-able column as `string`.
 * Normalize to `type: [X, "null"]` so the published contract and the generated client
 * agree. Pure function, tested.
 */
export function normalizeNullable(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(normalizeNullable);
	if (node === null || typeof node !== "object") return node;
	const obj = node as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		if (key === "nullable") continue;
		out[key] = normalizeNullable(value);
	}
	if (obj.nullable === true) {
		const type = out.type;
		if (typeof type === "string") out.type = [type, "null"];
		else if (Array.isArray(type)) out.type = type.includes("null") ? type : [...type, "null"];
		else {
			const rest = { ...out };
			out.anyOf = [rest, { type: "null" }];
			delete out.type;
		}
	}
	return out;
}

/** Build the published document. One entry point so `/doc` and `openapi.json` cannot diverge. */
export function openApiDocument(app: OpenAPIHono): Record<string, unknown> {
	const doc = app.getOpenAPI31Document(OPENAPI_INFO);
	return normalizeNullable(doc) as Record<string, unknown>;
}
