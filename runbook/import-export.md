# import-export

.env import classification plus a refs-only export round trip (the committable config shape).

```bash
export JTK_HOME="$(mktemp -d /tmp/jtk-ie.XXXXXX)" JTK_SE_HELPER="$PWD/packages/core/src/vault/helper/fake-se.ts"
bun apps/cli/src/main.ts init >/dev/null
printf 'DEEPSEEK_API_KEY=sk-x\nZAI=jtk://dev/zai/api_key\nOP=op://dev/a/b\n' > "$JTK_HOME/keys.env"
echo "sk-real" | bun apps/cli/src/main.ts set jtk://dev/zai/api_key --stdin
bun apps/cli/src/main.ts import-env "$JTK_HOME/keys.env" --vault dev --item misc   # imported 1 values, 1 refs, skipped 1 (op:// …)
bun apps/cli/src/main.ts export --format env-ref | tee "$JTK_HOME/refs.env"       # ZAI=jtk://dev/zai/api_key — aliases only (imported literals are vault fields, not aliases), never values

# round trip: import the refs into a fresh home, export again → byte-identical
H2="$(mktemp -d /tmp/jtk-ie2.XXXXXX)"
JTK_HOME="$H2" bun apps/cli/src/main.ts init >/dev/null
JTK_HOME="$H2" bun apps/cli/src/main.ts import-env "$JTK_HOME/refs.env" --vault zz --item zz >/dev/null
JTK_HOME="$H2" bun apps/cli/src/main.ts export --format env-ref | cmp - "$JTK_HOME/refs.env" && echo byte-identical
rm -rf "$JTK_HOME" "$H2"
```

**Proves**: plaintext only goes into the vault; export never carries values; op:// is skipped and counted (no adapter yet); the reference round trip is byte-stable. Invariant: `export-refs-only`.
