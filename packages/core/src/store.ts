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
import { createEnvelopeV2, openDataV2, resealV2, unlockWithSe } from "./vault/envelope.ts";
import { pickLocalSeSlot, seCreate, seEcdh } from "./vault/se.ts";
import { listVaultBackups, readVaultRaw, writeVaultFile } from "./vault/vault.ts";

/** Storage context. There is no password: the vault unlocks through this Mac's Secure Enclave. */
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
	const slot = await pickLocalSeSlot(file);
	if (!slot) {
		return err(
			`no unlock slot for this Mac (vault ${file.fingerprint}) — reset with your passkey in the dogsout WebUI (F3), then this Mac gets its own Touch ID slot`,
		);
	}
	const dek = await unlockWithSe(file, slot, seEcdh);
	if (dek.isErr()) return err(`vault unlock failed: ${dek.error.kind === "unlock" ? dek.error.message : "corrupt"}`);
	const data = await openDataV2(file, dek.value);
	if (data.isErr()) return err(corrupt(ctx.home));
	return ok({ envelope: { file, dek: dek.value, slotId: slot.id }, data: data.value });
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
 * Create config.json + an empty vault: mint a Secure Enclave key, seal under a fresh DEK, then
 * unlock once (one Touch ID) — init only succeeds if the new slot really opens; otherwise the
 * files it wrote are removed.
 */
export async function initFiles(home: string): Promise<Result<{ fingerprint: string }, string>> {
	const { mkdirSync, rmSync } = await import("node:fs");
	mkdirSync(home, { recursive: true });
	const se = await seCreate();
	if (se.isErr()) return err(se.error);
	const { file } = await createEnvelopeV2({ version: 1, vaults: {} }, se.value);
	const cfgR = await writeConfig(home, { version: 1, aliases: {}, maps: {} });
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

export function nowIso(): string {
	return new Date().toISOString();
}
