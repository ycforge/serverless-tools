# Implementation Plan: project-model — `.ycsf/*.yaml` Project Model

**Branch**: `011-project-model` | **Date**: 2026-09-06 | **Spec**: specs/011-project-model/spec.md

**Input**: Feature specification from `specs/011-project-model/spec.md`

**Note**: This template is filled in by the `/skill:speckit-plan` command; its definition describes the execution workflow.

## Summary

Add to Project C (`@ycforge/pilot`, `packages/pilot`) a library-level module that loads and validates the project model from the `.ycsf/*.yaml` files (`apps.yaml`, `resources.yaml`, per-app `build_config.yaml`). It produces a typed `ProjectModel` (apps, resources, build_configs, env_requirements, DependsOnGraph) with fail-fast validation: version enforcement, identity collisions, depends_on cycles/self-references/dangling references, and `{{$ENV}}` presence checks (FR-001..015).

Runtime `{{$ENV}}` interpolation, builder registry, materializer dispatch, Terraform generation, and the `ycsf` CLI are out of scope (specs 012–021). This spec only defines the model and its validation; the growth-append points are ready for those downstream specs.

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)

**Primary Dependencies**:
- `yaml@^2` — YAML parsing (already used in `@ycforge/composer`; reuse `parseDocument` with `{ uniqueKeys: true }` for duplicate-key detection). Added to pilot's `dependencies` (NOT to `@ycforge/pilot/contracts`).
- Type-only contracts from `@ycforge/pilot/contracts` (existing plugin contracts, spec 002) — reused where applicable (Diagnostic, Diagnostics constants).

**Storage**: File system (`.ycsf/*.yaml` + `<app>/build_config.yaml`)

**Testing**: Vitest (already configured) + `vitest.config.ts` typecheck for `test/types/*.test-d.ts`. Test-first per constitution; acceptance criteria → tests (RED → GREEN).

**Target Platform**: Library module within `packages/pilot` (ESM+CJS via tsup); consumed by future CLI (spec 021) and downstream specs.

**Project Type**: Type-safe library module (runtime parser/validator + type-only public contracts)

**Performance Goals**: SC-001 — load valid project (5 apps, 3 resources, 10 ENV) < 500ms.

**Constraints**:
- `src/contracts/` must remain zero-runtime-dependency (existing `zero-dependency.test.ts`) — parser/validator with `yaml` dep MUST NOT live there.
- Fail-fast (Constitution V): collisions, cycles, dangling refs are errors, never silent merges.
- C does not validate builder-specific `build_config` internals (Constitution I; builder's job, spec 018). Only structural `version`/`build_env`/presence checks.
- Resources are always external, reference only (Constitution VI); `resources.yaml` never feeds materializers.
- `version: 1` required in all `.ycsf/*.yaml` (Constitution III).
- Sync load/validate for the library API (only fs reads; no I/O beyond that).

**Scale/Scope**: Typical project: 5–20 apps, 3–10 resources, ~10 ENV vars. Single repo root per load.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Pure Project C: model ownership lives in `packages/pilot`; no runtime/interpolation, no Terraform, no builder internals |
| II. Spec-First, Test-First | ✅ PASS | Acceptance criteria → tests before implementation; RED then GREEN |
| III. Contracts Versioned | ✅ PASS | `version: 1` enforced on all `.ycsf/*.yaml`; model contracts exported via `@ycforge/pilot/contracts` (semver) |
| IV. Terraform Stays Terraform | ✅ PASS | No Terraform generation/validation in this spec |
| V. Explicit Over Magic | ✅ PASS | Fail-fast on collisions/cycles/dangling refs; duplicate keys rejected; `{{$ENV}}` validated at load |
| VI. Ownership Model | ✅ PASS | apps = managed, resources = external; resources.yaml reference-only |
| Monorepo Tooling | ✅ PASS | Model in `packages/pilot`; `yaml` added to pilot deps (not to contracts) |
| Secrets | ✅ PASS | Credentials not modeled/required in build config; runtime handled elsewhere |
| OpenAPI Build Safe Mode | ✅ PASS | Not applicable in this spec (openapi_entry field read only as opaque builder data) |
| Zero-dep contracts | ✅ PASS | New public contracts stay type-only/pure; parsing with `yaml` stays internal to pilot |

**Gate Decision**: All gates PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/011-project-model/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (project-model.json — `.ycsf` schemas + error codes catalog)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/pilot/
├── package.json                     # UPDATE: add "dependencies": { "yaml": "^2.x" }
├── tsup.config.ts                   # UPDATE: add internal entry (index already covers src/index.ts)
└── src/
    ├── index.ts                     # UPDATE: export internal project-model API (loader/validator)
    ├── model/                       # NEW: internal runtime module (uses `yaml` dep)
    │   ├── loader.ts                #   entry: loadProjectModel(rootDir) — orchestrates reading+validation
    │   ├── parse.ts                 #   low-level: parse + version + duplicate-key checks per file
    │   ├── apps.ts                  #   apps.yaml → App records
    │   ├── resources.ts             #   resources.yaml → Resource records + collision check vs apps
    │   ├── build-config.ts          #   <app>/build_config.yaml → BuildConfig (+ env_requirements extraction)
    │   ├── env-requirements.ts      #   `{{$ENV}}` regex extraction from build_config+build_env
    │   ├── depends-on.ts            #   DependsOnGraph construction + DFS cycle/self/dangling detection
    │   ├── errors.ts                #   ProjectModelError + diagnostics collection (model layer)
    │   └── types.ts                 #   internal model types (extends/consumes public contract types)
    ├── contracts/                   # EXISTING: remains zero-runtime-dep; ADD type-only + pure additions
    │   ├── project-model.ts         #   NEW: public type contracts (App, Resource, ProjectModel, BuildConfig,
    │   │                            #        DependsOnGraph, ProjectModelLoadResult) — types only
    │   └── index.ts                 #   UPDATE: re-export project-model types
    └── ...
```

**Structure Decision**: Runtime parsing/validation lives in `src/model/` (not `src/contracts/`) because it requires the `yaml` runtime dependency; `src/contracts/` must stay dependency-free per the existing `zero-dependency.test.ts`. Public **type** contracts (what downstream specs and future CLI consume) are re-exported from `src/contracts/project-model.ts` via `@ycforge/pilot/contracts`. Predicates that are pure (e.g. `isEnvRef`, `isVersion`) may live in contracts; anything touching `yaml` stays in `src/model/`.

## Complexity Tracking

No constitution violations — all gates pass as-is.

## Phase 0: Research (Generated Artifacts)

See `specs/011-project-model/research.md`. Key decisions resolved there:
- YAML parser: reuse `yaml@^2` (composer already uses `parseDocument` + `uniqueKeys`).
- Code location: `src/model/` (contracts stay dep-free).
- DependsOn algorithm: DFS coloring (white/gray/black); **collect all errors** (constitution V, mirrors composer check aggregation).
- ENV extraction: `{{$ENV}}` regex over `build_config` + `build_env` values; presence validated at load; runtime interpolation out of scope (012).
- Duplicate keys: `uniqueKeys: true` → error.
- Missing `build_config.yaml`: empty config (FR-003).
- Sync load/validate for the library API.

## Phase 1: Design & Contracts (Generated Artifacts)

### Data Model (`data-model.md`)

Entities: `App`, `Resource`, `BuildConfig`, `EnvRequirement`, `DependsOnGraph`, `ProjectModel`, `ProjectModelError`, `ProjectModelLoadResult` — fields, relationships, validation rules, load flow.

### Contracts (`contracts/`)

- `project-model.json`: JSON Schema for `.ycsf/apps.yaml`, `.ycsf/resources.yaml`, `<app>/build_config.yaml` (`version: 1`) + catalog of `PML_*` error codes.

### Quickstart (`quickstart.md`)

Validation scenarios: valid load, cycle, self-ref, dangling, collision, missing ENV, missing version, no build_config, empty apps — runnable via `@ycforge/pilot`'s `loadProjectModel` once implemented.

## Post-Design Constitution Re-Check

All gates still PASS. No new violations introduced. In particular: model stays in Project C only (I), load is fail-fast and explicit (V), resources reference-only (VI), `version: 1` enforced (III), `src/contracts/` remains dependency-free (monorepo tooling/zero-dep).
