# Working in dogsout

## Layout

- Seven packages, split along process boundaries. `apps/cli` is the product (`dogsout`, `bin: dogsout` -> `src/main.ts`) and holds only the command layer; `apps/api` is the Hono/OpenAPI server (the F3 daemon seed) and owns the drizzle table definitions; `apps/web` is the WebUI (TanStack Start + Nitro bun preset: approval page `/`, activity panel `/agent`); `apps/ask` is the native macOS approval window (a Go module on mygo's native UI, built by `apps/ask/build.sh`; no typecheck/test script — its gate is `cd apps/ask && go test ./...`, and `se/dogsout-se.swift` holds the Secure Enclave CLI); `packages/core` is the broker engine (vault, policy, session, the ask flow); `packages/type-contracts` is the zod single source; `packages/api-client` is heyapi output generated from `apps/api/openapi.json` and is the only API surface the browser imports. Root is a private bun workspace root, driven by turbo.
- Dependencies are one-way: `apps/*` -> `packages/*`. An app never imports another app, and nothing in `packages/core` reaches back into `apps/`. Import engine code as `@dogsout/core`, never by relative path. The root workspace (`tests/drive-ui.ts`) is not a package, so it imports workspace sources by relative path.
- `bun run typecheck` / `bun run test` fan out per package through turbo; `bun run lint`, `bun run test:e2e`, `bun run drive:ui` and `bun run check:bundle` stay root-level.

## Find the change target

- The CLI structure (commands, flags, meta: reads/writes/env) is exported by `apps/cli/src/commands.ts`; per-command intent, tiers and invariants live in `apps/cli/src/intent.ts`. Read both for a command before editing its handlers.
- The implementation is one module per command: a leaf command is `apps/cli/src/<command>.ts` (`init.ts`, `set.ts`, `run.ts`, `import-env.ts`, …); a command with subcommands gets a directory `apps/cli/src/<group>/` (`policy/`, `grants/`), one file per subcommand. Shared CLI plumbing is `cmd.ts` (`withMeta`/`runDogsout`/`Io`/`fail`) and `context.ts` (`ctxFromEnv`/`openDataOnce`/`ctxAndConfig`/`activeSessionIds`) — put a helper there rather than inside one command's module when a second command needs it.
- When a command's surface or behavior changes, update `apps/cli/src/intent.ts` in the same diff — it is the feature map's hand-written half, the command table is the other.
- Shared callers and contracts (`packages/type-contracts/`, `packages/core/`) still need inspection; the map does not encode call graphs beyond resource sharing and module imports.
- The approval protocol has three declared homes: the **wire** half (the JSON that crosses into `apps/ask` and the WebUI) is `packages/type-contracts/src/ask.ts`; the **WS frames** are `packages/type-contracts/src/events.ts`; the **in-process** half (the `Channel` interface and its degradation chain) is `packages/core/src/ask/channel.ts`. Changing one is almost always changing the others.
- **Type chain**: a drizzle table in `apps/api/src/db/schema.ts` is the entity source; `apps/api/src/openapi.ts` derives the zod schema (`.meta({ id })` fixes the generated component name); `GET /doc` publishes OpenAPI 3.1 and `bun run openapi:write` lands `apps/api/openapi.json`; `bun run codegen` regenerates `packages/api-client/src/generated`. Both hops have drift gates (`apps/api/src/typechain.test.ts`) — change the routes or the spec and CI goes red until you rerun both commands. `normalizeNullable` exists because zod-openapi still emits 3.0 `nullable`, which a JSON-Schema-only generator silently drops.
- WebUI approval is a long poll: `POST /ask` blocks in the pending registry, `POST /asks/{id}/decision` answers it, and approving requires a single-use WebAuthn token (`x-dogsout-assertion`); `authorize` is the seam tests override. There is **no password fallback** (vault v2 has no master password; PRD red line 4) — without a platform authenticator the page disables approval.

## Verify

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test                  # and: bun run test — the two runners must report the same count
bun run test:e2e
bun run drive:ui          # headless ask → decision → grant → WS frames
cd apps/ask && CGO_ENABLED=0 go test ./... && go tool mygo vet .   # native helper (macOS, local — CI has no Go)
bash apps/ask/build.sh    # macOS: dogsout-approve (Go, mygo) + dogsout-se (Swift, SE); both self-tests
bun run openapi:write && bun run codegen   # only when routes/schemas changed
bun run --cwd apps/web build && bun run check:bundle
```

## Workflow

- Incremental commits, one logical change each; PR then merge. Do not push without the owner's go-ahead.
- A claim of "done" carries evidence: the pipeline green plus the specific command outputs that changed.

## Boundaries

- Bun/strict TypeScript; relative imports include .ts; zod runtime contracts stay in packages/type-contracts/. Errors use neverthrow Results; plain data crosses boundaries.
- Tests and manual checks use temporary DOGSOUT_HOME and fake credentials, never the real vault. No secret values in logs, notifications or default exports.
- F1 has no broker authorization. The vault unlocks with Touch ID through the Secure Enclave helper — there is no master password; until F3 every vault command asks Touch ID once and headless callers cannot unlock. Do not claim otherwise without evidence; tests use the fake helper (`DOGSOUT_SE_HELPER`).
- Relay/hosted delivery sees approval metadata only. Sync/backup and new value/network boundaries require their own approved design.
- The browser never imports server code: `apps/web` imports `@dogsout/api-client` and `@dogsout/type-contracts` only. Do not import `apps/api` from anywhere except root test harnesses, and do not add `drizzle-zod` output to anything a client can reach (drizzle-orm#941 is why the chain stops at `/doc`).
- The WebUI never sees a credential value or a full value hash: `POST /ask` carries a 12-char display hash, which is why grants are recorded by the asker (core), not by the API.
- A linked test is not full coverage. Keep partial/manual verification and its gaps explicit; do not manufacture evidence to mark a feature shipped. The WebAuthn success path (a real Touch ID assertion) has no automated test — only the reject paths do.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
