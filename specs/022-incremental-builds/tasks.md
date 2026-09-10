---
description: "Task list for incremental-builds — content-addressed кэш артефактов (skip rebuild при неизменном fingerprint)"
---

# Tasks: incremental-builds — content-addressed кэш артефактов

**Input**: Design documents from `/specs/022-incremental-builds/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/cache-manifest.json, contracts/incremental-builds.json, quickstart.md

**Tests**: Test-first per constitution (II). Каждый FR-001..FR-030 и AC US1–US9 → ≥1 тест (RED → GREEN). Тесты пишутся ДО реализации и подтверждаются RED. Constitution II exception не применяется — cache logic unit-testable (temp FS), thin CLI wrapper — только CLI flags forwarding.

**Organization**: Задачи сгруппированы по фазам Setup / Foundational (contracts, cache modules, build integration skeleton — блокируют все US) / US1 hit/miss / US2 file change / US3 build_config/buildEnv / US4 depends_on transitive / US5 plan/apply pipeline / US6 CLI flags / US7 observability / US8 corrupted self-heal / US9 builder version / Polish. Cache lives в `packages/pilot` — no new package.

## Format: `[ID] [P?] [USn] Description with file path`

- **[P]**: Can run in parallel (different files, no incomplete deps)
- **[US1]–[US9]**: User story labels (required in US phases)
- Include exact file paths in descriptions

## Path Conventions

- **Cache core**: `packages/pilot/src/cache/` — fingerprint.ts, manifest.ts, blobs.ts, index.ts
- **Cache contracts**: `packages/pilot/src/contracts/cache.ts` — CacheManifest, CacheEntry, CacheReason, CacheSummary (export via `@ycforge/pilot/contracts`)
- **Build orchestrator**: `packages/pilot/src/build/index.ts` — `buildApps` с cache hit/miss ветвлением (единственная точка, D-1, S-4)
- **Build contracts**: `packages/pilot/src/contracts/build.ts` — UPDATE: extend BuildAppsOptions (noCache?, cacheDir?, onCacheProgress?)
- **CLI commands**: `packages/pilot/src/cli/build.ts`, `plan.ts`, `apply.ts` — add --no-cache/--force/--cache-dir, forward to buildApps, observability
- **CLI errors**: `packages/pilot/src/cli/errors.ts` — add CACHE_* constants (warnings, not exit-code errors)
- **CLI shared**: `packages/pilot/src/cli/pipeline.ts` — UPDATE: thread cache options через runBuildAndMaterialize
- **Root**: `.gitignore` — add `.ycsf/cache/`
- **Tests**: `packages/pilot/test/cache/*.test.ts` (unit: fingerprint, manifest, blobs) + `test/build/cache*.spec.ts` (buildApps integration) + `test/cli/cache*.spec.ts` (CLI flags, --json, stderr)
- **Fixtures**: `packages/pilot/test/check/fixtures/canonical/` (reuse existing, extend for depends_on cases via synthetic temp fixtures)

---

## Phase 1: Setup (Cache Location & Gitignore)

**Purpose**: Cache root `.ycsf/cache/` gitignored, ленивое создание директории, no new dependencies (node:crypto/fs built-in). Без этого blobs/manifest будут коммититься.

- [ ] T001 Add `.ycsf/cache/` to `.gitignore` (рядом с существующей записью `.ycsf/artifacts/` на строке 44, mirror 021 pattern). No new package. **Ref**: FR-001, S-1, plan.md R-10.
- [ ] T002 Verify `packages/pilot/vitest.config.ts` includes `test/cache/**/*.test.ts` and `test/build/cache*.spec.ts` globs (if explicit include list exists, extend; if default glob, no change — verify). **Ref**: plan.md Project Structure, quickstart.md Test file structure.

---

## Phase 2: Foundational (Contracts, Cache Modules, Build Integration Skeleton)

**Purpose**: Типы контракта (`version: 1`), cache modules (fingerprint, manifest, blobs, facade), расширение `BuildAppsOptions`, CACHE_* diagnostics, integration skeleton в `buildApps` (вычисление fingerprints topo, cacheLookup stub). ALL user story work depends on this phase.

### Cache contracts (RED → GREEN)

- [ ] T010 Create `packages/pilot/src/contracts/cache.ts` — `CacheManifest` (`{ version: 1, entries: Record<string, CacheEntry> }`), `CacheEntry` (`{ appId, fingerprint, effectiveFingerprint, artifactType, createdAt, dependsOnFingerprints }`), `CacheReason` union (`hit | no_entry | source_changed | build_config_changed | build_env_changed | builder_changed | dependency_changed | no_cache | blob_missing | corrupted`), `CacheCheckResult` (`{ appId, hit, fingerprint, reason, blobPath? }`), `CacheSummary` (`{ hits, misses, entries: CacheCheckResult[] }`). Re-export via `packages/pilot/src/contracts/index.ts` → `@ycforge/pilot/contracts`. Per data-model §2.1, §2.5, §2.6. **Ref**: FR-001, FR-028, FR-029, S-1, contracts/cache-manifest.json `#/manifest` + `#/definitions/cacheReason`.
- [ ] T011 [P] RED unit-test `packages/pilot/test/cache/contracts.test.ts` — AC: `CacheManifest.version` must be `1` (const check vs contracts JSON `#/manifest/properties/version/const`); `CacheReason` enum matches contracts/cache-manifest.json `#/definitions/cacheReason/enum` (10 values); `CacheEntry.fingerprint` regex `^[a-f0-9]{64}$`; `CacheSummary` shape matches contracts/incremental-builds.json `#/definitions/cacheSummary`. RED: import `src/contracts/cache.ts` fails. **Ref**: FR-028, FR-030, SC-010.

### Diagnostics constants (RED → GREEN)

- [ ] T012 Create `CACHE_*` constants in `packages/pilot/src/cli/errors.ts` — `CACHE_CORRUPTED`, `CACHE_BLOB_MISSING`, `CACHE_WRITE_FAILED`, `CACHE_VERSION_MISMATCH` (strings, warnings, not exit-code errors, not in CLI_* error hierarchy). Per data-model §6, contracts/cache-manifest.json `#/diagnostics`. **Ref**: FR-030, S-7, D-7.
- [ ] T013 [P] RED unit-test `packages/pilot/test/cache/errors.test.ts` — 4 CACHE_* constants exported, values byte-for-byte == keys in `specs/022-incremental-builds/contracts/cache-manifest.json` `#/diagnostics`; `CACHE_*` not in `CLI_*` InputError/RuntimeError branching (warning only, exit 0). RED: constants absent. **Ref**: FR-030, SC-010.

### BuildAppsOptions extension (RED → GREEN)

- [ ] T014 Extend `packages/pilot/src/contracts/build.ts` — `BuildAppsOptions` add `readonly noCache?: boolean` (--no-cache/--force), `readonly cacheDir?: string` (--cache-dir, default ".ycsf/cache" relative to projectRoot), `readonly onCacheProgress?: (result: CacheCheckResult) => void` (per-app hit/miss for CLI stderr + --json). Import `CacheCheckResult` from `contracts/cache.ts`. Per data-model §2.6, §5.1. **Ref**: FR-018, FR-019, FR-023, data-model §2.6, plan.md R-6.
- [ ] T015 [P] RED unit-test `packages/pilot/test/cache/build-options.test.ts` — BuildAppsOptions shape: noCache boolean optional, cacheDir string optional, onCacheProgress function optional, target still present; contracts align with contracts/incremental-builds.json `#/cliFlags`. RED: options absent. **Ref**: FR-018..020.

### Fingerprint module (RED → GREEN)

- [ ] T016 Create `packages/pilot/src/cache/fingerprint.ts` — `canonicalJson(obj: unknown): string` (JSON.stringify with recursive sorted keys, 0 spaces, deterministic); `computeFilesHash(projectRoot: string, sourcePath: string): Promise<string>` (sorted list `relativePath + '\0' + sha256(fileContent) + '\0'`, fixed excludes: `.git/`, `node_modules/`, `.ycsf/cache/`, `.ycsf/artifacts/`, `infra`, POSIX relativePath, stream hashing via `node:crypto` `createHash('sha256')` + `createReadStream`, symlink → read error → throw for caller to treat as miss, empty source_path → `sha256('')`); `computeOwnFingerprint(inputs: OwnFingerprintInputs): string` (`sha256(canonicalJson({ filesHash, buildConfig, buildEnv, builder }))`, 64-char hex lower-case); `computeEffectiveFingerprint(own: string, depEffects: readonly string[]): string` (`depEffects.length===0 ? own : sha256(own + '|' + sortedJoin(depEffects))`). Per spec S-2, FR-005..009, data-model §2.3..2.4, research R-1..R-3. **Ref**: FR-005..009.
- [ ] T017 [P] RED unit-test `packages/pilot/test/cache/fingerprint.test.ts` — (a) canonicalJson sorted keys deterministic (unsorted input → sorted output, no spaces); (b) filesHash: temp dir with 2 files → hash stable across readdir order, excludes `.git/` and `node_modules/` not hashed, empty dir → `sha256('')`, symlink → error (fail-safe); (c) ownFingerprint: known inputs → known 64-char hex (snapshot), buildEnv resolved not template, builder `id@version` included; (d) effectiveFingerprint: no deps → equals own, with deps sortedJoin deterministic, different dep order same result; (e) large file (>1MB) stream not OOM. Uses temp FS (`node:fs/promises mkdtemp`). RED: fingerprint.ts stub. **Ref**: FR-005..009, S-2, research R-1..R-3.

### Manifest module (RED → GREEN)

- [ ] T018 Create `packages/pilot/src/cache/manifest.ts` — `loadManifest(cacheDir: string): Promise<{ manifest: CacheManifest | null, warning?: string }>` (read `manifest.json`, parse, validate `version===1` else return warning `CACHE_VERSION_MISMATCH` + null; corrupted JSON/I/O → warning `CACHE_CORRUPTED` + null, fail-safe FR-025); `saveManifest(cacheDir: string, manifest: CacheManifest): Promise<void>` (write to `manifest.json.tmp` + `rename(manifest.json)` atomic, I/O error → warning `CACHE_WRITE_FAILED` but not throw per FR-026); `getCacheDir(projectRoot: string, cacheDirOpt?: string): string` (resolve relative from projectRoot, default `.ycsf/cache`). Per spec S-1, S-3, FR-002..004, data-model §2.1, research R-4. **Ref**: FR-001..004.
- [ ] T019 [P] RED unit-test `packages/pilot/test/cache/manifest.test.ts` — (a) save then load round-trip → entries equal, version 1; (b) corrupted JSON → load returns null + warning `CACHE_CORRUPTED`; (c) version 999 → warning `CACHE_VERSION_MISMATCH` + null; (d) missing file → null no warning; (e) atomic rename: temp file not left behind; (f) `getCacheDir` relative resolution from projectRoot. Temp FS. RED: manifest.ts stub. **Ref**: FR-002..004, FR-025, FR-028, S-7.

### Blobs module (RED → GREEN)

- [ ] T020 Create `packages/pilot/src/cache/blobs.ts` — `saveBlob(cacheDir: string, effectiveFingerprint: string, artifact: Artifact, artifactsAppDir: string): Promise<void>` (ensure `blobs/<fp>/`, copy `artifacts/<appId>/` → `blobs/<fp>/files/` recursive `cp`, write `artifact.json` `{ type, value }`, I/O error → warning `CACHE_WRITE_FAILED` FR-026); `restoreBlob(cacheDir: string, effectiveFingerprint: string, artifactsAppDir: string): Promise<Artifact | null>` (read `artifact.json` + copy `files/` → `artifacts/<appId>/`, missing/corrupted → return null + warning `CACHE_BLOB_MISSING`); `hasValidBlob(cacheDir: string, effectiveFingerprint: string): Promise<boolean>` (check `artifact.json` exists + readable). Per spec S-1, D-8, FR-003, FR-010, FR-013, research R-5. **Ref**: FR-003, FR-010, FR-013.
- [ ] T021 [P] RED unit-test `packages/pilot/test/cache/blobs.test.ts` — (a) save then restore round-trip → artifact equal + files restored; (b) missing blob → hasValidBlob false, restore returns null + warning; (c) corrupted artifact.json → miss; (d) saveBlob I/O error path (mock fs error) → warning `CACHE_WRITE_FAILED` not throw. Temp FS with temp artifacts dir. RED: blobs.ts stub. **Ref**: FR-003, FR-013, FR-026, D-8.

### Cache facade (RED → GREEN)

- [ ] T022 Create `packages/pilot/src/cache/index.ts` — `checkCache(projectRoot: string, appId: string, effectiveFingerprint: string, cacheDir: string, manifest: CacheManifest | null): Promise<CacheCheckResult>` (noCache → `no_cache` miss, no manifest/entry → `no_entry`, !hasValidBlob → `blob_missing` + self-heal delete entry, effective mismatch → detect reason via component diff priority `source_changed > build_config_changed > build_env_changed > builder_changed > dependency_changed` FR-011, else `hit`); `getCacheReasonPriority` helper; re-export `CacheReason`, `CacheCheckResult`, `CacheSummary`, `fingerprint` helpers. Per data-model §2.5, §3, spec S-6, FR-010..013. **Ref**: FR-010..013.
- [ ] T023 [P] RED unit-test `packages/pilot/test/cache/cache.test.ts` — (a) noCache flag → `no_cache` miss; (b) no entry → `no_entry`; (c) blob missing → `blob_missing` + manifest entry removed (self-heal); (d) effective mismatch with stored entry → correct reason priority; (e) hit when fingerprint equal + blob valid; (f) CacheSummary hits/misses counts. Mock manifest/blobs. RED: index.ts stub. **Ref**: FR-010..013, FR-025.

### Build integration skeleton (RED → GREEN)

- [ ] T024 Prepare `packages/pilot/src/build/index.ts` cache pipeline skeleton — add imports from `src/cache/*`, add `noCache`/`cacheDir`/`onCacheProgress` branching: if `noCache` skip cache I/O; else `loadManifest`, compute `ownFingerprint` per app (filesHash + canonicalJson buildConfig + resolvedEnv + builderId@version via registry packageName → package.json lookup with fallback), compute `effectiveFingerprint` in topologicalOrder (spec 011 `depends_on_graph`), `checkCache` per app in topo order, `onCacheProgress` callback, hit → `restoreBlob` (no builder call) push `BuiltArtifact`, miss → builder → `saveBlob`+`saveManifest` per app (FR-016). Keep existing fail-fast paths (`PML_*`, `BRG_*` before cache). Per spec S-4, FR-014..016, data-model §5.1, research R-6. **Ref**: FR-014..016.
- [ ] T025 [P] RED unit-test `packages/pilot/test/build/cache-skeleton.test.ts` — mock buildApps deps (loadProjectModel, prepareBuildEnv, loadRegistry, validateBuilders, getBuilder) + cache modules (`computeFilesHash` mock, `loadManifest` mock): (a) noCache false + manifest hit → builder NOT called, artifacts from restore; (b) noCache true → all miss, builder called; (c) hit still respects topologicalOrder (dependency before dependent). RED: skeleton absent. **Ref**: FR-014, FR-015, FR-018.

**Checkpoint**: Foundational ready — `pnpm --filter @ycforge/pilot test -- --run test/cache/` GREEN, `typecheck` clean, cache modules + BuildAppsOptions + CACHE_* constants verified.

---

## Phase 3: US1 — Повторный `ycsf build` без изменений — cache hit, skip сборки (Priority: P1) 🎯 MVP

**Goal**: Второй `ycsf build` без изменений не вызывает `Builder.build()`, копирует blobs → artifacts, завершается на порядок быстрее (SC-001). Ядро фичи §39.

**Independent Test**: Фикстура 1 app + fake builder с counter. Build miss → blob+manifest. Build повторно → hit, builder не вызван, artifacts восстановлены, `summary.cache.hits==1`.

### Tests for US1 (RED — write FIRST)

- [ ] T030 [P] [US1] RED integration-test `packages/pilot/test/build/cache.integration.spec.ts` (US1 section) — (a) `buildApps` first call on temp project with fake builder → `summary.cache.misses==1`, builder called 1, `blobs/<fp>/artifact.json` exists, `manifest.entries[appId].effectiveFingerprint==fp`; (b) second `buildApps` same project without changes → `summary.cache.hits==1`, builder NOT called, artifacts restored, `onCacheProgress` hit; (c) 2 independent apps both hit on second build, no builder calls. Mock `computeFilesHash` via real temp files or inject? Use temp FS fixture. RED: buildApps cache hit path not implemented. **Ref**: US1 AC1–AC3, FR-001, FR-010, FR-014, SC-001, quickstart Sc1.
- [ ] T031 [P] [US1] RED CLI integration-test `packages/pilot/test/cli/cache-hit.integration.spec.ts` — spawn `node dist/cli/index.js build --project-dir <temp-fixture>` twice: first → stderr `cache miss`, exit 0; second → stderr `cache hit  <appId>  (<8-char>) — skipped build`, exit 0, wall time < 300ms. Also `--json` second run → `summary.cache.hits==1` + no stderr cache lines. RED: CLI cache output absent. **Ref**: FR-022, FR-023, US1 AC2, SC-007.

### Implementation for US1 (GREEN)

- [ ] T032 [US1] Implement `packages/pilot/src/build/index.ts` US1 hit path — wire `computeFilesHash` real FS, `canonicalJson` buildConfig, resolvedEnv, `builderId@packageVersion` (lookup `package.json` via `createRequire` from registry record `packageName`, fallback builderId), topo compute, `loadManifest`+`hasValidBlob`+`restoreBlob` hit branch (return `BuiltArtifact` from blob without builder), miss branch `builder.build()` → `saveBlob`+`saveManifest` per app (FR-016). Ensure `artifacts/<appId>/` created, hit restores files. **Depends**: T016, T018, T020, T022, T024.
- [ ] T033 [US1] Wire `onCacheProgress` to build result — `buildApps` returns `CacheSummary` alongside `artifacts` (extend `BuildAppsResult` ok kind with `cache?: CacheSummary`), update `packages/pilot/src/contracts/build.ts` and `packages/pilot/src/cli/build.ts` to expose summary for US7 later (no CLI output yet). **Ref**: FR-014, data-model §5.1.

**Checkpoint**: `pnpm --filter @ycforge/pilot test -- --run test/build/cache.integration.spec.ts` US1 section GREEN, builder counter proves skip.

---

## Phase 4: US2 — Изменение файла инвалидирует кэш (Priority: P1)

**Goal**: Изменение `source_path` файла → `source_changed` miss только для этого app, остальные — hit. Внешние файлы вне `source_path` не инвалидируют.

**Independent Test**: После US1 hit, append к `source_path` файлу → build → miss `source_changed` для этого app, остальные hit. Изменение `README.md` вне source_path → all hit.

### Tests for US2 (RED — write FIRST)

- [ ] T040 [P] [US2] RED integration-test section in `packages/pilot/test/build/cache.integration.spec.ts` (US2) — (a) cached app, modify `source_path/src/app.controller.ts` (append) → next build → `source_changed` miss, fingerprint differs, builder called, new blob created; (b) 2 apps (A: user_service, B: frontend independent), change only B file → B miss, A hit; (c) change file outside source_path (`README.md` at root) → all hit. **Ref**: US2 AC1–AC3, FR-005, FR-011, SC-002.
- [ ] T041 [P] [US2] RED unit-test `packages/pilot/test/cache/fingerprint-filesHash.test.ts` — verify fixed excludes: `.git/`, `node_modules/`, `.ycsf/cache/`, `.ycsf/artifacts/`, `infra` not hashed (create files in those dirs, modify → filesHash unchanged); POSIX relativePath sorting; `filesHash` includes `relativePath + '\0' + sha256(content)` per file. RED: excludes missing. **Ref**: FR-005, S-2, research R-1.

### Implementation for US2 (GREEN)

- [ ] T042 [US2] Implement `packages/pilot/src/cache/fingerprint.ts` filesHash excludes + builder integration — ensure `computeFilesHash` filters fixed list (no configurable ignore in v1), uses `readdir` recurse sorted, POSIX relativePath, stream hash; `buildApps` compares `effectiveFingerprint` vs manifest entry to detect `source_changed` (first priority in reason detection). Isolated invalidation already from per-app effective check. **Depends**: T016, T032.
- [ ] T043 [US2] Wire reason propagation — `checkCache` returns `source_changed` when `filesHash` diff is root cause (compare `fingerprint`/`buildConfig`/`buildEnv`/`builder` components or fallback to generic diff; data-model §2.5 detection order). **Ref**: FR-011.

**Checkpoint**: Modify file → rebuild miss isolated; external file → hit. `fingerprint-filesHash` and US2 integration GREEN.

---

## Phase 5: US3 — Изменение `build_config.yaml` / `buildEnv` инвалидирует кэш (Priority: P1)

**Goal**: Изменение `build_config` или resolved ENV (`{{$ENV}}`) → `build_config_changed` / `build_env_changed` miss. Без изменений — hit.

**Independent Test**: After hit, change `build_config.yaml` field → miss `build_config_changed`. Change ENV `NPM_TOKEN` → miss `build_env_changed`. No changes → hit.

### Tests for US3 (RED — write FIRST)

- [ ] T050 [P] [US3] RED integration-test section in `packages/pilot/test/build/cache.integration.spec.ts` (US3) — (a) cached `analytics`, mutate `build_config` (build_config.dockerfile or opaque field) → next build `build_config_changed` miss; (b) cached `user_service` with `build_env: { NPM_TOKEN: "{{$NPM_TOKEN}}" }`, ENV `token1` → `token2` → `build_env_changed` miss, fingerprint differs; (c) no build_config/ENV change → hit. Mock `prepareBuildEnv` resolved values. **Ref**: US3 AC1–AC3, FR-006, FR-007, SC-003.
- [ ] T051 [P] [US3] RED unit-test `packages/pilot/test/cache/fingerprint-buildEnv.test.ts` — ownFingerprint includes canonicalJson buildConfig + resolved buildEnv (sorted keys), different buildEnv → different fingerprint even if files same; `{{$ENV}}` template change alone without resolved change → same fingerprint (but resolved change → diff). RED: buildEnv not in fingerprint. **Ref**: FR-006, FR-007, S-2, research R-2.

### Implementation for US3 (GREEN)

- [ ] T052 [US3] Implement buildEnv/buildConfig in fingerprint — `buildApps` passes `projectModel.build_configs.get(appId)?.build_config ?? {}` canonicalJson and `resolvedEnvs.get(appId)` (already prepared via `prepareBuildEnv`) into `computeOwnFingerprint`; ensure resolved values (not raw `{{$ENV}}`) used per FR-006. **Depends**: T016, T032.
- [ ] T053 [US3] Implement reason `build_config_changed` / `build_env_changed` detection — compare stored entry vs computed: if `filesHash` same but buildConfig canonical differs → `build_config_changed`; else if buildEnv differs → `build_env_changed`. Per FR-011 priority order. **Ref**: FR-011.

**Checkpoint**: build_config/ENV change → miss with correct reason; stable → hit.

---

## Phase 6: US4 — `depends_on` transitive инвалидация (Priority: P1)

**Goal**: Изменение `user_service` инвалидирует `analytics`/`frontend` depends_on `user_service` (dependency_changed), даже если их файлы не менялись. Инвалидация не идёт вверх. Transitive `A→B→C` все miss.

**Independent Test**: Фикстура 3 apps с цепочкой. Cache all → change `user_service` file → user_service source_changed, analytics/frontend dependency_changed. Change only analytics → analytics miss, user_service hit. A→B→C chain → change A → all miss.

### Tests for US4 (RED — write FIRST)

- [ ] T060 [P] [US4] RED integration-test section in `packages/pilot/test/build/cache.integration.spec.ts` (US4) — (a) user_service fp1, analytics depends_on user_service fpA includes fp1: change user_service file → user_service miss source_changed, analytics miss dependency_changed, builder analytics called; (b) change only analytics → analytics miss, user_service hit; (c) A→B→C (C depends B depends A) → change A → all 3 miss transitive; (d) `--target analytics` after user_service change → analytics miss dependency_changed via manifest last-entry for dependency outside target (FR-021). Mock depends_on graph from ProjectModel. **Ref**: US4 AC1–AC4, FR-008, FR-012, FR-015, FR-021, SC-002, S-2, quickstart Sc4.
- [ ] T061 [P] [US4] RED unit-test `packages/pilot/test/cache/effectiveFingerprint.test.ts` — effective = sha256(own + '|' + sortedJoin(depEffects)); topo order: dep effective before dependent; sortedJoin makes order irrelevant; empty deps → equals own; chain A→B→C: C effective includes B effective which includes A → transitive. RED: effective calc missing. **Ref**: FR-008, D-4, research R-3.

### Implementation for US4 (GREEN)

- [ ] T062 [US4] Implement `computeEffectiveFingerprint` topo in `packages/pilot/src/build/index.ts` — get `topologicalOrder` from `ProjectModel.depends_on_graph` (spec 011), compute `effectiveFingerprint` per app in order: own + sorted dep effects (direct neighbors); for `--target` mode, deps outside target taken from manifest last entry or treated as `dependency_changed` miss if absent (FR-008, FR-021, S-2). **Depends**: T016, T032.
- [ ] T063 [US4] Wire per-app save after each build (FR-016) to preserve partial cache even when dependent later fails — ensure manifest+blob saved immediately after each successful `builder.build()`, not batched. **Ref**: FR-016.

**Checkpoint**: Transitive invalidation proven: change root → all dependents miss; change leaf → root hit; --target respects deps outside set.

---

## Phase 7: US5 — `ycsf plan` / `apply` используют кэш в build-фазе (Priority: P1)

**Goal**: `ycsf plan`/`apply` build phase cached (hits when source unchanged), materialize и terraform always execute (не кэшируются), order `build → materialize → terraform` preserved.

**Independent Test**: Mock terraform binary (exit 0). Cached project → `ycsf plan` → build hits, materialize called, terraform plan called. Change source → plan → build miss + rest called.

### Tests for US5 (RED — write FIRST)

- [ ] T070 [P] [US5] RED integration-test `packages/pilot/test/cli/cache-pipeline.integration.spec.ts` (US5) — (a) cached fixture + mock terraform → `ycsf plan` → build hits, materialize called, `terraform plan` called, exit 0; (b) source change → `ycsf apply` → changed app miss + build, unchanged hit, then materialize → terraform apply; (c) order assertion: build cache check → materialize → terraform. Mock `terraform` binary via `test/cli/fixtures/terraform` (reuse 021 mock) + spawn mock. RED: plan/apply not forwarding cache. **Ref**: US5 AC1–AC3, FR-017, SC-006, quickstart Sc5.
- [ ] T071 [P] [US5] RED unit-test `packages/pilot/test/cli/unit/pipeline-cache.test.ts` — `runBuildAndMaterialize` forwards `noCache`/`cacheDir`/`onCacheProgress` to `buildApps`; materialize still called even on build hit; terraform not skipped. RED: pipeline thread missing. **Ref**: FR-017.

### Implementation for US5 (GREEN)

- [ ] T072 [US5] Update `packages/pilot/src/cli/pipeline.ts` — `runBuildAndMaterialize(rootDir, opts?: { target?: string, json?: boolean, noCache?: boolean, cacheDir?: string, onCacheProgress?: ... })` thread cache options to `buildApps`; keep materialize/plan/apply shared order (data-model §5.1). **Depends**: T014, T024.
- [ ] T073 [US5] Update `packages/pilot/src/cli/plan.ts` and `packages/pilot/src/cli/apply.ts` — forward `noCache`/`cacheDir` from commander opts to `runBuildAndMaterialize`; no cache for materialize/terraform phases themselves (S-4). **Depends**: T072.
- [ ] T074 [US5] Ensure `ycsf destroy`/`check`/`materialize` commands do NOT read/write cache (S-4) — verify no cache import in `materialize.ts`, `destroy.ts`, `check.ts`. Add assertion test. **Ref**: S-4, FR-017.

**Checkpoint**: `ycsf plan`/`apply` with mock terraform GREEN, cache hits in build phase, materialize/terraform always run.

---

## Phase 8: US6 — `--no-cache` / `--force` / `--cache-dir` (Priority: P2)

**Goal**: `--no-cache`/`--force` bypass cache (all miss, перезапись manifest/blobs), `--cache-dir <path>` override root (изолированный кэш), `--no-cache`+`--cache-dir` → cache ignored.

**Independent Test**: After hit, `ycsf build --no-cache` → all miss `no_cache`, builders called. `--cache-dir /tmp/custom` → blobs в custom, not `.ycsf/cache`. `--json --no-cache` → summary misses.

### Tests for US6 (RED — write FIRST)

- [ ] T080 [P] [US6] RED unit-test `packages/pilot/test/cli/unit/build-cache-flags.test.ts` — (a) `--no-cache` → `buildApps` called with `noCache=true`, all miss reason `no_cache`; (b) `--force` alias same behavior; (c) `--cache-dir /tmp/x` → `cacheDir=/tmp/x` forwarded, `.ycsf/cache` untouched; (d) `--no-cache --cache-dir /tmp/x` → cacheDir ignored, noCache wins; (e) relative cacheDir resolved from projectRoot. Mock commander opts → build.ts action. RED: flags not wired. **Ref**: US6 AC1–AC5, FR-018..020, SC-004, S-5.
- [ ] T081 [P] [US6] RED integration-test `packages/pilot/test/cli/cache-flags.integration.spec.ts` — spawn binary: `build --no-cache` → stderr `cache miss — --no-cache`, builders called, manifest overwritten; `build --force` identical; `build --cache-dir /tmp/ycsf-test-cache` → `blobs` in custom dir; repeat with same custom → hit isolated; `--json --no-cache` → `summary.cache.misses==N` `reason: no_cache`. RED: CLI flags not recognized (exit 2). **Ref**: US6 AC1–AC5, FR-018..020, quickstart Sc6.
- [ ] T082 [P] [US6] RED unit-test `packages/pilot/test/build/cache-flags.test.ts` — direct `buildApps` with `noCache:true`/`cacheDir:/tmp/custom` options: noCache → treat all as miss but still save new manifest/blobs after success; cacheDir custom → manifest read/write in custom. RED: buildApps flags not respected. **Ref**: FR-018, FR-019.

### Implementation for US6 (GREEN)

- [ ] T083 [US6] Implement flags in `packages/pilot/src/cli/build.ts` — add commander `.option('--no-cache', 'Ignore cache')`, `.option('--force', 'Alias --no-cache')`, `.option('--cache-dir <path>', 'Override cache directory')`; resolve `noCache = Boolean(opts.noCache || opts.force)`; `cacheDir = opts.cacheDir as string | undefined`; forward to `buildApps` as `BuildAppsOptions`. **Depends**: T014, T024.
- [ ] T084 [US6] Implement flags in `packages/pilot/src/cli/plan.ts` and `packages/pilot/src/cli/apply.ts` — same 3 options, forward to `runBuildAndMaterialize`. Ensure `--target` + `--no-cache` combo works (rebuild only target, ignoring cache). Unknown flag → commander error exit 2 (FR-021 validation). **Depends**: T072.
- [ ] T085 [US6] Implement `cacheDir` resolution in `packages/pilot/src/cache/manifest.ts:getCacheDir` — relative path resolved from `projectRoot` (FR-019), absolute passed through, `noCache` → custom dir ignored (just bypass). Documented. **Ref**: FR-019.

**Checkpoint**: `build --no-cache`/`--force`/`--cache-dir` GREEN, isolated cache and explicit opt-out verified.

---

## Phase 9: US7 — Observability: hit/miss логи и `--json` summary (Priority: P2)

**Goal**: Human-readable per-app `cache hit|miss` строки в stderr (8-char fingerprint prefix, reason), `--json` включает `summary.cache` и suppresses cache строки (чистый JSON stdout).

**Independent Test**: `ycsf build` → stderr 2 lines hit with prefix; 1 app changed → stderr `cache miss ... — source changed`; `ycsf build --json` → `summary.cache.hits==2` entries reason, stderr empty.

### Tests for US7 (RED — write FIRST)

- [ ] T090 [P] [US7] RED unit-test `packages/pilot/test/cli/unit/cache-observability.test.ts` — (a) human mode: `onCacheProgress` hit → stderr `  • cache hit  user_service  (a1b2c3d4) — skipped build`, miss → `  • cache miss  analytics  (e5f6g7h8) — source changed`/`dependency user_service changed`/`--no-cache`/`no cache entry`; `! cache corrupted` for blob missing; fingerprint 8-char prefix lower-case, grep-stable format; (b) `--json` mode: no cache lines in stderr, only JSON. Mock `onCacheProgress` → stderr formatter. RED: formatter absent. **Ref**: US7 AC1–AC4, FR-022, FR-024, S-6.
- [ ] T091 [P] [US7] RED integration-test `packages/pilot/test/cli/cache-observability.integration.spec.ts` — spawn `build --project-dir <cached-fixture>`: assert stderr per-app hit lines, fingerprint prefix 8 chars; with one app changed → miss reason; `build --json` → stdout JSON `summary.cache: { hits, misses, entries: [{ appId, hit, fingerprint: 64 hex, reason }] }`, reason enum values, stderr empty; `plan --json` with hit → JSON contains cache summary from build phase + tf output. RED: CLI observability missing. **Ref**: US7 AC1–AC4, FR-022, FR-023, SC-007, quickstart Sc7.

### Implementation for US7 (GREEN)

- [ ] T092 [US7] Implement human-readable logging in `packages/pilot/src/cli/build.ts` — `onCacheProgress` handler writes per-app line to stderr (format S-6): hit `  • cache hit  <appId>  (<8-char>) — skipped build`, miss `  • cache miss  <appId>  (<8-char>) — <reason string>` mapping reason enum to human text (`source_changed`→`source changed`, `dependency_changed`→`dependency <dep> changed`, `no_cache`→`--no-cache`, `no_entry`→`no cache entry`, `blob_missing`→corrupted warning `  ! cache corrupted for <app> (<8-char>) — rebuilding`). Lines precede `Building app …` or replace it on hit. Suppress when `json=true` (FR-023). Mirror in `plan.ts`/`apply.ts` via pipeline. **Depends**: T022, T083.
- [ ] T093 [US7] Implement `--json` `summary.cache` in `packages/pilot/src/cli/build.ts` — on `buildApps` ok/invalid, include `cache: { hits, misses, entries }` in `CLIResult.summary.cache` per contracts/incremental-builds.json `#/definitions/cacheSummary`; ensure `fingerprint` 64-char hex, `reason` enum. `plan.ts`/`apply.ts` include cache summary from build phase (even when terraform phase follows). Structured field absent for `check`/`destroy`/`materialize`. Validate against contracts. **Ref**: FR-023, S-6, data-model §5.2.
- [ ] T094 [US7] Implement `reason` enum mapping completeness — all 10 values `hit | no_entry | source_changed | build_config_changed | build_env_changed | builder_changed | dependency_changed | no_cache | blob_missing | corrupted` covered, per spec S-6, contracts/cache-manifest.json enum. **Ref**: FR-011, FR-023.

**Checkpoint**: Stderr lines grep-stable, `--json` summary.cache present, reason enum correct, human vs json modes isolated.

---

## Phase 10: US8 — Corrupted cache self-heal (Priority: P2)

**Goal**: Corrupted `manifest.json` / missing `blobs/<fp>/` / `version !== 1` → warning `CACHE_*` в stderr, treat as miss, rebuild, self-heal (перезапись), exit 0 если build успешен (fail-safe, не fail-fast).

**Independent Test**: После успешного build, повредить manifest `{broken` → build → warning `CACHE_CORRUPTED` exit 0, manifest restored. Удалить blobs dir → `CACHE_BLOB_MISSING` miss. `version:999` → `CACHE_VERSION_MISMATCH` warning.

### Tests for US8 (RED — write FIRST)

- [ ] T100 [P] [US8] RED unit-test `packages/pilot/test/cache/corruption.test.ts` — (a) manifest invalid JSON → load returns null + warning `CACHE_CORRUPTED`, treat all miss; (b) blobs/<fp> missing → `hasValidBlob` false → `blob_missing` miss + warning `CACHE_BLOB_MISSING` + stale entry delete; (c) manifest version 999 → warning `CACHE_VERSION_MISMATCH` + reset; (d) I/O error on cache read (EACCES mock) → warning, treat as miss exit 0; (e) I/O error on cache write (disk full mock) → warning `CACHE_WRITE_FAILED`, build still exit 0, next run miss (FR-026). Temp FS + fs mock. RED: fail-safe missing. **Ref**: US8 AC1–AC4, FR-004, FR-013, FR-025, FR-026, FR-030, SC-008, S-7.
- [ ] T101 [P] [US8] RED integration-test `packages/pilot/test/cli/cache-corruption.integration.spec.ts` — (a) corrupt manifest `echo '{broken' > .ycsf/cache/manifest.json` → spawn `build` → stderr contains `CACHE_CORRUPTED` or `cache corrupted`, exit 0, manifest rewritten valid `version:1`; (b) delete `blobs/<fp>/` → build → `blob_missing` miss, warning `CACHE_BLOB_MISSING`, builder called; (c) `version:999` manifest → warning `unsupported cache version` + all miss rebuild. RED: self-heal not implemented. **Ref**: US8 AC1–AC4, FR-025, quickstart Sc8.

### Implementation for US8 (GREEN)

- [ ] T102 [US8] Implement fail-safe in `packages/pilot/src/cache/manifest.ts` — corrupted JSON/I_O → warning `CACHE_CORRUPTED` to stderr (via `onCacheProgress` or direct `process.stderr.write`), return null (all miss), not throw; version mismatch → warning `CACHE_VERSION_MISMATCH`, return null; on next successful build overwrite with `version:1` (FR-004). **Depends**: T018, T022.
- [ ] T103 [US8] Implement self-heal in `packages/pilot/src/cache/blobs.ts` + `src/cache/index.ts` — `hasValidBlob` missing `artifact.json` → warning `CACHE_BLOB_MISSING`, `checkCache` deletes stale manifest entry (in-memory, next `saveManifest` persists deletion), treat as `blob_missing` miss per S-3, FR-013; `saveBlob`/`saveManifest` I/O error → warning `CACHE_WRITE_FAILED`, not exit 1 (FR-026), artifacts in `.ycsf/artifacts/` already valid. **Ref**: FR-013, FR-025, FR-026.
- [ ] T104 [US8] Wire warnings to stderr without changing exit code — `packages/pilot/src/build/index.ts` cache warnings never produce `CLI_BUILD_FAILED`; `packages/pilot/src/cli/build.ts` etc. preserve exit 0 on successful build despite cache warnings (D-7, FR-024). Verify `diagnostics` not polluted (warnings not in `errors`/`diagnostics` array per FR-030, only in stderr + `summary.cache.entries[].reason`). **Ref**: FR-024..026, FR-030, D-7.

**Checkpoint**: Corrupted cache → warning + miss + rebuild + self-heal, exit 0 when build ok; I/O failures fail-safe.

---

## Phase 11: US9 — Builder обновление инвалидирует кэш (Priority: P3)

**Goal**: Обновление `@ycforge/builder-*` `1.0.0→1.1.0` → все apps с этим builder — miss `builder_changed`; apps с другим builder — hit.

**Independent Test**: Замокать `package.json` версию builder-пакета. Закэшировать 1.0.0 → изменить версию 1.1.0 → build miss `builder_changed`.

### Tests for US9 (RED — write FIRST)

- [ ] T110 [P] [US9] RED unit-test `packages/pilot/test/cache/builder-version.test.ts` — (a) fingerprint includes `builderId@packageVersion`: same files/buildEnv but different version → different ownFingerprint; (b) version unknown fallback → only `builderId` (degraded, no warning, still valid fingerprint); (c) two builders (`nestjs-function` and `docker`): update only `docker` version → only docker apps miss `builder_changed`, nestjs hit. Mock `package.json` lookup. RED: builder version not in fingerprint. **Ref**: US9 AC1–AC2, FR-007, SC-009, S-2, research R-9.
- [ ] T111 [P] [US9] RED integration-test section in `packages/pilot/test/build/cache.integration.spec.ts` (US9) — cached project with builder `nestjs-function@1.0.0`, bump packageVersion to `1.1.0` (mock registry record packageName → fake package.json), build → all apps with that builder `builder_changed` miss, others hit. **Ref**: US9 AC1–AC2, FR-007, FR-011.

### Implementation for US9 (GREEN)

- [ ] T112 [US9] Implement builder version lookup in `packages/pilot/src/cache/fingerprint.ts` — helper `resolveBuilderVersion(registry, builderId: string): string | null` via `registry.records.get(builderId)?.packageName` → `createRequire(import.meta.url).resolve(packageName + '/package.json')` or `readFileSync` nearest `package.json`, parse `version`; fallback `null` → builder string = `builderId` only (degraded, no warning per S-2). Include in `OwnFingerprintInputs.builder` as `${builderId}@${version}` or `builderId`. Per S-2, FR-007, research R-9. **Depends**: T016.
- [ ] T113 [US9] Wire `builder_changed` reason detection — compare `builderId@version` component diff → `builder_changed` per FR-011 priority (after build_env, before dependency). **Ref**: FR-007, FR-011.

**Checkpoint**: Builder version bump → `builder_changed` miss isolated per builder type; unknown version degraded but build not blocked.

---

## Phase 12: Polish & Cross-Cutting

**Purpose**: Quickstart validation, typecheck, lint, full regression, docs sync, IDEA.md divergence check.

- [ ] T120 Verify quickstart Sc1 — `node packages/pilot/dist/cli/index.js build --project-dir test/check/fixtures/canonical` first → miss, second → hit, stderr cache lines + `blobs/`+`manifest.json version:1` exist. **Depends**: T032, T033.
- [ ] T121 Verify quickstart Sc2 — modify `source_path` file → `source_changed` miss, external file → hit. **Depends**: T042, T043.
- [ ] T122 Verify quickstart Sc3 — `build_config.yaml` / ENV change → `build_config_changed`/`build_env_changed`, stable → hit. **Depends**: T052, T053.
- [ ] T123 Verify quickstart Sc4 — depends_on transitive A→B→C, `--target` deps handling. **Depends**: T062, T063.
- [ ] T124 Verify quickstart Sc5 — `ycsf plan`/`apply` with mock terraform (`packages/pilot/test/cli/fixtures/terraform`) → build hits + materialize/terraform always executed, `--no-cache` variant. **Depends**: T073, T074.
- [ ] T125 Verify quickstart Sc6 — `--no-cache`/`--force`/`--cache-dir` isolated, `--json --no-cache` summary. **Depends**: T083, T084.
- [ ] T126 Verify quickstart Sc7 — human-readable vs `--json` observability, fingerprint 8-char prefix, summary.cache hits/misses/entries.reason. **Depends**: T092, T093.
- [ ] T127 Verify quickstart Sc8 — corrupted manifest / blob missing / version mismatch self-heal, exit 0. **Depends**: T102, T103.
- [ ] T128 Verify quickstart Sc9 — builder update `builder_changed` isolated per builder. **Depends**: T112, T113.
- [ ] T129 Verify quickstart Sc10 Edge cases — 0 apps `hits==0 misses==0`, new app `no_entry`, empty `source_path` `sha256('')` hit, `symlink` → miss fail-safe, large file stream not OOM (R-1). **Depends**: T016, T030.
- [ ] T130 Structural consistency audit — (a) CACHE_* constants in `src/cli/errors.ts` byte-for-byte == `specs/022-incremental-builds/contracts/cache-manifest.json` `#/diagnostics` keys; (b) CacheReason enum (10 values) == contracts `#/definitions/cacheReason/enum`; (c) `CacheManifest.version` const 1 == contracts `#/manifest/properties/version/const`; (d) no string-literal `CACHE_*` comparisons in `src/cache/**` or `src/build/**` (only constant imports per Constitution V). **Depends**: T012, T022.
- [ ] T131 Typecheck clean — `pnpm --filter @ycforge/pilot typecheck` (`tsc --noEmit`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) → zero errors (including `CacheManifest`, `BuildAppsOptions` extensions, `createRequire`). **Depends**: T010, T014, T016, T018, T020, T022, T032, T083, T092.
- [ ] T132 Lint clean — `pnpm --filter @ycforge/pilot lint` (`eslint`) → zero errors (no string-literal CACHE_* in src/**, only constant imports). **Depends**: T131.
- [ ] T133 Full build — `pnpm --filter @ycforge/pilot build` (`tsup`) → `dist/cache/**` + `dist/build/index.js` + `dist/cli/index.js` present, `dist/cli/index.js` shebang intact, no new external deps. **Depends**: T001, T010.
- [ ] T134 Full check suite + zero-regression — `pnpm --filter @ycforge/pilot test` → ALL existing pilot tests (011–021) still GREEN + ALL new `test/cache/*.test.ts` + `test/build/cache*.spec.ts` + `test/cli/cache*.spec.ts` GREEN (≥600 LOC tests). **Depends**: T131, T132, T133.
- [ ] T135 Docs sync — verify `specs/022-incremental-builds/quickstart.md` Sc1..Sc10 match implemented CLI flags/JSON shape; if spec and `IDEA.md §39` diverge, update `IDEA.md` (§39 incremental builds section) per AGENTS.md (spec wins, IDEA.md updated). Check `specs/README.md` roadmap still ⬜ until converge. **Depends**: T120..T129.
- [ ] T136 SC-010 performance sanity — `ycsf build` second run on canonical fixture (cached) wall time < 300ms (vs >2s full), `summary.cache.hits==2`; `filesHash` for <10k files < 500ms (plan.md Performance Goals). Record result in Polish notes. **Depends**: T032.

---

## Phase 13: Convergence

**Purpose**: Gaps found during `/speckit.converge` (read-only audit, `pnpm --filter @ycforge/pilot test` full, `typecheck`/`lint` clean, smoke probes against `dist/cli/index.js`). Verdict placeholder — populate after implementation.

- [ ] T140 Convergence findings placeholder — reserve for `/speckit.converge` re-run: adversarial re-verification of all FR-001..030, US1–US9 AC, exit codes (0/1/2), `--json` pure stdout, cache warnings fail-safe vs `PML_DEPENDS_CYCLE`/`CLI_BUILD_FAILED` fail-fast, `destroy --cleanup` not touching `.ycsf/cache/`, `Artifact` contract unchanged, `manifest.json version:1` atomic, SC-001..SC-010.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No deps — can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 (`.gitignore` + vitest glob). BLOCKS all US phases. Internal order: T010/T012/T014/T016/T018/T020/T022/T024 [P] (modules + contracts) → T011/T013/T015/T017/T019/T021/T023/T025 (tests) — RED before GREEN per file.
- **Phase 3 (US1)**: Depends on Phase 2 complete. T030/T031 [P] (RED) → T032 (GREEN) → T033 (wire summary).
- **Phase 4 (US2)**: Depends on Phase 2 + Phase 3 (buildApps hit path exists for isolated invalidation test). T040/T041 [P] (RED) → T042 (GREEN) → T043 (reason).
- **Phase 5 (US3)**: Depends on Phase 2 + Phase 3. T050/T051 [P] (RED) → T052 (GREEN) → T053 (reason).
- **Phase 6 (US4)**: Depends on Phase 2 + Phase 3 (effectiveFingerprint needs topo + hit path). T060/T061 [P] (RED) → T062 (GREEN) → T063 (per-app save).
- **Phase 7 (US5)**: Depends on Phase 2 + Phase 3 (buildApps). T070/T071 [P] (RED) → T072 (GREEN pipeline) → T073 → T074.
- **Phase 8 (US6)**: Depends on Phase 2 complete (flags independent of US1–US5 content). T080/T081/T082 [P] (RED) → T083 → T084 → T085.
- **Phase 9 (US7)**: Depends on Phases 3–8 (observability needs cache results). T090/T091 [P] (RED) → T092 → T093 → T094.
- **Phase 10 (US8)**: Depends on Phase 2 complete (manifest/blobs fail-safe). T100/T101 [P] (RED) → T102 → T103 → T104.
- **Phase 11 (US9)**: Depends on Phase 2 + Phase 3 (builder version needs fingerprint core). T110/T111 [P] (RED) → T112 → T113.
- **Phase 12 (Polish)**: Depends on all US phases (3–11). T120–T129 [P] (quickstart) → T130 → T131 → T132 → T133 → T134 → T135 → T136.
- **Phase 13 (Convergence)**: Depends on Polish complete. T140 placeholder.

### User Story Dependencies

```
Phase 1 (Setup) ────────────────────────────────────────────┐
                                                             ▼
Phase 2 (Foundational) ───────┬───────────────────────────────┐
                               │                               │
                               ├──► Phase 3 US1 hit/miss ──────┼──► Phase 5 US3 buildEnv ───┐
                               │        │                      │                              │
                               │        ├──► Phase 4 US2 file ─┤                              │
                               │        │                      ├──► Phase 6 US4 depends_on ──┤──► Phase 7 US5 pipeline
                               │        │                      │                              │        │
                               ├──► Phase 8 US6 flags ────────┼──────────────────────────────┘        │
                               │                               │                                     │
                               ├──► Phase 10 US8 corrupted ────┤──► Phase 9 US7 observability ───────┤
                               │                               │                                     │
                               └──► Phase 11 US9 builder ──────┘                                     │
                                                                                                     ▼
                                                                              Phase 12 Polish ──► Phase 13 Convergence
```

- **US1, US2, US3, US6, US8, US9**: Can start in parallel after Phase 2 (independent files, but US2/US3/US4 share `cache.integration.spec.ts` file — coordinate or split sections).
- **US4**: Depends on US1 (hit path must exist to test transitive invalidation).
- **US5**: Depends on US1 (buildApps with cache).
- **US7**: Depends on US1–US6 (observability aggregates cache results).
- **Polish**: Depends on all US phases.

### Parallel Opportunities

- **Phase 2**: T010/T012/T014/T016/T018/T020/T022/T024 [P] (different files); T011/T013/T015/T017/T019/T021/T023/T025 [P] (unit tests, different files).
- **Phases 3, 6, 8, 10, 11**: After Phase 2, US1, US6, US8, US9, and (after US1) US4 can run in parallel by different developers (watch `cache.integration.spec.ts` merge).
- **Phase 12**: T120–T129 [P] (quickstart per scenario, different probes).

### Parallel Example: After Phase 2

```bash
# Foundational done — parallel US chains:
Task: "US1: hit/miss T030/T031 → T032 → T033"
Task: "US6: flags T080/T081/T082 → T083 → T084"
Task: "US8: corrupted T100/T101 → T102 → T103"
Task: "US9: builder T110/T111 → T112 → T113"
# After US1:
Task: "US2: file T040/T041 → T042"
Task: "US3: buildEnv T050/T051 → T052"
Task: "US4: depends_on T060/T061 → T062"
Task: "US5: pipeline T070/T071 → T072 → T073"
# Then:
Task: "US7: observability T090/T091 → T092 → T093"
```

---

## Implementation Strategy

### MVP First (US1 only — incremental hit/miss)

1. Complete Phase 1: Setup (`.gitignore`).
2. Complete Phase 2: Foundational (contracts, fingerprint, manifest, blobs, facade, build skeleton).
3. Complete Phase 3: US1 — hit/miss (RED T030/T031 → GREEN T032 → T033).
4. **STOP and VALIDATE**: `ycsf build` twice → second build 0 builder calls, `summary.cache.hits==N`, blobs + manifest exist, `artifacts/` restored.
5. MVP: incremental build core works end-to-end.

### Incremental Delivery

1. Setup + Foundational → module skeleton buildable + types/constants.
2. US1 (hit/miss) → Test independently → MVP! (SC-001)
3. US2 (file change) → Isolated invalidation (SC-002)
4. US3 (build_config/buildEnv) → Builder inputs (SC-003)
5. US4 (depends_on transitive) → Graph invalidation (SC-002)
6. US5 (plan/apply) → Pipeline with cache (SC-006)
7. US6 (--no-cache/--force/--cache-dir) → Explicit opt-out + CI isolation (SC-004/005)
8. US7 (observability) → Human + JSON (SC-007)
9. US8 (corrupted self-heal) → Fail-safe (SC-008)
10. US9 (builder version) → Bundler update (SC-009)
11. Polish → quickstart, typecheck, lint, regression, docs/IDEA.md sync.

### Parallel Team Strategy

With multiple developers:
1. Together: Phase 1 + Phase 2 (Foundational).
2. Once Foundational done:
   - Developer A: US1 (hit) + US2 (file) + US4 (depends_on) — fingerprint/build core
   - Developer B: US6 (flags) + US8 (corrupted) + US9 (builder) — CLI/edge cases
   - Developer C: US3 (buildEnv) + US5 (pipeline) + US7 (observability) — env/pipeline/logs
3. After A+B+C: Polish together — quickstart, typecheck, lint, regression, IDEA.md.

---

## Notes

- [P] tasks = different files, no dependencies — safe to parallelize.
- [USn] label maps task to specific user story for traceability (FR→AC→task).
- Each US: tests (RED) MUST be written and FAIL before implementation (GREEN) — Constitution II, spec SC-010.
- Commit after each task or logical group; keep `buildApps` sequential loop (no parallel build, no file locking v1, per spec Concurrency).
- Stop at any checkpoint to validate story independently (`pnpm --filter @ycforge/pilot test -- --run <file>`).
- Avoid: vague tasks, same-file conflicts, cross-story deps that break independence; `cache.integration.spec.ts` shared across US1–US4/US9 — coordinate edits (append sections, not overwrite).
- Cache — C-level optimization only (Constitution I): `Builder` stateless, `Artifact` unchanged (FR-029), Terraform not cached (FR-017), `version: 1` versioned (FR-028).
- Exit codes: cache warnings never change exit code (0 on success, FR-024..026); `PML_DEPENDS_CYCLE`/`CLI_BUILD_FAILED`/`BRG_*` fail-fast 1/2 before cache (FR-027).

