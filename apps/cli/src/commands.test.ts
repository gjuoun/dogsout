import { describe, expect, test } from "bun:test";
import type { JtkMeta } from "./cmd.ts";
import { COMMANDS, SUBCOMMANDS } from "./commands.ts";

const EXPECTED = [
	"init",
	"set",
	"get",
	"ls",
	"rm",
	"alias",
	"map",
	"run",
	"policy",
	"grants",
	"import-env",
	"export",
	"vault",
];

const metaOf = (cmd: unknown): JtkMeta | undefined => (cmd as { meta?: JtkMeta }).meta;
const topicsOf = (cmd: unknown): Array<{ usage: string }> =>
	typeof (cmd as { helpTopics?: unknown }).helpTopics === "function"
		? ((cmd as { helpTopics: () => Array<{ usage: string }> }).helpTopics() as Array<{ usage: string }>)
		: [];

/** Collect leaf commands from the nested subcommand tree. */
function leaves(tree: Record<string, unknown>, prefix: string, out: Array<[string, unknown]>): void {
	for (const [name, node] of Object.entries(tree)) {
		if (node && typeof node === "object" && typeof (node as { helpTopics?: unknown }).helpTopics === "function") {
			out.push([`${prefix}${name}`, node]);
		} else if (node && typeof node === "object") {
			leaves(node as Record<string, unknown>, `${prefix}${name} `, out);
		}
	}
}

/**
 * Extraction contract for the notebook feature map: ctx/check import COMMANDS and
 * SUBCOMMANDS, then read helpTopics (args/flags) + meta (reads/writes/env).
 */
describe("command table contract (feature map extraction)", () => {
	test("exposes exactly the expected CLI commands", () => {
		expect(Object.keys(COMMANDS).sort()).toEqual([...EXPECTED].sort());
	});

	test("every top-level command carries reads/writes/env meta", () => {
		for (const [name, cmd] of Object.entries(COMMANDS)) {
			const m = metaOf(cmd);
			expect(m, `${name}: meta missing`).toBeDefined();
			if (!m) continue;
			expect(Array.isArray(m.reads), `${name}: reads`).toBe(true);
			expect(Array.isArray(m.writes), `${name}: writes`).toBe(true);
			expect(Array.isArray(m.env) && m.env.length > 0, `${name}: env`).toBe(true);
		}
	});

	test("leaf commands expose help topics with non-empty usage", () => {
		for (const [name, cmd] of Object.entries(COMMANDS)) {
			if (name === "policy" || name === "grants" || name === "vault") continue; // groups: enumerated via SUBCOMMANDS
			const topics = topicsOf(cmd);
			expect(topics.length, `${name}: no help topics`).toBeGreaterThan(0);
			expect(
				topics.every((t) => t.usage.length > 0),
				`${name}: empty usage`,
			).toBe(true);
		}
	});

	test("SUBCOMMANDS enumerates every nested leaf with help topics", () => {
		const out: Array<[string, unknown]> = [];
		leaves(SUBCOMMANDS as unknown as Record<string, unknown>, "", out);
		const names = out.map(([n]) => n).sort();
		expect(names).toEqual(
			[
				"grants ls",
				"grants rm",
				"policy config principal add",
				"policy config principal rm",
				"policy config rule add",
				"policy config rule rm",
				"policy config set",
				"policy config show",
				"policy simulate",
				"policy test",
				"policy why",
				"vault rekey",
				"vault restore",
				"vault slot rm",
				"vault status",
			].sort(),
		);
		for (const [name, cmd] of out) {
			expect(topicsOf(cmd).length, `${name}: no help topics`).toBeGreaterThan(0);
		}
	});
});
