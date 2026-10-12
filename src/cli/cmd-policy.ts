import { err, ok, type Result } from "neverthrow";
import type { Config } from "../../contracts/index.ts";
import { PrincipalSchema, RuleSchema, SettingsSchema } from "../../contracts/index.ts";
import { sha256Hex } from "../ask/flow.ts";
import { evaluate } from "../policy/evaluate.ts";
import { parseDuration } from "../policy/ttl.ts";
import { loadGrants, revokeByAlias } from "../session/grants.ts";
import { loadSessions } from "../session/session.ts";
import { parseAddress } from "./address.ts";
import { ctxFromEnv, openDataOnce } from "./cmd-crud.ts";
import { resolveToAddress } from "./map.ts";
import { jtkHome } from "./paths.ts";
import { type Ctx, loadConfig, writeConfig } from "./store.ts";

function usage(): Result<never, string> {
	return err(
		[
			"usage:",
			"  jtk policy simulate [--principal P] [--group G]... [--alias A]...",
			"  jtk policy why --alias A [--principal P]",
			"  jtk policy test <cases.json>",
			"  jtk policy config show | set <key> <value> | rule add <json> | rule rm <id> | principal add <json> | principal rm <name>",
			"  jtk grants ls [--principal P] | rm <ALIAS> [--principal P]",
		].join("\n"),
	);
}

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
async function simulate(argv: string[]): Promise<Result<string, string>> {
	const principal = flagValue(argv, "--principal") ?? "cli@simulate";
	const groups = repeatedValues(argv, "--group");
	const aliases = repeatedValues(argv, "--alias");
	const ac = await ctxAndConfig();
	if (ac.isErr()) return err(ac.error);
	const { ctx, cfg } = ac.value;
	const opened = await openDataOnce(ctx);
	if (opened.isErr()) return err(opened.error);
	const grants = await loadGrants(ctx.home);
	if (grants.isErr()) return err(grants.error);
	const targets = aliases.length > 0 ? aliases : Object.keys(cfg.aliases);
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
			principal,
			groups,
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
async function why(argv: string[]): Promise<Result<string, string>> {
	const alias = flagValue(argv, "--alias");
	if (!alias) return err("jtk policy why --alias A [--principal P]");
	const principal = flagValue(argv, "--principal") ?? "cli@simulate";
	const ac = await ctxAndConfig();
	if (ac.isErr()) return err(ac.error);
	const { ctx, cfg } = ac.value;
	const opened = await openDataOnce(ctx);
	if (opened.isErr()) return err(opened.error);
	const grants = await loadGrants(ctx.home);
	if (grants.isErr()) return err(grants.error);
	const resolved = resolveToAddress(alias, cfg);
	if (resolved.isErr()) return err(resolved.error);
	const parsed = parseAddress(resolved.value.address);
	if (parsed.isErr()) return err(parsed.error);
	const raw = opened.value.data.vaults[parsed.value.vault]?.[parsed.value.item]?.fields[parsed.value.field];
	const valueHash = raw !== undefined ? await sha256Hex(raw) : "(missing)";
	const v = evaluate({
		principal,
		alias,
		address: resolved.value.address,
		valueHash,
		rules: cfg.rules ?? [],
		grants: grants.value.grants,
		defaultDecision: cfg.settings?.default_decision ?? "ask",
		activeSessions: await activeSessionIds(ctx.home),
		now: new Date(),
	});
	const lines = [alias + ": " + v.kind + "  [" + v.via + "] " + v.reason];
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
async function policyTest(argv: string[]): Promise<Result<string, string>> {
	const file = argv.find((a) => !a.startsWith("--"));
	if (!file) return err("jtk policy test <cases.json>");
	let raw: unknown;
	try {
		raw = JSON.parse(await Bun.file(file).text());
	} catch {
		return err("cannot read cases file: " + file);
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

async function configSet(argv: string[]): Promise<Result<string, string>> {
	const [key, value] = argv.filter((a) => !a.startsWith("--"));
	if (!key || value === undefined)
		return err("jtk policy config set <key> <value> — keys: " + Object.keys(SETTABLE).join(", "));
	const validate = SETTABLE[key];
	if (!validate) return err("unknown setting: " + key);
	const checked = validate(value);
	if (checked.isErr()) return err(key + ": " + checked.error);
	const home = jtkHome();
	const cfg = await loadConfig(home);
	if (cfg.isErr()) return err(cfg.error);
	cfg.value.settings = { ...(cfg.value.settings ?? SettingsSchema.parse({})), [key]: checked.value };
	const w = await writeConfig(home, cfg.value);
	if (w.isErr()) return err(w.error);
	return ok(key + " = " + checked.value);
}

async function ruleAdd(argv: string[]): Promise<Result<string, string>> {
	const json = argv.find((a) => !a.startsWith("--"));
	if (!json) return err("jtk policy config rule add '<json>'");
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
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

async function ruleRm(argv: string[]): Promise<Result<string, string>> {
	const id = argv.find((a) => !a.startsWith("--"));
	if (!id) return err("jtk policy config rule rm <id>");
	const home = jtkHome();
	const cfg = await loadConfig(home);
	if (cfg.isErr()) return err(cfg.error);
	const rules = cfg.value.rules ?? [];
	const next = rules.filter((r) => r.id !== id);
	if (next.length === rules.length) return err("no such rule: " + id);
	cfg.value.rules = next;
	const w = await writeConfig(home, cfg.value);
	if (w.isErr()) return err(w.error);
	return ok("rule " + id + " removed");
}

async function principalAdd(argv: string[]): Promise<Result<string, string>> {
	const json = argv.find((a) => !a.startsWith("--"));
	if (!json) return err("jtk policy config principal add '<json>'");
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
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

async function principalRm(argv: string[]): Promise<Result<string, string>> {
	const name = argv.find((a) => !a.startsWith("--"));
	if (!name) return err("jtk policy config principal rm <name>");
	const home = jtkHome();
	const cfg = await loadConfig(home);
	if (cfg.isErr()) return err(cfg.error);
	const principals = cfg.value.principals ?? [];
	const next = principals.filter((p) => p.name !== name);
	if (next.length === principals.length) return err("no such principal: " + name);
	cfg.value.principals = next;
	const w = await writeConfig(home, cfg.value);
	if (w.isErr()) return err(w.error);
	return ok("principal " + name + " removed");
}

async function policyConfig(argv: string[]): Promise<Result<string, string>> {
	const [sub, ...rest] = argv;
	switch (sub) {
		case "show":
			return await configShow();
		case "set":
			return await configSet(rest);
		case "rule":
			if (rest[0] === "add") return await ruleAdd(rest.slice(1));
			if (rest[0] === "rm") return await ruleRm(rest.slice(1));
			return err("usage: jtk policy config rule add <json> | rule rm <id>");
		case "principal":
			if (rest[0] === "add") return await principalAdd(rest.slice(1));
			if (rest[0] === "rm") return await principalRm(rest.slice(1));
			return err("usage: jtk policy config principal add <json> | principal rm <name>");
		default:
			return err("jtk policy config show|set|rule|principal");
	}
}

export async function runPolicy(argv: string[]): Promise<Result<string, string>> {
	const [sub, ...rest] = argv;
	switch (sub) {
		case "simulate":
			return await simulate(rest);
		case "why":
			return await why(rest);
		case "test":
			return await policyTest(rest);
		case "config":
			return await policyConfig(rest);
		default:
			return usage();
	}
}

export async function runGrants(argv: string[]): Promise<Result<string, string>> {
	const [sub, ...rest] = argv;
	const principal = flagValue(rest, "--principal");
	if (sub === "ls") {
		const file = await loadGrants(jtkHome());
		if (file.isErr()) return err(file.error);
		const active = await activeSessionIds(jtkHome());
		const now = new Date();
		const rows = file.value.grants
			.filter((g) => (principal ? g.principal === principal : true))
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
	if (sub === "rm") {
		const alias = rest.find((a) => !a.startsWith("--"));
		if (!alias) return err("jtk grants rm <ALIAS> [--principal P]");
		const grants = await loadGrants(jtkHome());
		if (grants.isErr()) return err(grants.error);
		const targets = grants.value.grants.filter(
			(g) => g.alias === alias && (principal ? g.principal === principal : true),
		);
		if (targets.length === 0) return err("no grants for alias " + alias);
		let removed = 0;
		for (const t of targets) {
			const r = await revokeByAlias(jtkHome(), t.principal, t.alias);
			if (r.isErr()) return err(r.error);
			removed += r.value;
		}
		return ok("revoked " + removed + " grant(s) for " + alias + " — next request re-asks");
	}
	return err("jtk grants ls [--principal P] | rm <ALIAS> [--principal P]");
}

function flagValue(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(name);
	return i !== -1 ? argv[i + 1] : undefined;
}

function repeatedValues(argv: string[], name: string): string[] {
	const out: string[] = [];
	for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1] as string);
	return out;
}
