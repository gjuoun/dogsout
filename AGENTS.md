# Working in junethekey

## Find the change target

- Start at [features/INDEX.md](features/INDEX.md); a known key goes directly to [features/registry.yaml](features/registry.yaml).
- Read the feature's intent, current/target behavior and acceptance before editing its code/test entry points. Shared callers and contracts still need inspection.
- Cross-domain changes start at [product intent](features/product.md) and [architecture](features/architecture.md). Planned entries are not implemented protection.
- Keep stable keys when moving files or adding another surface. Do not read the historical docs-spec.md snapshot as a live roadmap.

Known-key lookup (read just its record, not the whole registry):

```bash
rg -n -F -A 14 'key: "run-fromenv"' features/registry.yaml
```

## Verify

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run test:e2e
bun run features:check
```

After updating registry/prose, run `bun run features:generate` then `bun run features:check`. INDEX and the marked README roadmap are generated; edit the source, not projections.

## Boundaries

- Bun/strict TypeScript; relative imports include .ts; zod runtime contracts stay in contracts/. Errors use neverthrow Results; plain data crosses boundaries.
- Tests and manual checks use temporary JTK_HOME and fake credentials, never the real vault. No secret values in logs, notifications or default exports.
- F1 has no broker authorization. run strips the inherited master but explicit reinjection has a documented gap; do not claim it fixed without evidence.
- Relay/hosted delivery sees approval metadata only. Sync/backup and new value/network boundaries require their own approved design.
- A linked test is not full coverage. Keep partial/manual verification and its gaps explicit; do not manufacture evidence to mark a feature shipped.
