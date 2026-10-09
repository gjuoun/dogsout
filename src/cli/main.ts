import { runAlias, runGet, runInit, runLs, runRm, runSet } from "./cmd-crud.ts";
import { runRun } from "./cmd-run.ts";

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

type CmdResult = { isErr: boolean; error?: string; value?: string };
const [cmd, ...rest] = process.argv.slice(2);
const commands: Record<string, (argv: string[]) => Promise<CmdResult>> = {
  init: runInit as unknown as (argv: string[]) => Promise<CmdResult>,
  set: runSet as unknown as (argv: string[]) => Promise<CmdResult>,
  get: runGet as unknown as (argv: string[]) => Promise<CmdResult>,
  ls: runLs as unknown as (argv: string[]) => Promise<CmdResult>,
  rm: runRm as unknown as (argv: string[]) => Promise<CmdResult>,
  alias: runAlias as unknown as (argv: string[]) => Promise<CmdResult>,
  run: async (argv: string[]) => {
    const r = await runRun(argv);
    if (r.isErr()) return { isErr: true, error: r.error };
    process.exit(r.value);
    return { isErr: false };
  },
};

if (!cmd || cmd === "help" || cmd === "--help") {
  console.log(USAGE);
  process.exit(cmd ? 0 : 1);
}

const fn = commands[cmd];
if (!fn) {
  console.error(`jtk: unknown command: ${cmd}`);
  process.exit(1);
}

const r = await fn(rest);
if (r.isErr) {
  console.error(`jtk: ${r.error}`);
  process.exit(1);
}
if (typeof r.value === "string") console.log(r.value);