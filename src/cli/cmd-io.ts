import { err, ok, type Result } from "neverthrow";
import { formatEnvRef, formatJsonRef, parseEnvFile } from "../vault/io.ts";
import { jtkHome } from "./paths.ts";
import { loadConfig, masterFromEnv, nowIso, openData, saveData, writeConfig } from "./store.ts";

export async function runImportEnv(argv: string[]): Promise<Result<string, string>> {
	const positional = argv.filter((a) => !a.startsWith("--"));
	const file = positional[0];
	if (!file) return err("usage: jtk import-env <file.env> [--vault V] [--item I]");
	const flag = (name: string, dflt: string): string => {
		const i = argv.indexOf(name);
		const v = i !== -1 ? argv[i + 1] : undefined;
		return v ?? dflt;
	};
	const vault = flag("--vault", "imported");
	const item = flag("--item", "misc");

	let text: string;
	try {
		text = await Bun.file(file).text();
	} catch {
		return err(`cannot read: ${file}`);
	}
	const plan = parseEnvFile(text);

	const master = masterFromEnv();
	if (master.isErr()) return err(master.error);
	const home = jtkHome();
	const opened = await openData({ home, master: master.value });
	if (opened.isErr()) return err(opened.error);
	const { envelope, data } = opened.value;
	data.vaults[vault] ??= {};
	const items = data.vaults[vault];
	if (!items[item]) items[item] = { fields: {}, updated_at: nowIso() };
	for (const d of plan.directs) items[item].fields[d.key] = d.value;
	items[item].updated_at = nowIso();
	const saved = await saveData({ home, master: master.value }, envelope, data);
	if (saved.isErr()) return err(saved.error);

	if (plan.refs.length > 0) {
		const cfg = await loadConfig(home);
		if (cfg.isErr()) return err(cfg.error);
		for (const r of plan.refs) cfg.value.aliases[r.key] = r.value;
		const w = await writeConfig(home, cfg.value);
		if (w.isErr()) return err(w.error);
	}

	const skippedNote = plan.skipped.length > 0 ? `, skipped ${plan.skipped.length} (op:// — adapter lands in F6)` : "";
	return ok(`imported ${plan.directs.length} values, ${plan.refs.length} refs${skippedNote} -> ${vault}/${item}`);
}

export async function runExport(argv: string[]): Promise<Result<string, string>> {
	const fmtFlag = argv.includes("--format") ? argv[argv.indexOf("--format") + 1] : "env-ref";
	if (fmtFlag !== "env-ref" && fmtFlag !== "json-ref")
		return err("--format must be env-ref|json-ref (--reveal values arrive with the daemon feature)");
	const home = jtkHome();
	const cfg = await loadConfig(home);
	if (cfg.isErr()) return err(cfg.error);
	const body = fmtFlag === "env-ref" ? formatEnvRef(cfg.value.aliases) : formatJsonRef(cfg.value.aliases);
	return ok(body.trimEnd());
}
