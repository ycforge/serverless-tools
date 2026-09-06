---
description: "Task list for project-model — .ycsf/*.yaml Project Model (load/validate/ownership/depends_on graph)"
---

# Tasks: project-model — `.ycsf/*.yaml` Project Model

**Input**: Design documents from `/specs/011-project-model/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/project-model.json, quickstart.md

**Tests**: Test-first per constitution (II). Every acceptance criterion and every quickstart scenario maps to at least one test task (RED → GREEN). Tests are written and confirmed failing BEFORE their implementation task.

**Organization**: Tasks are grouped into Setup / Tests / Core / Integration / Polish phases so each module is implemented test-first and the whole quickstart suite is validated at the end.

## Format: `[ID] [P?] [P1/P2/P3] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[P1]/[P2]/[P3]**: Priority of the user story this task serves (from spec.md). `/speckit.plan` open questions are resolved inline as decided behavior + dedicated test cases.
- Include exact file paths in descriptions.

## Path Conventions

- **Monorepo package**: `packages/pilot/src/` for source, `packages/pilot/test/` for tests
- **Public type contracts**: `packages/pilot/src/contracts/project-model.ts` re-exported from `src/contracts/index.ts` (`@ycforge/pilot/contracts`)
- **Internal runtime model** (`yaml`-dependent): `packages/pilot/src/model/`
- **Unit tests**: `packages/pilot/test/unit/` (matches existing `version.test.ts`, `zero-dependency.test.ts`)
- **Integration / quickstart scenarios**: `packages/pilot/test/project-model/`
- **Type tests**: `packages/pilot/test/types/` (`.test-d.ts`, picked up by vitest typecheck)

⚠️ **Repro concern (must handle in Setup)**: `packages/pilot/test/unit/zero-dependency.test.ts` currently asserts `package.json` has NO `dependencies`/`peerDependencies` fields. Adding `yaml@^2` to `dependencies` will fail that assertion. The test's real intent is that `src/contracts/` stays dependency-free (import-graph check); the package.json-level assertion must be scoped to contract-only deps so the new `yaml` runtime dep does not trip it. Handle in T003/T005.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Package wiring and contract scaffolding so that tests and implementation can run in pilot.

- [ ] T001 Add `"yaml": "^2.9.0"` under `dependencies` in `packages/pilot/package.json` (runtime dep; NOT added to `@ycforge/pilot/contracts`, per plan/research decision 1)
- [ ] T002 [P] Create `packages/pilot/src/contracts/project-model.ts` — type-only public contracts: `App`, `Resource`, `BuildConfig`, `EnvRequirement`, `DependsOnGraph`, `ProjectModel`, `ProjectModelDiagnostic`, `ProjectModelError`, `ProjectModelLoadResult`, plus `ProjectModelDiagnostics` code constants (`PML_VERSION`, `PML_PARSE`, `PML_INVALID`, `PML_DUPLICATE_APP_ID`, `PML_DUPLICATE_RESOURCE_ID`, `PML_DUPLICATE_KEY`, `PML_DEPENDS_SELF`, `PML_DEPENDS_UNKNOWN`, `PML_DEPENDS_CYCLE`, `PML_IDENTITY_COLLISION`, `PML_ENV_NOT_SET`) matching `contracts/project-model.json` — export from `src/contracts/index.ts` (add `export * from './project-model.js'`)
- [ ] T003 [P] Update `packages/pilot/test/unit/zero-dependency.test.ts` — keep the `src/contracts` relative-import check; scoped the package.json assertion so it still enforces that `@ycforge/pilot/contracts` has no runtime deps without failing now that the pilot package itself gains the `yaml` dependency (add a comment noting the split)
- [ ] T004 [P] Add vitest typecheck config for `test/types/**/*.test-d.ts` if not already covered; create `packages/pilot/test/types/project-model.test-d.ts` skeleton verifying the new public types are imported/usable from `@ycforge/pilot/contracts` (mirrors `fr-*.test-d.ts` pattern)
- [ ] T005 [P] Verify wiring: run `pnpm --filter @ycforge/pilot typecheck && pnpm --filter @ycforge/pilot test` from repo root — confirm existing suite passes (with T001+T003 in place) and tsup entry still resolves (`packages/pilot/tsup.config.ts` already emits `src/index.ts` and `src/contracts/index.ts`; no config change expected unless index import breaks)

---

## Phase 2: Tests — Core module tests (RED)

**Purpose**: Write failing unit tests for each `src/model/` module, mapping every acceptance criterion / quickstart scenario and every FR to a concrete case. All RED here; GREEN comes in Phase 3.

### parse.ts — version + duplicate-key (US-6 / US-3, P3)

- [ ] T010 [P] [P3] Unit test `parse.ts`: valid `version: 1` passes; missing `version` → `PML_VERSION`; `version: 2` → `PML_VERSION` (US-6 AC1/AC2, FR-004/FR-014) in `packages/pilot/test/unit/parse.spec.ts`
- [ ] T011 [P] [P3] Unit test `parse.ts`: YAML syntax error → `PML_PARSE` with line/column from `parseDocument` (FR-015) in `packages/pilot/test/unit/parse.spec.ts`
- [ ] T012 [P] [P3] Unit test `parse.ts` duplicate-key granularity (**plan Q2 decided**): `parseDocument(text, { uniqueKeys: true })` reports a repeated `app_id` (and a repeated `resource_id`) key as `PML_DUPLICATE_KEY` (yaml AST level), never silent last-wins (US-3 AC2, FR-008) — assert the diagnostic code is `PML_DUPLICATE_KEY`, not `PML_DUPLICATE_APP_ID`/`PML_DUPLICATE_RESOURCE_ID` (those semantic codes remain reserved in the catalog) in `packages/pilot/test/unit/parse.spec.ts`

### apps.ts (US-1, P1)

- [ ] T013 [P] [P1] Unit test `apps.ts`: parses 3 apps with `source_path`, `builder`, `depends_on`; missing `depends_on` becomes `[]` (US-1 AC1, FR-001) in `packages/pilot/test/unit/apps.spec.ts`
- [ ] T014 [P] [P1] Unit test `apps.ts`: rejects builder-specific/unknown per-app keys (FR-012) and non-string `depends_on` entries / missing `builder` or `source_path` → `PML_INVALID` in `packages/pilot/test/unit/apps.spec.ts`

### resources.ts — resources + identity collision (US-1 / US-3, P1)

- [ ] T015 [P] [P1] Unit test `resources.ts`: groups resources by domain (`queues.events`, `buckets.frontend`, `functions.legacy_authorizer`) (US-1 AC2, FR-002) in `packages/pilot/test/unit/resources.spec.ts`
- [ ] T016 [P] [P1] Unit test `resources.ts` (**plan Q1 decided**): unknown top-level domains (e.g. `topics:`) are treated as generic resource groups, NOT a load error (forward-compat spec 019; research decision 11, FR-002) in `packages/pilot/test/unit/resources.spec.ts`
- [ ] T017 [P] [P3] Unit test `resources.ts`: empty `resources.yaml` (no resources) → valid, empty model (spec Edge Case, FR-002) in `packages/pilot/test/unit/resources.spec.ts`
- [ ] T018 [P] [P1] Unit test identity collision (**plan Q1 decided**, data-model.md "Decision"): `app_id` equals a `functions`-domain `resource_id` OR `functions.<app_id>` equals a `functions.<resource_id>` → `PML_IDENTITY_COLLISION` with identity set (US-3 AC1, FR-008) in `packages/pilot/test/unit/resources.spec.ts`

### build-config.ts + env-requirements.ts (US-3 / US-4 / US-5, P1/P2)

- [ ] T019 [P] [P1] Unit test `build-config.ts`: reads `build_config` (opaque, not validated — FR-011) + `build_env` (string | null) (US-1 AC3, FR-003/FR-011) in `packages/pilot/test/unit/build-config.spec.ts`
- [ ] T020 [P] [P2] Unit test `build-config.ts`: `<app>/build_config.yaml` absent → `{ build_config: {}, build_env: {} }`, no error (US-5 AC1, FR-003) and file with only `build_env` (no `build_config`) → valid with empty `build_config` (spec Edge Case) in `packages/pilot/test/unit/build-config.spec.ts`
- [ ] T021 [P] [P2] Unit test `env-requirements.ts`: extracts `{{$NAME}}` from `build_config` string leaves + from `build_env` values (regex `/\{\{\$([A-Z0-9_]+)\}\}/g`), and treats bare `build_env` `null` entries as requirements too (US-4, FR-009/FR-010, research decision 4) in `packages/pilot/test/unit/env-requirements.spec.ts`
- [ ] T022 [P] [P2] Unit test `env-requirements.ts`: missing `{{$NAME}}`/`null` env when absent from `process.env` → `PML_ENV_NOT_SET` (collect-all, both names reported, each with `app` + source field) (US-4 AC1, FR-009/FR-015) and present env → passed with `isSet: true` (US-4 AC2) in `packages/pilot/test/unit/env-requirements.spec.ts`

### depends-on.ts — DFS cycle/self/dangling (US-2, P1)

- [ ] T023 [P] [P1] Unit test `depends-on.ts`: builds `DependsOnGraph.adjacency` + `topologicalOrder` for a valid DAG (US-1 AC1, FR-005) in `packages/pilot/test/unit/depends-on.spec.ts`
- [ ] T024 [P] [P1] Unit test `depends-on.ts`: cycle A→B→C→A → `PML_DEPENDS_CYCLE` with involved chain (a → b → c → a) in message/app fields (US-2 AC1, FR-005/FR-015/S C-002) in `packages/pilot/test/unit/depends-on.spec.ts`
- [ ] T025 [P] [P1] Unit test `depends-on.ts`: self-reference A→A → `PML_DEPENDS_SELF` (US-2 AC2, FR-006) in `packages/pilot/test/unit/depends-on.spec.ts`
- [ ] T026 [P] [P1] Unit test `depends-on.ts`: dangling A→nonexistent → `PML_DEPENDS_UNKNOWN` naming 'nonexistent' (US-2 AC3, FR-007) in `packages/pilot/test/unit/depends-on.spec.ts`
- [ ] T027 [P] [P1] Unit test `depends-on.ts`: collect-ALL — a project with both a cycle and a dangling ref reports BOTH diagnostics in one load (research decision 3, FR-015) in `packages/pilot/test/unit/depends-on.spec.ts`

### errors.ts (FR-015, all)

- [ ] T028 [P] [P1] Unit test `errors.ts`: `ProjectModelError` aggregates `ProjectModelDiagnostic[]`; each diagnostic car carries `code`, `message`, `file`, and where applicable `app`/`identity`/`field`/`line`/`column` per `contracts/project-model.json` `#/definitions/diagnostic` (FR-015) in `packages/pilot/test/unit/errors.spec.ts`

---

## Phase 3: Core — Implementation (GREEN)

**Purpose**: Implement each `src/model/` module to turn the Phase 2 tests GREEN, keeping `yaml` imports strictly inside `src/model/` (never `src/contracts/`).

- [ ] T030 [P] [P3] Implement `parse.ts` in `packages/pilot/src/model/parse.ts` — `parseDocument(text, { uniqueKeys: true })`, map `doc.errors` to `PML_PARSE`/`PML_DUPLICATE_KEY`, enforce `version: 1` → `PML_VERSION` (depends on T010–T012)
- [ ] T031 [P] [P1] Implement `apps.ts` in `packages/pilot/src/model/apps.ts` — `apps.yaml` → `App[]` with shape checks (`PML_INVALID`), unknown per-app keys rejected (FR-012) (depends on T013, T014)
- [ ] T032 [P] [P1] Implement `resources.ts` in `packages/pilot/src/model/resources.ts` — parse `resources.yaml`, group by domain, treat unknown domains as generic groups, run app↔resource identity collision check (`functions.<app_id>` / bare `app_id` vs `functions.<resource_id>`) → `PML_IDENTITY_COLLISION` (depends on T015–T018)
- [ ] T033 [P] [P1] Implement `build-config.ts` in `packages/pilot/src/model/build-config.ts` — load `<app>/build_config.yaml`, absent → empty `BuildConfig`, read `build_config` (opaque) + `build_env` (string|null) (depends on T019, T020)
- [ ] T034 [P] [P2] Implement `env-requirements.ts` in `packages/pilot/src/model/env-requirements.ts` — `EnvRequirement` extraction (regex + `null` build_env), `process.env` presence check → `PML_ENV_NOT_SET`, collect-all (depends on T021, T022)
- [ ] T035 [P] [P1] Implement `depends-on.ts` in `packages/pilot/src/model/depends-on.ts` — `DependsOnGraph` adjacency + topological order via iterative DFS white/gray/black; detect cycle (`PML_DEPENDS_CYCLE` with chain), self (`PML_DEPENDS_SELF`), dangling (`PML_DEPENDS_UNKNOWN`); collect ALL (depends on T023–T027)
- [ ] T036 [P] [P1] Implement `errors.ts` in `packages/pilot/src/model/errors.ts` — `ProjectModelError` plus diagnostic factory helpers carrying `code/message/file/app/identity/field/line/column` (depends on T028)
- [ ] T037 [P1] Implement `types.ts` in `packages/pilot/src/model/types.ts` — internal model types that consume the public contracts from `src/contracts/project-model.ts` (maps parsed YAML → typed model)
- [ ] T038 [P1] Implement `loader.ts` in `packages/pilot/src/model/loader.ts` — orchestrate `loadProjectModel(rootDir)`: read `.ycsf/apps.yaml` (MUST exist; else throws IO error), optional `.ycsf/resources.yaml`, per-app `build_config.yaml`; run all validation passes; return `ProjectModelLoadResult` = `{ kind:'ok', model }` | `{ kind:'invalid', errors }`; never throws for validation failures (depends on T030–T036; backs Phase 4 integration)

---

## Phase 4: Core Contracts wiring + package entry (GREEN polish of public surface)

- [ ] T040 [P1] Export `loadProjectModel` and the model loader API from `packages/pilot/src/index.ts` (internal-use entry, not the contracts subpath); keep `src/contracts/` type-only/pure (depends on T038)
- [ ] T041 [P] [P1] Ensure the public type contracts in `src/contracts/project-model.ts` and the runtime result type `ProjectModelLoadResult` line up so `@ycforge/pilot/contracts` consumers and `@ycforge/pilot` loader agree (typecheck via `test/types/project-model.test-d.ts`); run `pnpm --filter @ycforge/pilot typecheck`

---

## Phase 5: Integration — quickstart scenarios (RED → GREEN)

**Purpose**: Run all quickstart scenarios against the real `loadProjectModel` in `packages/pilot/test/project-model/`, each mapping to the listed US/AC and FR. Write the integration test first (RED), then confirm GREEN after Phase 3+4 is in place.

- [ ] T050 [P] [P1] Integration test Sc1 (valid project): reference project (user_service, analytics, frontend, openapi; resources queues/buckets/functions) loads with `{ kind:'ok' }`; 4 apps, resources grouped by domain, builds_configs (incl. `frontend` → empty), topologicalOrder has user_service before analytics/frontend/openapi (US-1, FR-001/002/003/005) in `packages/pilot/test/project-model/quickstart.spec.ts`
- [ ] T051 [P] [P1] Integration test Sc2 (cycle): load `a→b→c→a` → `{ kind:'invalid' }`, `PML_DEPENDS_CYCLE` naming chain (US-2 AC1) in `packages/pilot/test/project-model/quickstart.spec.ts`
- [ ] T052 [P] [P1] Integration test Sc3 (self-ref): `a.depends_on:[a]` → `PML_DEPENDS_SELF` (US-2 AC2) in `packages/pilot/test/project-model/quickstart.spec.ts`
- [ ] T053 [P] [P1] Integration test Sc4 (dangling): `a.depends_on:[nonexistent]` → `PML_DEPENDS_UNKNOWN` naming 'nonexistent' (US-2 AC3) in `packages/pilot/test/project-model/quickstart.spec.ts`
- [ ] T054 [P] [P1] Integration test Sc5 (identity collision): app `legacy_authorizer` + `functions.legacy_authorizer` → `PML_IDENTITY_COLLISION` with identity set (US-3 AC1) in `packages/pilot/test/project-model/quickstart.spec.ts`
- [ ] T055 [P] [P1] Integration test Sc6 (duplicate app_id): repeated `user_service` key → `PML_DUPLICATE_KEY`, not silent last-wins (US-3 AC2; plan Q2 decision) in `packages/pilot/test/project-model/quickstart.spec.ts`
- [ ] T056 [P] [P2] Integration test Sc7 (missing ENV): `analytics/build_config.yaml` with `{{$ANALYTICS_DOCKERFILE}}` + `null` `NPM_TOKEN`, neither set → `PML_ENV_NOT_SET` for BOTH (collect-all) (US-4 AC1) in `packages/pilot/test/project-model/quickstart.spec.ts`
- [ ] T057 [P] [P2] Integration test Sc8 (ENV present): same build_config with both vars set → `{ kind:'ok' }`, `env_requirements` records both with `isSet:true`, no interpolation (US-4 AC2, FR-010; runtime out of scope spec 012) in `packages/pilot/test/project-model/quickstart.spec.ts`
- [ ] T058 [P] [P2] Integration test Sc9 (missing build_config): app `simple_app` with no `build_config.yaml` → `{ kind:'ok' }`, `build_configs.get('simple_app')` = `{ build_config:{}, build_env:{} }` (US-5 AC1, FR-003) in `packages/pilot/test/project-model/quickstart.spec.ts`
- [ ] T059 [P] [P3] Integration test Sc10 (version): `apps.yaml` missing `version` OR `version: 2` → `PML_VERSION` (US-6 AC1/AC2, FR-004/FR-014) in `packages/pilot/test/project-model/quickstart.spec.ts`
- [ ] T060 [P] [P1] Integration edge cases (**plan Q3/Q4 decisions + spec edge cases**): empty `apps.yaml` (0 apps) → OK empty model; empty `resources.yaml` → OK; `depends_on` absent everywhere → OK (all independent); `source_path` pointing to a nonexistent dir → NOT a load error (deferred spec 020); unknown `builder` value → NOT a load error (deferred spec 013) in `packages/pilot/test/project-model/quickstart.spec.ts`

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the package/pipeline surface end-to-end and confirm no regressions.

- [ ] T070 [P1] Run full RED/GREEN gate for the quickstart suite: `pnpm --filter @ycforge/pilot test` — confirm all `test/unit/*` and `test/project-model/*` scenarios pass; confirm type-only tests under `test/types/` run via vitest typecheck
- [ ] T071 [P1] Verify `src/contracts/` zero-dependency invariant still holds after T003: run `pnpm --filter @ycforge/pilot test -- --run test/unit/zero-dependency.test.ts` (contracts import graph + deps split)
- [ ] T072 [P1] Build: run `pnpm --filter @ycforge/pilot build` — confirm tsup emits dist with `index` and `contracts/index` entries including the new model + contracts (`packages/pilot/tsup.config.ts` unchanged unless needed)
- [ ] T073 [P1] Typecheck: run `pnpm --filter @ycforge/pilot typecheck` and fix any TS errors (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` strictness on model types)
- [ ] T074 [P1] Verify SC-001 perf headroom: load a 5-app / 3-resource / 10-ENV project and assert `loadProjectModel` completes well under 500ms (cheap smoke in `test/project-model/quickstart.spec.ts` or a standalone perf spec); no optimization beyond keeping the single-pass load
- [ ] T075 [P1] Final consistency pass: confirm every FR-001..FR-015 is covered by ≥1 test and every quickstart scenario (Sc1–Sc10) maps to a test in Phase 5; confirm the PREDICATES (e.g. `isEnvRef`, `isVersion`) that live in `src/contracts/` are pure (no `yaml` import); note README roadmap update is handled by the main agent at PR time (not this spec)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — starts immediately. Must complete before any test/impl runs.
- **Tests (Phase 2)**: Depends on Setup (T001 package.json, T002 contracts types for imports, T003 zero-dep fix). RED only.
- **Core (Phase 3)**: Depends on Phase 2 tests existing (GREEN turns them). Module order: parse → apps/resources/build-config/env-requirements/depends-on (parallel) → errors/types → loader.
- **Core contracts wiring (Phase 4)**: Depends on Phase 3 (loader + types) + Phase 1 (contracts exports).
- **Integration (Phase 5)**: Depends on Phase 3+4 (real loader). RED written in Phase interval, GREEN after Phase 3/4.
- **Polish (Phase 6)**: Depends on all phases complete.

### Within Each User Story / Module

- Tests (Phase 2) MUST fail before implementation (Phase 3) — RED then GREEN (Constitution II).
- parse.ts first (blocks T030) — version + duplicate-key is the base for every other file's parse path; the rest (apps/resources/build-config/env-requirements/depends-on) are independent and parallel.

### Parallel Opportunities

- All Setup tasks marked [P] (T002–T005) — different files.
- All Phase 2 test tasks marked [P] — different `.spec.ts` files, no interdependencies.
- Phase 3 implementation: T031–T036 parallel (independent modules); T037/T038 depend on all.
- Integration scenarios T050–T060 all [P] — same `quickstart.spec.ts` file, but distinct `it` blocks; can be authored in one pass.

---

## Parallel Example: Core Validation Modules

```bash
# Launch the five independent module implementations together (each after its own RED test):
Task: "Implement apps.ts (depends T013-014)"
Task: "Implement resources.ts (depends T015-018)"
Task: "Implement build-config.ts (depends T019-020)"
Task: "Implement env-requirements.ts (depends T021-022)"
Task: "Implement depends-on.ts (depends T023-027)"
```

---

## Implementation Strategy

### MVP First (Load a valid project — US-1)

1. Phase 1 Setup (T001–T005)
2. Phase 2 RED: parse/apps/resources/build-config tests (T010–T020)
3. Phase 3 GREEN: parse/apps/resources/build-config + loader (T030–T038)
4. **STOP and VALIDATE**: Sc1 (valid project) integration + typecheck + build
5. **MVP reached**: valid `.ycsf` project loads.

### Incremental Delivery

1. Valid project loads (US-1 / FR-001..003, 011, 012, 013) → MVP
2. depends_on validation (US-2 / FR-005..007) via depends-on.ts
3. identity collision + duplicate keys (US-3 / FR-008, FR-012) via resources.ts + parse.ts
4. ENV requirements (US-4 / FR-009, FR-010) via env-requirements.ts
5. missing build_config (US-5 / FR-003) via build-config.ts
6. version enforcement (US-6 / FR-004, FR-014) via parse.ts
7. Integration Sc1–Sc10 + Polish (Phases 5–6)

### Parallel Team Strategy

1. Setup together.
2. Developer A: parse.ts + version/duplicate key.
3. Developers B–F: one each on apps / resources / build-config / env-requirements / depends-on.
4. Loader assembled after modules land; then integration + polish.
5. All PRs target `dev`, branch `011-project-model`.

---

## Notes

- [P] tasks = different files, no dependencies.
- Tests written RED first; confirm failing, then GREEN.
- `yaml` dependency lives in `packages/pilot/package.json` `dependencies` and is imported ONLY in `src/model/`. `src/contracts/project-model.ts` is type-only/pure; predicates (`isEnvRef`, `isVersion`) are allowed there but must not import `yaml`.
- Fail-fast: collisions, cycles, self/dangling refs, duplicate YAML keys are errors, never silent merges.
- `loadProjectModel` returns `{ kind:'ok' } | { kind:'invalid', errors }` and throws only for I/O catastrophes (e.g. missing `.ycsf/apps.yaml`).
- Do NOT validate `builder` (spec 013) or `source_path` existence (spec 020) at load.
- Do NOT generate/gitignore `specs/README.md` update here — the main agent handles the roadmap at PR time.
