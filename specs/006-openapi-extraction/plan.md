# Implementation Plan: safe OpenAPI extraction for Project B (composer)

**Branch**: `006-openapi-extraction` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-openapi-extraction/spec.md`

## Summary

Spec 006 adds the OpenAPI extraction phase to `@ycforge/composer` (Project B): obtaining a ready OpenAPI document for one application in safe mode. Sources follow a fixed fallback chain (`openapi_entry` explicit export → `<app>/swagger.json` → `<app>/openapi.json` → `dist/main` convention → terminal error). Execution of user entry points happens in an isolated runner subprocess (variant B, clarify 2026-09-04) with `SERVERLESS_TOOLS_OPENAPI_BUILD=1` set in the runner environment; the main composer process never imports user code. The extracted document passes through unchanged — composition/merge is spec 008.

Key technical approach:
- New package `packages/composer` (`@ycforge/composer`), greenfield, zero runtime dependencies (native `node:child_process`, `node:fs`, `node:path`)
- Public contract `extractOpenApi(request): Promise<OpenApiDocument>` implementing the fallback chain
- Runner subprocess (plain `.mjs` script, shipped with the package) that dynamic-imports the entry point, calls `buildYcsfOpenApi`, serializes the JSON document over a dedicated result pipe (child fd 3) so the application's own stdout/stderr never contaminate the result; `child_process.spawn` with `{ env, cwd }`, kill-on-timeout, non-zero-exit ⇒ fail-fast error
- Artifact read + minimal OpenAPI validation (object with `openapi` + `paths`)
- Deterministic error codes per source and failure class (FR-006/007/008/011)

## Technical Context

**Language/Version**: TypeScript 5.x, ES2022 target, ESNext modules; runner script authored as ESM `.mjs` (no build step for it)

**Primary Dependencies**: zero runtime dependencies; builtins only (`node:child_process`, `node:fs`, `node:path`, `node:url`); dev: typescript, vitest

**Storage**: N/A (stateless; only reads artifact files and the declared entry module)

**Testing**: vitest + node (monorepo convention); integration tests drive a real `spawn` with fixture apps

**Target Platform**: Node.js 22+ (dev/CI build tool — mirrored from existing packages; not a Cloud Function runtime)

**Project Type**: library (npm package `@ycforge/composer`); future CLI surface is spec 010

**Performance Goals**: extraction is build-time; single subprocess spawn per entry source, default timeout 30s (configurable) before kill; no measurable cost on artifact path (pure fs read + JSON parse)

**Constraints**: zero new npm dependencies; entry points must be Node-loadable modules (JS/CJS/ESM) — TS source transpilation is a builder concern (spec 018), documented in FR-010/research R1; `SERVERLESS_TOOLS_OPENAPI_BUILD=1` always set in runner env (FR-002); main process never imports user code (FR-003, FR-011)

**Scale/Scope**: new package `packages/composer`; ~6 source files + runner script; integration test fixtures

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation of concerns | ✅ | Extraction is B's zone; B never imports user code into its main process (variant B, FR-003); no Terraform, no deployment |
| II. Spec-first, test-first | ✅ | Spec complete with ACs; tests generated from AC before implementation |
| III. Contracts versioned | ⚠️ | New public API of `@ycforge/composer` (`extractOpenApi`) — versioned via package semver; contract documented in `contracts/openapi-extraction.md`; no `.ycsf/*.yaml` |
| IV. Terraform stays Terraform | N/A | No Terraform involvement |
| V. Explicit over magic | ✅ | Explicit `openapi_entry`; fallback chain is a fixed, documented order (IDEA §10), no reflection/auto-discovery beyond it; broken artifact = fail-fast, never silent fallthrough |
| VI. Ownership | N/A | No apps/resources involvement |

**Safe-mode env (constitution addendum)**: `SERVERLESS_TOOLS_OPENAPI_BUILD=1` is always set by B (FR-002) — ✅.

**Post-design re-check**: see Phase 1.

## Project Structure

### Documentation (this feature)

```text
specs/006-openapi-extraction/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/composer/                         # NEW: @ycforge/composer (Project B)
├── package.json                           # NEW: public exports, files = [dist, runner]
├── tsconfig.json                          # NEW: ESNext modules, ES2022
├── runner/
│   └── runner.mjs                         # NEW: steady child script — imports entry, calls buildYcsfOpenApi, writes JSON doc to result fd (3), errors to stderr
├── src/
│   ├── index.ts                           # NEW: public exports (extractOpenApi, types, error codes)
│   ├── extract.ts                         # NEW: fallback chain orchestration (FR-001/004/005/006)
│   ├── extract.spec.ts                    # NEW: chain + priority + terminal error tests
│   ├── errors.ts                          # NEW: OpenApiExtractError + deterministic codes (FR-006/007/008/011)
│   ├── artifacts.ts                       # NEW: swagger.json/openapi.json read + minimal validation (FR-004/007)
│   ├── artifacts.spec.ts                  # NEW: artifact tests (valid, missing, broken, priority)
│   └── runner/
│       ├── spawn-runner.ts                # NEW: spawn + env + cwd + timeout kill + result-fd protocol (FR-002/011)
│       └── spawn-runner.spec.ts           # NEW: runner tests (ok, crash, timeout, bad JSON)
└── test/
    └── extraction.integration.spec.ts     # NEW: end-to-end against fixture apps (US1–US4)
```

**Structure Decision**: composer is a new lean library package mirroring the repo conventions of `packages/nest-bridge` (ESM, zero runtime deps, vitest). The runner is shipped as a plain `.mjs` asset (no compilation) so the child process needs no bundled loader. The acquisition logic is separated from the chain orchestration (`artifacts.ts`, `runner/`, `extract.ts`) so the fixed priority order and each source are independently testable (SC-003).

## Phase 0: Research

**Output**: [research.md](./research.md)

All NEEDS CLARIFICATION items resolved:

| # | Unknown | Resolution |
|---|---------|------------|
| R1 | Loading user entry (openapi_entry / dist/main) | Runner dynamic `import()` (works for CJS+ESM); entry must be Node-loadable JS. TS source transpilation is a builder concern (spec 018) — v1 rejects/errors with guidance; Node 22.6+ type-stripping usable opportunistically but not relied on |
| R2 | Runner spawn + result transport | `child_process.spawn(process.execPath, [runnerPath, entry, mode], { env: {...processEnv, SERVERLESS_TOOLS_OPENAPI_BUILD:'1'}, cwd: appRoot })`, `stdio: ['ignore','pipe','pipe','pipe']`; result JSON written to the dedicated result fd (3) (exactly one object), errors to stderr; timeout kill (default 30s); non-zero exit ⇒ fail-fast |
| R3 | Artifact validation | Minimal structural check: object with string `openapi` and object `paths`; broken JSON / wrong shape ⇒ fail-fast with path (FR-007) |
| R4 | Error taxonomy | `OpenApiExtractError` with `code`: NO_SOURCE, INVALID_ARTIFACT, ENTRY_LOAD_FAILED, ENTRY_EXECUTION_FAILED, ENTRY_TIMEOUT, ENTRY_RETURNED_INVALID, RUNNER_SPAWN_FAILED; terminal FR-006 message carries NO_SOURCE |
| R5 | Safe-mode env semantics | Set only in runner env before spawn (FR-002); parent process env untouched; value `"1"`; document that it is an advisory flag, primary defense is the safe entry contract (US1) |

## Phase 1: Design & Contracts

**Outputs**: [data-model.md](./data-model.md), [contracts/](./contracts/openapi-extraction.md), [quickstart.md](./quickstart.md)

Key design decisions:

- **`extractOpenApi(request, options?)`** — single entry point; `request = { appRoot, openapiEntry? }`; returns `OpenApiDocument` (type-only `{ openapi, info, paths, ... }`); throws `OpenApiExtractError` on any failure (FR-001/004/005/006)
- **Fixed source priority**: `openapiEntry` → `swagger.json` → `openapi.json` → `dist/main` → NO_SOURCE error (SC-003; edge cases in spec)
- **Artifact source** is pure read + validate (no user code execution); broken artifact = fail-fast, never fall through (FR-007)
- **Runner subprocess** (variant B): steady `.mjs` child; imports the entry, calls `buildYcsfOpenApi()`, serializes the document over the dedicated result fd (3); failures/side channels on stderr; main process parses the result fd with a size guard (FR-003/011)
- **Error codes**: deterministic per failure class, exported publicly for downstream (`ycsf-api`, spec 010) (FR-006/007/008/011)
- **Document parity**: extracted document returned as-is (deep-cloned only for transport safety, no structural changes) — FR-009
- **Backward compatible / greenfield**: new package, no changes to existing packages

**Post-design Constitution re-check**: ✅ No new violations. Variant B keeps Constitution I (B main process never imports user code); explicit-source rule (V) holds — fallback chain is a fixed documented order with fail-fast on broken artifacts; contract versioning (III) satisfied by documented `@ycforge/composer` API + semver.

## Complexity Tracking

> No constitution violations requiring justification.