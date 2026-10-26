import {
	fieldNameOf,
	loadConfig,
	nowIso,
	openData,
	parseAddressStrict,
	parseEnvFile,
	parseOnePasswordRef,
	saveData,
	segmentProblem,
	writeConfig,
} from "@dogsout/core";
import { command, option, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

export function importEnvCommand() {
	return withMeta(
		command({
			name: "import-env",
			description:
				"import a .env file: literal values into the vault, dogsout:// refs become aliases, op:// lines become config refs",
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
					const field = fieldNameOf(d.key);
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
				// An op:// line becomes a config ref served by the service account. The 1Password vault
				// becomes the address item, so a vault name that is not a valid segment (Personal Vault)
				// aborts the whole import instead of being silently renamed.
				const opRefs: Array<{ address: string; ref: string }> = [];
				const claimedAddresses = new Map<string, string>();
				for (const line of plan.skipped) {
					const parsed = parseOnePasswordRef(line.value);
					if (parsed.isErr()) {
						problems.push(`${line.key}: ${parsed.error}`);
						continue;
					}
					const field = fieldNameOf(line.key);
					if (field.isErr()) {
						problems.push(field.error);
						continue;
					}
					// The reference namespace is fixed at `op` (item = the 1Password vault), independent of
					// --vault, which only chooses where literal values land.
					const address = `dogsout://op/${parsed.value.vault.toLowerCase()}/${field.value}`;
					const checked = parseAddressStrict(address);
					if (checked.isErr()) {
						problems.push(`${line.key} -> ${address}: ${checked.error}`);
						continue;
					}
					const previous = claimedAddresses.get(address);
					if (previous !== undefined) {
						problems.push(`keys "${previous}" and "${line.key}" both become ${address} — rename one`);
						continue;
					}
					claimedAddresses.set(address, line.key);
					opRefs.push({ address, ref: parsed.value.ref });
				}
				if (problems.length > 0) {
					return err(`import aborted, nothing written:\n  ${problems.join("\n  ")}`);
				}

				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const ctx = ctxR.value;
				const home = ctx.home;
				// A file of references only must not unlock the vault: open it solely for literal values.
				if (directs.length > 0) {
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
				}

				if (plan.refs.length > 0 || opRefs.length > 0) {
					const cfg = await loadConfig(home);
					if (cfg.isErr()) return err(cfg.error);
					for (const r of plan.refs) cfg.value.aliases[r.key] = r.value;
					for (const e of opRefs) cfg.value.refs[e.address] = e.ref;
					const w = await writeConfig(home, cfg.value);
					if (w.isErr()) return err(w.error);
				}

				const opNote = opRefs.length > 0 ? `, ${opRefs.length} 1password refs -> op` : ` -> ${vault}/${item}`;
				return ok(`imported ${directs.length} values, ${plan.refs.length} refs${opNote}`);
			},
		}),
		{ reads: ["vault", "config"], writes: ["vault", "config"], env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER"] },
	);
}

export async function runImportEnv(argv: string[]): Promise<Result<string, string>> {
	return runDogsout<string>(importEnvCommand(), argv);
}
