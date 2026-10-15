import { homedir } from "node:os";
import { join } from "node:path";

export function jtkHome(): string {
	return process.env.JTK_HOME ?? join(homedir(), ".config", "junethekey");
}

export function configPath(home: string = jtkHome()): string {
	return join(home, "config.json");
}

export function vaultPath(home: string = jtkHome()): string {
	return join(home, "vault.enc");
}

/** Rolling backup n (1 = newest) of vault.enc — whole-file ciphertext copies, kept local. */
export function vaultBackupPath(home: string = jtkHome(), n: 1 | 2 = 1): string {
	return join(home, `vault.enc.bak.${n}`);
}

/** The v1 file kept after `jtk vault migrate` until the user deletes it. */
export function vaultV1Path(home: string = jtkHome()): string {
	return join(home, "vault.v1.enc");
}

/** Where `jtk vault restore` parks the unreadable vault.enc it replaces. */
export function vaultBrokenPath(home: string = jtkHome()): string {
	return join(home, "vault.enc.broken");
}

export function grantsPath(home: string = jtkHome()): string {
	return join(home, "grants.json");
}

export function sessionsPath(home: string = jtkHome()): string {
	return join(home, "sessions.json");
}
