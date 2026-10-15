import { homedir } from "node:os";
import { join } from "node:path";
import type { SeSlot, VaultFileV2 } from "@jtk/type-contracts";
import { err, ok, type Result } from "neverthrow";
import type { Ecdh, SeKeyRef } from "./envelope.ts";

/**
 * Client for the Secure Enclave mode of the native helper (apps/ask jtk-approve):
 *   --se-create            → {blob, pub}        (no Touch ID)
 *   --se-ecdh  ← {blob, peer, reason} → {shared} (Touch ID / login password)
 *   --se-probe ← {blob}    → {usable}           (no UI: interactionNotAllowed)
 * JSON over stdin/stdout. Any non-zero exit, crash or garbage is an error — never a partial key.
 * A foreign or tampered blob can make CryptoKit trap, so each probe runs in its own process.
 */
export const SE_HELPER_ENV = "JTK_SE_HELPER";

export function seHelperPath(): string {
	return process.env[SE_HELPER_ENV] ?? join(homedir(), ".bun", "bin", "jtk-approve");
}

const UNLOCK_BUDGET_MS = 120_000;
const PROBE_BUDGET_MS = 10_000;

async function callHelper(flag: string, input: unknown, budgetMs: number): Promise<Result<unknown, string>> {
	const path = seHelperPath();
	if (!(await Bun.file(path).exists())) return err(`secure enclave helper not found: ${path}`);
	// Snapshot env minus the v1 master: the helper never needs it.
	const { JTK_MASTER: _m, ...childEnv } = process.env;
	void _m;
	let proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
	try {
		proc = Bun.spawn([path, flag], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...childEnv } });
	} catch (e) {
		return err(`cannot spawn secure enclave helper: ${String(e)}`);
	}
	proc.stdin.write(input === undefined ? "" : JSON.stringify(input));
	proc.stdin.end();
	const timer = setTimeout(() => proc.kill(), budgetMs);
	try {
		const [out, errText, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (code !== 0) return err(`secure enclave helper ${flag} failed (exit ${code}): ${errText.trim().slice(0, 200)}`);
		return ok(JSON.parse(out.trim()));
	} catch (e) {
		return err(`secure enclave helper ${flag} returned garbage: ${String(e)}`);
	} finally {
		clearTimeout(timer);
	}
}

function isString(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}

/** Mint a new Secure Enclave key (no Touch ID). */
export async function seCreate(): Promise<Result<SeKeyRef, string>> {
	const r = await callHelper("--se-create", undefined, PROBE_BUDGET_MS);
	if (r.isErr()) return err(r.error);
	const v = r.value as { blob?: unknown; pub?: unknown };
	return isString(v.blob) && isString(v.pub) ? ok({ blob: v.blob, pub: v.pub }) : err("--se-create: bad response");
}

/** ECDH through the chip; this is where Touch ID is asked. */
export const seEcdh: Ecdh = async (blob, ephPub) => {
	const r = await callHelper("--se-ecdh", { blob, peer: ephPub, reason: "unlock your jtk vault" }, UNLOCK_BUDGET_MS);
	if (r.isErr()) return err(r.error);
	const shared = (r.value as { shared?: unknown }).shared;
	if (!isString(shared)) return err("--se-ecdh: bad response");
	const bytes = new Uint8Array(Buffer.from(shared, "base64"));
	return bytes.length === 32 ? ok(bytes) : err("--se-ecdh: shared secret is not 32 bytes");
};

/** Is this blob usable on THIS Mac? Never shows UI; any failure (incl. a CryptoKit trap) = false. */
export async function seProbe(blob: string): Promise<boolean> {
	const r = await callHelper("--se-probe", { blob }, PROBE_BUDGET_MS);
	return r.isOk() && (r.value as { usable?: unknown }).usable === true;
}

/** The se slot whose key lives in this Mac's Secure Enclave, or null (new Mac → passkey reset via WebUI). */
export async function pickLocalSeSlot(file: VaultFileV2): Promise<SeSlot | null> {
	for (const slot of file.slots) {
		if (slot.kind === "se" && (await seProbe(slot.blob))) return slot;
	}
	return null;
}
