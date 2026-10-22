import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	type VerifiedRegistrationResponse,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import type { ApiDb } from "../db/client.ts";
import { webauthnCred } from "../db/schema.ts";

/**
 * Human-assertion gate for WebUI approvals. Platform authenticator only (Touch ID /
 * iCloud Keychain passkey), user verification required — PRD §4 "Web 侧触摸验证用 WebAuthn".
 *
 * Fail-closed rules (PRD red line 4): no credential registered, expired challenge,
 * unknown credential or a bad signature all end in "no approval". There is deliberately
 * **no password fallback**: vault v2 has no master password, so a password gate would be a
 * weaker factor invented out of nothing. The UI disables approval and points at the
 * CLI/swiftui channels instead.
 */

export interface AuthConfig {
	/** WebAuthn RP ID = the host the page is served from. `localhost` covers any port. */
	rpID: string;
	rpName: string;
	/** Origins allowed to complete the ceremony (comma-separated `JTK_WEB_ORIGIN`). */
	origins: string[];
}

export function authConfig(): AuthConfig {
	const origins = (process.env.JTK_WEB_ORIGIN ?? "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173")
		.split(",")
		.map((o) => o.trim())
		.filter((o) => o.length > 0);
	return { rpID: process.env.JTK_WEBAUTHN_RP_ID ?? "localhost", rpName: "junethekey", origins };
}

interface Challenge {
	kind: "register" | "assert";
	expires: number;
}

/** Short-lived server state: challenges (60s, single use) and assertion tokens (120s, single use). */
const challenges = new Map<string, Challenge>();
const tokens = new Map<string, number>();
const CHALLENGE_TTL_MS = 60_000;
const TOKEN_TTL_MS = 120_000;

function remember(challenge: string, kind: Challenge["kind"]): void {
	challenges.set(challenge, { kind, expires: Date.now() + CHALLENGE_TTL_MS });
}

/** Take a challenge exactly once; a stale or misused one is consumed and rejected. */
export function consumeChallenge(challenge: string, kind: Challenge["kind"], now = Date.now()): boolean {
	const entry = challenges.get(challenge);
	challenges.delete(challenge);
	return entry !== undefined && entry.kind === kind && entry.expires > now;
}

export function issueToken(now = Date.now()): string {
	const token = crypto.randomUUID();
	tokens.set(token, now + TOKEN_TTL_MS);
	return token;
}

/** Single-use assertion token check — used by the decision endpoint. */
export function consumeToken(token: string | undefined, now = Date.now()): boolean {
	if (token === undefined) return false;
	const expires = tokens.get(token);
	tokens.delete(token);
	return expires !== undefined && expires > now;
}

export function clearAuthState(): void {
	challenges.clear();
	tokens.clear();
}

function credentials(db: ApiDb) {
	return db.select().from(webauthnCred).all();
}

export function credentialCount(db: ApiDb): number {
	return credentials(db).length;
}

export async function registrationOptions(db: ApiDb): Promise<{ options: unknown; challenge: string }> {
	const existing = credentials(db).map((c) => ({ id: c.id }));
	const options = await generateRegistrationOptions({
		rpName: authConfig().rpName,
		rpID: authConfig().rpID,
		userName: "jtk-local",
		userDisplayName: "junethekey (local)",
		attestationType: "none",
		excludeCredentials: existing,
		authenticatorSelection: {
			residentKey: "preferred",
			userVerification: "required",
			// Platform authenticator only: this gate must be the machine the human is sitting at.
			authenticatorAttachment: "platform",
		},
	});
	remember(options.challenge, "register");
	return { options, challenge: options.challenge };
}

export interface RegistrationResult {
	verified: boolean;
	error?: string;
}

export async function verifyRegistration(db: ApiDb, response: unknown, challenge: string): Promise<RegistrationResult> {
	if (!consumeChallenge(challenge, "register")) return { verified: false, error: "challenge expired or unknown" };
	let verified: VerifiedRegistrationResponse;
	try {
		verified = await verifyRegistrationResponse({
			response: response as never,
			expectedChallenge: challenge,
			expectedOrigin: authConfig().origins,
			expectedRPID: authConfig().rpID,
			requireUserVerification: true,
		});
	} catch (e) {
		return { verified: false, error: String(e) };
	}
	if (!verified.verified || verified.registrationInfo === undefined) return { verified: false, error: "not verified" };
	const info = verified.registrationInfo;
	db.insert(webauthnCred)
		.values({
			id: info.credential.id,
			public_key: Buffer.from(info.credential.publicKey).toString("base64url"),
			counter: info.credential.counter,
			transports: info.credential.transports?.join(",") ?? null,
			created_at: new Date().toISOString(),
		})
		.onConflictDoNothing()
		.run();
	return { verified: true };
}

export async function authenticationOptions(db: ApiDb): Promise<{ options: unknown; challenge: string }> {
	const options = await generateAuthenticationOptions({
		rpID: authConfig().rpID,
		allowCredentials: credentials(db).map((c) => ({ id: c.id })),
		userVerification: "required",
	});
	remember(options.challenge, "assert");
	return { options, challenge: options.challenge };
}

export interface AssertionResult {
	verified: boolean;
	token?: string;
	error?: string;
}

export async function verifyAssertion(db: ApiDb, response: unknown, challenge: string): Promise<AssertionResult> {
	if (!consumeChallenge(challenge, "assert")) return { verified: false, error: "challenge expired or unknown" };
	const parsed = response as { id?: string };
	const credId = parsed.id;
	const stored =
		credId === undefined ? undefined : db.select().from(webauthnCred).where(eq(webauthnCred.id, credId)).get();
	if (stored === undefined) return { verified: false, error: "unknown credential" };
	try {
		const verified = await verifyAuthenticationResponse({
			response: response as never,
			expectedChallenge: challenge,
			expectedOrigin: authConfig().origins,
			expectedRPID: authConfig().rpID,
			requireUserVerification: true,
			credential: {
				id: stored.id,
				publicKey: Buffer.from(stored.public_key, "base64url"),
				counter: stored.counter,
				...(stored.transports ? { transports: stored.transports.split(",") as never } : {}),
			},
		});
		if (!verified.verified) return { verified: false, error: "not verified" };
		db.update(webauthnCred)
			.set({ counter: verified.authenticationInfo.newCounter })
			.where(eq(webauthnCred.id, stored.id))
			.run();
		return { verified: true, token: issueToken() };
	} catch (e) {
		return { verified: false, error: String(e) };
	}
}
