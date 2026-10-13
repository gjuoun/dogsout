import { runSafely, subcommands } from "cmd-ts";
import { parseErrorMessage, unwrapRunnerOutput } from "./cmd.ts";
import { COMMANDS } from "./commands.ts";

const app = subcommands({
	name: "jtk",
	description: "the credential broker for AI agents",
	cmds: { ...COMMANDS },
});

const argv = process.argv.slice(2);
const helpR = await runSafely(app, ["--help"]);
const helpText = helpR._tag === "error" ? helpR.error.config.message : String(helpR.value);
// `jtk` bare and `jtk help`: usage text; bare keeps exit 1, explicit help exits 0
if (argv.length === 0) {
	console.log(helpText);
	process.exit(1);
}
if (argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
	console.log(helpText);
	process.exit(0);
}

const r = await runSafely(app, argv);
if (r._tag === "error") {
	const c = r.error.config;
	if (c && c.exitCode === 0) {
		// help flags surface as a zero-exit Exit carrying the help text
		(c.into === "stderr" ? console.error : console.log)(c.message);
		process.exit(0);
	}
	console.error(`jtk: ${parseErrorMessage(r.error)}`);
	process.exit(c ? c.exitCode : 1);
}
const res = unwrapRunnerOutput(r.value) as import("neverthrow").Result<string | number, string>;
if (res.isErr()) {
	console.error(`jtk: ${res.error}`);
	process.exit(1);
}
const value = res._unsafeUnwrap();
if (typeof value === "number") process.exit(value); // `run`: exit with the child's exit code
if (typeof value === "string" && value.length > 0) console.log(value);
process.exit(0);
