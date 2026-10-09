import { describe, expect, test } from "bun:test";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyVault } from "../../contracts/vault.ts";
import { createVault, openVault, readVaultFile, saveVault, writeVaultFile } from "./vault.ts";

const MASTER = "correct-master-passphrase";

function dataWith(vault: string, item: string, field: string, value: string) {
  const v = emptyVault();
  v.vaults[vault] = { [item]: { fields: { [field]: value }, updated_at: "2026-10-08T00:00:00Z" } };
  return v;
}

describe("vault.enc encryption", () => {
  test("roundtrip: create → write → read → open equals original", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jtk-vault-"));
    const path = join(dir, "vault.enc");
    const data = dataWith("dev", "zai", "api_key", "sk-roundtrip");
    const env1 = await createVault(MASTER, data);
    expect((await writeVaultFile(path, env1)).isOk()).toBe(true);
    const read = await readVaultFile(path);
    expect(read.isOk()).toBe(true);
    if (read.isOk()) {
      const opened = await openVault(read.value, MASTER);
      expect(opened.isOk()).toBe(true);
      if (opened.isOk()) expect(opened.value).toEqual(data);
    }
  });

  test("wrong master → typed failure { kind: bad-master }", async () => {
    const env = await createVault(MASTER, emptyVault());
    const r = await openVault(env, "wrong-pass");
    expect(r.isErr()).toBe(true);
    if (r.isErr()) expect(r.error.kind).toBe("bad-master");
  });

  test("tampered ciphertext → GCM auth failure (corrupt/bad-master, never plaintext)", async () => {
    const env = await createVault(MASTER, emptyVault());
    const bytes = Buffer.from(env.ct_b64, "base64");
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] ?? 0) ^ 0xff;
    const tampered = { ...env, ct_b64: bytes.toString("base64") };
    const r = await openVault(tampered, MASTER);
    expect(r.isErr()).toBe(true);
  });

  test("save keeps salt (same master re-opens), file mode 0600", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jtk-vault-"));
    const path = join(dir, "vault.enc");
    const env1 = await createVault(MASTER, emptyVault());
    const data2 = dataWith("dev", "deepseek", "api_key", "sk-2");
    const env2 = await saveVault(data2, MASTER, env1);
    expect(env2.kdf.salt_b64).toBe(env1.kdf.salt_b64);
    expect((await writeVaultFile(path, env2)).isOk()).toBe(true);
    const opened = await openVault(await readVaultFile(path).then((r) => r.unwrapOr(env2)), MASTER);
    expect(opened.isOk()).toBe(true);
    expect((statSync(path).mode & 0o777) & 0o077).toBe(0);
  });
});