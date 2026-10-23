import {
	applyMigration,
	dogsoutHome,
	legacyHome,
	type MigrationPlan,
	planMigration,
	storageGuard,
} from "@dogsout/core";
import { command, flag, option, optional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { runDogsout, withMeta } from "./cmd.ts";

/**
 * `dogsout migrate` — the one-time rename migration: stored addresses
 * `jtk://` → `dogsout://`, then the storage directory ~/.config/junethekey →
 * ~/.config/dogsout. `--dry-run` prints the plan and touches nothing; a second run
 * reports zero rewrites and writes no file (idempotent).
 */
function describePlan(p: MigrationPlan): string {
	const storage: Record<MigrationPlan["storage"]["action"], string> = {
		move: `move ${p.storage.from} -> ${p.storage.to}`,
		"already-migrated": `already migrated (${p.home})`,
		"explicit-home": `skipped (explicit DOGSOUT_HOME=${p.home})`,
		none: "no legacy storage found",
	};
	const lines: string[] = [`storage: ${storage[p.storage.action]}`];
	for (const f of p.files) {
		if (!f.exists) {
			lines.push(`${f.path}: absent`);
			continue;
		}
		lines.push(`${f.path}: ${f.rewrites} address(es)${f.sample ? ` (e.g. ${f.sample})` : ""}`);
	}
	lines.push(`total: ${p.totalRewrites} rewrites`);
	return lines.join("\n");
}

export function migrateCommand() {
	return withMeta(
		command({
			name: "migrate",
			description: "one-time rename migration: jtk:// addresses -> dogsout://, storage dir -> ~/.config/dogsout",
			args: {
				dryRun: flag({ long: "dry-run", description: "print the plan, change nothing" }),
				home: option({
					long: "home",
					type: optional(string),
					description: "target storage root (default DOGSOUT_HOME or ~/.config/dogsout)",
				}),
				legacy: option({
					long: "legacy-home",
					type: optional(string),
					description: "pre-rename storage root (default ~/.config/junethekey)",
				}),
			},
			handler: async ({ dryRun, home, legacy }): Promise<Result<string, string>> => {
				const opts = { home: home ?? dogsoutHome(), legacy: legacy ?? legacyHome() };
				const planned = await planMigration(opts);
				if (planned.isErr()) return err(planned.error);
				const plan = planned.value;
				if (dryRun) return ok(`migrate (dry-run):\n${describePlan(plan)}`);
				if (plan.totalRewrites === 0 && plan.storage.action !== "move") {
					return ok(`migrate: nothing to do\n${describePlan(plan)}`);
				}
				const applied = await applyMigration(plan);
				if (applied.isErr()) return err(applied.error);
				const r = applied.value;
				const moved = r.storage === "move" ? `, storage moved ${r.from} -> ${r.to}` : "";
				return ok(`migrated: ${r.rewrites} addresses in ${r.filesWritten} file(s)${moved}`);
			},
		}),
		{ reads: ["config", "grants"], writes: ["config", "grants"], env: ["DOGSOUT_HOME"] },
	);
}

export async function runMigrate(argv: string[]): Promise<Result<string, string>> {
	return runDogsout<string>(migrateCommand(), argv);
}

/** Non-null when a command must point at `dogsout migrate` instead of creating new storage. */
export function migrationRequired(): string | null {
	return storageGuard();
}
