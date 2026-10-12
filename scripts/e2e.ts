#!/usr/bin/env bun
// Portable F1 acceptance, migrated from the JG-115 notebook plan.
// Only fake values and temporary JTK_HOME directories; drives the real CLI.
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const MASTER = "e2e-master-pass";
let failures = 0;

async function jtk(
	home: string,
	args: string[],
	stdin = "",
	env: Record<string, string> = {},
): Promise<{ code: number; out: string; err: string }> {
	const proc = Bun.spawn([process.execPath, "src/cli/main.ts", ...args], {
		cwd: REPO,
		env: { ...process.env, JTK_HOME: home, JTK_MASTER: MASTER, ...env },
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

const home1 = mkdtempSync(join(tmpdir(), "jtk-e2e-1-"));
const home2 = mkdtempSync(join(tmpdir(), "jtk-e2e-2-"));
const homeAsk = mkdtempSync(join(tmpdir(), "jtk-e2e-ask-"));
const homeDeny = mkdtempSync(join(tmpdir(), "jtk-e2e-deny-"));
const homeSess = mkdtempSync(join(tmpdir(), "jtk-e2e-sess-"));
const fakeApprover = join(REPO, "src/ask/helper/fake-approve.ts");
try {
	const init = await jtk(home1, ["init"]);
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
		["E2E_DIRECT=hello-e2e-123", "E2E_REF=jtk://e2e/misc/E2E_DIRECT", "E2E_OP=op://dev/a/b", ""].join("\n"),
	);
	const imp = await jtk(home1, ["import-env", fixture, "--vault", "e2e", "--item", "misc"]);
	check(
		imp.code === 0 && imp.out.includes("1 refs") && imp.out.includes("skipped 1"),
		"import classifies values/refs/op-skip",
		imp.out + imp.err,
	);
	const set = await jtk(home1, ["set", "jtk://e2e/extra/token", "--stdin"], "tok-abc-999");
	const get = await jtk(home1, ["get", "jtk://e2e/extra/token", "--reveal"]);
	check(set.code === 0 && get.code === 0 && get.out.trim() === "tok-abc-999", "set/reveal exact value", get.err);
	const run = await jtk(home1, ["run", "--env", "E2E_REF", "--", "sh", "-c", 'test "$E2E_REF" = hello-e2e-123']);
	check(run.code === 0, "run injects imported reference into child env", run.err);
	const exp = await jtk(home1, ["export", "--format", "env-ref"]);
	check(
		exp.code === 0 &&
			exp.out.includes("E2E_REF=jtk://e2e/misc/E2E_DIRECT") &&
			!exp.out.includes("op://") &&
			!exp.out.includes("hello-e2e-123"),
		"export contains refs, not values",
		exp.err,
	);
	const round = join(home1, "round.env");
	await Bun.write(round, exp.out);
	const init2 = await jtk(home2, ["init"]);
	const imp2 = await jtk(home2, ["import-env", round, "--vault", "zz", "--item", "zz"]);
	const exp2 = await jtk(home2, ["export", "--format", "env-ref"]);
	check(
		init2.code === 0 && imp2.code === 0 && exp2.code === 0 && exp2.out === exp.out,
		"fresh-home reference roundtrip is byte-identical",
		exp2.err,
	);

	// --- F2: ask flow with a fake approval channel driving the real CLI ---
	const askEnv = { JTK_APPROVE_HELPER: fakeApprover, JTK_PRINCIPAL: "e2e-agent@ci" };
	const askInit = await jtk(homeAsk, ["init"]);
	check(askInit.code === 0, "ask-home init", askInit.err);
	const askSet = await jtk(homeAsk, ["set", "jtk://dev/e2e/token", "--stdin"], "tok-f2-ask");
	check(askSet.code === 0, "ask-home set token", askSet.err);
	const askAlias = await jtk(homeAsk, ["alias", "E2E_TOKEN", "jtk://dev/e2e/token"]);
	check(askAlias.code === 0, "ask-home alias", askAlias.err);

	const approved = await jtk(
		homeAsk,
		["run", "--env", "E2E_TOKEN", "--", "sh", "-c", 'test "$E2E_TOKEN" = tok-f2-ask'],
		"",
		askEnv,
	);
	check(approved.code === 0, "ask: approval injects value into child env", approved.out + approved.err);

	const grantsLs = await jtk(homeAsk, ["grants", "ls", "--principal", "e2e-agent@ci"]);
	check(
		grantsLs.code === 0 && grantsLs.out.includes("E2E_TOKEN"),
		"ask: grant recorded (metadata visible)",
		grantsLs.out,
	);

	const second = await jtk(
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

	const denyInit = await jtk(homeDeny, ["init"]);
	const denySet = await jtk(homeDeny, ["set", "jtk://dev/e2e/token", "--stdin"], "tok-f2-deny");
	const denyAlias = await jtk(homeDeny, ["alias", "E2E_TOKEN", "jtk://dev/e2e/token"]);
	const marker = join(homeDeny, "child-ran");
	const denied = await jtk(homeDeny, ["run", "--env", "E2E_TOKEN", "--", "sh", "-c", "touch " + marker], "", {
		JTK_APPROVE_HELPER: fakeApprover,
		FAKE_APPROVE_MODE: "deny",
		JTK_PRINCIPAL: "e2e-agent@ci",
	});
	check(
		denyInit.code === 0 && denySet.code === 0 && denyAlias.code === 0 && denied.code !== 0 && !existsSync(marker),
		"deny: fail-closed abort, child never spawned",
		denied.out + denied.err,
	);

	const sessInit = await jtk(homeSess, ["init"]);
	const sessSet = await jtk(homeSess, ["set", "jtk://dev/e2e/token", "--stdin"], "tok-f2-sess");
	const sessAlias = await jtk(homeSess, ["alias", "E2E_TOKEN", "jtk://dev/e2e/token"]);
	const manifestPath = join(homeSess, "session.json");
	await Bun.write(
		manifestPath,
		JSON.stringify({ id: "sess_e2e", principal: "e2e-session@ci", groups: [], invites: ["E2E_TOKEN"] }),
	);
	const sessRun = await jtk(
		homeSess,
		["run", "--session", manifestPath, "--env", "E2E_TOKEN", "--", "sh", "-c", 'test "$E2E_TOKEN" = tok-f2-sess'],
		"",
		{ JTK_APPROVE_HELPER: fakeApprover },
	);
	check(
		sessInit.code === 0 && sessSet.code === 0 && sessAlias.code === 0 && sessRun.code === 0,
		"session: manifest invite approves once, child runs",
		sessRun.out + sessRun.err,
	);
	const sessGrants = await jtk(homeSess, ["grants", "ls"]);
	check(
		sessGrants.code === 0 && sessGrants.out.includes("(no live grants)"),
		"session: end withdraws session grants",
		sessGrants.out,
	);
} finally {
	rmSync(home1, { recursive: true, force: true });
	rmSync(home2, { recursive: true, force: true });
	rmSync(homeAsk, { recursive: true, force: true });
	rmSync(homeDeny, { recursive: true, force: true });
	rmSync(homeSess, { recursive: true, force: true });
}
if (failures) process.exit(1);
