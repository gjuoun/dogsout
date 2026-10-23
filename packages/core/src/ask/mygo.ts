import { homedir } from "node:os";
import { join } from "node:path";
import type { AskRequest, Decision } from "@dogsout/type-contracts";
import { err, ok, type Result } from "neverthrow";
import { type Channel, decisionFromStdout } from "./channel.ts";

/**
 * The mygo slot: the native approval window is apps/ask — a Go module using
 * mygo's native UI (no webview, no cgo), built by apps/ask/build.sh into
 * ~/.bun/bin/dogsout-approve. The wire contract is unchanged: --request <path> in,
 * one Decision JSON on stdout, a non-zero exit means the channel failed.
 */

/** Helper binary override for tests and non-standard installs. */
export const HELPER_ENV = "DOGSOUT_APPROVE_HELPER";

export function helperPath(): string {
	const fromEnv = process.env[HELPER_ENV];
	if (fromEnv) return fromEnv;
	return join(homedir(), ".bun", "bin", "dogsout-approve");
}

/** The mygo slot: only when the helper binary exists (F2: macOS local build). */
export const mygoChannel: Channel = {
	name: "mygo",
	async available() {
		const p = helperPath();
		return await Bun.file(p).exists();
	},
	async ask(request: AskRequest, budgetMs: number): Promise<Result<Decision, string>> {
		const path = helperPath();
		const tmp = join(await import("node:os").then((m) => m.tmpdir()), "dogsout-ask-" + crypto.randomUUID() + ".json");
		await Bun.write(tmp, JSON.stringify(request));
		let proc: Bun.Subprocess<"ignore", "pipe", "inherit">;
		try {
			// Bun.spawn without explicit env uses the boot-time environment, missing runtime mutations;
			// pass a snapshot of the current one.
			const childEnv = { ...process.env };
			proc = Bun.spawn([path, "--request", tmp], {
				stdin: "ignore",
				stdout: "pipe",
				stderr: "inherit",
				env: { ...childEnv },
			});
		} catch (e) {
			return err("cannot spawn helper: " + String(e));
		}
		const timer = setTimeout(() => proc.kill(), budgetMs);
		try {
			const out = await new Response(proc.stdout).text();
			const code = await proc.exited;
			if (code !== 0) return err("helper exit " + code + " (window closed or failed — fail-closed)");
			return decisionFromStdout(out.trim());
		} catch (e) {
			return err("helper failed: " + String(e));
		} finally {
			clearTimeout(timer);
		}
	},
};
