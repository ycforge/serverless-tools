# Implementation Plan: ycsf-cli — CLI layer Project C

**Branch**: `021-ycsf-cli` | **Date**: 2026-09-10 | **Spec**: [specs/021-ycsf-cli/spec.md](./spec.md)

**Input**: Feature specification from `./spec.md`

## Summary

CLI layer Project C (`ycsf`): thin wrapper dispatching library functions buildApps/dispatch/check + terraform spawn for 6 commands (build/materialize/check/plan/apply/destroy). Commander-based (mirror ycsf-api), unified exit codes 0/1/2/130, `--json` structured output, `--project-dir`/`--no-color` global flags. Pipeline commands (plan/apply) share build+materialize steps via `src/cli/pipeline.ts`. Destroy uses interactive readline prompt with non-TTY guard.

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` — tsconfig pilot).

**Primary Dependencies**: `commander` v12 (CLI framework, added as runtime dependency). Internal `@ycforge/pilot` library functions. `node:child_process` (spawn for terraform), `node:readline` (destroy prompt). No other external dependencies.

**Storage**: File system — read-only for project model (`.ycsf/*.yaml`), write during materialize to `<root>/infra/*.ycsf.tf.json` (+ `99-ycsf-outputs.tf.json`). terraform manages its own state.

**Testing**: Vitest (unit + integration tests). Test-first per Constitution II: каждый AC US1–US8 → ≥1 тест, RED → GREEN. `typecheck`/`lint` чисто.

**Target Platform**: Node 22+ ESM module in `packages/pilot/src/cli/`. Bundled by tsup with `#!/usr/bin/env node` banner. Binary: `dist/cli/index.js`.

**Project Type**: CLI layer in `packages/pilot` (`@ycforge/pilot`). CLI entry point: `src/cli/index.ts`, bundled by tsup. `package.json` bin: `{ "ycsf": "dist/cli/index.js" }`.

**Performance Goals**: SC-011 — CLI startup overhead (arg parsing + project model load) < 50ms. Pipeline commands are I/O-bound (builders, terraform).

**Constraints**: CLI is thin wrapper (Constitution I). No build/materialize logic in CLI. Fail-fast pipeline (D-4). Terraform stays real Terraform (Constitution IV). Generated code in `packages/pilot/src/cli/` and `packages/pilot/src/build/`.

**Scale/Scope**: ~500 LOC CLI + ~200 LOC buildApps orchestrator + ~100 LOC pipeline shared + ~300 LOC tests. 6 commands, 8 error codes, 12 acceptance scenarios.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | CLI owns arg parsing + I/O + exit codes. CLI dispatches library functions (buildApps, dispatch, check). CLI does NOT contain build/materialize/check logic. `buildApps` is orchestration within C (acceptable — it composes existing pure library functions). Terraform invoked via spawn, state managed by Terraform. |
| II. Spec-First, Test-First | ✅ PASS | Каждый AC US1–US8 → ≥1 тест (fixture-based). RED → GREEN. Characterization tests for terraform spawn (Constitution II exception: thin orchestration layer). |
| III. Contracts Versioned | ✅ PASS | `CLI_*` codes — new additive error family in `src/cli/errors.ts`. `CLIResult`, `CLIDiagnostic` — new types. `contracts/ycsf-cli.json` with `version: 1`. Library diagnostic codes (PML_*, EXT_*, etc.) pass through unchanged. |
| IV. Terraform Stays Terraform | ✅ PASS | terraform invoked via `child_process.spawn`, pass-through stdio. CLI does not model provider schema, does not manage state. `-no-color` flag only. No custom DSL. |
| V. Explicit Over Magic | ✅ PASS | `CLI_*` codes as constants (Constitution V). Fail-fast pipeline. Explicit flag parsing via commander. No auto-discovery. `getBuilder` shape guard identical to `getMaterializer`. |
| VI. Ownership Model | ✅ PASS | CLI dispatches C-owned functions. apps = managed (buildApps iterates them), resources = external (reference only in project model). |
| Monorepo Tooling | ✅ PASS | New modules in `packages/pilot/src/cli/` and `packages/pilot/src/build/` — within pilot package. `commander` added as dependency (same pattern as composer). tsup config extended for CLI entry point. |
| Secrets | ✅ PASS | CLI does not read/write secrets. ENV validation checks presence, not values. Terraform handles secrets via provider. |

**Gate Decision**: All gates PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/021-ycsf-cli/
├── plan.md              # This file
├── research.md          # Phase 0 output (decisions D-RE-1..15)
├── data-model.md        # Phase 1 output (CLIResult, CLIDiagnostic, pipeline model)
├── quickstart.md        # Phase 1 output (validation scenarios Sc1..Sc12)
├── contracts/           # Phase 1 output
│   └── ycsf-cli.json    # CLI_* codes, exit codes, command schemas, --json schema
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/pilot/src/
├── cli/                              # NEW — CLI layer (spec 021)
│   ├── index.ts                      # entry point: program, global flags, error handler, parseAsync
│   ├── errors.ts                     # CLIError hierarchy + CLI_* constants
│   ├── build.ts                      # ycsf build command action
│   ├── materialize.ts                # ycsf materialize command action
│   ├── check.ts                      # ycsf check command action
│   ├── plan.ts                       # ycsf plan command action
│   ├── apply.ts                      # ycsf apply command action
│   ├── destroy.ts                    # ycsf destroy command action
│   ├── pipeline.ts                   # shared: runBuildAndMaterialize, runTerraform*
│   ├── terraform.ts                  # spawnTerraform, findTerraform, SIGINT handler
│   └── prompt.ts                     # readline confirmation (destroy)
├── build/                            # NEW — build orchestration (spec 021)
│   └── index.ts                      # buildApps(rootDir, options?) → BuildAppsResult
├── registry/
│   └── shape.ts                      # UPDATE: add getBuilder() (symmetric to getMaterializer)
├── index.ts                          # UPDATE: add export { buildApps } from './build/index.js'
packages/pilot/
├── package.json                      # UPDATE: add "commander" dependency, "bin" field
├── tsup.config.ts                    # UPDATE: add CLI entry point with shebang banner
├── vitest.config.ts                  # UPDATE: add test/cli/ to include
└── test/
    ├── cli/
    │   ├── unit/
    │   │   ├── errors.test.ts        # CLIError hierarchy, code→exitCode mapping
    │   │   ├── pipeline.test.ts      # pipeline step sequencing (mocked)
    │   │   └── terraform.test.ts     # spawnTerraform, ENOENT detection
    │   └── integration/
    │       ├── build.integration.spec.ts    # Sc1, Sc2
    │       ├── materialize.integration.spec.ts
    │       ├── check.integration.spec.ts    # Sc3, Sc4, Sc5
    │       ├── plan.integration.spec.ts     # Sc6, Sc7
    │       ├── apply.integration.spec.ts
    │       ├── destroy.integration.spec.ts  # Sc8, Sc9
    │       └── help.integration.spec.ts     # Sc10, Sc11, Sc12
    └── check/
        └── fixtures/
            └── canonical/            # EXISTING — reused by CLI integration tests
```

**Structure Decision**: CLI layer в `packages/pilot/src/cli/` (зеркало `packages/composer/src/cli/`). `buildApps` orchestrator в `src/build/` — отдельный модуль (не в CLI, не в materialize). Каждая команда — отдельный файл `src/cli/{command}.ts` (зеркало composer pattern). Pipeline shared functions в `src/cli/pipeline.ts` (plan/apply/destroy разделяют build+materialize+terraform steps). Тесты в `test/cli/unit/` и `test/cli/integration/` с fixture reuse из `test/check/fixtures/canonical/`.

## Complexity Tracking

No constitution violations introduced — all gates pass. CLI is a thin wrapper dispatching to existing library functions. `buildApps` is new orchestration within C (acceptable: composes pure library functions, no I/O side effects beyond the individual functions it calls). No new packages, no new dependency cycles, no magic.
