# Quickstart: incremental-builds (spec 022)

**Spec**: [specs/022-incremental-builds/spec.md](./spec.md) | **Branch**: `022-incremental-builds` | **Date**: 2026-09-11

Runnable validation scenarios (Sc1..Sc10). Каждый сценарий доказывает конкретную часть фичи end-to-end. Канонический проект — `user_service`, `analytics`, `frontend`, `openapi` (как в specs/README и IDEA §5) — в тестах представлен фикстурой `packages/pilot/test/check/fixtures/canonical/` (2 apps) + synthetic фикстуры для depends_on и builder version. Реализация — `packages/pilot/src/cache/` + `src/build/index.ts` + `src/cli/{build,plan,apply}.ts`.

---

## Prerequisites

```bash
cd packages/pilot
pnpm install
pnpm build          # build pilot + CLI (tsup: src/index, src/contracts/index, src/build/index, src/cli/index)
```

CLI binary: `packages/pilot/dist/cli/index.js` (`#!/usr/bin/env node`, bin `ycsf`).

Опционально изолировать кэш в тестах:

```bash
export YCSF_CACHE_DIR=/tmp/ycsf-test-cache   # не используется (no env toggle); используйте --cache-dir
```

> Spec S-5: кэш включается флагом `--cache-dir <path>` только через CLI, не через env.

---

## Sc1: Повторный `ycsf build` без изменений — hit (US1, FR-010, FR-022)

**Fixture**: `test/check/fixtures/canonical/` (user_service, analytics) с fake builders (counter `build()`).

```bash
rm -rf test/check/fixtures/canonical/.ycsf/cache test/check/fixtures/canonical/.ycsf/artifacts

# 1) first build — all miss, builders called, blobs created
node dist/cli/index.js build --project-dir test/check/fixtures/canonical
# Expected: stderr contains for each app "cache miss ... — no cache entry" (или source changed на первом запуске)
#          exit 0, .ycsf/cache/manifest.json exists version:1, blobs/<effective>/artifact.json exists

# 2) second build — all hit, builders NOT called
node dist/cli/index.js build --project-dir test/check/fixtures/canonical
# Expected: stderr each app "  • cache hit  user_service  (a1b2c3d4) — skipped build"
#           exit 0, artifacts restored from blobs, wall time < 300ms on reference 3-app project (SC-001)

# 3) structured
node dist/cli/index.js build --project-dir test/check/fixtures/canonical --json
# Expected stdout JSON:
# { "command":"build", "exitCode":0, "diagnostics":[], "summary":{ "apps":2,"artifacts":2, "cache":{ "hits":2,"misses":0, "entries":[{"appId":"user_service","hit":true,"reason":"hit"}, ...] } } }
# stderr — empty (no cache lines when --json)
```

**Unit alternative**:
```bash
pnpm vitest run test/build/cache.integration.spec.ts -t "US1 hit"
pnpm vitest run test/cache/fingerprint.test.ts
```

---

## Sc2: Изменение файла инвалидирует кэш (US2, FR-005, FR-011)

```bash
# after Sc1 hit state
echo "// tweak" >> test/check/fixtures/canonical/user_service/src/main.ts

node dist/cli/index.js build --project-dir test/check/fixtures/canonical
# Expected: user_service — "cache miss ... — source changed", builder called, fingerprint changed, new blob created
#           analytics (если independent) — hit

# restore
git checkout -- test/check/fixtures/canonical/user_service/src/main.ts

# external file outside source_path does NOT invalidate
echo "readme tweak" >> test/check/fixtures/canonical/README.md  # if exists, else touch ./README.md at root
node dist/cli/index.js build --project-dir test/check/fixtures/canonical
# Expected: all hit (README.md not in source_path, FR-005 excludes)
rm -f README.md
```

---

## Sc3: Изменение build_config.yaml / buildEnv инвалидирует кэш (US3, FR-006..007)

```bash
# after hit state

# build_config change
# edit analytics/build_config.yaml: build_config.minify true->false (или добавить поле)
node dist/cli/index.js build --project-dir test/check/fixtures/canonical
# Expected: analytics — miss reason "build_config_changed"

# buildEnv change (resolved ENV, FR-006)
NPM_TOKEN=token2 node dist/cli/index.js build --project-dir test/check/fixtures/canonical
# Если app имеет build_env: { NPM_TOKEN: "{{$NPM_TOKEN}}" }
# Expected: miss reason "build_env_changed" (для app с этим buildEnv)
```

---

## Sc4: depends_on transitive инвалидация (US4, FR-008, FR-012, FR-015)

**Fixture**: synthetic `test/cache/fixtures/with-depends/` (user_service root, analytics depends_on user_service, frontend depends_on user_service) — или canonical с добавленным depends_on.

```bash
rm -rf fixtures/with-depends/.ycsf/cache
node dist/cli/index.js build --project-dir fixtures/with-depends
# → all miss, cached (effective includes deps)

# change user_service file
echo "// change" >> fixtures/with-depends/user_service/src/main.ts
node dist/cli/index.js build --project-dir fixtures/with-depends
# Expected: user_service miss source_changed, analytics miss dependency_changed, frontend miss dependency_changed
#           builders for analytics/frontend called even though their files unchanged
#           without change artifacts: analytics effectiveFingerprint changed

# change only analytics file
echo "// analytics change" >> fixtures/with-depends/analytics/src/main.ts
node dist/cli/index.js build --project-dir fixtures/with-depends
# Expected: analytics miss source_changed, user_service hit (invalidation not upward)

# transitive A->B->C: change A → B,C all miss
```

**Test**:
```bash
pnpm vitest run test/build/cache.integration.spec.ts -t "US4 transitive"
```

---

## Sc5: ycsf plan/apply используют кэш в build-фазе (US5, FR-017)

```bash
# mock terraform (как в 021 quickstart Sc6)
cat > /tmp/terraform <<'EOF'
#!/bin/bash
echo "Terraform $@: mock ok"
exit 0
EOF
chmod +x /tmp/terraform
PATH=/tmp:$PATH

rm -rf test/check/fixtures/canonical/.ycsf/cache
node dist/cli/index.js plan --project-dir test/check/fixtures/canonical
# → build misses + materialize called + terraform plan called (FR-017)

node dist/cli/index.js plan --project-dir test/check/fixtures/canonical
# Expected: build hits, materialize still called, terraform plan still called, exit 0, order build → materialize → terraform preserved

node dist/cli/index.js plan --project-dir test/check/fixtures/canonical --no-cache
# Expected: build all miss --no-cache, materialize + terraform still called
```

---

## Sc6: --no-cache / --force / --cache-dir (US6, FR-018..020)

```bash
# after hit state
node dist/cli/index.js build --project-dir test/check/fixtures/canonical --no-cache
# Expected: all miss reason no_cache, builders called, manifest overwritten, stderr "cache miss — --no-cache"

node dist/cli/index.js build --project-dir test/check/fixtures/canonical --force
# Expected: identical to --no-cache (alias)

node dist/cli/index.js build --project-dir test/check/fixtures/canonical --cache-dir /tmp/ycsf-custom
# Expected: blobs in /tmp/ycsf-custom/blobs/, .ycsf/cache/ untouched
# repeat → hit isolated
node dist/cli/index.js build --project-dir test/check/fixtures/canonical --cache-dir /tmp/ycsf-custom
# Expected: hits (second run with same custom dir)

node dist/cli/index.js build --project-dir test/check/fixtures/canonical --json --no-cache
# Expected JSON summary.cache.misses == 2, entries[].reason == "no_cache"

node dist/cli/index.js build --project-dir test/check/fixtures/canonical --no-cache --cache-dir /tmp/x
# Expected: cache ignored (custom dir not read, --no-cache wins, S-5)
```

---

## Sc7: Observability — stderr lines + --json summary.cache (US7, FR-022..024)

```bash
# human-readable
node dist/cli/index.js build --project-dir test/check/fixtures/canonical 2>stderr.txt
cat stderr.txt
# Expected: per-app line "cache hit|miss  <appId>  (<8-char fp>) — <reason>"
#           fingerprint prefix 8 chars, reason in hit|source_changed|dependency_changed|no_cache|...

# structured
node dist/cli/index.js build --project-dir test/check/fixtures/canonical --json 2>stderr2.txt >out.json
cat stderr2.txt
# Expected: empty (no cache lines when --json)
cat out.json | jq .summary.cache
# Expected: { hits, misses, entries: [{ appId, hit, fingerprint (64 hex), reason }] }

node dist/cli/index.js plan --project-dir test/check/fixtures/canonical --json >plan.json 2>/dev/null
cat plan.json | jq .summary.cache
# Expected: cache summary from build phase + terraform output in summary
```

---

## Sc8: Corrupted cache self-heal (US8, FR-025, FR-013, FR-024)

```bash
# after successful build (cache exists)

# corrupt manifest
echo '{broken' > test/check/fixtures/canonical/.ycsf/cache/manifest.json
node dist/cli/index.js build --project-dir test/check/fixtures/canonical 2>stderr.txt
# Expected: stderr warning "CACHE_CORRUPTED" or "cache corrupted", exit 0 after rebuild, manifest rewritten valid

# delete blobs dir
rm -rf test/check/fixtures/canonical/.ycsf/cache/blobs/*
node dist/cli/index.js build --project-dir test/check/fixtures/canonical 2>stderr.txt
# Expected: warning "CACHE_BLOB_MISSING", miss blob_missing, builder called

# wrong version
echo '{"version":999,"entries":{}}' > test/check/fixtures/canonical/.ycsf/cache/manifest.json
node dist/cli/index.js build --project-dir test/check/fixtures/canonical 2>stderr.txt
# Expected: warning "unsupported cache version" (CACHE_VERSION_MISMATCH), treat as miss all, rebuild, new manifest version:1

pnpm vitest run test/cache/manifest.test.ts -t "corrupted"
```

---

## Sc9: Builder update инвалидирует кэш (US9, FR-007)

```bash
# Mock: builder package version is read from package.json of plugin package (R-9)
# After hit state, bump version in fake builder's package.json or mock resolution
# synthetic fixture with builder @ycforge/builders-core fake version 1.0.0 → 1.1.0

node dist/cli/index.js build --project-dir fixtures/with-builder-version  # cached 1.0.0
# bump version (or rewire loadRegistry mock to return 1.1.0)
node dist/cli/index.js build --project-dir fixtures/with-builder-version
# Expected: apps with that builder — miss builder_changed; apps with other builder — hit

pnpm vitest run test/build/cache.integration.spec.ts -t "US9 builder"
```

---

## Sc10: Edge cases (spec Edge Cases)

```bash
# 0 apps
node dist/cli/index.js build --project-dir fixtures/empty-apps --json | jq .summary.cache
# Expected: hits==0 misses==0

# new app added → no_entry miss; removed app → orphan entry not error
# empty source_path dir → filesHash sha256('') → hit if stays empty
# symlink in source_path → miss (fail-safe), documented limitation
# very large file → stream hashing, not OOM (R-1)
```

---

## Test mapping

| Scenario | US / FR | Test file |
|----------|---------|-----------|
| Sc1 | US1, FR-001/010/022/023 | `test/build/cache.integration.spec.ts`, `test/cache/manifest.test.ts` |
| Sc2 | US2, FR-005/011 | `test/build/cache.integration.spec.ts`, `test/cache/fingerprint.test.ts` |
| Sc3 | US3, FR-006/007/011 | `test/build/cache.integration.spec.ts` |
| Sc4 | US4, FR-008/012/015 | `test/build/cache.integration.spec.ts` (transitive chain) |
| Sc5 | US5, FR-014/017 | `test/cli/cache.integration.spec.ts` (mock terraform) |
| Sc6 | US6, FR-018..021 | `test/cli/cache.integration.spec.ts`, `test/build/cache-flags.test.ts` |
| Sc7 | US7, FR-022..024 | `test/cli/cache.integration.spec.ts` (stderr vs --json) |
| Sc8 | US8, FR-004/013/025/030 | `test/cache/manifest.test.ts`, `test/cache/blobs.test.ts` |
| Sc9 | US9, FR-007/011 | `test/build/cache.integration.spec.ts` (builder@version mock) |
| Sc10 | Edge Cases | `test/cache/fingerprint.test.ts`, `test/build/cache.integration.spec.ts` |

---

## Test file structure

```text
packages/pilot/test/
├── cache/
│   ├── fingerprint.test.ts          # filesHash, ownFingerprint, effectiveFingerprint, excludes, builder version
│   ├── manifest.test.ts             # manifest I/O, version mismatch, corruption, atomic rename
│   └── blobs.test.ts                # saveBlob/restoreBlob, blob_missing self-heal, CACHE_WRITE_FAILED
├── build/
│   ├── cache.integration.spec.ts    # Sc1..Sc4, Sc9, transitive, --target + depends_on
│   └── cache-flags.test.ts          # noCache/cacheDir via BuildAppsOptions
└── cli/
    └── cache.integration.spec.ts    # Sc5..Sc8 — ycsf build/plan/apply --json, stderr lines, corruption (binary)
```

---

## Diagnostics / contracts quick ref

- **Cache manifest schema**: [contracts/cache-manifest.json](./contracts/cache-manifest.json)
- **CLI cache surface (flags + summary.cache)**: [contracts/incremental-builds.json](./contracts/incremental-builds.json)
- **Data model (entities, transitions, validation)**: [data-model.md](./data-model.md)
- **Research decisions (R-1..R-10, D-1..D-8)**: [research.md](./research.md)
