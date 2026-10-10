import { hostname } from "node:os";
import { err, ok, type Result } from "neverthrow";
import type { Config } from "../../contracts/index.ts";
import { SessionManifestSchema } from "../../contracts/session.ts";
import type { VaultData } from "../../contracts/vault.ts";
import { cliChannel } from "../ask/cli.ts";
import {
	closeSessionFlow,
	openSessionFlow,
	prepareRun,
	readVaultValue,
	recordApprovalsFlow,
	resumeReplayFlow,
	sha256Hex,
} from "../ask/flow.ts";
import { swiftuiChannel } from "../ask/swiftui.ts";
import { grantUsable } from "../policy/evaluate.ts";
import { loadGrants, recordApproval } from "../session/grants.ts";
import { parseEnvFile } from "../vault/io.ts";
import { ctxFromEnv, openDataOnce } from "./cmd-crud.ts";
import { resolveToAddress } from "./map.ts";
import { loadConfig } from "./store.ts";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function principalFromEnv(): string {
	return process.env.JTK_PRINCIPAL ?? "cli@" + hostname();
}

function askBudgetMs(): number {
	const raw = process.env.JTK_ASK_TIMEOUT;
	const n = raw ? Number(raw) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : 120_000;
}

/** jtk run --env ALIAS [--from-env FILE] [--session MANIFEST] [--resume] -- cmd args (spec §5.2 + F2 ask flow). */
export async function runRun(argv: string[]): Promise<Result<number, string>> {
	const sep = argv.indexOf("--");
	if (sep === -1) {
		return err(
			"usage: jtk run --env ALIAS [--from-env FILE] [--session MANIFEST [--resume]] [--principal NAME] -- <cmd> [args...]",
		);
	}
	const flagPart = argv.slice(0, sep);
	const cmd = argv.slice(sep + 1);
	if (cmd.length === 0) return err("no command after --");

	const names: string[] = [];
	let fromEnvFile: string | undefined;
	let sessionFile: string | undefined;
	let resume = false;
	let principalFlag: string | undefined;
	for (let i = 0; i < flagPart.length; i++) {
		const a = flagPart[i];
		if (a === "--env") {
			const n = flagPart[i + 1];
			if (!n) return err("--env needs an ALIAS name");
			if (!ENV_NAME.test(n))
				return err(
					"--env wants a valid env var name (alias), got: " +
						n +
						" — register an alias or use --from-env with jtk:// refs",
				);
			names.push(n);
			i++;
		} else if (a === "--from-env") {
			const f = flagPart[i + 1];
			if (!f) return err("--from-env needs a FILE path");
			fromEnvFile = f;
			i++;
		} else if (a === "--session") {
			const f = flagPart[i + 1];
			if (!f) return err("--session needs a MANIFEST json path");
			sessionFile = f;
			i++;
		} else if (a === "--resume") {
			resume = true;
		} else if (a === "--principal") {
			const p = flagPart[i + 1];
			if (!p) return err("--principal needs a NAME");
			principalFlag = p;
			i++;
		} else {
			return err(
				"unknown flag: " +
					a +
					" — item spread (--from-item) was removed: nested field names are not valid env names; use aliases or --from-env",
			);
		}
	}
	if (resume && !sessionFile) return err("--resume requires --session");

	const inject: Record<string, string> = {};
	const refBindings: Array<{ key: string; addr: string }> = [];
	// --from-env FILE: .env style — KEY=literal passes through, KEY=jtk://… resolves from vault (through policy).
	if (fromEnvFile) {
		let text: string;
		try {
			text = await Bun.file(fromEnvFile).text();
		} catch {
			return err("cannot read: " + fromEnvFile);
		}
		const plan = parseEnvFile(text);
		if (plan.skipped.length > 0) {
			return err(plan.skipped[0]?.key + " uses op:// — the 1Password adapter lands in a later feature");
		}
		for (const d of plan.directs) inject[d.key] = d.value;
		for (const r of plan.refs) {
			refBindings.push({ key: r.key, addr: r.value });
			names.push(r.value);
		}
	}

	if (names.length > 0) {
		const ctxR = ctxFromEnv();
		if (ctxR.isErr()) return err(ctxR.error);
		const { home, master } = ctxR.value;
		const cfg = await loadConfig(home);
		if (cfg.isErr()) return err(cfg.error);
		const opened = await openDataOnce({ home, master });
		if (opened.isErr()) return err(opened.error);

		const principal = principalFlag ?? principalFromEnv();
		const channels = [swiftuiChannel, cliChannel];
		const budget = askBudgetMs();

		let sessionId: string | undefined;
		if (sessionFile) {
			let raw: unknown;
			try {
				raw = JSON.parse(await Bun.file(sessionFile).text());
			} catch {
				return err("cannot read session manifest: " + sessionFile);
			}
			const parsed = SessionManifestSchema.safeParse(raw);
			if (!parsed.success) return err("invalid session manifest: " + sessionFile);
			const opened2 = await openSessionFlow(home, parsed.data);
			if (opened2.isErr()) return err(opened2.error);
			sessionId = parsed.data.id;

			if (resume) {
				const replay = await resumeReplayFlow(home, sessionId);
				if (replay.isErr()) return err(replay.error);
				for (const alias of replay.value) {
					const r = await reGrantForReplay(home, cfg.value, opened.value.data, alias, principal, sessionId);
					if (r.isErr()) return err(r.error);
				}
			}

			const inviteNames = parsed.data.invites.filter((n) => names.includes(n) || !resume);
			if (inviteNames.length > 0) {
				const invited = await prepareRun({
					home,
					cfg: cfg.value,
					data: opened.value.data,
					principal,
					groups: parsed.data.groups,
					names: inviteNames,
					channels,
					askBudgetMs: budget,
					...(sessionId !== undefined ? { sessionId } : {}),
					forceTtl: "session",
				});
				if (invited.isErr()) {
					await closeSessionFlow(home, sessionId).catch(() => undefined);
					return err(invited.error);
				}
				for (const [k, v] of Object.entries(invited.value.inject)) inject[k] = v;
				const approved = invited.value.asked;
				if (approved.length > 0) {
					const rec = await recordApprovalsFlow(home, sessionId, approved);
					if (rec.isErr()) return err(rec.error);
				}
			}
		}

		const run = await prepareRun({
			home,
			cfg: cfg.value,
			data: opened.value.data,
			principal,
			groups: [],
			names,
			channels,
			askBudgetMs: budget,
			...(sessionId !== undefined ? { sessionId } : {}),
		});
		if (run.isErr()) {
			if (sessionId) await closeSessionFlow(home, sessionId).catch(() => undefined);
			return err(run.error);
		}
		for (const [k, v] of Object.entries(run.value.inject)) inject[k] = v;
		for (const rb of refBindings) {
			const v = run.value.inject[rb.addr];
			if (v === undefined) return err("unresolved ref " + rb.key + " -> " + rb.addr);
			inject[rb.key] = v;
		}

		if (sessionId) {
			const rec = await recordApprovalsFlow(home, sessionId, run.value.asked);
			if (rec.isErr()) return err(rec.error);
		}
	}

	// strip JTK_MASTER: the master password must not leak into child env (agent-run commands)
	const { JTK_MASTER: _stripped, ...parentEnv } = process.env;
	void _stripped;
	const proc = Bun.spawn(cmd, {
		env: { ...parentEnv, ...inject },
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await proc.exited;
	return ok(code);
}

/** Resume replay: re-create a session grant from the replay list without asking (permissions, not values). */
async function reGrantForReplay(
	home: string,
	cfg: Config,
	data: VaultData,
	alias: string,
	principal: string,
	sessionId: string,
): Promise<Result<void, string>> {
	const resolved = resolveToAddress(alias, cfg);
	if (resolved.isErr()) return err("resume replay: " + resolved.error);
	const value = readVaultValue(data, resolved.value.address);
	if (value.isErr()) return err("resume replay: " + value.error);
	const address = resolved.value.address;
	const grants = await loadGrants(home);
	if (grants.isErr()) return err(grants.error);
	const valueHash = await sha256Hex(value.value);
	const existing = grants.value.grants.find(
		(g) =>
			g.principal === principal &&
			g.alias === alias &&
			g.session === sessionId &&
			grantUsable(g, g.value_hash, [sessionId], new Date()).ok,
	);
	if (existing) return ok(undefined);
	const rec = await recordApproval(
		home,
		{ principal, alias, address, valueHash, ttl: "session", via: "resume-replay", session: sessionId },
		{ always_decay: "720h" },
	);
	return rec.isErr() ? err(rec.error) : ok(undefined);
}
