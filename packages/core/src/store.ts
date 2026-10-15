import {
	type Config,
	parseConfig,
	parseVaultFileV2,
	type VaultData,
	type VaultFileV2,
	vaultFileVersion,
} from "@jtk/type-contracts";
import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import { configPath, vaultPath } from "./paths.ts";
import { openDataV2, resealV2, unlockWithSe } from "./vault/envelope.ts";
import { pickLocalSeSlot, seEcdh } from "./vault/se.ts";
import {
	createVault,
	listVaultBackups,
	openVault,
	readVaultRaw,
	saveVault,
	type VaultFile,
	writeVaultFile,
} from "./vault/vault.ts";

/** Storage context. `master` is only needed for a v1 (password) vault; v2 unlocks through the SE. */
export interface Ctx {
	home: string;
	master?: string;
}

/** An opened vault file plus the key that re-seals it: v1 = master password, v2 = DEK. */
export type OpenedEnvelope =
	| { version: 1; file: VaultFile; master: string }
	| { version: 2; file: VaultFileV2; dek: Uint8Array<ArrayBuffer>; slotId: string };

export function masterFromEnv(): Result<string, string> {
	const m = process.env.JTK_MASTER;
	return m ? ok(m) : err("JTK_MASTER not set (F1: env-only master, prompt lands with daemon work)");
}

export async function loadConfig(home: string): Promise<Result<Config, string>> {
	const file = Bun.file(configPath(home));
	if (!file.exists()) return err(`config not found: ${configPath(home)} — run: jtk init`);
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
		? `vault corrupt — backup vault.enc.bak.${baks[0]} exists: run jtk vault restore`
		: "vault corrupt";
}

export async function openData(ctx: Ctx): Promise<Result<{ envelope: OpenedEnvelope; data: VaultData }, string>> {
	const rawR = await readVaultRaw(vaultPath(ctx.home));
	if (rawR.isErr()) {
		return err(
			rawR.error.kind === "corrupt" ? corrupt(ctx.home) : `vault not found: ${vaultPath(ctx.home)} — run: jtk init`,
		);
	}
	const version = vaultFileVersion(rawR.value);
	if (version === 1) {
		const masterR = ctx.master ? ok(ctx.master) : masterFromEnv();
		if (masterR.isErr()) return err(masterR.error);
		const master = masterR.value;
		const file = rawR.value as VaultFile;
		const opened = await openVault(file, master);
		if (opened.isErr()) return err(opened.error.kind === "bad-master" ? "wrong master password" : corrupt(ctx.home));
		return ok({ envelope: { version: 1, file, master }, data: opened.value });
	}
	if (version === 2) {
		const parsed = parseVaultFileV2(rawR.value);
		if (!parsed.ok) return err(corrupt(ctx.home));
		const file = parsed.file;
		const slot = await pickLocalSeSlot(file);
		if (!slot) {
			return err(
				`no unlock slot for this Mac (vault ${file.fingerprint}) — reset with your passkey in the jtk WebUI (F3), then this Mac gets its own Touch ID slot`,
			);
		}
		const dek = await unlockWithSe(file, slot, seEcdh);
		if (dek.isErr()) return err(`vault unlock failed: ${dek.error.kind === "unlock" ? dek.error.message : "corrupt"}`);
		const data = await openDataV2(file, dek.value);
		if (data.isErr()) return err(corrupt(ctx.home));
		return ok({ envelope: { version: 2, file, dek: dek.value, slotId: slot.id }, data: data.value });
	}
	return err(corrupt(ctx.home));
}

export async function saveData(ctx: Ctx, envelope: OpenedEnvelope, data: VaultData): Promise<Result<void, string>> {
	const sealed =
		envelope.version === 1
			? await saveVault(data, envelope.master, envelope.file)
			: await resealV2(envelope.file, envelope.dek, data);
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

export async function initFiles(home: string, master: string): Promise<Result<void, string>> {
	const { mkdirSync } = await import("node:fs");
	mkdirSync(home, { recursive: true });
	const cfgR = await writeConfig(home, { version: 1, aliases: {}, maps: {} });
	if (cfgR.isErr()) return cfgR;
	const envelope = await createVault(master, { version: 1, vaults: {} });
	const w = await writeVaultFile(vaultPath(home), envelope, { rotate: false });
	return w.isErr() ? err(w.error.kind) : ok(undefined);
}

export function nowIso(): string {
	return new Date().toISOString();
}
