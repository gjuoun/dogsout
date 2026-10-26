import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { err, ok, type Result } from "neverthrow";

/**
 * 1Password references as a value source (F6). A reference is not a secret: it is a pointer
 * (`op://vault/item/field`) kept in config.json, and it is resolved at read time through the
 * official SDK by a service-account token. Nothing here ever spawns the `op` CLI: every `op`
 * process stats the 1Password group container and trips macOS TCC (439 prompts in 6 h, 2026-09-20).
 */

const SCHEME = "op://";

/** Cheap test used on every read path; the strict parse below is for writes and messages. */
export function isOnePasswordRef(value: string): boolean {
	return value.startsWith(SCHEME);
}

export interface OnePasswordRef {
	/** The reference verbatim, as stored. */
	ref: string;
	vault: string;
	item: string;
	section?: string;
	field: string;
}

/**
 * `op://<vault>/<item>/<field>` or `op://<vault>/<item>/<section>/<field>`. Nothing else: an empty
 * segment, whitespace, a trailing slash or a query/fragment is a typo we can name at write time
 * instead of failing much later inside a 1Password error message.
 */
export function parseOnePasswordRef(value: string): Result<OnePasswordRef, string> {
	if (!isOnePasswordRef(value)) return err(`not a 1password reference: ${value}`);
	const body = value.slice(SCHEME.length);
	if (/\s/.test(body)) return err(`1password reference contains whitespace: ${value}`);
	if (/[?#]/.test(body)) return err(`1password reference must not carry a query or fragment: ${value}`);
	if (body.endsWith("/")) return err(`1password reference must not end with a slash: ${value}`);
	const parts = body.split("/");
	if (parts.some((p) => p.length === 0)) return err(`1password reference has an empty segment: ${value}`);
	if (parts.length === 3) {
		const [vault, item, field] = parts as [string, string, string];
		return ok({ ref: value, vault, item, field });
	}
	if (parts.length === 4) {
		const [vault, item, section, field] = parts as [string, string, string, string];
		return ok({ ref: value, vault, item, section, field });
	}
	return err(`1password reference must be op://<vault>/<item>/<field> (or .../<section>/<field>): ${value}`);
}

/** Why a resolve failed. Never carries a value: messages name the reference and the reason only. */
export type RefFailure = { kind: "missing-token"; message: string } | { kind: "resolve"; ref: string; message: string };

export function refFailureMessage(f: RefFailure): string {
	return f.kind === "missing-token" ? `1password: ${f.message}` : `1password: ${f.ref}: ${f.message}`;
}

/**
 * The one seam every 1Password read goes through. `resolve` is a BATCH call: one HTTPS round trip
 * for the whole list, so latency and the account read budget stay flat in key count.
 */
export interface RefResolver {
	resolve(refs: readonly string[]): Promise<Result<Map<string, string>, RefFailure>>;
}

/** Where the service-account token lives — env first, then the file opk already uses. */
export function serviceAccountToken(
	env: Record<string, string | undefined> = process.env,
	opts: { tokenFile?: string } = {},
): Result<string, RefFailure> {
	const fromEnv = env.OP_SERVICE_ACCOUNT_TOKEN?.trim();
	if (fromEnv) return ok(fromEnv);
	try {
		const fromFile = readFileSync(opts.tokenFile ?? join(homedir(), ".config/op/sa-token"), "utf8").trim();
		if (fromFile.length > 0) return ok(fromFile);
	} catch {
		// fall through to the typed failure
	}
	return err({
		kind: "missing-token",
		message: "no service account token (OP_SERVICE_ACCOUNT_TOKEN unset and ~/.config/op/sa-token unreadable)",
	});
}

/** The subset of `@1password/sdk` this module uses — injected in tests, imported lazily in production. */
export interface OnePasswordClient {
	secrets: {
		resolveAll(refs: string[]): Promise<{
			individualResponses: Record<string, { content?: { secret?: string }; error?: { message?: string } }>;
		}>;
	};
}

export type CreateClient = (config: {
	auth: string;
	integrationName: string;
	integrationVersion: string;
}) => Promise<OnePasswordClient>;

/** Real SDK factory: imported on first use so `ls` / `set` never pay the WASM init. */
async function realCreateClient(config: {
	auth: string;
	integrationName: string;
	integrationVersion: string;
}): Promise<OnePasswordClient> {
	const mod = await import("@1password/sdk");
	return (await mod.createClient(config)) as unknown as OnePasswordClient;
}

export interface SdkResolverOptions {
	/** Injected by tests; production leaves it out and the real SDK is imported lazily. */
	createClient?: CreateClient;
	token?: string;
	integrationName?: string;
	integrationVersion?: string;
	/** `DOGSOUT_1P_TIMING=1` prints one timing line to stderr; never a value. */
	timing?: boolean;
}

/**
 * The production resolver: one client per process (init ≈ 1 s of WASM + auth), one `resolveAll`
 * per read (latency and read budget stay flat in key count). Failures are per-batch: a reference
 * the vault refuses fails the whole read, because a half-injected environment is worse than none.
 */
export function sdkResolver(opts: SdkResolverOptions = {}): RefResolver {
	const integrationName = opts.integrationName ?? "dogsout";
	const integrationVersion = opts.integrationVersion ?? "0.0.2";
	const timing = opts.timing ?? process.env.DOGSOUT_1P_TIMING === "1";
	let clientPromise: Promise<OnePasswordClient> | undefined;
	let initMs = 0;

	async function client(): Promise<Result<OnePasswordClient, RefFailure>> {
		const token = opts.token !== undefined ? ok(opts.token) : serviceAccountToken();
		if (token.isErr()) return err(token.error);
		if (!clientPromise) {
			const started = performance.now();
			clientPromise = (opts.createClient ?? realCreateClient)({
				auth: token.value,
				integrationName,
				integrationVersion,
			}).finally(() => {
				initMs = Math.round(performance.now() - started);
			});
		}
		try {
			return ok(await clientPromise);
		} catch (cause) {
			// A rejected init (bad token, no network) must not be cached as a broken client.
			clientPromise = undefined;
			const message = cause instanceof Error ? cause.message : String(cause);
			return err({ kind: "resolve", ref: "op://", message });
		}
	}

	return {
		async resolve(refs) {
			const unique = [...new Set(refs.filter((r) => r.length > 0))];
			const out = new Map<string, string>();
			if (unique.length === 0) return ok(out);
			const c = await client();
			if (c.isErr()) return err(c.error);
			const started = performance.now();
			let responses: Awaited<ReturnType<OnePasswordClient["secrets"]["resolveAll"]>>;
			try {
				responses = await c.value.secrets.resolveAll(unique);
			} catch (cause) {
				const message = cause instanceof Error ? cause.message : String(cause);
				return err({ kind: "resolve", ref: unique[0] as string, message });
			}
			const resolveMs = Math.round(performance.now() - started);
			if (timing) process.stderr.write(`1password: init=${initMs}ms resolve=${resolveMs}ms refs=${unique.length}\n`);
			for (const ref of unique) {
				const response = responses.individualResponses[ref];
				const secret = response?.content?.secret;
				if (secret === undefined) {
					return err({ kind: "resolve", ref, message: response?.error?.message ?? "no value for " + ref });
				}
				out.set(ref, secret);
			}
			return ok(out);
		},
	};
}
