# Working in junethekey

## Find the change target

- The CLI structure (commands, flags, meta: reads/writes/env) is exported by `src/cli/commands.ts`; per-command intent, tiers and invariants live in `src/intent.ts`. Read both for a command before editing its handlers.
- When a command's surface or behavior changes, update `src/intent.ts` in the same diff — it is the feature map's hand-written half, the command table is the other.
- Shared callers and contracts (`contracts/`) still need inspection; the map does not encode call graphs beyond resource sharing and module imports.

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

- Bun/strict TypeScript; relative imports include .ts; zod runtime contracts stay in contracts/. Errors use neverthrow Results; plain data crosses boundaries.
- Tests and manual checks use temporary JTK_HOME and fake credentials, never the real vault. No secret values in logs, notifications or default exports.
- F1 has no broker authorization. run strips the inherited master but explicit reinjection has a documented gap; do not claim it fixed without evidence.
- Relay/hosted delivery sees approval metadata only. Sync/backup and new value/network boundaries require their own approved design.
- A linked test is not full coverage. Keep partial/manual verification and its gaps explicit; do not manufacture evidence to mark a feature shipped.
