import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAlias, runInit, runSet, type Io } from "./cmd-crud.ts";
import { runRun } from "./cmd-run.ts";

const MASTER = "run-test-master";
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
let home = "";

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "jtk-run-"));
  process.env.JTK_HOME = home;
  process.env.JTK_MASTER = MASTER;
  await runInit([], stdinOf(""));
  await runSet(["jtk://dev/zai/api_key", "--stdin"], stdinOf("sk-inject-me"));
  await runAlias(["ZAI_API_KEY", "jtk://dev/zai/api_key"]);
});

afterAll(() => {
  delete process.env.JTK_HOME;
  delete process.env.JTK_MASTER;
  rmSync(home, { recursive: true, force: true });
});

describe("jtk run env injection", () => {
  test("--env ALIAS injects value into child env (exit 0)", async () => {
    const r = await runRun(["--env", "ZAI_API_KEY", "--", "sh", "-c", 'test "$ZAI_API_KEY" = sk-inject-me']);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe(0);
  });

  test("--from jtk://v/item spreads all fields by field name", async () => {
    const r = await runRun(["--from", "jtk://dev/zai", "--", "sh", "-c", 'test "$api_key" = sk-inject-me']);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe(0);
  });

  test("missing alias -> typed failure, no child spawned", async () => {
    const r = await runRun(["--env", "NOPE_KEY", "--", "sh", "-c", "exit 0"]);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error).toContain("NOPE_KEY");
  });

  test("address as --env name is rejected with guidance", async () => {
    const r = await runRun(["--env", "jtk://dev/zai/api_key", "--", "sh", "-c", "exit 0"]);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error).toContain("--from");
  });
});