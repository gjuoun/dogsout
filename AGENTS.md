# Working in junethekey

## Layout

- Five packages, split along process boundaries. `apps/cli` is the product (`junethekey`, `bin: jtk` -> `src/main.ts`) and holds only the command layer; `apps/api` is the Hono/OpenAPI server (the F3 daemon seed); `apps/ask` is the native macOS approval window (Swift, built by `apps/ask/build.sh`, no typecheck/test script); `packages/core` is the broker engine (vault, policy, session, the ask flow); `packages/type-contracts` is the zod single source. Root is a private bun workspace root, driven by turbo.
- Dependencies are one-way: `apps/*` -> `packages/*`. An app never imports another app, and nothing in `packages/core` reaches back into `apps/`. Import engine code as `@jtk/core`, never by relative path.
- `bun run typecheck` / `bun run test` fan out per package through turbo; `bun run lint` and `bun run test:e2e` stay root-level.

## Find the change target

- The CLI structure (commands, flags, meta: reads/writes/env) is exported by `apps/cli/src/commands.ts`; per-command intent, tiers and invariants live in `apps/cli/src/intent.ts`. Read both for a command before editing its handlers.
- The implementation is one module per command: a leaf command is `apps/cli/src/<command>.ts` (`init.ts`, `set.ts`, `run.ts`, `import-env.ts`, …); a command with subcommands gets a directory `apps/cli/src/<group>/` (`policy/`, `grants/`), one file per subcommand. Shared CLI plumbing is `cmd.ts` (`withMeta`/`runJtk`/`Io`/`fail`) and `context.ts` (`ctxFromEnv`/`openDataOnce`/`ctxAndConfig`/`activeSessionIds`) — put a helper there rather than inside one command's module when a second command needs it.
- When a command's surface or behavior changes, update `apps/cli/src/intent.ts` in the same diff — it is the feature map's hand-written half, the command table is the other.
- Shared callers and contracts (`packages/type-contracts/`, `packages/core/`) still need inspection; the map does not encode call graphs beyond resource sharing and module imports.
- The approval protocol has two declared homes: the **wire** half (the JSON that crosses into `apps/ask`) is `packages/type-contracts/src/ask.ts`; the **in-process** half (the `Channel` interface and its degradation chain) is `packages/core/src/ask/channel.ts`. Changing one is almost always changing both.

## Verify

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run test:e2e
```

## Workflow

- Incremental commits, one logical change each; PR then merge. Do not push without the owner's go-ahead.
- A claim of "done" carries evidence: the pipeline green plus the specific command outputs that changed.

## Boundaries

- Bun/strict TypeScript; relative imports include .ts; zod runtime contracts stay in packages/type-contracts/. Errors use neverthrow Results; plain data crosses boundaries.
- Tests and manual checks use temporary JTK_HOME and fake credentials, never the real vault. No secret values in logs, notifications or default exports.
- F1 has no broker authorization. run strips the inherited master but explicit reinjection has a documented gap; do not claim it fixed without evidence.
- Relay/hosted delivery sees approval metadata only. Sync/backup and new value/network boundaries require their own approved design.
- A linked test is not full coverage. Keep partial/manual verification and its gaps explicit; do not manufacture evidence to mark a feature shipped.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
