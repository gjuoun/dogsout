import { err, ok, type Result } from "neverthrow";
import { parseEnvFile } from "../vault/io.ts";
import { readValue } from "./cmd-crud.ts";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** jtk run --env ALIAS [--from-env FILE] -- cmd args — values go to child env only (spec §5.2). */
export async function runRun(argv: string[]): Promise<Result<number, string>> {
	const sep = argv.indexOf("--");
	if (sep === -1) {
		return err("usage: jtk run --env ALIAS [--from-env FILE] -- <cmd> [args...]");
	}
	const flagPart = argv.slice(0, sep);
	const cmd = argv.slice(sep + 1);
	if (cmd.length === 0) return err("no command after --");

	const names: string[] = [];
	let fromEnvFile: string | undefined;
	for (let i = 0; i < flagPart.length; i++) {
		const a = flagPart[i];
		if (a === "--env") {
			const n = flagPart[i + 1];
			if (!n) return err("--env needs an ALIAS name");
			if (!ENV_NAME.test(n))
				return err(
					`--env wants a valid env var name (alias), got: ${n} — register an alias or use --from-env with jtk:// refs`,
				);
			names.push(n);
			i++;
		} else if (a === "--from-env") {
			const f = flagPart[i + 1];
			if (!f) return err("--from-env needs a FILE path");
			fromEnvFile = f;
			i++;
		} else {
			return err(
				`unknown flag: ${a} — item spread (--from-item) was removed: nested field names are not valid env names; use aliases or --from-env`,
			);
		}
	}

	const inject: Record<string, string> = {};

	// --from-env FILE: .env style — KEY=literal passes through, KEY=jtk://… resolves from vault.
	if (fromEnvFile) {
		let text: string;
		try {
			text = await Bun.file(fromEnvFile).text();
		} catch {
			return err(`cannot read: ${fromEnvFile}`);
		}
		const plan = parseEnvFile(text);
		if (plan.skipped.length > 0) {
			return err(`${plan.skipped[0]?.key} uses op:// — the 1Password adapter lands in a later feature`);
		}
		for (const d of plan.directs) inject[d.key] = d.value;
		for (const r of plan.refs) {
			const v = await readValue(r.value);
			if (v.isErr()) return err(`${r.key}: ${v.error}`);
			inject[r.key] = v.value;
		}
	}

	for (const n of names) {
		const v = await readValue(n);
		if (v.isErr()) return err(v.error);
		inject[n] = v.value;
	}

	// strip JTK_MASTER: the master password must not leak into child env (agent-run commands)
	const { JTK_MASTER: _stripped, ...parentEnv } = process.env;
	void _stripped;
	const proc = Bun.spawn(cmd, {
		env: { ...parentEnv, ...inject },
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await proc.exited;
	return ok(code);
}
