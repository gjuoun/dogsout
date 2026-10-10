#!/usr/bin/env bun
// Portable F1 acceptance, migrated from the JG-115 notebook plan.
// Only fake values and temporary JTK_HOME directories; drives the real CLI.
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const MASTER = "e2e-master-pass";
let failures = 0;

async function jtk(home: string, args: string[], stdin = ""): Promise<{ code: number; out: string; err: string }> {
	const proc = Bun.spawn([process.execPath, "src/cli/main.ts", ...args], {
		cwd: REPO,
		env: { ...process.env, JTK_HOME: home, JTK_MASTER: MASTER },
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
} finally {
	rmSync(home1, { recursive: true, force: true });
	rmSync(home2, { recursive: true, force: true });
}
if (failures) process.exit(1);
