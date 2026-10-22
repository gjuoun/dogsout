import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import {
	authConfig,
	authenticationOptions,
	credentialCount,
	registrationOptions,
	verifyAssertion,
	verifyRegistration,
} from "../auth/webauthn.ts";
import type { ApiDb } from "../db/client.ts";
import { ErrorBody } from "../openapi.ts";

/**
 * WebAuthn enrollment + assertion. Options are the library's JSON (pass-through), so the
 * schemas are intentionally loose: the contract that matters is the *verify* response and
 * the single-use token it hands back.
 */

export const AuthStatus = z
	.object({ credentials: z.number().int(), rpID: z.string(), origins: z.array(z.string()) })
	.meta({ id: "AuthStatus", description: "is this browser allowed to approve, and against which RP" });
export const RegistrationOptions = z
	.object({ options: z.unknown(), challenge: z.string() })
	.meta({ id: "RegistrationOptionsWrap", description: "pass-through of PublicKeyCredentialCreationOptionsJSON" });
export const AuthenticationOptions = z
	.object({ options: z.unknown(), challenge: z.string() })
	.meta({ id: "AuthenticationOptionsWrap", description: "pass-through of PublicKeyCredentialRequestOptionsJSON" });
export const VerifyRegistrationBody = z
	.object({ response: z.looseObject({}), challenge: z.string().min(1) })
	.meta({ id: "VerifyRegistrationBody" });
export const VerifyAssertionBody = z
	.object({ response: z.looseObject({}), challenge: z.string().min(1) })
	.meta({ id: "VerifyAssertionBody" });
export const VerifyRegistrationResult = z
	.object({ verified: z.boolean(), error: z.string().optional() })
	.meta({ id: "VerifyRegistrationResult" });
export const AssertionResult = z
	.object({ verified: z.boolean(), token: z.string().optional(), error: z.string().optional() })
	.meta({ id: "AssertionResult", description: "token is single-use, 120s, and required on approve" });

const statusRoute = createRoute({
	method: "get",
	path: "/auth/status",
	tags: ["auth"],
	summary: "how many credentials can approve, and the RP this page must use",
	responses: { 200: { content: { "application/json": { schema: AuthStatus } }, description: "capability probe" } },
});

const registerOptionsRoute = createRoute({
	method: "post",
	path: "/auth/register/options",
	tags: ["auth"],
	summary: "start platform-authenticator enrollment (Touch ID / passkey)",
	responses: {
		200: { content: { "application/json": { schema: RegistrationOptions } }, description: "creation options" },
	},
});

const registerVerifyRoute = createRoute({
	method: "post",
	path: "/auth/register/verify",
	tags: ["auth"],
	request: { body: { content: { "application/json": { schema: VerifyRegistrationBody } }, required: true } },
	responses: {
		200: { content: { "application/json": { schema: VerifyRegistrationResult } }, description: "registration checked" },
		400: { content: { "application/json": { schema: ErrorBody } }, description: "challenge expired or rejected" },
	},
});

const assertOptionsRoute = createRoute({
	method: "post",
	path: "/auth/assert/options",
	tags: ["auth"],
	summary: "challenge for one touch",
	responses: {
		200: { content: { "application/json": { schema: AuthenticationOptions } }, description: "request options" },
	},
});

const assertVerifyRoute = createRoute({
	method: "post",
	path: "/auth/assert/verify",
	tags: ["auth"],
	request: { body: { content: { "application/json": { schema: VerifyAssertionBody } }, required: true } },
	responses: {
		200: { content: { "application/json": { schema: AssertionResult } }, description: "verified + single-use token" },
		400: {
			content: { "application/json": { schema: ErrorBody } },
			description: "unknown credential / expired challenge / bad signature",
		},
	},
});

export function registerAuth(app: OpenAPIHono, deps: { db: ApiDb }): void {
	app.openapi(statusRoute, (c) => {
		const cfg = authConfig();
		return c.json({ credentials: credentialCount(deps.db), rpID: cfg.rpID, origins: cfg.origins }, 200);
	});

	app.openapi(registerOptionsRoute, async (c) => c.json(await registrationOptions(deps.db), 200));

	app.openapi(registerVerifyRoute, async (c) => {
		const { response, challenge } = c.req.valid("json");
		const result = await verifyRegistration(deps.db, response, challenge);
		if (!result.verified) return c.json({ error: result.error ?? "registration rejected" }, 400);
		return c.json({ verified: true }, 200);
	});

	app.openapi(assertOptionsRoute, async (c) => c.json(await authenticationOptions(deps.db), 200));

	app.openapi(assertVerifyRoute, async (c) => {
		const { response, challenge } = c.req.valid("json");
		const result = await verifyAssertion(deps.db, response, challenge);
		if (!result.verified || result.token === undefined)
			return c.json({ error: result.error ?? "assertion rejected" }, 400);
		return c.json({ verified: true, token: result.token }, 200);
	});
}
