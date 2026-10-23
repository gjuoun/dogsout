import {
	loadConfig,
	nowIso,
	openData,
	parseAddressStrict,
	parseEnvFile,
	saveData,
	segmentProblem,
	writeConfig,
} from "@dogsout/core";
import { command, option, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

/**
 * Env names are UPPER_SNAKE by POSIX convention while address segments are lowercase
 * [a-z0-9_-]; the field name is the lowercased key (GITHUB_TOKEN -> github_token). Unchanged
 * otherwise, so a lowercase key imports under its own name.
 */
function fieldOf(key: string): Result<string, string> {
	const field = key.toLowerCase();
	const problem = segmentProblem("field", field);
	if (problem !== null) return err(`${problem} (from key "${key}" in the env file)`);
	return ok(field);
}

export function importEnvCommand() {
	return withMeta(
		command({
			name: "import-env",
			description: "import a .env file: literal values into the vault, dogsout:// refs become aliases",
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
				if (plan.legacy.length > 0) {
					const first = plan.legacy[0] as { key: string; value: string };
					return err(
						`${first.key} uses the retired jtk:// scheme — rewrite it as dogsout:// (run: dogsout migrate for stored aliases)`,
					);
				}

				// Validate the whole file before touching the vault: an import either lands completely
				// or not at all (a half-imported .env is worse than a refused one).
				const problems: string[] = [];
				const vaultProblem = segmentProblem("vault", vault);
				if (vaultProblem !== null) problems.push(vaultProblem);
				const itemProblem = segmentProblem("item", item);
				if (itemProblem !== null) problems.push(itemProblem);
				const directs: Array<{ field: string; value: string }> = [];
				const claimed = new Map<string, string>();
				for (const d of plan.directs) {
					const field = fieldOf(d.key);
					if (field.isErr()) {
						problems.push(field.error);
						continue;
					}
					const previous = claimed.get(field.value);
					if (previous !== undefined) {
						problems.push(`keys "${previous}" and "${d.key}" both become field "${field.value}" — rename one`);
						continue;
					}
					claimed.set(field.value, d.key);
					directs.push({ field: field.value, value: d.value });
				}
				for (const r of plan.refs) {
					const parsed = parseAddressStrict(r.value);
					if (parsed.isErr()) problems.push(`ref ${r.key}=${r.value}: ${parsed.error}`);
				}
				if (problems.length > 0) {
					return err(`import aborted, nothing written:\n  ${problems.join("\n  ")}`);
				}

				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const ctx = ctxR.value;
				const home = ctx.home;
				const opened = await openData(ctx);
				if (opened.isErr()) return err(opened.error);
				const { envelope, data } = opened.value;
				data.vaults[vault] ??= {};
				const items = data.vaults[vault];
				if (!items[item]) items[item] = { fields: {}, updated_at: nowIso() };
				const target = items[item];
				for (const d of directs) target.fields[d.field] = d.value;
				target.updated_at = nowIso();
				const saved = await saveData(ctx, envelope, data);
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
				return ok(`imported ${directs.length} values, ${plan.refs.length} refs${skippedNote} -> ${vault}/${item}`);
			},
		}),
		{ reads: ["vault", "config"], writes: ["vault", "config"], env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER"] },
	);
}

export async function runImportEnv(argv: string[]): Promise<Result<string, string>> {
	return runDogsout<string>(importEnvCommand(), argv);
}
