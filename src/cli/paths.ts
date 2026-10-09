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
