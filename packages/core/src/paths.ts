import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The repo was `junethekey` until 2026-10-23; storage written by that name is migrated once. */
const LEGACY_DIR = "junethekey";
const APP_DIR = "dogsout";

/** `DOGSOUT_HOME` selects a storage root; the default is ~/.config/dogsout (0600 files inside). */
export function dogsoutHome(): string {
	return process.env.DOGSOUT_HOME ?? join(homedir(), ".config", APP_DIR);
}

/** Where a pre-rename install kept config.json / vault.enc — the input of `dogsout migrate`. */
export function legacyHome(): string {
	return join(homedir(), ".config", LEGACY_DIR);
}

/**
 * Refuse to silently start a second, empty vault: when the legacy directory is still
 * populated and the new one does not exist, every command but `migrate` points at the
 * one-time move instead of creating fresh storage. Returns the guidance line, or null
 * when the caller may proceed.
 */
export function storageGuard(
	explicitHome = process.env.DOGSOUT_HOME,
	home = dogsoutHome(),
	legacy = legacyHome(),
): string | null {
	if (explicitHome) return null;
	if (existsSync(join(home, "config.json"))) return null;
	if (!existsSync(join(legacy, "config.json"))) return null;
	return `storage found at ${legacy} — run: dogsout migrate`;
}

export function configPath(home: string = dogsoutHome()): string {
	return join(home, "config.json");
}

export function vaultPath(home: string = dogsoutHome()): string {
	return join(home, "vault.enc");
}

/** Rolling backup n (1 = newest) of vault.enc — whole-file ciphertext copies, kept local. */
export function vaultBackupPath(home: string = dogsoutHome(), n: 1 | 2 = 1): string {
	return join(home, `vault.enc.bak.${n}`);
}

/** Where `dogsout vault restore` parks the unreadable vault.enc it replaces. */
export function vaultBrokenPath(home: string = dogsoutHome()): string {
	return join(home, "vault.enc.broken");
}

export function grantsPath(home: string = dogsoutHome()): string {
	return join(home, "grants.json");
}

export function sessionsPath(home: string = dogsoutHome()): string {
	return join(home, "sessions.json");
}
