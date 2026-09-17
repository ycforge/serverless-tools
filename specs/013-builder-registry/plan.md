# Implementation Plan: builder-registry — explicit mapping `.ycsf/builders.yaml`, загрузка плагинов

**Branch**: `013-builder-registry` | **Date**: 2026-09-06 | **Spec**: [specs/013-builder-registry/spec.md](./spec.md)

**Input**: Feature specification from `spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add to Project C (`@ycforge/pilot`, `packages/pilot`) a registry layer that loads the explicit plugin mapping from `.ycsf/builders.yaml`, dynamically `import()`s builder/materializer plugin modules, shape-detects the exported `Builder`/`Materializer` contract (spec 002), and validates the loaded project model (spec 011) so that every `App.builder` exists in the registry. Fail-fast, explicit-only (Constitution V): no auto-discovery, no `package.json` registration — one source of truth. Provides distinct `BRG_*` load/validation diagnostics. No builder execution (021), no materializer→Terraform dispatch (014), no actual builder packages (018).

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)

**Primary Dependencies**:
- `yaml@^2` — already a dependency of `@ycforge/pilot` (spec 011). Reuse `parseDocument` with `{ uniqueKeys: true }` for duplicate-key detection (same conventions as `src/model/parse.ts`).
- Dynamic `import()` — native Node 22 (ESM+CJS interop, no `createRequire` needed for the plugin-loading surface).
- Type-only contracts from `@ycforge/pilot/contracts` (spec 002 `Builder`/`Materializer`, spec 011 `ProjectModel`/`App`/`ProjectModelError`, `Diagnostic`).

**Storage**: File system (`.ycsf/builders.yaml` — mandatory); in-memory `PluginRegistry` + loaded module handles.

**Testing**: Vitest (already configured) + `test/types/*.test-d.ts` type tests. Test-first per constitution; acceptance criteria / quickstart scenarios → tests (RED → GREEN). Hermetic plugin fixtures: temp `.mjs`/`.cjs` files created by a test helper, referenced via import specifier paths (research decision 4).

**Target Platform**: Library module within `packages/pilot` (ESM+CJS via tsup); consumed by spec 020/021 (`ycsf check`/`build`) and downstream specs (014 materializer dispatch).

**Project Type**: Type-safe library runtime module (registry loader/validator + shape detector + type-only public contracts).

**Performance Goals**: SC-001 — load registry + plugins for a typical project (3 builders + 2 materializers, all installed) < 2s (dominated by dynamic `import()` in Node 22).

**Constraints**:
- `src/contracts/` must remain zero-runtime-dependency (existing `zero-dependency.test.ts`). `builders.yaml` parsing (uses `yaml`) and dynamic `import()` live in the runtime `src/registry/`, NOT `src/contracts/`. `src/registry/` holds the plugin-loading runtime; only type-only/pure contracts are re-exported from `src/contracts/`.
- Fail-fast (Constitution V): any registry/plugin-load error → registry invalid; never warnings, never silent. Duplicate keys, builders↔materializers key collision → error before any dynamic import.
- Explicit-only: plugins loaded ONLY via `.ycsf/builders.yaml` mapping (FR-012); no auto-discovery, no `package.json` registration.
- `version: 1` required in `builders.yaml` (Constitution III).
- Partial load (FR-015): one failing plugin does not prevent loading others — collect all errors; non-empty error set ⇒ registry invalid.
- Registry loading config is a sync file pass; plugin module loading is async (dynamic `import()`); `validateBuilders` is sync given loaded registry + project model.
- Boundary (Constitution I): C does NOT know builder/materializer internal schemes (B-as-plugin returns Artifact).

**Scale/Scope**: Typical project 5–20 apps, 3–5 builders, 2–5 materializers. Single repo root per registry load.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Pure Project C orchestration registry in `packages/pilot/src/registry/`; loads plugins, does not execute builders (021), does not dispatch to Terraform (014); C never parses the B-internal OpenAPI IR (`yandex-api-gateway` = opaque Builder → Artifact) |
| II. Spec-First, Test-First | ✅ PASS | Acceptance criteria + quickstart scenarios → tests (RED → GREEN); fixture plugins make each AC testable hermetically |
| III. Contracts Versioned | ✅ PASS | `version: 1` enforced in `builders.yaml`; BRG_* catalog + plugin-entry contracts re-exported via `@ycforge/pilot/contracts` (semver); additive error codes |
| IV. Terraform Stays Terraform | ✅ PASS | No Terraform generation/validation/dispatch in this spec (014) |
| V. Explicit Over Magic | ✅ PASS | **Central here**: explicit mapping only, no auto-discovery, no `package.json` registration; fail-fast on duplicate keys, builders↔materializers collision, unknown builder, package-not-found, not-a-plugin, load error |
| VI. Ownership Model | ✅ PASS | Registry maps identifiers→packages; apps stay managed; no ownership change; `validateBuilders` only cross-references `App.builder` against registry |
| Monorepo Tooling | ✅ PASS | `src/registry/` runtime module (uses `yaml` + dynamic `import()`); `src/contracts/` stays dependency-free; type-only additions re-exported via `@ycforge/pilot/contracts` |
| Secrets | ✅ PASS | No credentials or env handling in registry; secrets unaffected |
| OpenAPI Build Safe Mode | ✅ PASS | `yandex-api-gateway` treated as opaque builder plugin returning Artifact; C sets no OpenAPI semantics here (B's job) |
| Zero-dep contracts | ✅ PASS | New public type contracts are type-only/pure; `builders.yaml` parsing (`yaml`) and plugin loading (`import()`) live in runtime `src/registry/`, never in `src/contracts/` |

**Gate Decision**: All gates PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/013-builder-registry/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (plugin-registry.json — .ycsf/builders.yaml schema + BRG_* error code catalog)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/pilot/
├── package.json                     # UNCHANGED (yaml already a dependency from spec 011; no new runtime deps)
├── tsup.config.ts                   # UNCHANGED (index + contracts entries already emitted)
└── src/
    ├── index.ts                     # UPDATE: export runtime registry API (loadRegistry, validateBuilders)
    ├── registry/                    # NEW: runtime module (uses `yaml` + dynamic import(); owns plugin loading)
    │   ├── builders-yaml.ts         #   parse+validate .ycsf/builders.yaml (parse conventions from src/model/parse.ts)
    │   ├── registry.ts              #   build PluginRegistry config from parsed builders.yaml (entries, kinds)
    │   ├── load.ts                  #   async: dynamic import() each package, shape-detect → loaded PluginEntry or PluginLoadError (partial, collect-all)
    │   ├── validate.ts              #   sync: validateBuilders(projectModel, registry) → BuilderRegistryValidationResult
    │   ├── shape.ts                 #   isBuilderShape / isMaterializerShape (default+named export resolution)
    │   ├── errors.ts                #   RegistryError + BRG_* diagnostics (reuses src/model/errors.ts `diag` shape)
    │   ├── types.ts                 #   internal registry types (extends/consumes public contract types)
    │   └── index.ts                 #   entry: loadRegistry(rootDir) → PluginRegistryLoadResult; validateBuilders
    ├── contracts/                   # EXISTING: remains zero-runtime-dep; ADD type-only + pure additions
    │   ├── registry.ts              #   NEW: public type contracts (BuildersYaml, PluginEntry, PluginRegistry, PluginKind,
    │   │                            #        PluginLoadError, BuilderRegistryValidationResult, BRG_* constants) — types only
    │   └── index.ts                 #   UPDATE: re-export registry types
    └── ...
```

**Structure Decision**: Runtime registry + plugin loading lives in `src/registry/` (NOT `src/contracts/`) because it requires the `yaml` runtime dependency for `builders.yaml` parsing and relies on dynamic `import()` for plugin loading; `src/contracts/` must stay dependency-free per `zero-dependency.test.ts`. Public **type** contracts (what spec 020/021 CLI and downstream 014 consume) are re-exported from `src/contracts/registry.ts` via `@ycforge/pilot/contracts`. Pure shape predicates may live in contracts; anything touching `yaml`/`import()` stays in `src/registry/`.

BRG_* error-code constants live in `src/contracts/registry.ts` (pure constants, like `PML_*` in `project-model.ts`), mirrored in the `contracts/plugin-registry.json` catalog.

## Complexity Tracking

No constitution violations — all gates pass as-is.

## Phase 0: Research (Generated Artifacts)

See `specs/013-builder-registry/research.md`. Key decisions resolved there:
- Dynamic `import()` (native Node 22 ESM+CJS interop), not `createRequire`; error shape classification for `ERR_MODULE_NOT_FOUND` → `BRG_PACKAGE_NOT_FOUND`, syntax/runtime → `BRG_LOAD_ERROR`, loaded-but-missing-shape → `BRG_NOT_A_PLUGIN`.
- Plugin module export contract: default export **or** named export; resolution order `ns.default` → `ns`; shape detection guards `build` (builder), `supports`+`materialize` (materializer); ambiguity (both shapes) resolved to builder priority.
- API surface: `loadRegistry` async (config load sync + dynamic import async); `validateBuilders` sync given loaded registry.
- Test fixtures: temp `.mjs`/`.cjs` files created by a test helper; registry values are import specifiers (`import()` accepts both package names and file paths) — production uses package specifiers, hermetic tests use fixture paths.
- BRG_* code granularity: BRG_PACKAGE_NOT_FOUND / BRG_NOT_A_PLUGIN / BRG_LOAD_ERROR / BRG_UNKNOWN_BUILDER (from spec) + structural BRG_VERSION / BRG_MISSING_FILE / BRG_DUPLICATE_KEY / BRG_KEY_COLLISION / BRG_INVALID (mirroring PML_* style).
- Registry immutability: frozen read-only structure after load; new `contracts/plugin-registry.json` catalog file (BRG_* are not PML_* project-model codes).
- Duplicate-key semantics: reuse `parse.ts` `uniqueKeys: true` → `BRG_DUPLICATE_KEY`.

## Phase 1: Design & Contracts (Generated Artifacts)

### Data Model (`data-model.md`)

Entities: `BuildersYaml`, `BuilderRegistryEntry`, `PluginKind`, `PluginEntry`, `PluginRegistry`, `PluginLoadError`, `PluginRegistryLoadResult`, `BuilderRegistryValidationResult`, `RegistryError`, BRG diagnostics — fields, relationships, load flow, validation rules.

### Contracts (`contracts/`)

- `plugin-registry.json`: JSON Schema for `.ycsf/builders.yaml` (`version: 1`) + catalog of `BRG_*` error codes (structural + load + validation).

### Quickstart (`quickstart.md`)

Validation scenarios Sc1..ScN: valid builders.yaml loads; unknown app builder → `BRG_UNKNOWN_BUILDER`; package-not-found → `BRG_PACKAGE_NOT_FOUND`; not-a-plugin → `BRG_NOT_A_PLUGIN`; load error → `BRG_LOAD_ERROR`; duplicate key; version missing; builders↔materializers collision; empty registry with apps; materializer referenced — runnable via `@ycforge/pilot`'s `loadRegistry`/`validateBuilders` once implemented, using the reference project (`user_service`, `analytics`, `frontend`, `openapi`).

## Post-Design Constitution Re-Check

All gates still PASS. No new violations introduced. In particular: registry stays in Project C only (I), explicit-only + fail-fast (V), `version: 1` enforced (III), BRG_* additive (III), `src/contracts/` remains dependency-free, plugin loading (`import()`) and `builders.yaml` parsing (`yaml`) live only in `src/registry/` (zero-dep), B-as-plugin remains opaque (I).

## Open Questions for /speckit.tasks

- Exact module split within `src/registry/` (builders-yaml/registry/load/validate/shape/errors/index) and whether the shape predicates are exported from `src/registry/shape.ts` or as pure fns in `src/contracts/registry.ts` — task-ified in tasks.md.
- Naming of the public entries (`loadRegistry`, `validateBuilders`) and exact exported type names — confirm in data-model/contracts before task assignment.
- Diagnostics shape for `validateBuilders`: reuse `ProjectModelDiagnostic` (it already carries `app`/`file` fields) vs. a dedicated `BuilderValidationDiagnostic` — resolved in research, confirmed in contracts.
