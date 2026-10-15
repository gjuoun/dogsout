import { evaluate } from "@jtk/core";
import { command, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { ctxAndConfig } from "../context.ts";

interface PolicyCase {
	principal: string;
	groups?: string[];
	alias: string;
	address?: string;
	expect: "allow" | "ask" | "deny";
}

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

export function policyTestCommand() {
	return command({
		name: "test",
		description: "run decision fixtures from a cases json",
		args: { file: positional({ type: string, displayName: "cases.json" }) },
		handler: policyTestCore,
	});
}
