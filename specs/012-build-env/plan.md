# Implementation Plan: build-env — `{{$ENV}}` интерполяция, `build_env` resolution, ENV runtime validation

**Branch**: `012-build-env` | **Date**: 2026-09-06 | **Spec**: [specs/012-build-env/spec.md](./spec.md)

**Input**: Feature specification from `spec.md`

## Summary

Добавить в Project C (`@ycforge/pilot`, `packages/pilot`) библиотечный runtime-слой **build-env prepare** (spec 012), исполняемый **после** load-time validation (spec 011). Слой берёт загруженную проектную модель (`ProjectModel`, spec 011) и для каждого app:
- рекурсивно интерполирует все `{{$NAME}}` в `build_config` (строковые листья) и значениях `build_env` из **снимка** `process.env`;
- резолвит `build_env` (null → из process env, literal → как есть, interpolated → подстановка) в resolved `Record<string,string>`;
- выполняет runtime fail-fast валидацию (`PML_ENV_UNRESOLVED`): ни одного остаточного `{{$…}}` или неразрешённой пустой-строкой/null записи в переданном builder-у вводе;
- результатом является **materialized input** для builder-а (spec 002 `BuildContext`): интерполированный `build_config` + resolved `buildEnv` — без изобретения нового build-API.

Интерполируется **только** namespace `{{$NAME}}` (`[A-Z0-9_]+`); `${...}` (Terraform) и `${resources...}` (B→Materializer) не трогаются (IDEA §19). `.env`, default values, builder execution — вне scope. Слой чистый Project C: не импортирует composer, не лезет в материалizer/Terraform.

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)

**Primary Dependencies**:
- None new. Reuses existing public contract types + predicates from `@ycforge/pilot/contracts` (`BuildConfig`, `ProjectModelDiagnostic`, `ProjectModelError`, `PML_*` constants, `BuildContext/buildEnv` shape).
- Reuses spec 011 model internals: `collectStringLeaves` traversal pattern (exported/shared), `isRecord` guard, `diag()` factory, snapshot `process.env`.

**Storage**: N/A (in-memory transform of the in-memory `ProjectModel`; no file I/O beyond what spec 011 already loaded).

**Testing**: Vitest (already configured). Test-first per constitution: acceptance criteria / quickstart scenarios → tests (RED → GREEN). Type tests (`test/types/*.test-d.ts`) for the new public contracts.

**Target Platform**: Library module within `packages/pilot` (ESM+CJS via tsup); consumed by spec 021 (`ycsf build`) at build-preparation time.

**Project Type**: Type-safe library runtime module (interpolation + resolution + runtime validation) exposing type-only public contracts.

**Performance Goals**: SC-005 — per-app resolution for a typical project (5 apps, ~10 ENV) completes in < 50ms added to load.

**Constraints**:
- `src/contracts/` must remain zero-runtime-dependency (existing `zero-dependency.test.ts`). New runtime interpolation lives in `src/build-env/` (imports nothing from composer; uses no `yaml` — operates on the already-loaded model).
- Fail-fast (Constitution V): any residual `{{$…}}` or unresolved empty/null `build_env` entry → `PML_ENV_UNRESOLVED` diagnostic before builder; never partial/silent.
- C does NOT validate `build_config` internals (FR-011): interpolation is opaque text replacement over string leaves, never structure-aware builder validation.
- Runs strictly after spec 011 load-time validation (`PML_ENV_NOT_SET`); this spec adds runtime `PML_ENV_UNRESOLVED` (distinct, additive).
- Only `{{$NAME}}` namespace; `${...}`/`${resources...}` never matched (IDEA §19).
- No default values, no `.env`, no implicit env source (Constitution V).

**Scale/Scope**: Typical project 5–20 apps, ~10 ENV vars; runtime-prep invoked per app before each build invocation; results not cached between invocations, but deterministic per snapshot.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Pure Project C runtime-prep in `packages/pilot/src/build-env/`; imports nothing from composer; no Terraform/builder/materializer internals; builds **materialized input**, does not execute builders (021) |
| II. Spec-First, Test-First | ✅ PASS | Acceptance criteria + quickstart scenarios → tests (RED → GREEN) |
| III. Contracts Versioned | ✅ PASS | Additive `PML_ENV_UNRESOLVED` added to `contracts/project-model.json` errorCodes catalog + `src/contracts/project-model.ts` constants (semver-compatible; Constitution III — no `version` bump on `.ycsf` formats, additive code). New public type contracts re-exported via `@ycforge/pilot/contracts` |
| IV. Terraform Stays Terraform | ✅ PASS | `${...}` Terraform namespace untouched; no Terraform generation |
| V. Explicit Over Magic | ✅ PASS | Fail-fast `PML_ENV_UNRESOLVED`; no defaults; no `.env`; only `{{$NAME}}` namespace; no silent fallback |
| VI. Ownership Model | ✅ PASS | Per-app resolution keyed by `app_id`; resources untouched (external); no ownership change |
| Monorepo Tooling | ✅ PASS | New `src/build-env/` runtime module (no composer import); contracts stay dep-free |
| Secrets | ✅ PASS | No credentials into build config; only existing `process.env` interpolated; no new secrets stored |
| OpenAPI Build Safe Mode | ✅ PASS | build_config opaque; interpolation is text-level; no builder execution |
| Zero-dep contracts | ✅ PASS | New public contracts type-only/pure; no `yaml` import in `src/contracts/`; interpolation in `src/build-env/` (runtime) |
| Interpolation namespace boundary (IDEA §19) | ✅ PASS | This spec touches ONLY `{{$NAME}}`; `${...}` (Terraform) and `${resources...}` (B→Materializer) never matched by the `{{$NAME}}` regex — documented as a gate row (see research decision 4) |

**Gate Decision**: All gates PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/012-build-env/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (build-env.json — resolved-build-env runtime API contract)
├── checklists/          # Existing (requirements.md, specify)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/pilot/
├── package.json                     # UNCHANGED (no new runtime deps)
├── tsup.config.ts                   # UNCHANGED (index + contracts entries already emitted)
└── src/
    ├── index.ts                     # UPDATE: export runtime build-env prep API (e.g. prepareBuildEnv)
    ├── build-env/                   # NEW: runtime interpolation + resolution + validation (no composer import, no yaml dep)
    │   ├── interpolate.ts           #   `{{$NAME}}` substitution over build_config string leaves
    │   ├── resolve.ts               #   build_env resolution (null/literal/interpolated) → Record<string,string>
    │   ├── errors.ts                #   EnvUnresolvedError + PML_ENV_UNRESOLVED diagnostics (reuses src/model/errors.ts `diag`)
    │   └── index.ts                 #   entry: prepareBuildEnv(appId, buildConfig, envSnapshot?) → BuildEnvResolutionResult
    ├── contracts/                   # EXISTING: remains zero-runtime-dep; ADD type-only + pure additions
    │   ├── build-env.ts             #   NEW: public type contracts (EnvValue, BuildEnvResolutionResult, PreparedBuildEnv) + PML_ENV_UNRESOLVED constant
    │   ├── project-model.ts         #   UPDATE: add PML_ENV_UNRESOLVED to PML_* constants (matches contracts JSON)
    │   └── index.ts                 #   UPDATE: re-export build-env types
    ├── model/                       # EXISTING (spec 011) — reused (env-requirements.ts traversal)
    └── ...
```

**Structure Decision**: Put the runtime prep in a new `src/build-env/` directory (not `src/model/`): it operates on an **already-validated** model and performs *transformation* (interpolation/resolution) rather than parsing/validation of `.ycsf` files. `src/model/` owns file loading + load-time validation (spec 011); `src/build-env/` owns the post-load transform that feeds the builder. Both are Project C runtime; neither imports composer. Public **type** contracts (what downstream spec 021 consumes) are re-exported from `src/contracts/build-env.ts` via `@ycforge/pilot/contracts`; `src/contracts/` stays dependency-free.

## Complexity Tracking

No constitution violations — all gates pass as-is.

## Phase 0: Research (Generated Artifacts)

See `specs/012-build-env/research.md`. Key decisions resolved there:
- Interpolation algorithm reuses/extracts spec 011's string-leaf traversal (export a shared walk helper rather than duplicating `collectStringLeaves`).
- `process.env` read as a **snapshot** (per spec assumption), captured once at the entry of `prepareBuildEnv`; derivable/overrideable for hermetic tests.
- `build_env` resolution order: deterministic per-record in declaration order; `null` → process env (empty/unset → `PML_ENV_UNRESOLVED`), literal → as-is, interpolated → substitute.
- Residual-`{{$` detection: re-scan with the exact `{{$NAME}}` regex; `${...}`/`${resources...}` are never matched, so cross-namespace is naturally safe.
- `PML_ENV_UNRESOLVED` = runtime fail-fast distinct from load-time `PML_ENV_NOT_SET`.
- Per-app isolation: resolution keyed by `app_id`, no cross-app state.

## Phase 1: Design & Contracts (Generated Artifacts)

### Data Model (`data-model.md`)

Entities: `EnvValue` (kind null/literal/interpolated with `refs`), `BuildEnvResolutionResult` (`resolvedEnv`, `buildConfig`, `errors`; exclusivity invariant), `PreparedBuildEnv` (per-app, feeds `BuildContext`), `EnvUnresolvedError`, runtime diagnostics.

### Contracts (`contracts/`)

- `build-env.json`: JSON Schema documenting the resolved-build-env runtime API contract — input (`BuildConfig` + snapshot env), output (`resolvedEnv`, interpolated `buildConfig`), `PML_ENV_UNRESOLVED` diagnostic shape, and the `EnvValue` kind grammar. (New file; independent of `project-model.json` but compatible with its diagnostic shape.)

### Quickstart (`quickstart.md`)

Validation scenarios Sc1–Sc10 proving end-to-end runtime-prep against the real `prepareBuildEnv`, using the reference project (`user_service`, `analytics`, `frontend`, `openapi`). Expected outcomes table + how to run with repo tooling once implemented.

## Post-Design Constitution Re-Check

All gates still PASS. No new violations introduced. In particular: runtime-prep stays in Project C only (I), fail-fast `PML_ENV_UNRESOLVED` (V), only `{{$NAME}}` namespace (IDEA §19 gate), `PML_ENV_UNRESOLVED` additive (III), `src/contracts/` remains dependency-free, `src/build-env/` imports nothing from composer.

## Open Questions for /speckit.tasks

- Exact module split within `src/build-env/` (interpolate.ts / resolve.ts / errors.ts / index.ts) and whether the shared string-leaf walk helper is exported from `src/model/env-requirements.ts` or from a neutral shared location — resolved in research, task-ified in tasks.md.
- Naming of the public entry (`prepareBuildEnv`) — confirm the exact exported symbol + type names in data-model/contracts before task assignment.
