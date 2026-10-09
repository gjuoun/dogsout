import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import { type Config, parseConfig, type VaultData } from "../../contracts/index.ts";
import { createVault, openVault, readVaultFile, saveVault, type VaultFile, writeVaultFile } from "../vault/vault.ts";
import { configPath, vaultPath } from "./paths.ts";

export interface Ctx {
	home: string;
	master: string;
}

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

export async function openData(ctx: Ctx): Promise<Result<{ envelope: VaultFile; data: VaultData }, string>> {
	const envR = await readVaultFile(vaultPath(ctx.home));
	if (envR.isErr()) return err(`vault not found: ${vaultPath(ctx.home)} — run: jtk init`);
	const opened = await openVault(envR.value, ctx.master);
	if (opened.isErr()) return err(opened.error.kind === "bad-master" ? "wrong master password" : "vault corrupt");
	return ok({ envelope: envR.value, data: opened.value });
}

export async function saveData(ctx: Ctx, envelope: VaultFile, data: VaultData): Promise<Result<void, string>> {
	const sealed = await saveVault(data, ctx.master, envelope);
	const w = await writeVaultFile(vaultPath(ctx.home), sealed);
	return w.isErr() ? err(w.error.kind) : ok(undefined);
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
	const cfgR = await writeConfig(home, { version: 1, aliases: {} });
	if (cfgR.isErr()) return cfgR;
	const envelope = await createVault(master, { version: 1, vaults: {} });
	const w = await writeVaultFile(vaultPath(home), envelope);
	return w.isErr() ? err(w.error.kind) : ok(undefined);
}

export function nowIso(): string {
	return new Date().toISOString();
}
