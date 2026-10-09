import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit, type Io } from "./cmd-crud.ts";
import { runExport, runImportEnv } from "./cmd-io.ts";
import { loadConfig } from "./store.ts";
import { jtkHome } from "./paths.ts";

const MASTER = "io-test-master";
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
const FIXTURE = [
  "DIRECT_ONE=hello123",
  "REF_ONE=jtk://e2e/misc/DIRECT_ONE",
  "OP_X=op://dev/a/b",
].join("\n");
let home = "";
let fixturePath = "";

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "jtk-io-"));
  process.env.JTK_HOME = home;
  process.env.JTK_MASTER = MASTER;
  await runInit([], stdinOf(""));
  fixturePath = join(home, "fixture.env");
  await Bun.write(fixturePath, FIXTURE + "\n");
});

afterAll(() => {
  delete process.env.JTK_HOME;
  delete process.env.JTK_MASTER;
  rmSync(home, { recursive: true, force: true });
});

describe("import-env / export round-trip", () => {
  test("import classifies directs / refs / op-skip", async () => {
    const r = await runImportEnv([fixturePath, "--vault", "e2e", "--item", "misc"]);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toContain("imported 1 values, 1 refs");
      expect(r.value).toContain("skipped 1");
    }
  });

  test("env-ref export is sorted aliases only (no op://, no direct values)", async () => {
    const r = await runExport(["--format", "env-ref"]);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value).toBe("REF_ONE=jtk://e2e/misc/DIRECT_ONE");
    }
  });

  test("export -> import -> export is byte-identical", async () => {
    const e1 = await runExport(["--format", "env-ref"]);
    if (e1.isErr()) throw new Error(e1.error);
    const p2 = join(home, "round2.env");
    await Bun.write(p2, e1.value + "\n");
    const imp = await runImportEnv([p2, "--vault", "zz", "--item", "zz"]);
    if (imp.isErr()) throw new Error(imp.error);
    const e2 = await runExport(["--format", "env-ref"]);
    expect(e2.isOk()).toBe(true);
    if (e2.isOk()) expect(e2.value).toBe(e1.value);
  });

  test("json-ref parses and matches aliases", async () => {
    const r = await runExport(["--format", "json-ref"]);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const parsed = JSON.parse(r.value) as Record<string, string>;
      const cfg = await loadConfig(jtkHome());
      if (cfg.isErr()) throw new Error(cfg.error);
      expect(parsed).toEqual(cfg.value.aliases);
    }
  });
});