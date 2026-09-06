---
description: "Task list for builder-registry — explicit mapping `.ycsf/builders.yaml`, загрузка плагинов builder/materializer"
---

# Tasks: builder-registry — explicit mapping `.ycsf/builders.yaml`, загрузка плагинов

**Input**: Design documents from `/specs/013-builder-registry/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/plugin-registry.json, quickstart.md

**Tests**: Test-first per constitution (II). Every acceptance criterion, every FR, and every quickstart scenario Sc1–Sc14 maps to at least one test task (RED → GREEN). Tests are written and confirmed failing BEFORE their implementation task. 011/012 must stay zero-regression through every step.

**Organization**: Tasks are grouped into Setup / Tests / Core / Integration / Polish phases so each module is implemented test-first and the whole quickstart suite is validated at the end.

## Format: `[ID] [P?] [P1/P2/P3] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[P1]/[P2]/[P3]**: Priority of the user story this task serves (from spec.md). `/speckit.plan` open questions are resolved inline as decided behavior + dedicated test cases.
- Include exact file paths in descriptions.

## Design decisions locked in from plan/research (open questions resolved)

- **Module split (plan Q1)**: `src/registry/` = `builders-yaml.ts`, `registry.ts`, `load.ts`, `validate.ts`, `shape.ts`, `errors.ts`, `types.ts`, `index.ts` (per plan project structure).
- **Shared parse helper (plan Q2)**: `parseBuildersYaml(text, file)` in `src/registry/builders-yaml.ts` reuses the `yaml` library's `parseDocument(text, { uniqueKeys: true })` from `src/model/parse.ts` conventions — NOT importing `parse.ts` directly (different YAML schema), but applying the same `uniqueKeys: true` pattern. Returns `ParseBuildersYamlResult` (data-model.md).
- **Public entry (plan Q2)**: confirm `loadRegistry(rootDir: string): Promise<PluginRegistryLoadResult>` (async) and `validateBuilders(projectModel: ProjectModel, registry: PluginRegistry): BuilderRegistryValidationResult` (sync) in `src/registry/index.ts`, exported from `src/index.ts`. Types in `src/contracts/registry.ts` per data-model.md / `contracts/plugin-registry.json`.
- **Cross-spec contract (additive, Constitution III)**: BRG_* constants in `src/contracts/registry.ts` (like PML_* in `project-model.ts`). No existing codes modified. No `.ycsf` `version` bump.
- **Partial load (FR-015)**: always attempt all entries; collect errors; non-empty errors ⇒ `{ kind: 'invalid' }`. One failing plugin does not prevent loading others (research 3).

## Path Conventions

- **Monorepo package**: `packages/pilot/src/` for source, `packages/pilot/test/` for tests
- **Runtime registry module** (uses `yaml` + dynamic `import()`): `packages/pilot/src/registry/`
- **Public type contracts**: `packages/pilot/src/contracts/registry.ts` re-exported from `src/contracts/index.ts` (`@ycforge/pilot/contracts`)
- **Unit tests**: `packages/pilot/test/unit/`
- **Integration / quickstart scenarios**: `packages/pilot/test/registry/quickstart.spec.ts`
- **Type tests**: `packages/pilot/test/types/registry.test-d.ts` (`.test-d.ts`, picked up by vitest typecheck)
- **Fixture plugins**: `packages/pilot/test/fixtures/plugins/` (`.mjs` + `.cjs` files; created by helper, referenced as import specifiers in hermetic tests)

⚠️ **No new runtime deps (confirmed)**: `yaml@^2` is already a dependency (spec 011); dynamic `import()` is a Node builtin. `src/registry/` imports `yaml` (for `parseBuildersYaml`) and uses `import()` (for plugin loading); `src/contracts/` remains zero-runtime-dep. `packages/pilot/package.json` stays unchanged.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Package wiring check, zero-regression on 011/012, fixture helper, and `src/registry/` scaffold so all subsequent test/impl tasks have concrete files.

- [ ] T001 Verify no new package wiring is needed for 013: confirm `packages/pilot/package.json` stays UNCHANGED (no new runtime deps — `yaml` already present, `import()` is Node builtin), and `packages/pilot/tsup.config.ts` still emits `index` + `contracts/index` entries (no config change expected). Run `pnpm --filter @ycforge/pilot test` to confirm the 011/012 baseline is green BEFORE any changes.
- [ ] T002 [P] Create the test fixture helper `packages/pilot/test/helpers/registry-fixtures.ts`: exports `writeFixtureModule(dir, name, content)` — writes an `.mjs` file at the given path containing the given source text; `createFixtureBuilder(name, exportStyle)` — produces a builder fixture (exportStyle = `'default'` | `'named'`); `createFixtureMaterializer(name, exportStyle)` — same for materializer; `createFixtureBoth()` — module exporting both shapes; `createFixtureNotAPlugin()` — module exporting `{ foo: () => {} }`; `createFixtureLoadError()` — module with top-level `throw new Error('boom')`. All return absolute file paths suitable for `import()` (research decision 4). Does NOT touch real `node_modules` or `builders.yaml`.
- [ ] T003 [P] Scaffold `packages/pilot/src/registry/` with empty module stubs `builders-yaml.ts`, `registry.ts`, `load.ts`, `validate.ts`, `shape.ts`, `errors.ts`, `types.ts`, `index.ts` (function/class signatures per data-model.md) so subsequent test/impl tasks have concrete files; do NOT yet implement logic. No imports from composer.

---

## Phase 2: Tests — unit (RED)

**Purpose**: Write failing unit tests for each `src/registry/` module and the runtime entry, mapping every acceptance criterion / FR and every runtime edge to a concrete case. All RED here; GREEN comes in Phase 3.

### builders-yaml.ts — YAML structural parse + validation (US-1, US-2, P1/P2)

- [ ] T010 [P] [P1] Unit test `parseBuildersYaml`: valid `builders.yaml` (`version: 1`, `builders: { nestjs-function: "pkg-a" }`, `materializers: { yandex-function: "pkg-b" }`) → `{ kind: 'ok', data: { version: 1, builders: { 'nestjs-function': 'pkg-a' }, materializers: { 'yandex-function': 'pkg-b' } } }` — FR-001, US-1 AC1 in `packages/pilot/test/unit/builders-yaml.spec.ts`
- [ ] T011 [P] [P1] Unit test `parseBuildersYaml`: `version` missing → `{ kind: 'invalid' }`, error `BRG_VERSION`, message "missing version" — FR-002, US-1 AC2 in `packages/pilot/test/unit/builders-yaml.spec.ts`
- [ ] T012 [P] [P1] Unit test `parseBuildersYaml`: `version: 2` → `{ kind: 'invalid' }`, error `BRG_VERSION`, message "unsupported version '2' (supported: 1)" — FR-002, US-1 AC3 in `packages/pilot/test/unit/builders-yaml.spec.ts`
- [ ] T013 [P] [P1] Unit test `parseBuildersYaml`: builders↔materializers key collision (`builders: { my-plugin: "pkg-a" }`, `materializers: { my-plugin: "pkg-b" }`) → `{ kind: 'invalid' }`, error `BRG_KEY_COLLISION`, message "duplicate key 'my-plugin' in builders and materializers" — FR-003, US-2 AC1 in `packages/pilot/test/unit/builders-yaml.spec.ts`
- [ ] T014 [P] [P1] Unit test `parseBuildersYaml`: duplicate builder key (`builders: { a: "pkg-1", a: "pkg-2" }`) → `{ kind: 'invalid' }`, error `BRG_DUPLICATE_KEY` (YAML `uniqueKeys: true`), message "duplicate key 'a'" — FR-003, US-2 AC2 in `packages/pilot/test/unit/builders-yaml.spec.ts`
- [ ] T015 [P] [P2] Unit test `parseBuildersYaml`: non-string value in builders (`builders: { x: 123 }`) → `{ kind: 'invalid' }`, error `BRG_INVALID` — FR-004, edge case in `packages/pilot/test/unit/builders-yaml.spec.ts`
- [ ] T016 [P] [P2] Unit test `parseBuildersYaml`: empty string key (`builders: { "": "pkg" }`) → `{ kind: 'invalid' }`, error `BRG_INVALID` — FR-004, edge case in `packages/pilot/test/unit/builders-yaml.spec.ts`
- [ ] T017 [P] [P2] Unit test `parseBuildersYaml`: empty `builders.yaml` (`version: 1` only, no `builders`/`materializers`) → `{ kind: 'ok', data: { version: 1, builders: {}, materializers: {} } }` — US-6 AC1, FR-005 empty registry in `packages/pilot/test/unit/builders-yaml.spec.ts`
- [ ] T018 [P] [P2] Unit test `parseBuildersYaml`: YAML syntax error → `{ kind: 'invalid' }`, error `BRG_INVALID`, carries `line` + `column` — FR-015, edge case in `packages/pilot/test/unit/builders-yaml.spec.ts`
- [ ] T019 [P] [P1] Unit test `parseBuildersYaml`: valid with only `builders` key present (no `materializers`), valid with only `materializers` key present (no `builders`) — both → `{ kind: 'ok' }` — edge case, FR-004 in `packages/pilot/test/unit/builders-yaml.spec.ts`

### shape.ts — Builder/Materializer shape detection (FR-007, FR-008, US-4, P1)

- [ ] T020 [P] [P1] Unit test `shape.ts`: `isBuilderShape(obj)` returns `true` when `obj.build` is a `function` (default export with `build`), `false` otherwise — FR-007, US-4 in `packages/pilot/test/unit/shape.spec.ts`
- [ ] T021 [P] [P1] Unit test `shape.ts`: `isMaterializerShape(obj)` returns `true` when both `obj.supports` and `obj.materialize` are `function`s (default export with both), `false` otherwise — FR-008, US-4 in `packages/pilot/test/unit/shape.spec.ts`
- [ ] T022 [P] [P1] Unit test `shape.ts`: `detectPluginKind(ns)` resolves default export (`ns.default`) first, falls back to named (`ns` itself); builder-shape module → `'builder'`, materializer-shape module → `'materializer'`, both shapes → `'builder'` (builder-priority, research 2), neither shape → `null` (→ `BRG_NOT_A_PLUGIN` in caller) — FR-007/008, US-4 AC2, research 2 in `packages/pilot/test/unit/shape.spec.ts`

### load.ts — Dynamic import + plugin loading (US-3, US-4, FR-009..FR-011, FR-015, P1)

- [ ] T023 [P] [P1] Unit test `loadPlugins`: valid builder fixture (default export, `build` function) → loaded `PluginEntry` with `kind: 'builder'`, correct `id` and `packageName` (as file path), non-null `module` — FR-007, US-3 AC2 in `packages/pilot/test/unit/load-plugins.spec.ts`
- [ ] T024 [P] [P1] Unit test `loadPlugins`: valid builder fixture (named export path — `export const build = ...`) → loaded `PluginEntry` with `kind: 'builder'` — FR-007, US-3 AC2 in `packages/pilot/test/unit/load-plugins.spec.ts`
- [ ] T025 [P] [P1] Unit test `loadPlugins`: valid materializer fixture (default export, `supports`+`materialize`) → loaded `PluginEntry` with `kind: 'materializer'` — FR-008 in `packages/pilot/test/unit/load-plugins.spec.ts`
- [ ] T026 [P] [P1] Unit test `loadPlugins`: not-a-plugin fixture (`{ foo: () => {} }`) → `PluginLoadError` with `code: 'BRG_NOT_A_PLUGIN'` — FR-010, US-4 AC1 in `packages/pilot/test/unit/load-plugins.spec.ts`
- [ ] T027 [P] [P1] Unit test `loadPlugins`: nonexistent package (`@nonexistent/fake-builder`) → `PluginLoadError` with `code: 'BRG_PACKAGE_NOT_FOUND'` — FR-009, US-3 AC1 in `packages/pilot/test/unit/load-plugins.spec.ts`
- [ ] T028 [P] [P1] Unit test `loadPlugins`: load-error fixture (top-level `throw`) → `PluginLoadError` with `code: 'BRG_LOAD_ERROR'` — FR-011, US-4 / quickstart Sc7 in `packages/pilot/test/unit/load-plugins.spec.ts`
- [ ] T029 [P] [P1] Unit test `loadPlugins`: both-shape fixture (exports `build` AND `supports`+`materialize`) → loaded `PluginEntry` with `kind: 'builder'` (builder-priority; not an error, research 2) — US-4 AC2, quickstart Sc8 in `packages/pilot/test/unit/load-plugins.spec.ts`
- [ ] T030 [P] [P1] Unit test `loadPlugins`: partial load — 3 entries: one valid fixture, one nonexistent package, one load-error module → returns BOTH errors (`BRG_PACKAGE_NOT_FOUND` + `BRG_LOAD_ERROR`) collected together, valid entry still present in results; non-empty errors ⇒ overall invalid — FR-015 in `packages/pilot/test/unit/load-plugins.spec.ts`

### validate.ts — Project model validation (US-5, FR-013, P1)

- [ ] T031 [P] [P1] Unit test `validateBuilders`: app `analytics` with `builder: 'nest-function'` (not in registry which has `['nestjs-function', 'docker']`) → `{ kind: 'invalid' }`, error `BRG_UNKNOWN_BUILDER`, carries `app: 'analytics'`, `field: 'builder'`, message includes "available builders: nestjs-function, docker" — FR-013, US-5 AC1 in `packages/pilot/test/unit/validate-builders.spec.ts`
- [ ] T032 [P] [P1] Unit test `validateBuilders`: app `frontend` with `builder: 'nestjs-function'` (in registry) → `{ kind: 'ok' }` — FR-013, US-5 AC2 in `packages/pilot/test/unit/validate-builders.spec.ts`
- [ ] T033 [P] [P1] Unit test `validateBuilders`: 2 apps `a` (builder: `unknown`) and `b` (builder: `unknown2`), registry has only `docker` → `{ kind: 'invalid' }` with TWO `BRG_UNKNOWN_BUILDER` diagnostics (collect-all) — FR-013, US-5 AC3 in `packages/pilot/test/unit/validate-builders.spec.ts`
- [ ] T034 [P] [P2] Unit test `validateBuilders`: empty registry (0 records) + 1 app → `{ kind: 'invalid' }`, `BRG_UNKNOWN_BUILDER` with available builders list empty — US-6 AC2 in `packages/pilot/test/unit/validate-builders.spec.ts`
- [ ] T035 [P] [P2] Unit test `validateBuilders`: empty registry + 0 apps → `{ kind: 'ok' }` — edge case in `packages/pilot/test/unit/validate-builders.spec.ts`

### index.ts — loadRegistry runtime entry (all USs, P1)

- [ ] T036 [P] [P1] Unit test `loadRegistry` (integration of config parse + plugin load): valid `builders.yaml` with 2 builders + 1 materializer, all fixture modules resolvable → `{ kind: 'ok' }`, `registry.records.size === 3`, entries have correct `kind` — FR-001/007/008 in `packages/pilot/test/unit/load-registry.spec.ts`
- [ ] T037 [P] [P1] Unit test `loadRegistry`: `.ycsf/builders.yaml` absent → **throws** `Error` with code `BRG_MISSING_FILE` (I/O convention matching spec 011 `loadProjectModel` throws on missing `apps.yaml`; NOT a `{ kind: 'invalid' }` result) — FR-005, edge case in `packages/pilot/test/unit/load-registry.spec.ts`: `await expect(loadRegistry(tmpRoot)).rejects.toThrow(/BRG_MISSING_FILE/)`
- [ ] T038 [P] [P1] Unit test `loadRegistry`: `builders.yaml` with structural errors (duplicate key, version missing) → `{ kind: 'invalid' }` with structural `BRG_*` codes; NO dynamic import attempted (fail-fast before plugin loading, SC-004) — FR-014 in `packages/pilot/test/unit/load-registry.spec.ts`
- [ ] T039 [P] [P2] Unit test `loadRegistry`: `builders.yaml` with one valid entry and one invalid entry → `{ kind: 'invalid' }` with one `BRG_*` error; the valid entry's module was loaded (partial load, FR-015) — FR-015 in `packages/pilot/test/unit/load-registry.spec.ts`

### type-level (RED)

- [ ] T040 [P] [P1] Type-test `test/types/registry.test-d.ts`: verify the new public contracts `PluginKind`, `PluginEntry`, `PluginRegistry`, `PluginLoadError`, `PluginRegistryLoadResult`, `BuilderRegistryValidationResult`, the `BRG_*` constants (`BRG_MISSING_FILE`, `BRG_VERSION`, `BRG_DUPLICATE_KEY`, `BRG_KEY_COLLISION`, `BRG_INVALID`, `BRG_PACKAGE_NOT_FOUND`, `BRG_NOT_A_PLUGIN`, `BRG_LOAD_ERROR`, `BRG_UNKNOWN_BUILDER`), and the `loadRegistry` / `validateBuilders` signatures are importable + type-usable from `@ycforge/pilot/contracts` and `@ycforge/pilot` (mirrors `test/types/project-model.test-d.ts` and `test/types/build-env.test-d.ts` patterns; `expectTypeOf<...>()` for discriminated unions per `contracts/plugin-registry.json`) — RED until Phase 3 contracts land in `packages/pilot/test/types/registry.test-d.ts`

---

## Phase 3: Core — contracts + implementation (GREEN)

**Purpose**: Implement the contracts and `src/registry/` modules to turn the Phase 2 tests GREEN. `src/contracts/` stays dependency-free; `src/registry/` uses `yaml` and `import()`.

### Public type contracts

- [ ] T050 [P1] Create `packages/pilot/src/contracts/registry.ts` — NEW type-only + pure public contracts per data-model.md / `contracts/plugin-registry.json`: `PluginKind` (`'builder' | 'materializer'`), `PluginEntry` (`{ id, packageName, kind, module }`), `PluginRegistry` (`{ records: ReadonlyMap<string, PluginEntry> }`), `PluginLoadError` (`{ id, packageName, code, message }`), `PluginRegistryLoadResult` (discriminated union: `kind: 'ok' | 'invalid'`), `BuilderRegistryValidationResult` (discriminated union: `kind: 'ok' | 'invalid'` with `errors: readonly ProjectModelDiagnostic[]`), and the `BRG_*` string constants (`BRG_MISSING_FILE`, `BRG_VERSION`, `BRG_DUPLICATE_KEY`, `BRG_KEY_COLLISION`, `BRG_INVALID`, `BRG_PACKAGE_NOT_FOUND`, `BRG_NOT_A_PLUGIN`, `BRG_LOAD_ERROR`, `BRG_UNKNOWN_BUILDER`) — pure constants, like `PML_*` in `project-model.ts`; import type `ProjectModelDiagnostic` from `./project-model.js`
- [ ] T051 [P] [P1] Re-export the new registry contracts from `packages/pilot/src/contracts/index.ts`: add `export * from './registry.js'` (the contracts barrel, `@ycforge/pilot/contracts`; stays zero-runtime-dep — no `yaml`, no `import()`) (depends on T050)

### Runtime module implementation

- [ ] T052 [P1] Implement `packages/pilot/src/registry/builders-yaml.ts` — `parseBuildersYaml(text: string, file: string): ParseBuildersYamlResult`: reuses `parseDocument(text, { uniqueKeys: true })` pattern from `src/model/parse.ts` (but NOT importing parse.ts — different YAML schema: this file has `builders`/`materializers` maps, not `apps`); validates `version: 1` via `BRG_VERSION`; detects YAML duplicate keys → `BRG_DUPLICATE_KEY`; cross-section key collision (intersection of builders + materializers keys) → `BRG_KEY_COLLISION`; validates values (non-empty string) → `BRG_INVALID`; validates key shape (`\w+` pattern, non-empty) → `BRG_INVALID`; YAML syntax error → `BRG_INVALID` with line/column. Uses `diag()` factory from `src/model/errors.ts` for diagnostic shape. Structural pass only — no dynamic import. (depends on T010–T019)
- [ ] T053 [P] [P1] Implement `packages/pilot/src/registry/errors.ts` — `RegistryDiagnostic` type alias (mirrors `ProjectModelDiagnostic` shape from `src/contracts/project-model.ts`); re-export `diag()` factory from `src/model/errors.ts` or create a thin wrapper that uses it — registry structural + load diagnostics reuse the same shape as project-model diagnostics (research 8) (depends on T010)
- [ ] T054 [P] [P1] Implement `packages/pilot/src/registry/shape.ts` — `detectPluginKind(ns: Record<string, unknown>): 'builder' | 'materializer' | null`: checks `ns.default` (if non-null object) first, falls back to `ns` itself; `isBuilderShape`: `typeof obj?.build === 'function'`; `isMaterializerShape`: `typeof obj?.supports === 'function' && typeof obj?.materialize === 'function'`; both present → returns `'builder'` (builder-priority, research 2); neither → `null`. Pure functions, no I/O. (depends on T020–T022)
- [ ] T055 [P] [P1] Implement `packages/pilot/src/registry/load.ts` — `loadPlugins(entries: ReadonlyMap<string, { id: string, packageName: string, kind: 'builder' | 'materializer' }>): Promise<{ entries: Map<string, PluginEntry>, errors: PluginLoadError[] }>`: for each entry, `await import(packageName)` then classify via `detectPluginKind()`; on rejection: check `error.code === 'ERR_MODULE_NOT_FOUND'` → `BRG_PACKAGE_NOT_FOUND`; else → `BRG_LOAD_ERROR`; on success but null kind → `BRG_NOT_A_PLUGIN`. Partial load: collect all errors, never abort early; returns both loaded entries and errors (FR-015). (depends on T023–T030, T054)
- [ ] T056 [P1] Implement `packages/pilot/src/registry/validate.ts` — `validateBuilders(projectModel: ProjectModel, registry: PluginRegistry): BuilderRegistryValidationResult`: sync; iterates `projectModel.apps`, checks `App.builder ∈ registry.records.keys()`; unknown → `BRG_UNKNOWN_BUILDER` diagnostic (with `app: appId`, `field: 'builder'`, message listing available builders); collect-all (US-5 AC3); returns `{ kind: 'ok' }` or `{ kind: 'invalid', errors }`. (depends on T031–T035)
- [ ] T057 [P1] Implement `packages/pilot/src/registry/index.ts` — `loadRegistry(rootDir: string): Promise<PluginRegistryLoadResult>`: 1) construct path internally as `path.join(rootDir, '.ycsf', 'builders.yaml')` (rootDir-only contract, like `loadProjectModel`); 2) read the file via `fs.readFileSync`/`existsSync` — if absent, **throw** `Error` with `BRG_MISSING_FILE` (I/O failure = throw, per user decision; consistently with spec 011); 3) call `parseBuildersYaml()` (sync); if structural error → `{ kind: 'invalid', errors }` (fail-fast, SC-004, no dynamic import); 4) convert `BuildersYaml` data to `entries` map (id + packageName + kind from section: `builders` → `kind: 'builder'`, `materializers` → `kind: 'materializer'`); 5) call `loadPlugins(entries)` (async); 6) if any load errors → `{ kind: 'invalid', errors: [...structural, ...loadErrors] }`; else → `{ kind: 'ok', registry: { records: frozenMap } }`. Re-export `validateBuilders` from this module. (depends on T052, T055, T056)
- [ ] T058 [P1] Export the runtime entries from `packages/pilot/src/index.ts`: `export { loadRegistry, validateBuilders } from './registry/index.js'` (plus type re-exports of `PluginRegistryLoadResult`, `BuilderRegistryValidationResult`) alongside `loadProjectModel` and `prepareBuildEnv` (internal-use entry; `@ycforge/pilot/contracts` types stay separate) (depends on T057, T050–T051)

---

## Phase 4: Integration — quickstart scenarios (RED → GREEN)

**Purpose**: Run all quickstart scenarios against the real `loadRegistry` + `validateBuilders` in `packages/pilot/test/registry/quickstart.spec.ts`. Write the integration test first (RED), then GREEN after Phase 3. Each maps to the listed US/AC + FR + scenario.

### Fixture setup (all scenarios share one helper)

- [ ] T060 [P1] Create `packages/pilot/test/registry/fixtures/` directory with all fixture `.mjs` files: `builder-default.mjs` (`export default { build: async () => ... }`), `builder-named.mjs` (`export const build = async () => ...`), `materializer-default.mjs` (`export default { supports: () => true, materialize: async () => ... }`), `both-shapes.mjs` (both build + supports/materialize), `not-a-plugin.mjs` (`export default { foo: () => {} }`), `load-error.mjs` (top-level `throw`). These are committed test fixtures (static `.mjs` files in the repo, not generated by a helper), used as import specifiers in `builders.yaml` — same path in every test run (research decision 4, variant: committed fixtures instead of tmpdir for simplicity and reviewability)

### Quickstart scenario integration tests (RED)

- [ ] T061 [P1] Integration test Sc1 (valid builders.yaml loads): create temp project with `builders.yaml` referencing 3 fixture builder plugins + 1 fixture materializer plugin (via `file://` or relative path); call `loadRegistry(tmpRoot)` → `{ kind: 'ok' }`, `registry.records` has 4 entries with correct `kind` — US-1, FR-001/007/008, quickstart Sc1 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T062 [P1] Integration test Sc2 (missing version rejected): temp `builders.yaml` WITHOUT `version` → `loadRegistry` → `{ kind: 'invalid' }`, `BRG_VERSION`, no dynamic import attempted — US-1 AC2, quickstart Sc2 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T063 [P1] Integration test Sc3 (builders↔materializers key collision): temp `builders.yaml` with `builders: { my-plugin: "pkg-a" }` and `materializers: { my-plugin: "pkg-b" }` → `{ kind: 'invalid' }`, `BRG_KEY_COLLISION`, detected BEFORE any dynamic import (SC-004) — US-2, FR-003, quickstart Sc3 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T064 [P1] Integration test Sc4 (duplicate builder key): temp `builders.yaml` with `builders: { a: "pkg-1", a: "pkg-2" }` → `{ kind: 'invalid' }`, `BRG_DUPLICATE_KEY` — US-2 AC2, quickstart Sc4 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T065 [P1] Integration test Sc5 (package not found): temp `builders.yaml` with `builders: { nestjs: "@nonexistent/fake-builder" }` → `{ kind: 'invalid' }`, `BRG_PACKAGE_NOT_FOUND` — US-3, FR-009, quickstart Sc5 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T066 [P1] Integration test Sc6 (not a plugin): temp `builders.yaml` with entry pointing to `not-a-plugin.mjs` fixture → `{ kind: 'invalid' }`, `BRG_NOT_A_PLUGIN` — US-4, FR-010, quickstart Sc6 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T067 [P1] Integration test Sc7 (module load error): temp `builders.yaml` with entry pointing to `load-error.mjs` fixture → `{ kind: 'invalid' }`, `BRG_LOAD_ERROR` — FR-011, quickstart Sc7 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T068 [P1] Integration test Sc8 (both-shape module resolved as builder): temp `builders.yaml` with entry pointing to `both-shapes.mjs` fixture → `{ kind: 'ok' }`, entry `kind: 'builder'` (builder-priority, not an error) — US-4 AC2, quickstart Sc8 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T069 [P1] Integration test Sc9 (partial load collects all plugin errors): temp `builders.yaml` with 3 entries: one valid fixture + one nonexistent package + one load-error fixture → `{ kind: 'invalid' }`, errors contain BOTH `BRG_PACKAGE_NOT_FOUND` and `BRG_LOAD_ERROR`; non-empty errors ⇒ invalid (fail-fast, not warning) — FR-015, quickstart Sc9 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T070 [P1] Integration test Sc10 (validateBuilders — unknown builder): load a valid registry (2 builders), then load a project model (spec 011) with app `analytics` having `builder: 'nest-function'` (not in registry) → `validateBuilders` → `{ kind: 'invalid' }`, `BRG_UNKNOWN_BUILDER`, `app: 'analytics'`, `field: 'builder'`, message includes "available builders: nestjs-function, docker" — US-5, FR-013, quickstart Sc10 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T071 [P1] Integration test Sc11 (validateBuilders — known builder passes): load a valid registry containing `nestjs-function`; load a project model with app `frontend` having `builder: 'nestjs-function'` → `validateBuilders` → `{ kind: 'ok' }` — US-5 AC2, quickstart Sc11 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T072 [P1] Integration test Sc12 (validateBuilders — collect-all unknowns): load a valid registry with 1 builder; load a project model with 2 apps, both using unknown builders → `validateBuilders` → `{ kind: 'invalid' }` with 2 `BRG_UNKNOWN_BUILDER` diagnostics — US-5 AC3, FR-013, quickstart Sc12 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T073 [P2] Integration test Sc13 (empty registry with apps): temp `builders.yaml` with `version: 1` only (no `builders`/`materializers`); load a project model with 1 app → `loadRegistry` → `{ kind: 'ok' }` (empty registry); `validateBuilders` → `{ kind: 'invalid' }`, `BRG_UNKNOWN_BUILDER` with empty available builders list. ALSO: 0 apps + empty registry → `validateBuilders` → `{ kind: 'ok' }` — US-6, quickstart Sc13 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T074 [P2] Integration test Sc14 (optional materializers, not referenced): temp `builders.yaml` with only `materializers: { yandex-function: "materializer-fixture.mjs" }`, no `builders` → `loadRegistry` → `{ kind: 'ok' }`, `registry.records.size === 1`, entry has `kind: 'materializer'` — US-1, FR-005, quickstart Sc14 in `packages/pilot/test/registry/quickstart.spec.ts`
- [ ] T075 [P1] Integration edge — yandex-api-gateway (B-as-plugin conceptual, Sc14-boundary): temp `builders.yaml` with `builders: { yandex-api-gateway: "@ycforge/ycsf-api" }` (package NOT installed) → `loadRegistry` → `{ kind: 'invalid' }`, `BRG_PACKAGE_NOT_FOUND`; confirms the load diagnostics work for this conceptual builder — NOT a silent skip, NOT a special case; registry treats it like any other package (US-7 / boundary constraint, conceptual documentation in `packages/pilot/test/registry/quickstart.spec.ts`)

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Verify the package/pipeline surface end-to-end, confirm zero regression on 011/012, and ensure all FR/AC coverage is accounted for.

- [ ] T080 [P1] Full suite green incl. 011/012 zero-regression: `pnpm --filter @ycforge/pilot test` — confirm all `test/unit/*`, `test/registry/*`, `test/build-env/*` and `test/project-model/*` scenarios pass (011/012 unchanged) and type-only `test/types/*.test-d.ts` (incl. new `registry.test-d.ts`) run via vitest typecheck
- [ ] T081 [P1] `src/contracts/` zero-dependency invariant intact: run `pnpm --filter @ycforge/pilot test -- --run test/unit/zero-dependency.test.ts` — contract import graph only relative modules; `src/contracts/registry.ts` contains NO `yaml` import and no dynamic `import()` — pure type-only/pure constants (verified: `src/contracts/index.ts` re-exports only `./registry.js` which must be pure)
- [ ] T082 [P1] Typecheck: `pnpm --filter @ycforge/pilot typecheck` — fix any TS errors (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` strictness on the new discriminated unions / `ReadonlyMap` / `PluginRegistryLoadResult`)
- [ ] T083 [P1] tsup build: `pnpm --filter @ycforge/pilot build` — confirm dist emits `index` + `contracts/index` entries including the new registry runtime + contracts (`packages/pilot/tsup.config.ts` unchanged)
- [ ] T084 [P1] Verify `BRG_*` constants are consistent: present as string constants in `src/contracts/registry.ts` AND mirrored in `specs/013-builder-registry/contracts/plugin-registry.json` `#/errorCodes` (Constitution III/V) — all 9 codes: `BRG_MISSING_FILE`, `BRG_VERSION`, `BRG_DUPLICATE_KEY`, `BRG_KEY_COLLISION`, `BRG_INVALID`, `BRG_PACKAGE_NOT_FOUND`, `BRG_NOT_A_PLUGIN`, `BRG_LOAD_ERROR`, `BRG_UNKNOWN_BUILDER`
- [ ] T085 [P2] Perf smoke (SC-001, optional-but-nice): in `packages/pilot/test/registry/quickstart.spec.ts`, load a registry with 3 builders + 2 materializers (all fixture modules on local disk) and assert `loadRegistry` completes well under 2s (dynamic import of local `.mjs` files is fast; no optimization beyond the single-pass design + parallel `import()` start)
- [ ] T086 [P1] Final consistency pass: confirm every FR-001..FR-015 maps to ≥1 test and every quickstart Sc1–Sc15 (Sc1–Sc14 + Sc14-boundary) maps to a Phase-4 scenario; confirm the 011 `App.builder` field is the source of truth for `validateBuilders` input; note `specs/README.md` update and `.specify/feature.json` are BOTH handled by the main agent at PR time (NOT this spec — no task here)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — starts immediately. T001 confirms the 011/012 baseline; T002 creates the fixture helper (used by Phase 2 and Phase 4); T003 scaffolds `src/registry/`.
- **Tests (Phase 2)**: Depends on Setup (T001 baseline, T002/T003 for fixtures and stubs). RED only. T010–T019 (builders-yaml), T020–T022 (shape), T023–T030 (load), T031–T035 (validate), T036–T039 (loadRegistry entry), T040 (type-test) — all independent of each other except their internal dependency chains.
- **Core (Phase 3)**: Depends on Phase 2 tests existing (GREEN turns them). Order: T050–T051 (contracts) first (blocks runtime module imports), then T052/T053/T054/T055/T056 in parallel-ish (independent modules after contracts), then T057 (registry entry wiring them), then T058 (index export).
- **Integration (Phase 4)**: Depends on Phase 3 (real `loadRegistry`/`validateBuilders`). T060 (fixtures) lands first; T061–T075 all [P] — same `quickstart.spec.ts` file, distinct `it` blocks; can be authored in one pass.
- **Polish (Phase 5)**: Depends on all phases complete.

### Within Each User Story / Module

- Tests (Phase 2 / Phase 4 integration) MUST fail before implementation (Phase 3) — RED then GREEN (Constitution II).
- The 011/012 baseline (T001) is validated by the full test suite staying green through every step — it must NOT change observable 011/012 behavior.

### Parallel Opportunities

- All Setup tasks marked [P] (T002, T003) — independent; T002 is the fixture helper, T003 scaffolds `src/registry/`.
- All Phase 2 test tasks marked [P] — different `.spec.ts` files, no interdependencies.
- Phase 3 implementation: T050/T051 sequential (contracts first); T052/T053/T054/T055/T056 parallel (independent modules after contracts land); T057 depends on those; T058 depends on T057.
- Integration scenarios T061–T075 all [P] — same `quickstart.spec.ts` file, distinct `it` blocks.

---

## Parallel Example: Phase 3 core modules

```bash
# After contracts (T050–T051) land, launch the five runtime modules together:
Task: "Implement builders-yaml.ts (T052, depends T010-T019)"
Task: "Implement shape.ts (T054, depends T020-T022)"
Task: "Implement load.ts (T055, depends T023-T030, T054)"
Task: "Implement validate.ts (T056, depends T031-T035)"
Task: "Implement errors.ts (T053, depends T010)"
# then the entry + export:
Task: "Implement loadRegistry entry (T057) + src/index.ts export (T058)"
```

---

## Implementation Strategy

### MVP First (US-1 + US-2 core path)

1. Phase 1 Setup — T001 baseline, T002 fixtures, T003 stubs.
2. Phase 2 RED — builders-yaml tests (T010–T019), shape tests (T020–T022), type test (T040).
3. Phase 3 GREEN — contracts (T050–T051) → builders-yaml.ts (T052) + shape.ts (T054) → `loadRegistry` with structural-only pass (T057).
4. **STOP and VALIDATE**: T010–T019 + T020–T022 pass (structural parse + shape detection).
5. **MVP reached**: `builders.yaml` parse + structural validation works; no plugin loading yet.

### Incremental Delivery

1. Fixture infrastructure + 011/012 zero-regression (T001–T003) → foundation
2. Public type contracts + BRG_* constants (T050–T051)
3. `builders.yaml` structural parse (T052) → shape detection (T054) → error/diagnostic factory (T053)
4. Plugin loading (T055) + registry entry (T057) + `validateBuilders` (T056) + export (T058)
5. Integration Sc1–Sc14 + B-as-plugin boundary (T060–T075) + Polish (T080–T086)

### Parallel Team Strategy

1. Setup together (T001–T003).
2. Developer A: contracts (T050–T051) + `validateBuilders` (T056) + entry/export (T057–T058).
3. Developer B: `builders-yaml.ts` (T052) + its RED tests (T010–T019).
4. Developer C: `shape.ts` (T054) + `load.ts` (T055) + their RED tests (T020–T030).
5. Integration + polish after all land. All PRs target `dev`, branch `013-builder-registry`.

---

## Notes

- [P] tasks = different files, no dependencies.
- Tests written RED first; confirm failing, then GREEN (Constitution II).
- `src/registry/` uses `yaml` (for `parseBuildersYaml`) and `import()` (for plugin loading) — this is expected and documented; `src/contracts/` stays zero-runtime-dep (T081 verification).
- `loadRegistry` is async (dynamic `import()`); `validateBuilders` is sync (no I/O, just map lookups) — per research decision 3.
- `PluginRegistry.records` is a frozen `ReadonlyMap` (research decision 6); the `module` field is typed as `unknown` in the public contract (specific Builder/Materializer typing is the consumer's responsibility, not registry's).
- BRG_* constants are string constants (like `PML_*`), compared via constants never string literals (Constitution V); they live in BOTH `src/contracts/registry.ts` and `specs/013-builder-registry/contracts/plugin-registry.json` `#/errorCodes` (T084).
- Do NOT update `.specify/feature.json` or `specs/README.md` here — the main agent handles both at PR time.
- Do NOT commit. All checkboxes start `- [ ]` until implementation marks them done.

---

# Ambiguity Surface (surfaced during task decomposition; resolved before implementation)

**RESOLVED (user decisions, clarify 013):**

1. **`builders.yaml` absent → **THROW** `Error` with code `BRG_MISSING_FILE`** (decision: keep spec-011 I/O convention — catastrophic I/O = throw, validation errors = result). `loadRegistry(rootDir)` throws on missing file (T037 asserts `rejects.toThrow(/BRG_MISSING_FILE/)`; T057 implements the throw). Structural/load errors inside the file still return `{ kind: 'invalid', errors }`.
3. **`loadRegistry` takes `rootDir` only** and constructs `path.join(rootDir, '.ycsf', 'builders.yaml')` internally (decision: rootDir-only contract, symmetric with `loadProjectModel(rootDir)`; T057 updated accordingly).

**RESOLVED (lead defaults, no user ask needed):**

4. **Error message wording** — canonical wording per quickstart.md (e.g. `package '@nonexistent/fake-builder' not found (BRG_PACKAGE_NOT_FOUND)`; `app 'analytics' uses unknown builder 'nest-function'; available builders: nestjs-function, docker`); messages must contain the code substring for testability.
5. **`detectPluginKind`/`isBuilderShape`/`isMaterializerShape` stay in `src/registry/shape.ts`** (runtime, per plan's project structure); `src/contracts/registry.ts` exports only types + `BRG_*` constants + `PluginKind` literal type (zero-runtime-dep). T081 zero-dep check applies to `src/contracts/registry.ts` only.

**NO ambiguity (verified against code):**

3. `validateBuilders` input `ProjectModel`/`ProjectModelDiagnostic` import path is `src/contracts/project-model.ts` (confirmed; no change needed).

2. **`builders.yaml` location: is it always at `<rootDir>/.ycsf/builders.yaml`?**  The plan and data-model say "from root", but no explicit path constant is defined. Does `loadRegistry` accept `rootDir` as a parameter and construct the path internally, or does it accept the path directly? The task (T057) assumes `loadRegistry(rootDir)` and constructs `path.join(rootDir, '.ycsf', 'builders.yaml')` internally. If `loadRegistry` takes a full path instead, adjust accordingly.

3. **`validateBuilders` input: `ProjectModel` type from 011 — is the exact import path `src/contracts/project-model.ts`?** The data-model references `ProjectModel` and `ProjectModelDiagnostic` from spec 011 contracts. Confirmed: `ProjectModel` is in `src/contracts/project-model.ts` (T056 imports it). No ambiguity here after reading the contracts.

4. **`loadPlugins` error message format: exact wording for `BRG_PACKAGE_NOT_FOUND`?** See RESOLVED #4 above — canonical wording per quickstart examples; messages contain the code substring.

5. **`detectPluginKind` vs `isBuilderShape`/`isMaterializerShape` export boundary**: see RESOLVED #5 above — predicates stay in `src/registry/shape.ts`; `src/contracts/registry.ts` zero-dep.

---

# Guard Checklist

Before starting implementation, confirm:

1. **011/012 baseline is green** (`pnpm --filter @ycforge/pilot test` passes all 161+ tests, 0 failures).
2. **`packages/pilot/package.json` is UNCHANGED** — no new runtime deps; `yaml@^2` already present.
3. **`packages/pilot/tsup.config.ts` is UNCHANGED** — emits `index` + `contracts/index` (two entry points; no config change).
4. **`test/helpers/registry-fixtures.ts` is created** — provides `createFixtureBuilder`, `createFixtureMaterializer`, `createFixtureBoth`, `createFixtureNotAPlugin`, `createFixtureLoadError` returning absolute paths (T002).
5. **`test/registry/fixtures/` has all static `.mjs` files** — committed, reviewable, referenced by import path (T060).
6. **`test/fixtures/` directories are `.gitignore`d** if generated (or NOT — if static fixtures are committed, they are NOT gitignored; verify the intent).
7. **Vitest config picks up `test/unit/*.spec.ts`, `test/registry/*.spec.ts`, and `test/types/*.test-d.ts`** — verify the vitest config in `packages/pilot` includes the new test paths.
8. **`process.cwd()` independence** — all tests use `createTempProject()` (or create their own temp dir via `mkdtempSync`) and resolve paths from `tmpRoot`; never rely on CWD.
9. **`tmpdir()` cleanup** — every temp dir created by `createTempProject()` is cleaned up in `afterEach` / `afterAll` (`removeTempProject()`).
10. **`import()` specifier format** — fixture `.mjs` paths are absolute (or relative to a known root) and passed as strings to `import()`; no URL encoding needed on POSIX; verify on macOS that `file://` prefix is NOT used (Node's `import()` accepts bare paths on POSIX).
