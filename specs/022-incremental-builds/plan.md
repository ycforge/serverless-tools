# Implementation Plan: incremental-builds — content-addressed кэш артефактов

**Branch**: `022-incremental-builds` | **Date**: 2026-09-11 | **Spec**: [specs/022-incremental-builds/spec.md](./spec.md)

**Input**: Feature specification from `./spec.md` (content-addressed cache, §39, depends_on transitive invalidation, D-1..D-8)

## Summary

Spec 022 добавляет **content-addressed кэш артефактов на уровне C** (IDEA §39) внутри `buildApps` (`packages/pilot/src/build/index.ts`): `ycsf build` переиспользует `Artifact + outputDir snapshot` без вызова `Builder.build()`, когда `effectiveFingerprint(app) = sha256(ownFingerprint | dependsOnFingerprints)` не изменился и blob `/.ycsf/cache/blobs/<effective>/` валиден. Invalidation транзитивна по `depends_on` DAG (spec 011). Кэш локальный, best-effort, opt-out по умолчанию (`--no-cache`/`--force`/`--cache-dir`), fail-safe на corruption (warning + miss), fail-fast на project model. Builder контракты (`Builder`/`Artifact`, spec 002) не меняются; materialize/plan/apply вызывают `buildApps` прозрачно. Новые модули в `packages/pilot/src/cache/` (fingerprint, manifest, blobs, cache), интеграция в `buildApps` + CLI (`src/cli/build.ts`, `plan.ts`, `apply.ts`), `.gitignore` + `/.ycsf/cache/manifest.json version: 1`, observability stderr + `--json summary.cache`.

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` — tsconfig pilot). `node:crypto` (sha256), `node:fs/promises` + `node:fs` sync для manifest/blobs, `node:path` POSIX.

**Primary Dependencies**: Внутренние `loadProjectModel` (spec 011), `prepareBuildEnv` (spec 012), `loadRegistry`/`validateBuilders`/`getBuilder` (spec 013), `node:crypto` `createHash('sha256')`, `commander` v12 (CLI flags как в 021). Нет внешних hashing/cache библиотек.

**Storage**: File system — `<projectRoot>/.ycsf/cache/` (default): `manifest.json` (`version: 1`, `entries: Map<appId, CacheEntry>`) + `blobs/<effectiveFingerprint>/` (`artifact.json` + snapshot `outputDir`). `.ycsf/cache/` gitignored, лениво создаётся, атомарный `manifest.json.tmp + rename`, `artifacts/<appId>/` ↔ `blobs/<effective>/` copy. Актуальные artifacts как и раньше в `/.ycsf/artifacts/<appId>/`.

**Testing**: Vitest (unit + integration). Test-first per Constitution II: каждый FR-001..030 и US1..9 → ≥1 тест, RED → GREEN. Unit: temp FS для fingerprint/manifest/blobs/cache, mock builders. Integration: фикстура `test/check/fixtures/canonical/` + fake builders с counter `build()` (как в 021), `buildApps` directly + CLI binary `dist/cli/index.js` для `--no-cache`/`--cache-dir`/`--json`. `typecheck`/`lint` чисто.

**Target Platform**: Node 22+ ESM module в `packages/pilot`. Новые модули `src/cache/*`, обновление `src/build/index.ts`, `src/cli/{build,plan,apply}.ts`, `.gitignore`. Bundled by tsup (уже настроен для `src/build/index` + `src/cli/index`).

**Project Type**: CLI/orchestration layer в `packages/pilot` (`@ycforge/pilot`). Thin orchestration extension (cache wrapper вокруг builder loop) — не новый пакет, не новый deployment engine.

**Performance Goals**: SC-001 — повторный `ycsf build` без изменений на reference-проекте (3 apps) 0 builder вызовов, `wall time < 300ms` vs `>2s` полной сборки; `summary.cache.hits==3`. Fingerprint для типичного app (<10k файлов) < 500ms (stream hashing, не держать все файлы в памяти).

**Constraints**: Cache — C-level optimization (Constitution I: не в builder, не в materializer, не в Terraform). `Artifact` контракт (spec 002) неизменен (fingerprint — C-internal). `version: 1` версионирование manifest (Constitution III). Explicit flags only (`--no-cache`/`--force`/`--cache-dir`, no env/config, Constitution V). Fail-safe на corrupted cache (warning + miss, not error), fail-fast на `PML_DEPENDS_CYCLE`/`CLI_BUILD_FAILED` (Constitution V). Sequential `buildApps` loop (no parallel, no file locking v1).

**Scale/Scope**: ~400 LOC cache (`src/cache/` 4 файла) + ~150 LOC integration в `build/index.ts` + ~60 LOC CLI flags + ~50 LOC observability + ~600 LOC tests. 1 entity version, 4 new modules, 3 CLI commands modified, 2 contract JSON files, 9 user stories, 30 FRs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Cache живёт в C (`packages/pilot/src/cache/` + `src/build/index.ts` buildApps wrapper, S-2/S-3/S-4). Builder остаётся stateless `build(BuildContext)→Artifact` (не знает о кэше, D-1). B не затронут. Terraform не кэшируется (materialize всегда dispatch, S-4 D-8). §39: «C может реализовывать кэширование на уровне C» — прямо соблюдено. |
| II. Spec-First, Test-First | ✅ PASS | Каждый FR-001..030 и US1..9 → ≥1 тест, RED→GREEN (spec checklist). Исключение Constitution II (thin orchestration) не применяется — cache logic не thin CLI spawn, а unit-testable (temp FS). Характеристика: 021 уже требовала test-first. |
| III. Contracts Versioned | ✅ PASS | `manifest.json version: 1` (FR-028, S-1) — format versioning как `.ycsf/*.yaml`; mismatch → reset с warning. `Artifact` (spec 002) не меняется (FR-029, D-1). Новые diagnostic codes `CACHE_*` — warnings, не breaking. Contracts export — `contracts/cache.ts` type-only via `@ycforge/pilot/contracts` уже. |
| IV. Terraform Stays Terraform | ✅ PASS | Cache — только build artifacts (`Artifact` + `outputDir` snapshot). `materialize` → `.tf.json` не кэшируется (S-4). Terraform state/syntax не моделируется, не валидируется. `ycsf destroy --cleanup` не трогает cache (S-1). |
| V. Explicit Over Magic | ✅ PASS | Flags explicit: `--no-cache`/`--force`/`--cache-dir` (S-5 D-5), default enabled, нет env/config auto-detection. Fixed exclude list for filesHash (S-2) — explicit, не `.gitignore` magic. Fail-safe на corruption (warning + miss, D-7) vs fail-fast на `PML_DEPENDS_*`/`CLI_BUILD_FAILED` (FR-027). Коллизии вне scope кэша (fail-fast сохраняется). |
| VI. Ownership: apps=managed | ✅ PASS | Cache per-app (`entries: Map<appId, CacheEntry>`), `artifacts/<appId>/` ↔ `blobs/<effective>/`. Orphan entries при удалении app — not error (spec Edge Cases). `resources=external` не кэшируется. |
| Monorepo Tooling | ✅ PASS | Новые модули в `packages/pilot/src/cache/` — within pilot package (как `src/build/`, `src/cli/`). Нет новых пакетов. `node:crypto`/`fs` — built-in, нет новых dependencies. |

**Gate Decision**: All gates PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/022-incremental-builds/
├── plan.md              # This file
├── research.md          # Phase 0 output (decisions D-1..D-8 + research R-1..R-8)
├── data-model.md        # Phase 1 output (CacheManifest, CacheBlob, fingerprint entities)
├── quickstart.md        # Phase 1 output (validation scenarios Sc1..Sc10)
├── contracts/           # Phase 1 output
│   ├── cache-manifest.json      # CacheManifest JSON schema (version, entries, blob layout)
│   └── incremental-builds.json  # CLI surface: --no-cache/--force/--cache-dir, summary.cache
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/pilot/src/
├── cache/                               # NEW — incremental build cache (spec 022, §39)
│   ├── fingerprint.ts                   # ownFingerprint(), effectiveFingerprint(), filesHash(), canonicalJson()
│   ├── manifest.ts                      # CacheManifest I/O: loadManifest(), saveManifest() (atomic rename), version check
│   ├── blobs.ts                         # Blob I/O: saveBlob(), restoreBlob(), hasValidBlob(), removeBlob() — copy artifacts ↔ blobs
│   └── index.ts                         # checkCache() / saveCache(), CacheReason enum, CacheEntry type, CacheSummary for CLI
├── build/
│   └── index.ts                         # UPDATE — integrate cache: compute fingerprints topo, hit/miss branch, onCacheProgress, save after each app
├── cli/
│   ├── build.ts                         # UPDATE — add --no-cache/--force/--cache-dir, forward to buildApps, merge summary.cache
│   ├── plan.ts                          # UPDATE — forward cache flags to buildApps via pipeline
│   ├── apply.ts                         # UPDATE — forward cache flags to buildApps via pipeline
│   ├── pipeline.ts                      # UPDATE (if needed) — thread cache options through runBuildAndMaterialize
│   └── errors.ts                        # UPDATE — add CACHE_* constants (warnings, not exit-code errors)
├── contracts/
│   ├── cache.ts                         # NEW — CacheManifest, CacheEntry, CacheReason types (export via @ycforge/pilot/contracts)
│   └── build.ts                         # UPDATE — extend BuildAppsOptions with noCache?, cacheDir?, onCacheProgress?
├── index.ts                             # UPDATE — re-export cache contracts if public
packages/pilot/
├── vitest.config.ts                     # UPDATE — ensure test/cache/ included
└── test/
    ├── cache/
    │   ├── fingerprint.test.ts          # filesHash, ownFingerprint, effectiveFingerprint, builder version
    │   ├── manifest.test.ts             # manifest I/O, version mismatch, corruption
    │   └── blobs.test.ts                # save/restore, blob_missing self-heal
    ├── build/
    │   ├── cache.integration.spec.ts    # US1..US4, US9 — buildApps with cache, invalidation, transitive
    │   └── cache-flags.test.ts          # --no-cache/--force/--cache-dir via buildApps options
    └── cli/
        └── cache.integration.spec.ts    # US5..US8 — ycsf build/plan/apply --json summary.cache, stderr lines
.gitignore                               # UPDATE — add .ycsf/cache/
```

**Structure Decision**: Cache — чистый C-orchestration слой (Constitution I, D-1) в `packages/pilot/src/cache/` (4 файла), интегрируемый единственно в `buildApps` (`src/build/index.ts` — единственная точка hit/miss, S-4). CLI flags в `src/cli/{build,plan,apply}.ts` (зеркало 021 pattern: each command — отдельный файл, pipeline shared). Contracts `src/contracts/cache.ts` via `@ycforge/pilot/contracts` (type-only для плагинов, но fingerprint — C-internal). Тесты зеркалят 021 layout: `test/cache/` unit + `test/build/cache.*` integration + `test/cli/cache.*` CLI.

## Complexity Tracking

> No constitution violations introduced — all gates pass. Cache is local, best-effort optimization within C build orchestration (§39). No new packages, no provider schema modeling, no builder contract change.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
