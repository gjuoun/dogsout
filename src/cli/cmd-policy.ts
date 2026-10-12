import { command, multioption, option, optional, positional, string, subcommands } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import type { Config } from "../../contracts/index.ts";
import { PrincipalSchema, RuleSchema, SettingsSchema } from "../../contracts/index.ts";
import { sha256Hex } from "../ask/flow.ts";
import { evaluate } from "../policy/evaluate.ts";
import { parseDuration } from "../policy/ttl.ts";
import { loadGrants, revokeByAlias } from "../session/grants.ts";
import { loadSessions } from "../session/session.ts";
import { parseAddress } from "./address.ts";
import { runJtk, withMeta } from "./cmd.ts";
import { ctxFromEnv, openDataOnce } from "./cmd-crud.ts";
import { resolveToAddress } from "./map.ts";
import { jtkHome } from "./paths.ts";
import { type Ctx, loadConfig, writeConfig } from "./store.ts";

async function ctxAndConfig(): Promise<Result<{ ctx: Ctx; cfg: Config }, string>> {
	const ctx = ctxFromEnv();
	if (ctx.isErr()) return err(ctx.error);
	const cfg = await loadConfig(ctx.value.home);
	if (cfg.isErr()) return err(cfg.error);
	return ok({ ctx: ctx.value, cfg: cfg.value });
}

async function activeSessionIds(home: string): Promise<string[]> {
	const s = await loadSessions(home);
	return s.isOk() ? s.value.sessions.map((x) => x.id) : [];
}

/** Preview decisions for aliases — same evaluator as live, nothing granted, nothing revealed. */
async function simulateCore(a: { principal: string; group: string[]; alias: string[] }): Promise<Result<string, string>> {
	const ac = await ctxAndConfig();
	if (ac.isErr()) return err(ac.error);
	const { ctx, cfg } = ac.value;
	const opened = await openDataOnce(ctx);
	if (opened.isErr()) return err(opened.error);
	const grants = await loadGrants(ctx.home);
	if (grants.isErr()) return err(grants.error);
	const targets = a.alias.length > 0 ? a.alias : Object.keys(cfg.aliases);
	if (targets.length === 0) return err("no aliases configured — nothing to simulate");

	const lines: string[] = [];
	for (const alias of targets) {
		const resolved = resolveToAddress(alias, cfg);
		if (resolved.isErr()) {
			lines.push(alias + ": ERROR " + resolved.error);
			continue;
		}
		const parsed = parseAddress(resolved.value.address);
		if (parsed.isErr()) {
			lines.push(alias + ": ERROR " + parsed.error);
			continue;
		}
		const raw = opened.value.data.vaults[parsed.value.vault]?.[parsed.value.item]?.fields[parsed.value.field];
		const valueHash = raw !== undefined ? await sha256Hex(raw) : "(missing)";
		const v = evaluate({
			principal: a.principal,
			groups: a.group,
			alias,
			address: resolved.value.address,
			valueHash,
			rules: cfg.rules ?? [],
			grants: grants.value.grants,
			defaultDecision: cfg.settings?.default_decision ?? "ask",
			activeSessions: await activeSessionIds(ctx.home),
			now: new Date(),
		});
		lines.push(alias + ": " + v.kind + "  [" + v.via + "] " + v.reason);
	}
	return ok(lines.join("\n"));
}

/** Explain the current decision for one alias: matched rule and grant state. */
async function whyCore(a: { alias: string; principal: string }): Promise<Result<string, string>> {
	const ac = await ctxAndConfig();
	if (ac.isErr()) return err(ac.error);
	const { ctx, cfg } = ac.value;
	const opened = await openDataOnce(ctx);
	if (opened.isErr()) return err(opened.error);
	const grants = await loadGrants(ctx.home);
	if (grants.isErr()) return err(grants.error);
	const resolved = resolveToAddress(a.alias, cfg);
	if (resolved.isErr()) return err(resolved.error);
	const parsed = parseAddress(resolved.value.address);
	if (parsed.isErr()) return err(parsed.error);
	const raw = opened.value.data.vaults[parsed.value.vault]?.[parsed.value.item]?.fields[parsed.value.field];
	const valueHash = raw !== undefined ? await sha256Hex(raw) : "(missing)";
	const v = evaluate({
		principal: a.principal,
		alias: a.alias,
		address: resolved.value.address,
		valueHash,
			rules: cfg.rules ?? [],
			grants: grants.value.grants,
			defaultDecision: cfg.settings?.default_decision ?? "ask",
			activeSessions: await activeSessionIds(ctx.home),
			now: new Date(),
	});
	const lines = [a.alias + ": " + v.kind + "  [" + v.via + "] " + v.reason];
	if (v.grant) {
		const left =
			v.grant.expires_at === null
				? "session-bound"
				: Math.max(0, Math.round((new Date(v.grant.expires_at).getTime() - Date.now()) / 60_000)) + "m left";
		lines.push(
			"  grant " + v.grant.id.slice(0, 8) + " ttl=" + v.grant.ttl + " via=" + v.grant.approved_via + " " + left,
		);
	}
	return ok(lines.join("\n"));
}

interface PolicyCase {
	principal: string;
	groups?: string[];
	alias: string;
	address?: string;
	expect: "allow" | "ask" | "deny";
}

/** Regression fixtures: expected decisions run through the pure evaluator with no grants. */
async function policyTestCore(a: { file: string }): Promise<Result<string, string>> {
	let raw: unknown;
	try {
		raw = JSON.parse(await Bun.file(a.file).text());
	} catch {
		return err("cannot read cases file: " + a.file);
	}
	const cases = raw as { cases?: PolicyCase[] };
	if (!Array.isArray(cases.cases)) return err('cases file must be { "cases": [...] }');
	const ac = await ctxAndConfig();
	if (ac.isErr()) return err(ac.error);
	const { cfg } = ac.value;
	const failures: string[] = [];
	for (const c of cases.cases) {
		const v = evaluate({
			principal: c.principal,
			groups: c.groups ?? [],
			alias: c.alias,
			address: c.address ?? "jtk://sim/" + c.alias + "/value",
			valueHash: "fixture-hash",
			rules: cfg.rules ?? [],
			grants: [],
			defaultDecision: cfg.settings?.default_decision ?? "ask",
			now: new Date(),
		});
		if (v.kind !== c.expect)
			failures.push(
				c.principal + " x " + c.alias + ": expected " + c.expect + ", got " + v.kind + " [" + v.via + "] " + v.reason,
			);
	}
	if (failures.length > 0) return err(failures.join("\n"));
	return ok(cases.cases.length + " cases pass");
}

async function configShow(): Promise<Result<string, string>> {
	const cfg = await loadConfig(jtkHome());
	if (cfg.isErr()) return err(cfg.error);
	return ok(JSON.stringify(cfg.value, null, 2));
}

const SETTABLE: Record<string, (v: string) => Result<string | undefined, string>> = {
	default_decision: (v) => (["allow", "ask", "deny"].includes(v) ? ok(v) : err("must be allow|ask|deny")),
	always_decay: (v) => (parseDuration(v) !== null ? ok(v) : err("must be a duration like 720h")),
};

async function configSetCore(a: { key: string; value: string }): Promise<Result<string, string>> {
	const validate = SETTABLE[a.key];
	if (!validate) {
		return err("jtk policy config set <key> <value> — keys: " + Object.keys(SETTABLE).join(", "));
	}
	const checked = validate(a.value);
	if (checked.isErr()) return err(a.key + ": " + checked.error);
	const home = jtkHome();
	const cfg = await loadConfig(home);
	if (cfg.isErr()) return err(cfg.error);
	cfg.value.settings = { ...(cfg.value.settings ?? SettingsSchema.parse({})), [a.key]: checked.value };
	const w = await writeConfig(home, cfg.value);
	if (w.isErr()) return err(w.error);
	return ok(a.key + " = " + checked.value);
}

async function ruleAddCore(a: { json: string }): Promise<Result<string, string>> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(a.json);
	} catch {
		return err("rule json is not valid JSON");
	}
	const rule = RuleSchema.safeParse(parsed);
	if (!rule.success) return err("invalid rule: " + rule.error.issues[0]?.message);
	const home = jtkHome();
	const cfg = await loadConfig(home);
	if (cfg.isErr()) return err(cfg.error);
	const rules = cfg.value.rules ?? [];
	if (rules.some((r) => r.id === rule.data.id)) return err("duplicate rule id: " + rule.data.id);
	rules.push(rule.data);
	cfg.value.rules = rules;
	const w = await writeConfig(home, cfg.value);
	if (w.isErr()) return err(w.error);
	return ok("rule " + rule.data.id + " added (position " + rules.length + ", last-match-wins)");
}

async function ruleRmCore(a: { id: string }): Promise<Result<string, string>> {
	const home = jtkHome();
	const cfg = await loadConfig(home);
	if (cfg.isErr()) return err(cfg.error);
	const rules = cfg.value.rules ?? [];
	const next = rules.filter((r) => r.id !== a.id);
	if (next.length === rules.length) return err("no such rule: " + a.id);
	cfg.value.rules = next;
	const w = await writeConfig(home, cfg.value);
	if (w.isErr()) return err(w.error);
	return ok("rule " + a.id + " removed");
}

async function principalAddCore(a: { json: string }): Promise<Result<string, string>> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(a.json);
	} catch {
		return err("principal json is not valid JSON");
	}
	const p = PrincipalSchema.safeParse(parsed);
	if (!p.success) return err("invalid principal: " + p.error.issues[0]?.message);
	const home = jtkHome();
	const cfg = await loadConfig(home);
	if (cfg.isErr()) return err(cfg.error);
	const principals = cfg.value.principals ?? [];
	if (principals.some((x) => x.name === p.data.name)) return err("duplicate principal: " + p.data.name);
	principals.push(p.data);
	cfg.value.principals = principals;
	const w = await writeConfig(home, cfg.value);
	if (w.isErr()) return err(w.error);
	return ok("principal " + p.data.name + " added");
}

async function principalRmCore(a: { name: string }): Promise<Result<string, string>> {
	const home = jtkHome();
	const cfg = await loadConfig(home);
	if (cfg.isErr()) return err(cfg.error);
	const principals = cfg.value.principals ?? [];
	const next = principals.filter((p) => p.name !== a.name);
	if (next.length === principals.length) return err("no such principal: " + a.name);
	cfg.value.principals = next;
	const w = await writeConfig(home, cfg.value);
	if (w.isErr()) return err(w.error);
	return ok("principal " + a.name + " removed");
}

function configCommand() {
	return subcommands({
		name: "config",
		description: "inspect and safely edit policy settings, rules and principals",
		cmds: {
			show: command({
				name: "show",
				description: "print the current config json",
				args: {},
				handler: configShow,
			}),
			set: command({
				name: "set",
				description: "set one settings key (default_decision, always_decay)",
				args: {
					key: positional({ type: string, displayName: "key" }),
					value: positional({ type: string, displayName: "value" }),
				},
				handler: configSetCore,
			}),
			rule: subcommands({
				name: "rule",
				description: "add or remove access rules",
				cmds: {
					add: command({
						name: "add",
						description: "append a rule json (last-match-wins)",
						args: { json: positional({ type: string, displayName: "<json>" }) },
						handler: ruleAddCore,
					}),
					rm: command({
						name: "rm",
						description: "remove a rule by id",
						args: { id: positional({ type: string, displayName: "id" }) },
						handler: ruleRmCore,
					}),
				},
			}),
			principal: subcommands({
				name: "principal",
				description: "add or remove principals",
				cmds: {
					add: command({
						name: "add",
						description: "append a principal json",
						args: { json: positional({ type: string, displayName: "<json>" }) },
						handler: principalAddCore,
					}),
					rm: command({
						name: "rm",
						description: "remove a principal by name",
						args: { name: positional({ type: string, displayName: "name" }) },
						handler: principalRmCore,
					}),
				},
			}),
		},
	});
}

export function policyCommand() {
	return withMeta(
		subcommands({
			name: "policy",
			description: "preview, explain and regression-test policy decisions; safe config edits",
			cmds: {
				simulate: command({
					name: "simulate",
					description: "preview decisions for aliases (nothing granted, nothing revealed)",
					args: {
						principal: option({
							long: "principal",
							type: string,
							defaultValue: "cli@simulate",
							description: "requesting principal",
						}),
						group: multioption({ long: "group", type: string, description: "principal group (repeatable)" }),
						alias: multioption({ long: "alias", type: string, description: "alias to preview (repeatable; default all)" }),
					},
					handler: simulateCore,
				}),
				why: command({
					name: "why",
					description: "explain the current decision for one alias",
					args: {
						alias: option({ long: "alias", type: string, description: "alias to explain" }),
						principal: option({
							long: "principal",
							type: string,
							defaultValue: "cli@simulate",
							description: "requesting principal",
						}),
					},
					handler: whyCore,
				}),
				test: command({
					name: "test",
					description: "run decision fixtures from a cases json",
					args: { file: positional({ type: string, displayName: "cases.json" }) },
					handler: policyTestCore,
				}),
				config: configCommand(),
			},
		}),
		{ reads: ["vault", "config", "grants", "sessions"], writes: ["config"], env: ["JTK_HOME", "JTK_MASTER"] },
	);
}

export async function runPolicy(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(policyCommand(), argv);
}

async function grantsLsCore(a: { principal?: string }): Promise<Result<string, string>> {
	const file = await loadGrants(jtkHome());
	if (file.isErr()) return err(file.error);
	const active = await activeSessionIds(jtkHome());
	const now = new Date();
	const rows = file.value.grants
		.filter((g) => (a.principal ? g.principal === a.principal : true))
		.filter((g) => !g.consumed && (g.expires_at === null || new Date(g.expires_at) > now))
		.map((g) => {
			const left =
				g.expires_at === null
					? "session" + (active.includes(g.session ?? "") ? "" : " (closed)")
					: Math.round((new Date(g.expires_at).getTime() - now.getTime()) / 60_000) + "m";
			return g.principal + "  " + g.alias + "  ttl=" + g.ttl + "  " + left + "  via=" + g.approved_via;
		});
	return ok(rows.length > 0 ? rows.join("\n") : "(no live grants)");
}

async function grantsRmCore(a: { alias: string; principal?: string }): Promise<Result<string, string>> {
	const grants = await loadGrants(jtkHome());
	if (grants.isErr()) return err(grants.error);
	const targets = grants.value.grants.filter(
		(g) => g.alias === a.alias && (a.principal ? g.principal === a.principal : true),
	);
	if (targets.length === 0) return err("no grants for alias " + a.alias);
	let removed = 0;
	for (const t of targets) {
		const r = await revokeByAlias(jtkHome(), t.principal, t.alias);
		if (r.isErr()) return err(r.error);
		removed += r.value;
	}
	return ok("revoked " + removed + " grant(s) for " + a.alias + " — next request re-asks");
}

export function grantsCommand() {
	return withMeta(
		subcommands({
			name: "grants",
			description: "inspect and revoke approvals (metadata only, never values)",
			cmds: {
				ls: command({
					name: "ls",
					description: "list live grants",
					args: { principal: option({ long: "principal", type: optional(string), description: "filter by principal" }) },
					handler: grantsLsCore,
				}),
				rm: command({
					name: "rm",
					description: "revoke grants for an alias",
					args: {
						alias: positional({ type: string, displayName: "ALIAS" }),
						principal: option({ long: "principal", type: optional(string), description: "filter by principal" }),
							},
					handler: grantsRmCore,
				}),
			},
		}),
		{ reads: ["grants", "sessions"], writes: ["grants"], env: ["JTK_HOME"] },
	);
}

export async function runGrants(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(grantsCommand(), argv);
}
