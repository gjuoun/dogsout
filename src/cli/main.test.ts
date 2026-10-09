import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAlias, runGet, runInit, runLs, runRm, runSet, type Io } from "./cmd-crud.ts";
import { configPath, vaultPath } from "./paths.ts";

const MASTER = "test-master-pass";
const stdinOf = (v: string): Io => ({ stdin: async () => v, stdout: () => {} });
let home = "";

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "jtk-cli-"));
  process.env.JTK_HOME = home;
  process.env.JTK_MASTER = MASTER;
});

afterAll(() => {
  delete process.env.JTK_HOME;
  delete process.env.JTK_MASTER;
  rmSync(home, { recursive: true, force: true });
});

describe("F1 CLI monolith (JTK_HOME isolated)", () => {
  test("init creates config + vault, both 0600", async () => {
    const r = await runInit([], stdinOf(""));
    expect(r.isOk()).toBe(true);
    expect(statSync(configPath(home)).mode & 0o077).toBe(0);
    expect(statSync(vaultPath(home)).mode & 0o077).toBe(0);
  });

  test("init twice without --force refused", async () => {
    const r = await runInit([]);
    expect(r.isErr()).toBe(true);
  });

  test("set → get --reveal returns original value", async () => {
    const s = await runSet(["jtk://dev/zai/api_key", "--stdin"], stdinOf("sk-test-123\n"));
    expect(s.isOk()).toBe(true);
    const g = await runGet(["jtk://dev/zai/api_key", "--reveal"]);
    expect(g.isOk()).toBe(true);
    if (g.isOk()) expect(g.value).toBe("sk-test-123");
  });

  test("get masked by default (no plaintext)", async () => {
    const g = await runGet(["jtk://dev/zai/api_key"]);
    expect(g.isOk()).toBe(true);
    if (g.isOk()) {
      expect(g.value.startsWith("sha256:")).toBe(true);
      expect(g.value.includes("sk-test-123")).toBe(false);
    }
  });

  test("alias registers and resolves", async () => {
    const a = await runAlias(["ZAI_API_KEY", "jtk://dev/zai/api_key"]);
    expect(a.isOk()).toBe(true);
    const g = await runGet(["ZAI_API_KEY", "--reveal"]);
    expect(g.isOk()).toBe(true);
    if (g.isOk()) expect(g.value).toBe("sk-test-123");
  });

  test("ls --json lists the stored field", async () => {
    const r = await runLs(["--json"]);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      const parsed = JSON.parse(r.value) as { vaults: Record<string, Record<string, string[]>> };
      expect(parsed.vaults.dev?.zai).toContain("api_key");
    }
  });

  test("rm removes; subsequent get fails with not-found", async () => {
    const rm = await runRm(["jtk://dev/zai/api_key"]);
    expect(rm.isOk()).toBe(true);
    const g = await runGet(["jtk://dev/zai/api_key"]);
    expect(g.isErr()).toBe(true);
    if (g.isErr()) expect(g.error).toContain("not found");
  });
});