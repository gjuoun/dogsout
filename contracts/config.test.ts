import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AddressSchema, parseConfig } from "./config.ts";
import { parseVaultData } from "./vault.ts";

describe("config.example.json parses (spec §4 walkthrough fixture)", () => {
  test("full example config is valid and carries aliases", () => {
    const raw = JSON.parse(readFileSync("config.example.json", "utf8"));
    const r = parseConfig(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.config.aliases).length).toBeGreaterThanOrEqual(2);
      expect(r.config.settings?.default_decision).toBe("ask");
    }
  });
});

describe("AddressSchema (jtk:// F1 subset)", () => {
  test("accepts vault/item/field and dotted json path", () => {
    expect(AddressSchema.safeParse("jtk://dev/zai/api_key").success).toBe(true);
    expect(AddressSchema.safeParse("jtk://gcp/prod-sa/key.client_email").success).toBe(true);
  });
  test("rejects short / non-jtk forms", () => {
    expect(AddressSchema.safeParse("jtk://dev/zai").success).toBe(false);
    expect(AddressSchema.safeParse("op://dev/zai/x").success).toBe(false);
    expect(AddressSchema.safeParse("ZAI_API_KEY").success).toBe(false);
  });
});

describe("VaultDataSchema", () => {
  test("roundtrips a hierarchical example", () => {
    const v = {
      version: 1,
      vaults: {
        dev: {
          zai: { fields: { api_key: "sk-x" }, tags: { sensitivity: "high" }, updated_at: "2026-10-08T00:00:00Z" },
        },
      },
    };
    const r = parseVaultData(v);
    expect(r.ok).toBe(true);
  });
  test("reports first error as plain message", () => {
    const r = parseVaultData({ version: 2, vaults: {} });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("version");
  });
});