import {
	configPath,
	digSubpath,
	formatAddress,
	initFiles,
	jtkHome,
	loadConfig,
	nowIso,
	openData,
	parseAddress,
	resolveToAddress,
	saveData,
	writeConfig,
} from "@jtk/core";
import { command, flag, positional, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { defaultIo, type Io, runJtk, withMeta } from "./cmd.ts";
import { ctxFromEnv } from "./context.ts";

function fail(message: string): Result<never, string> {
	return err(message);
}

/** Interactive prompt when no JTK_MASTER and we have a TTY (reads one line, not EOF). */
async function readMasterInteractive(): Promise<string> {
	const { createInterface } = await import("node:readline");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await new Promise<string>((resolve) => {
		rl.question("master password (min 8 chars): ", (a: string) => resolve(a));
	});
	rl.close();
	return answer.trim();
}

export function initCommand(io: Io = defaultIo) {
	return withMeta(
		command({
			name: "init",
			description: "create vault.enc + config.json (master via JTK_MASTER, prompt, or stdin)",
			args: { force: flag({ long: "force", description: "reset an already-initialized home (destructive)" }) },
			handler: async ({ force }): Promise<Result<string, string>> => {
				const home = jtkHome();
				if ((await Bun.file(configPath(home)).exists()) && !force) {
					return fail(`already initialized: ${configPath(home)} (use --force to reset)`);
				}
				let master = process.env.JTK_MASTER;
				if (!master) {
					master = process.stdin.isTTY ? await readMasterInteractive() : (await io.stdin()).trim();
				}
				if (!master || master.length < 8) return fail("master password too short (min 8)");
				const r = await initFiles(home, master);
				if (r.isErr()) return err(r.error);
				return ok(`initialized ${home}`);
			},
		}),
		{ reads: [], writes: ["config", "vault"], env: ["JTK_HOME", "JTK_MASTER"] },
	);
}

export async function runInit(argv: string[], io: Io = defaultIo): Promise<Result<string, string>> {
	return runJtk<string>(initCommand(io), argv);
}

export function setCommand(io: Io = defaultIo) {
	return withMeta(
		command({
			name: "set",
			description: "store a secret from stdin at a jtk:// address",
			args: {
				addr: positional({ type: string, displayName: "jtk://vault/item/field" }),
				stdin: flag({ long: "stdin", description: "value is read from stdin (default behavior)" }),
			},
			handler: async ({ addr }): Promise<Result<string, string>> => {
				const parsed = parseAddress(addr);
				if (parsed.isErr()) return err(parsed.error);
				const value = (await io.stdin()).replace(/\n$/, "");
				if (value.length === 0) return fail("empty value refused");
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const opened = await openData(ctxR.value);
				if (opened.isErr()) return err(opened.error);
				const { envelope, data } = opened.value;
				const { vault, item, field } = parsed.value;
				data.vaults[vault] ??= {};
				const items = data.vaults[vault];
				if (!items[item]) items[item] = { fields: {}, updated_at: nowIso() };
				items[item].fields[field] = value;
				items[item].updated_at = nowIso();
				const saved = await saveData(ctxR.value, envelope, data);
				if (saved.isErr()) return err(saved.error);
				return ok(`set ${formatAddress(parsed.value)}`);
			},
		}),
		{ reads: [], writes: ["vault"], env: ["JTK_HOME", "JTK_MASTER"] },
	);
}

export async function runSet(argv: string[], io: Io = defaultIo): Promise<Result<string, string>> {
	return runJtk<string>(setCommand(io), argv);
}

export async function readValue(name: string): Promise<Result<string, string>> {
	const ctxR = ctxFromEnv();
	if (ctxR.isErr()) return err(ctxR.error);
	const cfg = await loadConfig(ctxR.value.home);
	if (cfg.isErr()) return err(cfg.error);
	const resolved = resolveToAddress(name, cfg.value);
	if (resolved.isErr()) return err(resolved.error);
	const parsed = parseAddress(resolved.value.address);
	if (parsed.isErr()) return err(parsed.error);
	const opened = await openData(ctxR.value);
	if (opened.isErr()) return err(opened.error);
	const { vault, item, field, subpath } = parsed.value;
	const raw = opened.value.data.vaults[vault]?.[item]?.fields[field];
	if (raw === undefined) return fail(`not found: ${resolved.value.address}`);
	return digSubpath(raw, subpath);
}

export function getCommand() {
	return withMeta(
		command({
			name: "get",
			description: "read a value (masked digest by default; --reveal prints plaintext)",
			args: {
				name: positional({ type: string, displayName: "alias|jtk://vault/item/field" }),
				reveal: flag({ long: "reveal", description: "print the plaintext value to stdout" }),
			},
			handler: async ({ name, reveal }): Promise<Result<string, string>> => {
				const value = await readValue(name);
				if (value.isErr()) return err(value.error);
				if (reveal) return ok(value.value);
				const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.value));
				const hex = Buffer.from(digest).toString("hex").slice(0, 8);
				return ok(`sha256:${hex} (${value.value.length} bytes, --reveal to show)`);
			},
		}),
		{ reads: ["config", "vault"], writes: [], env: ["JTK_HOME", "JTK_MASTER"] },
	);
}

export async function runGet(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(getCommand(), argv);
}

export function lsCommand() {
	return withMeta(
		command({
			name: "ls",
			description: "list field addresses without revealing values",
			args: { json: flag({ long: "json", description: "machine-readable vault summary" }) },
			handler: async ({ json }): Promise<Result<string, string>> => {
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const opened = await openData(ctxR.value);
				if (opened.isErr()) return err(opened.error);
				const lines: string[] = [];
				const summary: Record<string, Record<string, string[]>> = {};
				for (const [v, items] of Object.entries(opened.value.data.vaults)) {
					summary[v] = {};
					for (const [i, item] of Object.entries(items)) {
						summary[v][i] = Object.keys(item.fields);
						for (const f of Object.keys(item.fields)) lines.push(`jtk://${v}/${i}/${f}`);
					}
				}
				return ok(json ? JSON.stringify({ vaults: summary }, null, 2) : lines.join("\n"));
			},
		}),
		{ reads: ["vault"], writes: [], env: ["JTK_HOME", "JTK_MASTER"] },
	);
}

export async function runLs(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(lsCommand(), argv);
}

export function rmCommand() {
	return withMeta(
		command({
			name: "rm",
			description: "remove one field",
			args: { addr: positional({ type: string, displayName: "jtk://vault/item/field" }) },
			handler: async ({ addr }): Promise<Result<string, string>> => {
				const parsed = parseAddress(addr);
				if (parsed.isErr()) return err(parsed.error);
				if (parsed.value.subpath.length > 0) return fail("rm targets a field, not a subpath");
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const opened = await openData(ctxR.value);
				if (opened.isErr()) return err(opened.error);
				const { vault, item, field } = parsed.value;
				const target = opened.value.data.vaults[vault]?.[item];
				if (!target || target.fields[field] === undefined) return fail(`not found: ${addr}`);
				delete target.fields[field];
				target.updated_at = nowIso();
				const saved = await saveData(ctxR.value, opened.value.envelope, opened.value.data);
				if (saved.isErr()) return err(saved.error);
				return ok(`removed ${addr}`);
			},
		}),
		{ reads: [], writes: ["vault"], env: ["JTK_HOME", "JTK_MASTER"] },
	);
}

export async function runRm(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(rmCommand(), argv);
}

export function aliasCommand() {
	return withMeta(
		command({
			name: "alias",
			description: "register an alias for a jtk:// address in config.json",
			args: {
				name: positional({ type: string, displayName: "NAME" }),
				addr: positional({ type: string, displayName: "jtk://vault/item/field" }),
			},
			handler: async ({ name, addr }): Promise<Result<string, string>> => {
				const parsed = parseAddress(addr);
				if (parsed.isErr()) return err(parsed.error);
				const ctxR = ctxFromEnv();
				if (ctxR.isErr()) return err(ctxR.error);
				const cfg = await loadConfig(ctxR.value.home);
				if (cfg.isErr()) return err(cfg.error);
				cfg.value.aliases[name] = addr;
				const w = await writeConfig(ctxR.value.home, cfg.value);
				if (w.isErr()) return err(w.error);
				return ok(`${name} -> ${addr}`);
			},
		}),
		{ reads: [], writes: ["config"], env: ["JTK_HOME", "JTK_MASTER"] },
	);
}

export async function runAlias(argv: string[]): Promise<Result<string, string>> {
	return runJtk<string>(aliasCommand(), argv);
}
