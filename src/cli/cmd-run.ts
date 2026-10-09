import { err, ok, type Result } from "neverthrow";
import { parseEnvFile } from "../vault/io.ts";
import { parseItemRef } from "./address.ts";
import { readValue } from "./cmd-crud.ts";
import { jtkHome } from "./paths.ts";
import { masterFromEnv, openData } from "./store.ts";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** jtk run --env ALIAS [--from-item jtk://v/item] [--from-env FILE] -- cmd args — values go to child env only (spec §5.2). */
export async function runRun(argv: string[]): Promise<Result<number, string>> {
	const sep = argv.indexOf("--");
	if (sep === -1) {
		return err("usage: jtk run --env ALIAS [--from-item jtk://v/item] [--from-env FILE] -- <cmd> [args...]");
	}
	const flagPart = argv.slice(0, sep);
	const cmd = argv.slice(sep + 1);
	if (cmd.length === 0) return err("no command after --");

	const names: string[] = [];
	let from: string | undefined;
	let fromEnvFile: string | undefined;
	for (let i = 0; i < flagPart.length; i++) {
		const a = flagPart[i];
		if (a === "--env") {
			const n = flagPart[i + 1];
			if (!n) return err("--env needs an ALIAS name");
			if (!ENV_NAME.test(n))
				return err(`--env wants a valid env var name (alias), got: ${n} — addresses go through --from`);
			names.push(n);
			i++;
		} else if (a === "--from-item" || a === "--from") {
			const f = flagPart[i + 1];
			if (!f) return err(`${a} needs an item address (jtk://vault/item)`);
			from = f;
			i++;
		} else if (a === "--from-env") {
			const f = flagPart[i + 1];
			if (!f) return err("--from-env needs a FILE path");
			fromEnvFile = f;
			i++;
		} else {
			return err(`unknown flag: ${a}`);
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

	if (from) {
		const parsed = parseItemRef(from);
		if (parsed.isErr()) return err(parsed.error);
		const m = masterFromEnv();
		if (m.isErr()) return err(m.error);
		const opened = await openData({ home: jtkHome(), master: m.value });
		if (opened.isErr()) return err(opened.error);
		const { vault, item } = parsed.value;
		const target = opened.value.data.vaults[vault]?.[item];
		if (!target) return err(`not found: ${from}`);
		for (const [f, v] of Object.entries(target.fields)) inject[f] = v;
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
