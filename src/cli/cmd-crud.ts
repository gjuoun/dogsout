import { err, ok, type Result } from "neverthrow";
import { digSubpath, formatAddress, parseAddress } from "./address.ts";
import { resolveToAddress } from "./map.ts";
import { configPath, jtkHome } from "./paths.ts";
import { type Ctx, initFiles, loadConfig, masterFromEnv, nowIso, openData, saveData, writeConfig } from "./store.ts";

export interface Io {
	stdin: () => Promise<string>;
	stdout: (line: string) => void;
}

const defaultIo: Io = {
	stdin: async () => await new Response(Bun.stdin).text(),
	stdout: (l) => console.log(l),
};

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

function ctxFromEnv(): Result<Ctx, string> {
	const master = masterFromEnv();
	if (master.isErr()) return err(master.error);
	return ok({ home: jtkHome(), master: master.value });
}

export async function runInit(argv: string[], io: Io = defaultIo): Promise<Result<string, string>> {
	const home = jtkHome();
	if ((await Bun.file(configPath(home)).exists()) && !argv.includes("--force")) {
		return fail(`already initialized: ${configPath(home)} (use --force to reset)`);
	}
	let master = process.env.JTK_MASTER;
	if (!master) {
		master = process.stdin.isTTY ? await readMasterInteractive() : (await io.stdin()).trim();
	}
	if (!master || master.length < 8) return fail("master password too short (min 8)");
	if (master.length < 8) return fail("master password too short (min 8)");
	const r = await initFiles(home, master);
	if (r.isErr()) return err(r.error);
	return ok(`initialized ${home}`);
}

export async function runSet(argv: string[], io: Io = defaultIo): Promise<Result<string, string>> {
	const addr = argv.find((a) => !a.startsWith("--"));
	if (!addr) return fail("usage: jtk set <jtk://vault/item/field> [--stdin]");
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

export async function runGet(argv: string[]): Promise<Result<string, string>> {
	const name = argv.find((a) => !a.startsWith("--"));
	if (!name) return fail("usage: jtk get <alias|jtk://...> [--reveal]");
	const value = await readValue(name);
	if (value.isErr()) return err(value.error);
	if (argv.includes("--reveal")) return ok(value.value);
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.value));
	const hex = Buffer.from(digest).toString("hex").slice(0, 8);
	return ok(`sha256:${hex} (${value.value.length} bytes, --reveal to show)`);
}

export async function runLs(argv: string[]): Promise<Result<string, string>> {
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
	return ok(argv.includes("--json") ? JSON.stringify({ vaults: summary }, null, 2) : lines.join("\n"));
}

export async function runRm(argv: string[]): Promise<Result<string, string>> {
	const addr = argv.find((a) => !a.startsWith("--"));
	if (!addr) return fail("usage: jtk rm <jtk://vault/item/field>");
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
}

export async function runAlias(argv: string[]): Promise<Result<string, string>> {
	const [name, addr] = argv.filter((a) => !a.startsWith("--"));
	if (!name || !addr) return fail("usage: jtk alias <NAME> <jtk://vault/item/field>");
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
}
