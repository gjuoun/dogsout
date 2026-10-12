import { command, option, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { formatEnvRef, formatJsonRef, parseEnvFile } from "../vault/io.ts";
import { runJtk, withMeta } from "./cmd.ts";
import { jtkHome } from "./paths.ts";
import { loadConfig, masterFromEnv, nowIso, openData, saveData, writeConfig } from "./store.ts";

export function importEnvCommand() {
	return withMeta(
		command({
			name: "import-env",
			description: "import a .env file: literal values into the vault, jtk:// refs become aliases",
			args: {
				file: positional({ type: string, displayName: "file.env" }),
				vault: option({
					long: "vault",
					type: string,
					defaultValue: () => "imported",
					description: "target vault (default imported)",
				}),
				item: option({
					long: "item",
					type: string,
					defaultValue: () => "misc",
					description: "target item (default misc)",
				}),
			},
			handler: async ({ file, vault, item }): Promise<Result<string, string>> => {
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

				const skippedNote =
					plan.skipped.length > 0 ? `, skipped ${plan.skipped.length} (op:// — adapter lands in F6)` : "";
				return ok(`imported ${plan.directs.length} values, ${plan.refs.length} refs${skippedNote} -> ${vault}/${item}`);
			},
		}),
		{ reads: ["vault", "config"], writes: ["vault", "config"], env: ["JTK_HOME", "JTK_MASTER"] },
	);
}

export async function runImportEnv(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(importEnvCommand(), argv);
}

export function exportCommand() {
	return withMeta(
		command({
			name: "export",
			description: "export aliases as references only (never values)",
			args: {
				format: option({
					long: "format",
					type: string,
					defaultValue: () => "env-ref",
					description: "env-ref | json-ref",
				}),
			},
			handler: async ({ format }): Promise<Result<string, string>> => {
				if (format !== "env-ref" && format !== "json-ref")
					return err("--format must be env-ref|json-ref (--reveal values arrive with the daemon feature)");
				const home = jtkHome();
				const cfg = await loadConfig(home);
				if (cfg.isErr()) return err(cfg.error);
				const body = format === "env-ref" ? formatEnvRef(cfg.value.aliases) : formatJsonRef(cfg.value.aliases);
				return ok(body.trimEnd());
			},
		}),
		{ reads: ["config"], writes: [], env: ["JTK_HOME"] },
	);
}

export async function runExport(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(exportCommand(), argv);
}
