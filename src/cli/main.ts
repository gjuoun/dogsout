import { err, ok, type Result } from "neverthrow";
import { runAlias, runGet, runInit, runLs, runRm, runSet } from "./cmd-crud.ts";
import { runRun } from "./cmd-run.ts";
import { runExport, runImportEnv } from "./cmd-io.ts";

const USAGE = [
  "jtk — the credential broker for AI agents (F1: local monolith)",
  "",
  "  jtk init [--force]                    create vault.enc + config.json (master via JTK_MASTER or stdin)",
  "  jtk set <jtk://v/i/field> --stdin     store a secret (value from stdin)",
  "  jtk get <alias|jtk://...> [--reveal]  read (masked digest by default)",
  "  jtk ls [--json]                       list fields",
  "  jtk rm <jtk://v/i/field>              remove a field",
  "  jtk alias <NAME> <jtk://v/i/field>    register an alias in config.json",
].join("\n");

const [cmd, ...rest] = process.argv.slice(2);
const commands: Record<string, (argv: string[]) => Promise<Result<string, string>>> = {
  init: runInit,
  set: runSet,
  get: runGet,
  ls: runLs,
  rm: runRm,
  alias: runAlias,
  "import-env": runImportEnv,
  export: runExport,
};

if (!cmd || cmd === "help" || cmd === "--help") {
  console.log(USAGE);
  process.exit(cmd ? 0 : 1);
}

const fn = cmd === "run"
  ? async (argv: string[]): Promise<Result<string, string>> => {
      const r = await runRun(argv);
      if (r.isErr()) return err(r.error);
      process.exit(r.value);
      return ok("");
    }
  : commands[cmd];
if (!fn) {
  console.error(`jtk: unknown command: ${cmd}`);
  process.exit(1);
}

const r = await fn(rest);
if (r.isErr()) {
  console.error(`jtk: ${r.error}`);
  process.exit(1);
}
const value = r._unsafeUnwrap();
if (typeof value === "string") console.log(value);