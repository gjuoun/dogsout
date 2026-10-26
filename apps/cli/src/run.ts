import { hostname } from "node:os";
import {
	cliChannel,
	closeSessionFlow,
	grantUsable,
	loadConfig,
	loadGrants,
	mygoChannel,
	openSessionFlow,
	parseEnvFile,
	prepareRun,
	readVaultValue,
	recordApproval,
	recordApprovalsFlow,
	refFailureMessage,
	refFor,
	resolveToAddress,
	resumeReplayFlow,
	sha256Hex,
} from "@dogsout/core";
import type { Config, VaultData } from "@dogsout/type-contracts";
import { SessionManifestSchema } from "@dogsout/type-contracts";
import { array, command, flag, multioption, option, optional, rest, string } from "cmd-ts";
import { err, ok, type Result } from "neverthrow";
import { runDogsout, withMeta } from "./cmd.ts";
import { ctxFromEnv, openVaultIfNeeded, refResolver } from "./context.ts";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function principalFromEnv(): string {
	return process.env.DOGSOUT_PRINCIPAL ?? "cli@" + hostname();
}

function askBudgetMs(): number {
	const raw = process.env.DOGSOUT_ASK_TIMEOUT;
	const n = raw ? Number(raw) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : 120_000;
}

interface RunArgs {
	env: string[];
	fromEnv?: string | undefined;
	session?: string | undefined;
	resume: boolean;
	principal?: string | undefined;
	cmd: string[];
}

/** dogsout run --env ALIAS [--from-env FILE] [--session MANIFEST [--resume]] -- cmd args (spec §5.2 + F2 ask flow). */
async function runCore(a: RunArgs): Promise<Result<number, string>> {
	// rest() keeps the leading `--` token; the child command starts after it
	const cmd = a.cmd[0] === "--" ? a.cmd.slice(1) : a.cmd;
	if (cmd.length === 0) {
		return err(
			"usage: dogsout run --env ALIAS [--from-env FILE] [--session MANIFEST [--resume]] [--principal NAME] -- <cmd> [args...]",
		);
	}
	const names = [...a.env];
	for (const n of a.env) {
		if (!ENV_NAME.test(n)) {
			return err(
				"--env wants a valid env var name (alias), got: " +
					n +
					" — register an alias or use --from-env with dogsout:// refs",
			);
		}
	}
	if (a.resume && !a.session) return err("--resume requires --session");

	const inject: Record<string, string> = {};
	const refBindings: Array<{ key: string; addr: string }> = [];
	let sessionClose: (() => Promise<Result<void, string>>) | undefined;
	// --from-env FILE: .env style — KEY=literal passes through, KEY=dogsout://… resolves from vault (through policy).
	if (a.fromEnv) {
		let text: string;
		try {
			text = await Bun.file(a.fromEnv).text();
		} catch {
			return err("cannot read: " + a.fromEnv);
		}
		const plan = parseEnvFile(text);
		if (plan.legacy.length > 0) {
			const first = plan.legacy[0] as { key: string; value: string };
			return err(
				`${first.key} uses the retired jtk:// scheme — rewrite it as dogsout:// (run: dogsout migrate for stored aliases)`,
			);
		}
		if (plan.skipped.length > 0) {
			const first = plan.skipped[0] as { key: string; value: string };
			return err(
				first.key +
					" is a 1Password reference, not a dogsout address — import it first: dogsout import-env " +
					a.fromEnv +
					" (then write KEY=dogsout://op/<1p-vault>/<key> in the env file)",
			);
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
		const ctx = ctxR.value;
		const home = ctx.home;
		const cfg = await loadConfig(home);
		if (cfg.isErr()) return err(cfg.error);
		// A name served by a config ref must not open the vault (nor ask for Touch ID); every other
		// name needs it. Decide first, then open only when something really lives in vault.enc.
		const needsVault = names.some((n) => {
			const resolved = resolveToAddress(n, cfg.value);
			return resolved.isErr() || refFor(cfg.value, resolved.value.address) === null;
		});
		const vaultData = await openVaultIfNeeded(ctx, needsVault);
		if (vaultData.isErr()) return err(vaultData.error);
		const opened = ok({ data: vaultData.value });

		const principal = a.principal ?? principalFromEnv();
		const channels = [mygoChannel, cliChannel];
		const budget = askBudgetMs();
		// Built once per process: the SDK client is memoised inside the resolver.
		const resolver = await refResolver();

		let sessionId: string | undefined;
		if (a.session) {
			let raw: unknown;
			try {
				raw = JSON.parse(await Bun.file(a.session).text());
			} catch {
				return err("cannot read session manifest: " + a.session);
			}
			const parsed = SessionManifestSchema.safeParse(raw);
			if (!parsed.success) return err("invalid session manifest: " + a.session);
			const opened2 = await openSessionFlow(home, parsed.data);
			if (opened2.isErr()) return err(opened2.error);
			sessionId = parsed.data.id;

			if (a.resume) {
				const replay = await resumeReplayFlow(home, sessionId);
				if (replay.isErr()) return err(replay.error);
				for (const alias of replay.value) {
					const r = await reGrantForReplay(home, cfg.value, opened.value.data, alias, principal, sessionId);
					if (r.isErr()) return err(r.error);
				}
			}

			const inviteNames = parsed.data.invites.filter((n) => names.includes(n) || !a.resume);
			if (inviteNames.length > 0) {
				const invited = await prepareRun({
					home,
					cfg: cfg.value,
					data: opened.value.data,
					resolver,
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
				const sid: string = sessionId;
				sessionClose = () => closeSessionFlow(home, sid);
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
			resolver,
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

	const proc = Bun.spawn(cmd, {
		env: { ...process.env, ...inject },
		stdout: "inherit",
		stderr: "inherit",
	});
	const code = await proc.exited;
	// session ends with the run: withdraw session grants and drop the record
	// (a crash leaves them for --resume, which replays once)
	if (sessionClose) await sessionClose().catch(() => undefined);
	return ok(code);
}

export function runCommand() {
	return withMeta(
		command({
			name: "run",
			description: "inject resolved credentials into a child process environment",
			args: {
				env: multioption({ long: "env", type: array(string), description: "alias to inject (repeatable)" }),
				fromEnv: option({ long: "from-env", type: optional(string), description: "refs .env file" }),
				session: option({ long: "session", type: optional(string), description: "session manifest json path" }),
				resume: flag({ long: "resume", description: "replay the last approval list exactly once (needs --session)" }),
				principal: option({ long: "principal", type: optional(string), description: "requesting principal name" }),
				cmd: rest({ displayName: "cmd", description: "child command after --" }),
			},
			handler: runCore,
		}),
		{
			reads: ["vault", "config", "grants", "sessions"],
			writes: ["grants", "sessions"],
			env: ["DOGSOUT_HOME", "DOGSOUT_SE_HELPER", "DOGSOUT_PRINCIPAL", "DOGSOUT_ASK_TIMEOUT", "DOGSOUT_APPROVE_HELPER"],
		},
	);
}

export async function runRun(argv: string[]): Promise<Result<number, string>> {
	// loud guidance for the removed item-spread flag, kept ahead of generic parse errors
	if (argv.includes("--from-item")) {
		return err(
			"unknown flag: --from-item — item spread (--from-item) was removed: " +
				"nested field names are not valid env names; use aliases or --from-env",
		);
	}
	return runDogsout<number>(runCommand(), argv);
}

/** Resume replay: re-create a session grant from the replay list without asking (permissions, not values). */
async function reGrantForReplay(
	home: string,
	cfg: Config,
	data: VaultData | undefined,
	alias: string,
	principal: string,
	sessionId: string,
): Promise<Result<void, string>> {
	const resolved = resolveToAddress(alias, cfg);
	if (resolved.isErr()) return err("resume replay: " + resolved.error);
	// A replay hashes the value a live run would hash: the resolved one for a ref-served address.
	const ref = refFor(cfg, resolved.value.address);
	let value: Result<string, string>;
	if (ref !== null) {
		const resolver = await refResolver();
		const batch = await resolver.resolve([ref]);
		if (batch.isErr()) return err("resume replay: " + refFailureMessage(batch.error));
		const secret = batch.value.get(ref);
		value = secret === undefined ? err("1password: no value for " + ref) : ok(secret);
	} else if (data === undefined) {
		value = err("vault not opened: " + resolved.value.address);
	} else {
		value = readVaultValue(data, resolved.value.address);
	}
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
