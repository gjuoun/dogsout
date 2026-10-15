import { configPath, initFiles, jtkHome } from "@jtk/core";
import { command, flag } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { defaultIo, fail, type Io, runJtk, withMeta } from "./cmd.ts";

/** Interactive prompt when no JTK_MASTER and we have a TTY (reads one line, not EOF). */
async function readMasterInteractive(): Promise<string> {
	const { createInterface } = await import("node:readline");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((resolve) => {
		rl.question("master password (min 8 chars): ", (a: string) => resolve(a));
	});
	rl.close();
	return answer.trim();
}

export function initCommand(io: Io = defaultIo) {
	return withMeta(
		command({
			name: "init",
			description: "create vault.enc + config.json (master via JTK_MASTER, prompt, or stdin)",
			args: { force: flag({ long: "force", description: "reset an already-initialized home (destructive)" }) },
			handler: async ({ force }): Promise<Result<string, string>> => {
				const home = jtkHome();
				if ((await Bun.file(configPath(home)).exists()) && !force) {
					return fail(`already initialized: ${configPath(home)} (use --force to reset)`);
				}
				let master = process.env.JTK_MASTER;
				if (!master) {
					master = process.stdin.isTTY ? await readMasterInteractive() : (await io.stdin()).trim();
				}
				if (!master || master.length < 8) return fail("master password too short (min 8)");
				const r = await initFiles(home, master);
				if (r.isErr()) return err(r.error);
				return ok(`initialized ${home}`);
			},
		}),
		{ reads: [], writes: ["config", "vault"], env: ["JTK_HOME", "JTK_MASTER"] },
	);
}

export async function runInit(argv: string[], io: Io = defaultIo): Promise<Result<string, string>> {
	return runJtk<string>(initCommand(io), argv);
}
