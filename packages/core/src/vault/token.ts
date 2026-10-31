import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "neverthrow";

/**
 * The local unlock token — the thing that replaced Touch ID.
 *
 * One 32-byte random token (base64url) in `$DOGSOUT_HOME/unlock-token`, mode 0600, overridable
 * with `DOGSOUT_UNLOCK_TOKEN` (tests, CI, a future auth-server-issued token). It wraps the vault
 * DEK in a `token` slot: whoever can read the file can open the vault, which is the same trust
 * boundary as the service-account token itself. Never print the value.
 */
export const UNLOCK_TOKEN_ENV = "DOGSOUT_UNLOCK_TOKEN";
export const UNLOCK_TOKEN_FILE = "unlock-token";
const MIN_TOKEN_CHARS = 32;

export function unlockTokenPath(home: string): string {
	return join(home, UNLOCK_TOKEN_FILE);
}

/** sha256(token) first 16 hex chars — the slot's public selector, never the token. */
export function tokenIdOf(token: string): string {
	return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export function readUnlockToken(home: string): Result<string, string> {
	const env = process.env[UNLOCK_TOKEN_ENV];
	if (env !== undefined && env.trim().length > 0) return ok(env.trim());
	const path = unlockTokenPath(home);
	if (!existsSync(path)) {
		return err(`no unlock token at ${path} (or set ${UNLOCK_TOKEN_ENV}) — run: dogsout vault token-add`);
	}
	try {
		const token = readFileSync(path, "utf8").trim();
		if (token.length < MIN_TOKEN_CHARS) return err(`unlock token is too short: ${path}`);
		return ok(token);
	} catch (e) {
		return err(`cannot read unlock token: ${path}: ${String(e)}`);
	}
}

/** Mint a fresh 32-byte token and write it 0600. Returns the token — never print it. */
export async function mintUnlockToken(home: string): Promise<Result<string, string>> {
	const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
	const path = unlockTokenPath(home);
	try {
		mkdirSync(home, { recursive: true });
		await Bun.write(path, `${token}\n`);
		chmodSync(path, 0o600);
		return ok(token);
	} catch (e) {
		return err(`cannot write unlock token: ${path}: ${String(e)}`);
	}
}
