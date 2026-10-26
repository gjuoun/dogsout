#!/usr/bin/env bun
// Portable F1 acceptance, migrated from the original F1 acceptance plan.
// Only fake values and temporary DOGSOUT_HOME directories; drives the real CLI.
// The vault unlocks through the test-only fake Secure Enclave helper (DOGSOUT_SE_HELPER).
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const FAKE_SE = join(REPO, "packages/core/src/vault/helper/fake-se.ts");
let failures = 0;

async function dogsout(
	home: string,
	args: string[],
	stdin = "",
	env: Record<string, string> = {},
): Promise<{ code: number; out: string; err: string }> {
	const proc = Bun.spawn([process.execPath, "apps/cli/src/main.ts", ...args], {
		cwd: REPO,
		env: { ...process.env, DOGSOUT_HOME: home, DOGSOUT_SE_HELPER: FAKE_SE, ...env },
		stdout: "pipe",
		stderr: "pipe",
		stdin: "pipe",
	});
	proc.stdin.write(stdin);
	proc.stdin.end();
	const [out, err, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, out, err };
}

function check(ok: boolean, name: string, detail: string) {
	if (ok) console.log(`PASS: ${name}`);
	else {
		failures++;
		console.error(`FAIL: ${name} — ${detail}`);
	}
}

const home1 = mkdtempSync(join(tmpdir(), "dogsout-e2e-1-"));
const home2 = mkdtempSync(join(tmpdir(), "dogsout-e2e-2-"));
const homeAsk = mkdtempSync(join(tmpdir(), "dogsout-e2e-ask-"));
const homeDeny = mkdtempSync(join(tmpdir(), "dogsout-e2e-deny-"));
const homeSess = mkdtempSync(join(tmpdir(), "dogsout-e2e-sess-"));
const homeV2 = mkdtempSync(join(tmpdir(), "dogsout-e2e-v2-"));
const homeMig = mkdtempSync(join(tmpdir(), "dogsout-e2e-mig-"));
const fakeApprover = join(REPO, "packages/core/src/ask/helper/fake-approve.ts");
try {
	const init = await dogsout(home1, ["init"]);
	const privateFiles =
		init.code === 0 &&
		["config.json", "vault.enc"].every((file) => (statSync(join(home1, file)).mode & 0o777) === 0o600);
	check(privateFiles, "init creates private config and vault (0600)", init.err);
	// F2: run is a policy surface — e2e homes carry an allow-all rule (ask-path e2e uses a fake approver)
	await Bun.write(
		join(home1, "config.json"),
		JSON.stringify({
			version: 1,
			aliases: {},
			maps: {},
			rules: [{ id: "e2e-allow", principal: "*", resource: "*", decide: "allow" }],
		}),
	);
	const fixture = join(home1, "fixture.env");
	await Bun.write(
		fixture,
		["E2E_DIRECT=hello-e2e-123", "E2E_REF=dogsout://e2e/misc/e2e_direct", "E2E_OP=op://dev/a/b", ""].join("\n"),
	);
	const imp = await dogsout(home1, ["import-env", fixture, "--vault", "e2e", "--item", "misc"]);
	check(
		imp.code === 0 && imp.out.includes("1 refs") && imp.out.includes("1 1password refs"),
		"import classifies values/refs/op-refs",
		imp.out + imp.err,
	);
	const set = await dogsout(home1, ["set", "dogsout://e2e/extra/token", "--stdin"], "tok-abc-999");
	const get = await dogsout(home1, ["get", "dogsout://e2e/extra/token", "--reveal"]);
	check(set.code === 0 && get.code === 0 && get.out.trim() === "tok-abc-999", "set/reveal exact value", get.err);
	const run = await dogsout(home1, ["run", "--env", "E2E_REF", "--", "sh", "-c", 'test "$E2E_REF" = hello-e2e-123']);
	check(run.code === 0, "run injects imported reference into child env", run.err);
	const exp = await dogsout(home1, ["export", "--format", "env-ref"]);
	check(
		exp.code === 0 &&
			exp.out.includes("E2E_REF=dogsout://e2e/misc/e2e_direct") &&
			!exp.out.includes("op://") &&
			!exp.out.includes("hello-e2e-123"),
		"export contains refs, not values",
		exp.err,
	);
	const round = join(home1, "round.env");
	await Bun.write(round, exp.out);
	const init2 = await dogsout(home2, ["init"]);
	const imp2 = await dogsout(home2, ["import-env", round, "--vault", "zz", "--item", "zz"]);
	const exp2 = await dogsout(home2, ["export", "--format", "env-ref"]);
	check(
		init2.code === 0 && imp2.code === 0 && exp2.code === 0 && exp2.out === exp.out,
		"fresh-home reference roundtrip is byte-identical",
		exp2.err,
	);

	// --- F2: ask flow with a fake approval channel driving the real CLI ---
	const askEnv = { DOGSOUT_APPROVE_HELPER: fakeApprover, DOGSOUT_PRINCIPAL: "e2e-agent@ci" };
	const askInit = await dogsout(homeAsk, ["init"]);
	check(askInit.code === 0, "ask-home init", askInit.err);
	const askSet = await dogsout(homeAsk, ["set", "dogsout://dev/e2e/token", "--stdin"], "tok-f2-ask");
	check(askSet.code === 0, "ask-home set token", askSet.err);
	const askAlias = await dogsout(homeAsk, ["alias", "E2E_TOKEN", "dogsout://dev/e2e/token"]);
	check(askAlias.code === 0, "ask-home alias", askAlias.err);

	const approved = await dogsout(
		homeAsk,
		["run", "--env", "E2E_TOKEN", "--", "sh", "-c", 'test "$E2E_TOKEN" = tok-f2-ask'],
		"",
		askEnv,
	);
	check(approved.code === 0, "ask: approval injects value into child env", approved.out + approved.err);

	const grantsLs = await dogsout(homeAsk, ["grants", "ls", "--principal", "e2e-agent@ci"]);
	check(
		grantsLs.code === 0 && grantsLs.out.includes("E2E_TOKEN"),
		"ask: grant recorded (metadata visible)",
		grantsLs.out,
	);

	const second = await dogsout(
		homeAsk,
		["run", "--env", "E2E_TOKEN", "--", "sh", "-c", 'test "$E2E_TOKEN" = tok-f2-ask'],
		"",
		{
			...askEnv,
			FAKE_APPROVE_MODE: "deny",
		},
	);
	check(
		second.code === 0,
		"ask: live grant skips the window (deny-mode helper never consulted)",
		second.out + second.err,
	);

	const denyInit = await dogsout(homeDeny, ["init"]);
	const denySet = await dogsout(homeDeny, ["set", "dogsout://dev/e2e/token", "--stdin"], "tok-f2-deny");
	const denyAlias = await dogsout(homeDeny, ["alias", "E2E_TOKEN", "dogsout://dev/e2e/token"]);
	const marker = join(homeDeny, "child-ran");
	const denied = await dogsout(homeDeny, ["run", "--env", "E2E_TOKEN", "--", "sh", "-c", "touch " + marker], "", {
		DOGSOUT_APPROVE_HELPER: fakeApprover,
		FAKE_APPROVE_MODE: "deny",
		DOGSOUT_PRINCIPAL: "e2e-agent@ci",
	});
	check(
		denyInit.code === 0 && denySet.code === 0 && denyAlias.code === 0 && denied.code !== 0 && !existsSync(marker),
		"deny: fail-closed abort, child never spawned",
		denied.out + denied.err,
	);

	const sessInit = await dogsout(homeSess, ["init"]);
	const sessSet = await dogsout(homeSess, ["set", "dogsout://dev/e2e/token", "--stdin"], "tok-f2-sess");
	const sessAlias = await dogsout(homeSess, ["alias", "E2E_TOKEN", "dogsout://dev/e2e/token"]);
	const manifestPath = join(homeSess, "session.json");
	await Bun.write(
		manifestPath,
		JSON.stringify({ id: "sess_e2e", principal: "e2e-session@ci", groups: [], invites: ["E2E_TOKEN"] }),
	);
	const sessRun = await dogsout(
		homeSess,
		["run", "--session", manifestPath, "--env", "E2E_TOKEN", "--", "sh", "-c", 'test "$E2E_TOKEN" = tok-f2-sess'],
		"",
		{ DOGSOUT_APPROVE_HELPER: fakeApprover },
	);
	check(
		sessInit.code === 0 && sessSet.code === 0 && sessAlias.code === 0 && sessRun.code === 0,
		"session: manifest invite approves once, child runs",
		sessRun.out + sessRun.err,
	);
	const sessGrants = await dogsout(homeSess, ["grants", "ls"]);
	check(
		sessGrants.code === 0 && sessGrants.out.includes("(no live grants)"),
		"session: end withdraws session grants",
		sessGrants.out,
	);

	// --- vault v2 specifics: fingerprint, slots, backups, restore, rekey, fail-closed unlock ---
	const v2Env = {};
	const v2Init = await dogsout(homeV2, ["init"], "", v2Env);
	check(
		v2Init.code === 0 && /vault v2, fingerprint [0-9A-F]{4}-[0-9A-F]{4}/.test(v2Init.out),
		"v2: init needs no password and prints the fingerprint",
		v2Init.out + v2Init.err,
	);
	const v2Set = await dogsout(homeV2, ["set", "dogsout://dev/v2/token", "--stdin"], "tok-v2-001", v2Env);
	const v2Get = await dogsout(homeV2, ["get", "dogsout://dev/v2/token", "--reveal"], "", v2Env);
	check(v2Set.code === 0 && v2Get.out.trim() === "tok-v2-001", "v2: set/reveal round-trip, no password", v2Get.err);
	const v2Status = await dogsout(homeV2, ["vault", "status"], "", v2Env);
	check(
		v2Status.code === 0 && v2Status.out.includes("this Mac") && v2Status.out.includes("1 unlock factor"),
		"v2: vault status shows one se slot and the single-factor warning",
		v2Status.out + v2Status.err,
	);
	await dogsout(homeV2, ["set", "dogsout://dev/v2/b", "--stdin"], "tok-b", v2Env);
	await dogsout(homeV2, ["set", "dogsout://dev/v2/c", "--stdin"], "tok-c", v2Env);
	check(
		existsSync(join(homeV2, "vault.enc.bak.1")) && existsSync(join(homeV2, "vault.enc.bak.2")),
		"v2: writes keep two rolling backups",
		"missing vault.enc.bak.1/2",
	);
	await Bun.write(join(homeV2, "vault.enc"), "{ broken");
	const v2Broken = await dogsout(homeV2, ["get", "dogsout://dev/v2/token"], "", v2Env);
	const v2Restore = await dogsout(homeV2, ["vault", "restore"], "", v2Env);
	const v2After = await dogsout(homeV2, ["get", "dogsout://dev/v2/token", "--reveal"], "", v2Env);
	check(
		v2Broken.code !== 0 &&
			v2Broken.err.includes("dogsout vault restore") &&
			v2Restore.code === 0 &&
			v2After.out.trim() === "tok-v2-001",
		"v2: corrupt vault.enc is reported, restore promotes the backup",
		v2Broken.err + v2Restore.out + v2Restore.err + v2After.err,
	);
	const v2Rekey = await dogsout(homeV2, ["vault", "rekey"], "", v2Env);
	check(
		v2Rekey.code === 0 && !existsSync(join(homeV2, "vault.enc.bak.1")) && !existsSync(join(homeV2, "vault.enc.bak.2")),
		"v2: rekey clears the backups",
		v2Rekey.out + v2Rekey.err,
	);
	const v2Deny = await dogsout(homeV2, ["get", "dogsout://dev/v2/token"], "", { ...v2Env, FAKE_SE_MODE: "deny" });
	check(
		v2Deny.code === 1 && v2Deny.err.includes("vault unlock failed"),
		"v2: cancelled Touch ID fails closed",
		v2Deny.err,
	);

	await Bun.write(
		join(homeMig, "vault.enc"),
		JSON.stringify({ version: 1, kdf: { algo: "legacy-password" }, iv_b64: "x", ct_b64: "y" }),
	);
	await Bun.write(join(homeMig, "config.json"), JSON.stringify({ version: 1, aliases: {}, maps: {} }));
	const v1Get = await dogsout(homeMig, ["get", "dogsout://dev/x/y"]);
	check(
		v1Get.code === 1 && v1Get.err.includes("no longer supported"),
		"v1 vault file is refused (cold cut)",
		v1Get.err,
	);

	// --- rename migration : addresses rewritten, vault untouched, second run a no-op ---
	const legacyHome = join(homeMig, "legacy");
	const targetHome = join(homeMig, "target");
	const seeded = { version: 1, aliases: { OLD: "jtk://dev/old/key" }, maps: {} };
	await Bun.write(join(homeMig, "seed.json"), JSON.stringify(seeded, null, 2));
	const { mkdirSync, readFileSync } = await import("node:fs");
	mkdirSync(legacyHome, { recursive: true });
	await Bun.write(join(legacyHome, "config.json"), JSON.stringify(seeded, null, 2));
	await Bun.write(join(legacyHome, "vault.enc"), "ciphertext-only");
	const vaultBytes = readFileSync(join(legacyHome, "vault.enc"), "utf8");
	const migrateArgs = ["migrate", "--home", targetHome, "--legacy-home", legacyHome];
	const dry = await dogsout(homeMig, [...migrateArgs, "--dry-run"], "", { DOGSOUT_HOME: "" });
	const untouched = readFileSync(join(legacyHome, "config.json"), "utf8").includes("jtk://") && !existsSync(targetHome);
	check(
		dry.code === 0 && dry.out.includes("total: 1 rewrites") && untouched,
		"migrate: --dry-run plans the rewrites and writes nothing",
		dry.out + dry.err,
	);
	const applied = await dogsout(homeMig, migrateArgs, "", { DOGSOUT_HOME: "" });
	const migratedCfg = readFileSync(join(targetHome, "config.json"), "utf8");
	const movedVault = readFileSync(join(targetHome, "vault.enc"), "utf8");
	check(
		applied.code === 0 &&
			migratedCfg.includes("dogsout://dev/old/key") &&
			!migratedCfg.includes("jtk://") &&
			movedVault === vaultBytes &&
			!existsSync(legacyHome),
		"migrate: apply rewrites addresses, keeps the vault bytes and moves the directory",
		applied.out + applied.err,
	);
	const again = await dogsout(homeMig, migrateArgs, "", { DOGSOUT_HOME: "" });
	check(
		again.code === 0 &&
			again.out.includes("0 rewrites") &&
			readFileSync(join(targetHome, "config.json"), "utf8") === migratedCfg,
		"migrate: a second run rewrites nothing (idempotent)",
		again.out + again.err,
	);
	// ---- 1Password refs: a ref-served home never unlocks (tripwire) and never stores a value.
	const homeRef = mkdtempSync(join(tmpdir(), "dogsout-e2e-ref-"));
	const fake1p = join(REPO, "packages/core/src/vault/helper/fake-1p.ts");
	const tripwire = join(homeRef, "se-tripwire.txt");
	const refMap = join(homeRef, "ref-map.json");
	const refCalls = join(homeRef, "ref-calls.txt");
	const REF = "op://dev/api_key/e2eref";
	const REF_VALUE = "e2e-resolved-value";
	await Bun.write(refMap, JSON.stringify({ [REF]: REF_VALUE }));
	const refEnv = (extra: Record<string, string> = {}) => ({
		DOGSOUT_1P_HELPER: fake1p,
		FAKE_1P_MAP: refMap,
		FAKE_1P_CALLS: refCalls,
		FAKE_SE_TRIPWIRE: tripwire,
		...extra,
	});
	try {
		const refInit = await dogsout(homeRef, ["init"], "", refEnv());
		check(refInit.code === 0, "refs: init", refInit.err);
		// A value that starts with op:// is stored as a reference in config, never as a value.
		const refSet = await dogsout(homeRef, ["set", "dogsout://op/dev/e2e_key"], REF, refEnv());
		const cfgAfterSet = JSON.parse(readFileSync(join(homeRef, "config.json"), "utf8")) as {
			refs?: Record<string, string>;
		};
		check(
			refSet.code === 0 && cfgAfterSet.refs?.["dogsout://op/dev/e2e_key"] === REF,
			"refs: set with an op:// value writes config.refs, no unlock",
			refSet.out + refSet.err,
		);
		await Bun.write(
			join(homeRef, "config.json"),
			JSON.stringify({ ...cfgAfterSet, rules: [{ id: "e2e-allow", principal: "*", resource: "*", decide: "allow" }] }),
		);

		// The vault is taken away: any unlock attempt now fails, and the tripwire records it.
		renameSync(join(homeRef, "vault.enc"), join(homeRef, "vault.enc.moved"));
		const tripwireLength = () => (existsSync(tripwire) ? readFileSync(tripwire, "utf8").length : 0);
		const beforeTrip = tripwireLength();

		const refGet = await dogsout(homeRef, ["get", "dogsout://op/dev/e2e_key"], "", refEnv());
		check(
			refGet.code === 0 &&
				refGet.out.includes(REF) &&
				refGet.out.includes("sha256:") &&
				!refGet.out.includes(REF_VALUE),
			"refs: get prints the reference + resolved digest, never the value",
			refGet.out + refGet.err,
		);
		const refReveal = await dogsout(homeRef, ["get", "dogsout://op/dev/e2e_key", "--reveal"], "", refEnv());
		check(
			refReveal.code === 0 && refReveal.out.trim() === REF_VALUE,
			"refs: get --reveal prints the resolved value",
			refReveal.out + refReveal.err,
		);

		const listed = await dogsout(homeRef, ["ls", "--json"], "", refEnv());
		type Leaf = { source?: string; ref?: string };
		const tree =
			listed.code === 0 ? (JSON.parse(listed.out) as Record<string, Record<string, Record<string, Leaf>>>) : {};
		const leaf: Leaf = tree.op?.dev?.e2e_key ?? {};
		check(
			leaf.source === "1password" && leaf.ref === REF && !JSON.stringify(tree).includes(REF_VALUE),
			"refs: ls --json names the source and the reference, never a value",
			listed.out + listed.err,
		);

		const envRefs = join(homeRef, "secrets.env");
		await Bun.write(envRefs, "E2E_KEY=dogsout://op/dev/e2e_key\n");
		const ran = await dogsout(
			homeRef,
			["run", "--from-env", envRefs, "--", "sh", "-c", 'test "$E2E_KEY" = ' + REF_VALUE],
			"",
			refEnv(),
		);
		check(ran.code === 0, "refs: run --from-env injects the resolved value into the child only", ran.out + ran.err);

		const opLine = await dogsout(
			homeRef,
			[
				"run",
				"--from-env",
				await (async () => {
					const p = join(homeRef, "op-line.env");
					await Bun.write(p, "X=op://dev/api_key/x\n");
					return p;
				})(),
				"--",
				"sh",
				"-c",
				"true",
			],
			"",
			refEnv(),
		);
		check(
			opLine.code !== 0 && opLine.err.includes("import it first: dogsout import-env"),
			"refs: run --from-env still refuses a raw op:// line",
			opLine.out + opLine.err,
		);

		check(
			tripwireLength() === beforeTrip,
			"refs: the whole ref path makes zero Secure Enclave calls",
			`tripwire grew by ${tripwireLength() - beforeTrip} bytes`,
		);

		// ask-before-read: a first-time ask must not resolve anything.
		await Bun.write(refCalls, "");
		const askHome = homeAsk;
		const askedRun = await dogsout(askHome, ["set", "dogsout://op/dev/ask_key"], REF, refEnv());
		const askCfg = JSON.parse(readFileSync(join(askHome, "config.json"), "utf8")) as {
			refs?: Record<string, string>;
			rules?: unknown[];
		};
		await Bun.write(join(askHome, "config.json"), JSON.stringify({ ...askCfg, rules: [] }));
		const askEnv = join(askHome, "ask.env");
		await Bun.write(askEnv, "ASK_KEY=dogsout://op/dev/ask_key\n");
		const beforeAskCalls = existsSync(refCalls) ? readFileSync(refCalls, "utf8").length : 0;
		const deniedRun = await dogsout(askHome, ["run", "--from-env", askEnv, "--", "sh", "-c", "exit 0"], "", {
			...refEnv(),
			DOGSOUT_APPROVE_HELPER: "/nonexistent/dogsout-approve",
		});
		const afterAskCalls = existsSync(refCalls) ? readFileSync(refCalls, "utf8").length : 0;
		check(
			askedRun.code === 0 && deniedRun.code !== 0 && afterAskCalls === beforeAskCalls,
			"refs: a first-time ask resolves nothing before approval",
			`calls before=${beforeAskCalls} after=${afterAskCalls} — ${deniedRun.err}`,
		);

		const missing = await dogsout(
			homeRef,
			["get", "dogsout://op/dev/e2e_key"],
			"",
			refEnv({ FAKE_1P_MODE: "missing-token" }),
		);
		check(
			missing.code !== 0 && missing.err.includes("OP_SERVICE_ACCOUNT_TOKEN") && missing.err.includes("sa-token"),
			"refs: a missing token is a typed failure naming both sources",
			missing.out + missing.err,
		);
	} finally {
		rmSync(homeRef, { recursive: true, force: true });
	}
} finally {
	rmSync(home1, { recursive: true, force: true });
	rmSync(home2, { recursive: true, force: true });
	rmSync(homeAsk, { recursive: true, force: true });
	rmSync(homeDeny, { recursive: true, force: true });
	rmSync(homeSess, { recursive: true, force: true });
	rmSync(homeV2, { recursive: true, force: true });
	rmSync(homeMig, { recursive: true, force: true });
}
if (failures) process.exit(1);
