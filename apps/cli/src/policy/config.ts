import { dogsoutHome, loadConfig, parseDuration, writeConfig } from "@dogsout/core";
import { PrincipalSchema, RuleSchema, SettingsSchema } from "@dogsout/type-contracts";
import { command, positional, string, subcommands } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";

async function configShow(): Promise<Result<string, string>> {
	const cfg = await loadConfig(dogsoutHome());
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
		return err("dogsout policy config set <key> <value> — keys: " + Object.keys(SETTABLE).join(", "));
	}
	const checked = validate(a.value);
	if (checked.isErr()) return err(a.key + ": " + checked.error);
	const home = dogsoutHome();
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
	const home = dogsoutHome();
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
	const home = dogsoutHome();
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
	const home = dogsoutHome();
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
	const home = dogsoutHome();
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

export function configShowCommand() {
	return command({ name: "show", description: "print the current config json", args: {}, handler: configShow });
}

export function configSetCommand() {
	return command({
		name: "set",
		description: "set one settings key (default_decision, always_decay)",
		args: {
			key: positional({ type: string, displayName: "key" }),
			value: positional({ type: string, displayName: "value" }),
		},
		handler: configSetCore,
	});
}

export function ruleAddCommand() {
	return command({
		name: "add",
		description: "append a rule json (last-match-wins)",
		args: { json: positional({ type: string, displayName: "<json>" }) },
		handler: ruleAddCore,
	});
}

export function ruleRmCommand() {
	return command({
		name: "rm",
		description: "remove a rule by id",
		args: { id: positional({ type: string, displayName: "id" }) },
		handler: ruleRmCore,
	});
}

export function principalAddCommand() {
	return command({
		name: "add",
		description: "append a principal json",
		args: { json: positional({ type: string, displayName: "<json>" }) },
		handler: principalAddCore,
	});
}

export function principalRmCommand() {
	return command({
		name: "rm",
		description: "remove a principal by name",
		args: { name: positional({ type: string, displayName: "name" }) },
		handler: principalRmCore,
	});
}

export function configCommand() {
	return subcommands({
		name: "config",
		description: "inspect and safely edit policy settings, rules and principals",
		cmds: {
			show: configShowCommand(),
			set: configSetCommand(),
			rule: subcommands({
				name: "rule",
				description: "add or remove access rules",
				cmds: { add: ruleAddCommand(), rm: ruleRmCommand() },
			}),
			principal: subcommands({
				name: "principal",
				description: "add or remove principals",
				cmds: { add: principalAddCommand(), rm: principalRmCommand() },
			}),
		},
	});
}
