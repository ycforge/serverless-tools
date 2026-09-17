---
description: "Task list for ycsf-check — consolidated validation layer (YCK_* diagnostics, C1–C13 check categories, aggregation, optional terraform validate)"
---

# Tasks: ycsf-check — `@ycforge/pilot` check module (YCK_* + C1–C13)

**Input**: Design documents from `/specs/020-ycsf-check/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), data-model.md, contracts/ycsf-check.json, research.md, quickstart.md

**Tests**: Test-first per constitution (II). Каждый acceptance criterion (3 AC по US1–US6 = 18 AC плюс edge-case-инварианты), каждый FR-001..FR-024, каждый quickstart-сценарий Sc1–Sc6 и каждый SC-001..SC-008 маппится минимум на одну test-задачу (RED → GREEN). Тесты пишутся ДО реализации и подтверждаются как RED (падают по правильной причине: целевой модуль — стаб `'not implemented'` / отсутствующий тип / пустой generated model, а не по ошибке фикстуры). Constitution II exception НЕ применяется: check = чистая валидация, не thin CLI wrapper.

**Organization**: Задачи сгруппированы по фазам Setup / Foundational (типы, YCK_*, generated loader, module skeleton — блокируют все stories) / US1 (override targets C1) / US2 (ENV in patch C7) / US3 (build ENV C2–C3) / US4 (resource consistency C4) / US5 (full aggregation) / US6 (terraform validate C13) / Polish (exports, quickstart, typecheck, lint). Check module lives INSIDE `packages/pilot` — no new package.

## Format: `[ID] [P?] [USn] Description with file path`

- **[P]**: Can run in parallel (different files, no incomplete deps)
- **[US1]–[US6]**: User story labels (required in US phases)
- Include exact file paths in descriptions

## Path Conventions

- **Module source**: `packages/pilot/src/check/` — internal module in pilot (no new package)
- **Contracts**: `packages/pilot/src/contracts/check.ts` — `CheckResult`, `CheckOptions`, `YckDiagnostic`, `YCK_*` codes
- **Category modules**: `packages/pilot/src/check/categories/{override-targets,env-in-patch,resource-consistency,terraform-validate}.ts`
- **Orchestration**: `packages/pilot/src/check/check.ts` — load + all categories + aggregate
- **Loader**: `packages/pilot/src/check/generated-loader.ts` — `loadGeneratedModel(rootDir)`
- **Error codes**: `packages/pilot/src/check/errors.ts` — `YCK_*` constants + `yck()` factory
- **Tests**: `packages/pilot/test/check/*.spec.ts` — one per category + aggregation + loader
- **Fixtures**: `packages/pilot/test/check/fixtures/{canonical,missing-target,env-in-patch,unresolved-ref,terraform-fail}/`
- **Pilot barrel**: `packages/pilot/src/index.ts` — UPDATE: add `check`/`CheckResult`/`CheckOptions` exports

---

## Phase 1: Setup (Module Exports)

**Purpose**: Export `check`, `CheckResult`, `CheckOptions` from `@ycforge/pilot` barrel. No new package — check lives inside `packages/pilot`.

- [X] T001 Add `check`/`CheckResult`/`CheckOptions` export lines to `packages/pilot/src/check/index.ts` — `export { check } from './check.js'; export type { CheckResult, CheckOptions } from '../contracts/check.js';` (initial skeleton, will be wired in Phase 7). **Depends**: T020 (contracts exist).
- [X] T002 Add `check`/`CheckResult`/`CheckOptions` re-exports to `packages/pilot/src/index.ts` — `export { check } from './check/index.js'; export type { CheckResult, CheckOptions } from './contracts/check.js';`. **Depends**: T020.

---

## Phase 2: Foundational (Types, YCK_*, Loader, Module Skeleton)

**Purpose**: Contract types, error code constants, diagnostic factory, generated model loader, module skeleton with stubs. ALL user story work depends on this phase.

### Foundational types & constants (RED contract → GREEN)

- [X] T010 [P] Create `packages/pilot/src/contracts/check.ts` — `CheckResult` interface (`{ readonly diagnostics: readonly Diagnostic[] }`), `CheckOptions` interface (`{ readonly validateTf?: boolean; readonly generatedDir?: string }`), `YckDiagnostic` interface (per data-model §2.3), `Diagnostic` union type (`ProjectModelDiagnostic | ExtensionsDiagnostic | OutputsDiagnostic | MovesDiagnostic | YckDiagnostic`), import existing diagnostic types from sibling contracts. RED: file missing → imports fail.
- [X] T011 [P] Create `packages/pilot/src/check/errors.ts` — 5 `YCK_*` constants (FR/Constitution V: constants never literals): `YCK_MISSING_TARGET`, `YCK_ENV_IN_PATCH`, `YCK_REF_UNRESOLVED`, `YCK_TERRAFORM_INVALID`, `YCK_TERRAFORM_UNAVAILABLE`; `YckOptions` interface; `yck(opts: YckOptions): YckDiagnostic` factory (set only defined fields per `exactOptionalPropertyTypes`, pattern from `src/extensions/errors.ts`). RED: constants absent.
- [X] T012 [P] RED unit-test `packages/pilot/test/unit/check-errors.test.ts` — structural contract vs `specs/020-ycsf-check/contracts/ycsf-check.json` (Constitution V): exactly 5 constants; constant names byte-for-byte match `#/errorCodes` keys in JSON contract; `yck({ code, message })` returns `YckDiagnostic` with only defined fields; `yck({ code, message, target, availableIdls })` sets optional fields. RED: import fails (errors.ts stub).

### Generated model loader (RED → GREEN)

- [X] T013 Create `packages/pilot/src/check/generated-loader.ts` — `loadGeneratedModel(rootDir: string): readonly GeneratedResource[]`; `GeneratedResource` type (`{ readonly kind: 'resource'; readonly type: string; readonly name: string; readonly configuration: Record<string, unknown> }`); readdir `.ycsf/` → filter `*.ycsf.tf.json` (reuse `FILENAME_RE` pattern from `materialize/serialize.ts`) → `JSON.parse` each → extract `resource.*` blocks → flatten; empty dir → empty array; missing dir → empty array. RED: function throws/stub.
- [X] T014 RED unit-test `packages/pilot/test/check/generated-loader.spec.ts` — (a) empty `.ycsf/` dir → empty array; (b) single file with `{ resource: { yandex_function: { my_func: { runtime: 'nodejs22' } } } }` → `[{ kind:'resource', type:'yandex_function', name:'my_func', configuration:{ runtime:'nodejs22' }]`; (c) multiple files → flattened array; (d) file without `resource` key → skipped (no throw); (e) `generatedDir` option overrides default path. RED: loader stub.

### Module skeleton (RED → GREEN)

- [X] T015 Create `packages/pilot/src/check/check.ts` — orchestration stub: `async function check(rootDir: string, options?: CheckOptions): Promise<CheckResult>` that returns `{ diagnostics: [] }` (empty). Collect-all pattern skeleton (all category calls return empty arrays). Imports from `./categories/*` (stubs). RED: function body throws/stub.
- [X] T016 [P] Create `packages/pilot/src/check/categories/override-targets.ts` — stub: `checkOverrideTargets(extensions: ExtensionsYaml, generatedResources: readonly GeneratedResource[]): readonly YckDiagnostic[]` returns `[]`.
- [X] T017 [P] Create `packages/pilot/src/check/categories/env-in-patch.ts` — stub: `scanPatchForEnvRefs(extensions: ExtensionsYaml): readonly YckDiagnostic[]` returns `[]`.
- [X] T018 [P] Create `packages/pilot/src/check/categories/resource-consistency.ts` — stub: `checkResourceConsistency(resources: ResourcesYaml | undefined, generatedResources: readonly GeneratedResource[]): readonly YckDiagnostic[]` returns `[]`.
- [X] T019 [P] Create `packages/pilot/src/check/categories/terraform-validate.ts` — stub: `runTerraformValidate(rootDir: string): readonly YckDiagnostic[]` returns `[]`.

### Fixture projects

- [X] T020 Create hermetic fixture project `packages/pilot/test/check/fixtures/canonical/` — `.ycsf/apps.yaml` (2 apps: `user_service` with builder, `analytics`), `.ycsf/extensions.yaml` (1 valid rule targeting `functions.user_service`), `.ycsf/builders.yaml`, `.ycsf/resources.yaml` (1 external resource matching generated), `.ycsf/outputs.yaml`, `.ycsf/moved.yaml`; generated `.ycsf/yandex-function.user_service.ycsf.tf.json` and `.ycsf/yandex-api-gateway.main.ycsf.tf.json` (valid `resource` blocks). All checks should pass (0 diagnostics). **Depends**: T013.
- [X] T021 [P] Create fixture `packages/pilot/test/check/fixtures/missing-target/` — `.ycsf/extensions.yaml` with rule `{ target: 'functions.user_service', patch: {} }`, generated model contains only `yandex_function.analytics` (no `user_service`). **Depends**: T013.
- [X] T022 [P] Create fixture `packages/pilot/test/check/fixtures/env-in-patch/` — `.ycsf/extensions.yaml` with rule containing `{{$API_KEY}}` in patch at depth ≥2 (`{ environment: { API_KEY: '{{$API_KEY}}' } }`), valid generated model. **Depends**: T013.
- [X] T023 [P] Create fixture `packages/pilot/test/check/fixtures/unresolved-ref/` — `.ycsf/resources.yaml` with `functions.external_svc`, generated model contains only `yandex_function.user_service` (no `external_svc`). **Depends**: T013.
- [X] T024 [P] Create fixture `packages/pilot/test/check/fixtures/terraform-fail/` — valid project (all base checks pass), includes mock terraform binary or relies on mocking `spawnSync`. **Depends**: T013.

---

## Phase 3: US1 — Override Targets (C1, P1) 🎯 MVP

**Goal**: DevOps checks extension targets exist in generated model. Missing target → `YCK_MISSING_TARGET` with `availableIdls`.

**Independent Test**: Fixture: generated resources = `[yandex_function { name: 'analytics' }]`, extensions = `[{ target: 'functions.user_service', patch: {} }]`. Run check. Expect `YCK_MISSING_TARGET` with `availableIdls: ['functions.analytics']`.

### Tests for US1 (RED — write FIRST)

- [X] T030 [P] [US1] RED unit-test `packages/pilot/test/check/override-targets.spec.ts` — AC1: generated model contains `yandex_function.user_service` + `yandex_api_gateway.main`, extension rule `{ target: 'functions.user_service', patch: { runtime: 'python312' } }` → NO `YCK_MISSING_TARGET` for `functions.user_service`; AC2: generated model contains only `yandex_function.analytics`, extension rule `{ target: 'functions.user_service', patch: {} }` → `YCK_MISSING_TARGET` with `target: 'functions.user_service'` and `availableIdls: ['functions.analytics']` (sorted); AC3: 2 extension rules both valid (both targets exist) → 0 `YCK_MISSING_TARGET` diagnostics; FR-010: empty generated model → all targets missing; edge: no extensions → 0 diagnostics. RED: stub returns `[]`.
- [X] T031 [P] [US1] RED integration-test `packages/pilot/test/check/override-targets.integration.spec.ts` — using `missing-target` fixture (T021): call `check()` on fixture root → `diagnostics` contains `YCK_MISSING_TARGET` with correct `target` and `availableIdls`; using `canonical` fixture (T020): call `check()` → 0 `YCK_MISSING_TARGET`. RED: `check()` returns empty diagnostics.

### Implementation for US1 (GREEN)

- [X] T032 [US1] Implement `packages/pilot/src/check/categories/override-targets.ts` — for each extension rule: build IDL index via `createIdlIndex` (from `extensions/idl.ts`), check `rule.target` against `idlIndex.byIdl`; missing → `yck({ code: YCK_MISSING_TARGET, message: ..., target: rule.target, availableIdls: idlIndex.availableIdls })`. O(E × M) → use IDL index for O(E + M). **Depends**: T016, T011, T013.
- [X] T033 [US1] Wire `checkOverrideTargets` into `packages/pilot/src/check/check.ts` — after loading extensions and generated model, call `checkOverrideTargets(extensions, generatedResources)` and push results into diagnostics array. **Depends**: T015, T032.

---

## Phase 4: US2 — ENV in Extensions Patch (C7, P1)

**Goal**: DevOps checks extension patches don't contain `{{$ENV}}` references. Terraform expressions only — not build env variables.

**Independent Test**: Fixture: extensions = `[{ target: 'functions.user_service', patch: { environment: { API_KEY: '{{$API_KEY}}' } } }]`. Run check. Expect `YCK_ENV_IN_PATCH` with `target` and `field: 'environment.API_KEY'`.

### Tests for US2 (RED — write FIRST)

- [X] T040 [P] [US2] RED unit-test `packages/pilot/test/check/env-in-patch.spec.ts` — AC1: patch `{ environment: { API_KEY: '{{$API_KEY}}' } }` → `YCK_ENV_IN_PATCH` with `target: 'functions.user_service'` and `field: 'environment.API_KEY'`; AC2: patch `{ runtime: 'python312', memory: 128 }` → 0 `YCK_ENV_IN_PATCH`; AC3: 3 rules, 1 with `{{$ENV}}` at depth 2 (`nested.patch.$value`) → exactly 1 `YCK_ENV_IN_PATCH` with `field: 'nested.patch.value'`; FR-013: uses `ENV_REF_RE` from `model/env-requirements.ts`; edge: no extensions → 0 diagnostics. RED: stub returns `[]`.
- [X] T041 [P] [US2] RED integration-test `packages/pilot/test/check/env-in-patch.integration.spec.ts` — using `env-in-patch` fixture (T022): call `check()` → `diagnostics` contains `YCK_ENV_IN_PATCH` with correct `target` and `field`. RED: `check()` returns empty diagnostics.

### Implementation for US2 (GREEN)

- [X] T042 [US2] Implement `packages/pilot/src/check/categories/env-in-patch.ts` — recursive deep scan of each extension rule's `patch` object: for each string value, match `ENV_REF_RE` (`/\{\{\$([A-Z0-9_]+)\}\}/g` from `model/env-requirements.ts`); match → `yck({ code: YCK_ENV_IN_PATCH, message: ..., target: rule.target, field: <dot-path> })`. Walk: `scanObject(obj, path)`: if string → regex match; if object → recurse keys; else skip. O(E × P) where P = patch tree depth. **Depends**: T017, T011.
- [X] T043 [US2] Wire `scanPatchForEnvRefs` into `packages/pilot/src/check/check.ts` — after loading extensions, call `scanPatchForEnvRefs(extensions)` and push results into diagnostics array. **Depends**: T015, T042.

---

## Phase 5: US3 — Build ENV Validation (C2–C3, P1)

**Goal**: DevOps checks all `{{$ENV}}` references in build_config/build_env have corresponding `process.env` values. Reuses `checkEnvRequirements` from spec 011.

**Independent Test**: Fixture: app `user_service` with `build_env: { API_KEY: null }`, `process.env.API_KEY` NOT set. Run check. Expect `PML_ENV_NOT_SET` for `API_KEY`.

### Tests for US3 (RED — write FIRST)

- [X] T050 [P] [US3] RED unit-test `packages/pilot/test/check/build-env.spec.ts` — AC1: app `user_service` with `build_env: { API_KEY: null }`, `process.env.API_KEY` set → 0 `PML_ENV_NOT_SET` for `API_KEY`; AC2: same setup, `process.env.API_KEY` NOT set → `PML_ENV_NOT_SET` with `app: 'user_service'` and `field: 'API_KEY'`; AC3: app `analytics` with `build_config: { entry: '{{$ENTRY_POINT}}' }`, `process.env.ENTRY_POINT` NOT set → `PML_ENV_NOT_SET` for `ENTRY_POINT`; edge: no apps → 0 diagnostics. RED: stub returns `[]`.
- [X] T051 [P] [US3] RED integration-test `packages/pilot/test/check/build-env.integration.spec.ts` — fixture project with missing ENV → call `check()` → `diagnostics` contains `PML_ENV_NOT_SET`. RED: `check()` returns empty diagnostics.

### Implementation for US3 (GREEN)

- [X] T052 [US3] Wire `checkEnvRequirements` (reuse from `model/env-requirements.ts`) into `packages/pilot/src/check/check.ts` — for each app in project model: call `checkEnvRequirements(app.id, app.buildConfig, file)` → collect `PML_ENV_NOT_SET` errors into diagnostics. FR-021. **Depends**: T015, T050.
- [X] T053 [US3] Add `loadProjectModel` call to `packages/pilot/src/check/check.ts` — first step of orchestration: load project model (provides apps, build_config, build_env for ENV checks and resources for consistency checks). FR-002 (model load). **Depends**: T015.

---

## Phase 6: US4 — Resource Consistency (C4, P2)

**Goal**: DevOps checks resources.yaml references have matching generated Terraform resources. Mismatch → `YCK_REF_UNRESOLVED`.

**Independent Test**: Fixture: resources = `{ functions: { external_svc: {} } }`, generated = `[yandex_function { name: 'user_service' }]` (no `external_svc`). Run check. Expect `YCK_REF_UNRESOLVED`.

### Tests for US4 (RED — write FIRST)

- [X] T060 [P] [US4] RED unit-test `packages/pilot/test/check/resource-consistency.spec.ts` — AC1: `resources.yaml` = `{ functions: { external_svc: {} } }`, generated = `[yandex_function { name: 'external_svc' }]` → 0 `YCK_REF_UNRESOLVED`; AC2: `resources.yaml` = `{ functions: { external_svc: {} } }`, generated = `[yandex_function { name: 'user_service' }]` (no `external_svc`) → `YCK_REF_UNRESOLVED` with `resourceRef: 'functions.external_svc'` and `file: '.ycsf/resources.yaml'`; AC3: empty `resources.yaml` (no entries) → 0 diagnostics; edge: resources.yaml undefined → 0 diagnostics (skip). FR-016. RED: stub returns `[]`.
- [X] T061 [P] [US4] RED integration-test `packages/pilot/test/check/resource-consistency.integration.spec.ts` — using `unresolved-ref` fixture (T023): call `check()` → `diagnostics` contains `YCK_REF_UNRESOLVED` with correct `resourceRef` and `file`. RED: `check()` returns empty diagnostics.

### Implementation for US4 (GREEN)

- [X] T062 [US4] Implement `packages/pilot/src/check/categories/resource-consistency.ts` — reverse `IDL_DOMAIN_BY_TF_TYPE` mapping (from `extensions/idl.ts`); for each entry in `resources.yaml`: domain → tfType, resource_id → name; check `generatedResources.some(r => r.type === tfType && r.name === resourceId)`; missing → `yck({ code: YCK_REF_UNRESOLVED, message: ..., resourceRef: `${domain}.${resourceId}`, file: '.ycsf/resources.yaml' })`. FR-014/015. **Depends**: T018, T011.
- [X] T063 [US4] Wire `checkResourceConsistency` into `packages/pilot/src/check/check.ts` — call with project model resources and generated model; push results into diagnostics. **Depends**: T015, T062.

---

## Phase 7: US5 — Full Aggregation (P1)

**Goal**: DevOps runs unified `ycsf check` and gets all diagnostics from all categories in one pass. Collect-all pattern. Exit code semantics.

**Independent Test**: Fixture: project with extension error + model error. Run check. Expect exit code 1 + 2 diagnostics (EXT_* + PML_*).

### Tests for US5 (RED — write FIRST)

- [X] T070 [P] [US5] RED unit-test `packages/pilot/test/check/aggregation.spec.ts` — AC1: project without errors (canonical fixture T020) → `diagnostics.length === 0`; AC2: project with `EXT_UNRESOLVED_TARGET` + `PML_ENV_NOT_SET` → `diagnostics` contains both (mixed families); AC3: project with extension target missing → `diagnostics` contains BOTH `YCK_MISSING_TARGET` (check-specific) AND `EXT_UNRESOLVED_TARGET` (reuse from 015, D-10 duplicate diagnostics); SC-005: mixed-diagnostics fixture returns diagnostics from PML_*, EXT_*, YCK_* families; SC-001: canonical project → 0 diagnostics. RED: `check()` returns empty array.
- [X] T071 [P] [US5] RED integration-test `packages/pilot/test/check/aggregation.integration.spec.ts` — full check on `canonical` fixture (T020) → `diagnostics.length === 0`; full check on `missing-target` fixture (T021) → `diagnostics` contains `YCK_MISSING_TARGET` + `EXT_UNRESOLVED_TARGET`. RED: `check()` returns empty.

### Implementation for US5 (GREEN)

- [X] T072 [US5] Implement full `packages/pilot/src/check/check.ts` orchestration — collect-all pattern (D-4): load project model → load generated model → C2-3: `checkEnvRequirements` per app → C11: `validateBuilders` (reuse, FR-022) → C5-8: load extensions (optional, try/catch missing file) → `applyExtensions` (reuse, FR-020) + `checkOverrideTargets` (C1, T032) + `scanPatchForEnvRefs` (C7, T042) → C4: `checkResourceConsistency` (T062) → C9: load outputs (optional) + `buildOutputs` (reuse, FR-023) → C10: load moves + `validateMoves` (reuse, FR-024) → aggregate all → C13: if `validateTf` + 0 base errors → terraform validate (Phase 8). FR-001–FR-007. Async function. **Depends**: T015, T052, T053, T033, T043, T063.
- [X] T073 [US5] Wire reuse calls into `packages/pilot/src/check/check.ts` — add `validateBuilders` (FR-022), `applyExtensions` (FR-020), `buildOutputs` (FR-023), `validateMoves` (FR-024) calls. Each result's `.errors` flattened into `CheckResult.diagnostics`. Missing files (extensions/outputs) → skip category (no error). FR-003 (collect-all). **Depends**: T072.

---

## Phase 8: US6 — Optional Terraform Validate (C13, P3)

**Goal**: DevOps optionally runs `terraform validate` as final check step. Only when base checks pass (fail-fast, FR-018).

**Independent Test**: Fixture: project with no errors + mock `terraform validate` fail. Run check with `--validate-tf`. Expect `YCK_TERRAFORM_INVALID`.

### Tests for US6 (RED — write FIRST)

- [X] T080 [P] [US6] RED unit-test `packages/pilot/test/check/terraform-validate.spec.ts` — AC1: project without errors + `terraform validate` succeeds → 0 diagnostics, exit code 0; AC2: project WITH base errors + `validateTf: true` → terraform validate NOT called (fail-fast, FR-018), only base diagnostics present; AC3: project without errors + `terraform validate` returns error → `YCK_TERRAFORM_INVALID` with `message` containing terraform output; edge: `terraform` binary not found (ENOENT) + `validateTf: true` → `YCK_TERRAFORM_UNAVAILABLE` + base checks still complete. SC-006/007. RED: `runTerraformValidate` stub.
- [X] T081 [P] [US6] RED integration-test `packages/pilot/test/check/terraform-validate.integration.spec.ts` — using `terraform-fail` fixture (T024) + mocked `spawnSync` → `check(rootDir, { validateTf: true })` → `diagnostics` contains `YCK_TERRAFORM_INVALID`. RED: `check()` returns empty.

### Implementation for US6 (GREEN)

- [X] T082 [US6] Implement `packages/pilot/src/check/categories/terraform-validate.ts` — `runTerraformValidate(rootDir: string): readonly YckDiagnostic[]`; `spawnSync('terraform', ['validate', '-no-color'], { cwd: join(rootDir, 'infra'), encoding: 'utf8', timeout: 30_000 })`; non-zero exit → `yck({ code: YCK_TERRAFORM_INVALID, message: stderr })`; ENOENT → `yck({ code: YCK_TERRAFORM_UNAVAILABLE, message: '...' })`. FR-017/019. **Depends**: T019, T011.
- [X] T083 [US6] Wire `terraform validate` into `packages/pilot/src/check/check.ts` — after all base checks aggregated: if `options?.validateTf === true` AND `diagnostics.length === 0` → call `runTerraformValidate(rootDir)` and push results (FR-017/018 fail-fast). If base errors present → skip terraform step. **Depends**: T072, T082.

---

## Phase 9: Polish & Cross-Cutting

**Purpose**: Final wiring, quickstart scenario verification, typecheck, lint, structural consistency.

- [X] T090 [P] Verify quickstart Sc1 (override targets) — `pnpm --filter @ycforge/pilot test -- --run test/check/override-targets.spec.ts` — all AC US1 pass (target exists/missing, availableIdls sorted, multiple rules). **Depends**: T032, T033.
- [X] T091 [P] Verify quickstart Sc2 (ENV in patch) — `pnpm --filter @ycforge/pilot test -- --run test/check/env-in-patch.spec.ts` — all AC US2 pass (nested scan, field path, no false positives). **Depends**: T042, T043.
- [X] T092 [P] Verify quickstart Sc3 (build ENV) — `pnpm --filter @ycforge/pilot test -- --run test/check/build-env.spec.ts` — all AC US3 pass (PML_ENV_NOT_SET reuse). **Depends**: T052.
- [X] T093 [P] Verify quickstart Sc4 (resource consistency) — `pnpm --filter @ycforge/pilot test -- --run test/check/resource-consistency.spec.ts` — all AC US4 pass (YCK_REF_UNRESOLVED, empty resources). **Depends**: T062, T063.
- [X] T094 [P] Verify quickstart Sc5 (full aggregation) — `pnpm --filter @ycforge/pilot test -- --run test/check/aggregation.spec.ts` — all AC US5 pass (collect-all, mixed families, canonical clean). **Depends**: T072, T073.
- [X] T095 [P] Verify quickstart Sc6 (terraform validate) — `pnpm --filter @ycforge/pilot test -- --run test/check/terraform-validate.spec.ts` — all AC US6 pass (pass/fail/unavailable/fail-fast). **Depends**: T082, T083.
- [X] T096 Structural consistency audit: (a) `packages/pilot/test/unit/check-errors.test.ts` GREEN — YCK_* constants byte-for-byte == keys `specs/020-ycsf-check/contracts/ycsf-check.json` `#/errorCodes` == `data-model.md` §3.1 == `errors.ts` constants; (b) `contracts/check.ts` types match `contracts/ycsf-check.json` schemas; (c) no string-literal YCK comparisons in `src/check/**` (only constant imports from `errors.ts`). **Depends**: T012, T090–T095.
- [X] T097 SC-007 traceability: verify every AC (US1-AC1..3 through US6-AC1..3 = 18 AC + edge-case invariants) maps to ≥1 RED test task; confirm all RED → GREEN runs pass; document in traceability table. **Depends**: T090–T096.
- [X] T098 Typecheck + lint clean: `pnpm --filter @ycforge/pilot typecheck` → zero errors (including `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess` on `CheckOptions`/`YckDiagnostic`); `pnpm --filter @ycforge/pilot lint` → zero errors (if lint script exists); `pnpm --filter @ycforge/pilot build` → dist contains check module. **Depends**: T096, T097.
- [X] T099 Full check suite + zero-regression: `pnpm --filter @ycforge/pilot test` — ALL existing pilot tests (011–019) still green + ALL new `test/check/*.spec.ts` green. **Depends**: T098.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No deps — can start immediately (after Phase 2 types exist).
- **Foundational (Phase 2)**: T010/T011/T012 [P] (types/constants/audit) → T013 (loader) → T015 (check.ts skeleton) + T016–T019 [P] (category stubs) → T020–T024 [P] (fixtures). T001/T002 depend on T020.
- **US1 (Phase 3)**: Depends on Phase 2 complete. T030/T031 [P] (RED tests) → T032 (implement) → T033 (wire into check.ts).
- **US2 (Phase 4)**: Depends on Phase 2 complete. T040/T041 [P] (RED tests) → T042 (implement) → T043 (wire).
- **US3 (Phase 5)**: Depends on Phase 2 complete. T050/T051 [P] (RED tests) → T052/T053 (wire reuse calls + project model load).
- **US4 (Phase 6)**: Depends on Phase 2 complete. T060/T061 [P] (RED tests) → T062 (implement) → T063 (wire).
- **US5 (Phase 7)**: Depends on Phase 3–6 (all categories wired). T070/T071 [P] (RED tests) → T072/T073 (full orchestration).
- **US6 (Phase 8)**: Depends on Phase 7 (orchestration + fail-fast). T080/T081 [P] (RED tests) → T082 (implement) → T083 (wire).
- **Polish (Phase 9)**: Depends on all US phases. T090–T095 [P] (quickstart verification) → T096 (audit) → T097 (traceability) → T098 (typecheck/lint) → T099 (full suite).

### User Story Dependencies

```
Phase 2 (Foundational) ──────────────────────────┐
                                                   ├──► Phase 3 (US1) ─┐
                                                   ├──► Phase 4 (US2) ─┤
                                                   ├──► Phase 5 (US3) ─┤──► Phase 7 (US5) ──► Phase 8 (US6) ──► Phase 9
                                                   └──► Phase 6 (US4) ─┘
```

- **US1, US2, US3, US4**: Independent after Phase 2 — can proceed in parallel (different files, no cross-dependencies).
- **US5**: Aggregation — depends on all categories wired (Phases 3–6).
- **US6**: Optional terraform — depends on orchestration (Phase 7).
- **Polish**: Depends on all US phases.

### Parallel Opportunities

- **Phase 2**: T010/T011/T012 [P] (types/constants/audit); T016–T019 [P] (category stubs); T021–T024 [P] (fixtures).
- **Phases 3–6**: After Phase 2, four US chains run in parallel: US1 (T030/T031 → T032 → T033), US2 (T040/T041 → T042 → T043), US3 (T050/T051 → T052/T053), US4 (T060/T061 → T062 → T063).
- **Phase 9**: T090–T095 [P] (quickstart per-scenario) can run in parallel.

### Parallel Example: Phases 3–6

```bash
# After Phase 2 (types/constants/loader/skeleton):
Task: "US1: override-targets tests T030/T031 → impl T032 → wire T033"
Task: "US2: env-in-patch tests T040/T041 → impl T042 → wire T043"
Task: "US3: build-env tests T050/T051 → wire T052/T053"
Task: "US4: resource-consistency tests T060/T061 → impl T062 → wire T063"
# Then Phase 7-8:
Task: "US5: aggregation tests T070/T071 → orchestration T072/T073"
Task: "US6: terraform-validate tests T080/T081 → impl T082 → wire T083"
```

---

## Implementation Strategy

### MVP First (US1 only — override targets)

1. Complete Phase 1: Setup (exports).
2. Complete Phase 2: Foundational (types, YCK_*, loader, skeleton, fixtures).
3. Complete Phase 3: US1 — override targets (C1): RED T030/T031 → GREEN T032 → wire T033.
4. **STOP and VALIDATE**: `pnpm --filter @ycforge/pilot test -- --run test/check/override-targets.spec.ts` green.
5. MVP: `check()` detects missing extension targets with `YCK_MISSING_TARGET` + `availableIdls`.

### Incremental Delivery

1. Setup + Foundational → module skeleton buildable + types/constants.
2. US1 (C1: override targets) → Test independently → MVP!
3. US2 (C7: ENV in patch) → Test independently → extensions fully checked.
4. US3 (C2–C3: build ENV) → Test independently → ENV validation complete.
5. US4 (C4: resource consistency) → Test independently → resources checked.
6. US5 (aggregation) → Full `ycsf check` working.
7. US6 (C13: terraform validate) → Optional enhancement.
8. Polish → exports, quickstart, typecheck, lint.

### Parallel Team Strategy

With multiple developers:
1. Together: Phase 1 (Setup) + Phase 2 (Foundational).
2. Once Foundational done:
   - Developer A: US1 + US2 (extensions-related checks)
   - Developer B: US3 + US4 (model/resource checks)
3. After A & B: US5 (aggregation) → US6 (terraform) → Polish.
