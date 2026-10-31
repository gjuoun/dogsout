import {
	type Config,
	parseConfig,
	parseVaultFileV2,
	type VaultData,
	type VaultFileV2,
	vaultFileVersion,
} from "@dogsout/type-contracts";
import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import { configPath, vaultPath } from "./paths.ts";
import {
	createEnvelopeTokenV2,
	createEnvelopeV2,
	openDataV2,
	pickTokenSlot,
	resealV2,
	unlockWithSe,
	unlockWithToken,
} from "./vault/envelope.ts";
import { pickLocalSeSlot, seCreate, seEcdh } from "./vault/se.ts";
import { mintUnlockToken, readUnlockToken, unlockTokenPath } from "./vault/token.ts";
import { listVaultBackups, readVaultRaw, writeVaultFile } from "./vault/vault.ts";

/**
 * Storage context. The default unlock factor is a local token file (no biometrics); Secure
 * Enclave slots still exist for vaults created before 2026-10-30 and are reachable only with
 * DOGSOUT_ALLOW_SE=1, which the migration command `vault token-add` sets for one run.
 */
export interface Ctx {
	home: string;
}

/** An opened vault file plus the DEK that re-seals it and the slot that opened it. */
export interface OpenedEnvelope {
	file: VaultFileV2;
	dek: Uint8Array<ArrayBuffer>;
	slotId: string;
}

export const V1_UNSUPPORTED =
	"vault v1 is no longer supported — password vaults were removed (cold cut 2026-10-14); re-create it with dogsout init --force (the old file cannot be read)";

export async function loadConfig(home: string): Promise<Result<Config, string>> {
	const file = Bun.file(configPath(home));
	if (!file.exists()) return err(`config not found: ${configPath(home)} — run: dogsout init`);
	let raw: unknown;
	try {
		raw = JSON.parse(await file.text());
	} catch {
		return err("config.json is not valid JSON");
	}
	const parsed = parseConfig(raw);
	return parsed.ok ? ok(parsed.config) : err(parsed.error);
}

/** Corrupt-file message; names the newest backup and the restore command, never substitutes silently. */
function corrupt(home: string): string {
	const baks = listVaultBackups(home);
	return baks.length > 0
		? `vault corrupt — backup vault.enc.bak.${baks[0]} exists: run dogsout vault restore`
		: "vault corrupt";
}

export async function openData(ctx: Ctx): Promise<Result<{ envelope: OpenedEnvelope; data: VaultData }, string>> {
	return openDataAt(ctx, vaultPath(ctx.home));
}

/** Open a vault file at an explicit path (e.g. a rolling backup before `dogsout vault restore` promotes it). */
export async function openDataAt(
	ctx: Ctx,
	path: string,
): Promise<Result<{ envelope: OpenedEnvelope; data: VaultData }, string>> {
	const rawR = await readVaultRaw(path);
	if (rawR.isErr()) {
		return err(rawR.error.kind === "corrupt" ? corrupt(ctx.home) : `vault not found: ${path} — run: dogsout init`);
	}
	const version = vaultFileVersion(rawR.value);
	if (version === 1) return err(V1_UNSUPPORTED);
	const parsed = version === 2 ? parseVaultFileV2(rawR.value) : null;
	if (!parsed?.ok) return err(corrupt(ctx.home));
	const file = parsed.file;

	// 1) Local token — the default path: no UI, no Secure Enclave, no Touch ID.
	const tokenR = readUnlockToken(ctx.home);
	if (tokenR.isOk()) {
		const slot = pickTokenSlot(file, tokenR.value);
		if (slot) {
			const dek = await unlockWithToken(file, slot, tokenR.value);
			if (dek.isErr()) {
				const why = dek.error.kind === "unlock" ? dek.error.message : "corrupt";
				return err(`vault unlock failed: ${why}`);
			}
			const data = await openDataV2(file, dek.value);
			if (data.isErr()) return err(corrupt(ctx.home));
			return ok({ envelope: { file, dek: dek.value, slotId: slot.id }, data: data.value });
		}
	}

	// 2) Legacy Touch ID slots: never automatic — only the one-shot migration opts in.
	if (process.env.DOGSOUT_ALLOW_SE === "1") {
		const slot = await pickLocalSeSlot(file);
		if (slot) {
			const dek = await unlockWithSe(file, slot, seEcdh);
			if (dek.isErr())
				return err(`vault unlock failed: ${dek.error.kind === "unlock" ? dek.error.message : "corrupt"}`);
			const data = await openDataV2(file, dek.value);
			if (data.isErr()) return err(corrupt(ctx.home));
			return ok({ envelope: { file, dek: dek.value, slotId: slot.id }, data: data.value });
		}
	}

	if (file.slots.some((s) => s.kind === "token")) {
		return err(
			`${tokenR.isErr() ? tokenR.error : "this vault has no slot for the current unlock token"} (vault ${file.fingerprint})`,
		);
	}
	return err(
		`vault ${file.fingerprint} has no local token slot — run: dogsout vault token-add (one final Touch ID), or recreate with: dogsout init --force`,
	);
}

export async function saveData(ctx: Ctx, envelope: OpenedEnvelope, data: VaultData): Promise<Result<void, string>> {
	const sealed = await resealV2(envelope.file, envelope.dek, data);
	const w = await writeVaultFile(vaultPath(ctx.home), sealed);
	return w.isErr() ? err(w.error.kind === "io" ? w.error.message : w.error.kind) : ok(undefined);
}

export async function writeConfig(home: string, config: Config): Promise<Result<void, string>> {
	try {
		const tmp = `${configPath(home)}.tmp`;
		await Bun.write(tmp, JSON.stringify(config, null, 2));
		const { chmodSync, renameSync } = await import("node:fs");
		chmodSync(tmp, 0o600);
		renameSync(tmp, configPath(home));
		return ok(undefined);
	} catch (e) {
		return err(String(e));
	}
}

/**
 * Create config.json + an empty vault. Default mode (`token`): mint a local 0600 token, seal the
 * vault with a token slot and verify it opens — no Touch ID anywhere. `mode: "se"` keeps the
 * legacy Secure Enclave flow (one Touch ID at init).
 */
export async function initFiles(
	home: string,
	opts: { mode?: "token" | "se" } = {},
): Promise<Result<{ fingerprint: string; tokenPath?: string }, string>> {
	const { mkdirSync, rmSync } = await import("node:fs");
	mkdirSync(home, { recursive: true });
	const mode = opts.mode ?? "token";

	if (mode === "se") {
		const se = await seCreate();
		if (se.isErr()) return err(se.error);
		const { file } = await createEnvelopeV2({ version: 1, vaults: {} }, se.value);
		const cfgR = await writeConfig(home, { version: 1, aliases: {}, maps: {}, refs: {} });
		if (cfgR.isErr()) return err(cfgR.error);
		const w = await writeVaultFile(vaultPath(home), file, { rotate: false });
		if (w.isErr()) return err(w.error.kind === "io" ? w.error.message : w.error.kind);
		const slot = await pickLocalSeSlot(file);
		const dek = slot ? await unlockWithSe(file, slot, seEcdh) : null;
		if (!dek || dek.isErr()) {
			rmSync(vaultPath(home), { force: true });
			rmSync(configPath(home), { force: true });
			const why = dek?.isErr()
				? dek.error.kind === "unlock"
					? dek.error.message
					: "corrupt"
				: "slot not usable on this Mac";
			return err(`init aborted: the new Touch ID slot did not open (${why})`);
		}
		return ok({ fingerprint: file.fingerprint });
	}

	const tokenR = await mintUnlockToken(home);
	if (tokenR.isErr()) return err(tokenR.error);
	const { file } = await createEnvelopeTokenV2({ version: 1, vaults: {} }, tokenR.value);
	const cfgR = await writeConfig(home, { version: 1, aliases: {}, maps: {}, refs: {} });
	if (cfgR.isErr()) return err(cfgR.error);
	const w = await writeVaultFile(vaultPath(home), file, { rotate: false });
	if (w.isErr()) return err(w.error.kind === "io" ? w.error.message : w.error.kind);
	const slot = pickTokenSlot(file, tokenR.value);
	const dek = slot ? await unlockWithToken(file, slot, tokenR.value) : null;
	if (!dek || dek.isErr()) {
		rmSync(vaultPath(home), { force: true });
		rmSync(configPath(home), { force: true });
		const why = dek?.isErr() ? (dek.error.kind === "unlock" ? dek.error.message : "corrupt") : "slot not found";
		return err(`init aborted: the new token slot did not open (${why})`);
	}
	return ok({ fingerprint: file.fingerprint, tokenPath: unlockTokenPath(home) });
}

export function nowIso(): string {
	return new Date().toISOString();
}
