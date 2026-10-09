import { z } from "zod";

/** jtk://<vault>/<item>/<field>[.json.path] — F1 subset: no ?jq=, no glob in stored aliases. */
export const AddressSchema = z
  .string()
  .regex(/^jtk:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+(\.[^/\s]+)*$/, "must be jtk://<vault>/<item>/<field>[.json.path]");
export type Address = z.infer<typeof AddressSchema>;

/** Settings skeleton — every knob the spec defines; F1 CLI only consumes defaults. */
export const SettingsSchema = z.object({
  request_ttl: z.string().default("15m"),
  request_ttl_human: z.string().default("24h"),
  token_max_ttl: z.string().default("8760h"),
  always_decay: z.string().default("720h"),
  auto_lock: z.string().default("30m"),
  default_decision: z.enum(["allow", "ask", "deny"]).default("ask"),
});

/** F2 placeholders — parsed when present, not consumed by F1. */
export const PrincipalSchema = z.object({
  name: z.string(),
  kind: z.enum(["agent", "user"]).optional(),
  group: z.string().optional(),
  public_key: z.string().optional(),
});

export const RuleSchema = z.object({
  id: z.string(),
  principal: z.string(),
  resource: z.string(),
  decide: z.enum(["allow", "ask", "deny"]),
  ttl: z.string().optional(),
  ask_on: z.array(z.string()).optional(),
});

/** Single-JSON config (spec §4): settings + aliases (+ F2 principals/rules when they come). */
export const ConfigSchema = z.object({
  version: z.literal(1),
  settings: SettingsSchema.optional(),
  aliases: z.record(z.string(), AddressSchema).default({}),
  principals: z.array(PrincipalSchema).optional(),
  rules: z.array(RuleSchema).optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

/** Parse and validate; first schema error as a plain message (boundary = plain data). */
export function parseConfig(raw: unknown): { ok: true; config: Config } | { ok: false; error: string } {
  const r = ConfigSchema.safeParse(raw);
  if (r.success) return { ok: true, config: r.data };
  const issue = r.error.issues[0] ?? { path: ["(root)"], message: "invalid config" };
  return { ok: false, error: `${issue.path.join(".") || "(root)"}: ${issue.message}` };
}