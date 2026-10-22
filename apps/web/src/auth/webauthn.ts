import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { API_BASE } from "~/api/client";

/**
 * Human assertion for approvals. Touch ID / platform passkey only, user verification
 * required — see apps/api/src/auth/webauthn.ts for the server half.
 *
 * There is no password fallback by design: vault v2 has no master password, so a password
 * gate would be a weaker factor invented for the WebUI. No authenticator → no approval;
 * the page says so and points at the CLI/swiftui channels (PRD red line 4).
 */

export interface AuthStatus {
	credentials: number;
	rpID: string;
	origins: string[];
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
	const r = await fetch(`${API_BASE}/auth/status`);
	if (!r.ok) throw new Error(`auth status failed: ${r.status}`);
	return (await r.json()) as AuthStatus;
}

/** Can this browser do a platform (Touch ID) ceremony at all? */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
	try {
		if (typeof PublicKeyCredential === "undefined") return false;
		return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
	} catch {
		return false;
	}
}

export async function registerThisDevice(): Promise<void> {
	const start = await fetch(`${API_BASE}/auth/register/options`, { method: "POST" });
	if (!start.ok) throw new Error(`register/options failed: ${start.status}`);
	const { options, challenge } = (await start.json()) as { options: unknown; challenge: string };
	const response = await startRegistration({ optionsJSON: options as never });
	const verified = await fetch(`${API_BASE}/auth/register/verify`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ response, challenge }),
	});
	if (!verified.ok)
		throw new Error(
			`registration rejected: ${((await verified.json()) as { error?: string }).error ?? verified.status}`,
		);
}

/** One touch → a single-use token for the decision call. */
export async function assertHuman(): Promise<string> {
	const start = await fetch(`${API_BASE}/auth/assert/options`, { method: "POST" });
	if (!start.ok) throw new Error(`assert/options failed: ${start.status}`);
	const { options, challenge } = (await start.json()) as { options: unknown; challenge: string };
	const response = await startAuthentication({ optionsJSON: options as never });
	const verified = await fetch(`${API_BASE}/auth/assert/verify`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ response, challenge }),
	});
	const body = (await verified.json()) as { verified?: boolean; token?: string; error?: string };
	if (!verified.ok || body.token === undefined) throw new Error(body.error ?? `assertion rejected: ${verified.status}`);
	return body.token;
}

export interface GateInput {
	available: boolean;
	credentials: number;
}

/**
 * The one place that decides whether approving is possible, so the page and its tests agree.
 * Returns the reason approval is disabled, or undefined when it is allowed.
 */
export function approvalBlockedReason(input: GateInput): string | undefined {
	if (!input.available) return "没有可用的平台认证器 — 用 CLI 或 swiftui 通道审批";
	if (input.credentials === 0) return "这台设备还没有审批凭据 — 先注册（Touch ID / passkey）";
	return undefined;
}
