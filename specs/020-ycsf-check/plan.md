# Implementation Plan: ycsf-check — consolidated validation layer

**Branch**: `020-ycsf-check` | **Date**: 2026-09-10 | **Spec**: [specs/020-ycsf-check/spec.md](./spec.md)

**Input**: Feature specification from `./spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

`ycsf check` — lightweight consolidated validation layer (Project C), который агрегирует все проверки контрактов проекта C (C1–C13) в единой точке входа перед запуском Terraform. Переиспользует существующие валидации из specs 011–017 (build ENV, extensions, outputs, moves, builder registry, project model) и добавляет три новые проверки: override targets (C1), resource consistency (C4), `{{$ENV}}` в extensions patch (C7). Опциональный финальный шаг `terraform validate` (C13, `--validate-tf`) — вызывается только при успешных базовых проверках (fail-fast). CLI surface: `ycsf check [rootDir] --validate-tf`, exit code 0/1, diagnostics family `YCK_*`.

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` — tsconfig pilot).

**Primary Dependencies**: Внутренние модули `@ycforge/pilot` (`src/model/`, `src/extensions/`, `src/outputs/`, `src/moves/`, `src/registry/`). Внешние runtime-зависимости — **ноль** (check = pure validation + optional `child_process.spawn` для `terraform validate`). `node:fs`, `node:path`, `node:child_process` — built-in.

**Storage**: File system — read-only: `.ycsf/*.ycsf.tf.json` (generated resources), `.ycsf/apps.yaml`, `.ycsf/extensions.yaml`, `.ycsf/outputs.yaml`, `.ycsf/moved.yaml`, `.ycsf/builders.yaml`, per-app `build_config.yaml`. Один write при `--validate-tf` — нет (check = read-only).

**Testing**: Vitest (unit tests + fixture projects). Test-first per Constitution II: каждый acceptance criterion US1–US6 → ≥1 тест, RED → GREEN. `typecheck`/`lint` чисто.

**Target Platform**: Node 22+ module within `packages/pilot/src/check/`. CLI entry point интегрируется через spec 021 (`ycsf check` command).

**Project Type**: Module in `packages/pilot` (`@ycforge/pilot`). `ycsf check` — публичный API pilot (`export { check } from './check/index.js'`).

**Performance Goals**: SC-008 — < 100ms на project с 20 apps + 30 generated resources + 10 extension rules (pure validation, no network, no Terraform init).

**Constraints**: check выполняется ПОСЛЕ materialization (dispatch 014), ДО terraform (spec 021). НЕ требует `terraform init` для базовых проверок. Generated resources загружаются из файловой системы (`.ycsf/*.ycsf.tf.json`), не из pipeline state.

**Scale/Scope**: Модуль в `packages/pilot/src/check/` (~300 LOC + tests). Диагностики `YCK_*` (5 codes). Reuse 6 существующих модулей.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Check validates C's OWN contracts (apps, extensions, generated TF resources). Не моделирует provider schema (Constitution IV); `terraform validate` — optional, delegate to Terraform. C не знает Yandex API. |
| II. Spec-First, Test-First | ✅ PASS | Каждый AC US1–US6 → ≥1 тест (fixture-based, pure functions). RED → GREEN. Конституционное исключение (тонкий orchestration layer `terraform validate` spawn) — characterization test post-factum допустим. |
| III. Contracts Versioned | ✅ PASS | `YCK_*` codes — новая additive diagnostic family; существующие `PML_*`/`EXT_*`/`OUT_*`/`MOV_*`/`MTL_*`/`BRG_*` не меняются. `CheckResult` — новый тип в `contracts/check.ts` (additive). `contracts/ycsf-check.json` с `version: 1`. |
| IV. Terraform Stays Terraform | ✅ PASS | `terraform validate` — optional final step; check не моделирует provider schema. Base checks (C1–C12) — pure contract validation, без terraform state/provider cache/module sources. |
| V. Explicit Over Magic | ✅ PASS | `YCK_*` codes — constants, не string literals (Constitution V). Fail-fast: collisions → errors. Collect-all aggregation (parallel to `applyExtensions` 015, `buildOutputs` 016). No auto-discovery. |
| VI. Ownership Model | ✅ PASS | Check validates apps (managed) and resources (external reference only). Resource consistency check (C4) проверяет refs → generated TF addresses. Extensions targets — IDL-addressable resources only. |
| Monorepo Tooling | ✅ PASS | Новый модуль в `packages/pilot/src/check/` — внутренний модуль, не пакет. Export через `@ycforge/pilot` barrel. Нет новых зависимостей. |
| Secrets | ✅ PASS | Check read-only; не читает/пишет секреты; ENV validation проверяет presence, не values. |

**Gate Decision**: All gates PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/020-ycsf-check/
├── plan.md              # This file
├── research.md          # Phase 0 output (decisions D-RE-1..N)
├── data-model.md        # Phase 1 output (CheckResult, YCK_*, aggregation model)
├── quickstart.md        # Phase 1 output (validation scenarios Sc1..Sc6)
├── contracts/           # Phase 1 output (ycsf-check.json)
│   └── ycsf-check.json  # YCK_* codes, exit codes, check config surface
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/pilot/src/
├── check/                           # NEW — ycsf check module
│   ├── index.ts                     # public API: export { check, type CheckResult, type CheckOptions }
│   ├── check.ts                     # orchestration: load generated model + run all categories + aggregate
│   ├── categories/
│   │   ├── override-targets.ts      # C1: extension target → generated resource existence (YCK_MISSING_TARGET)
│   │   ├── env-in-patch.ts          # C7: deep-scan extension patch for {{$ENV}} refs (YCK_ENV_IN_PATCH)
│   │   ├── resource-consistency.ts  # C4: resources.yaml refs → generated TF addresses (YCK_REF_UNRESOLVED)
│   │   └── terraform-validate.ts    # C13: optional terraform validate spawn (YCK_TERRAFORM_INVALID / YCK_TERRAFORM_UNAVAILABLE)
│   ├── generated-loader.ts          # load *.ycsf.tf.json files → TerraformResource[] (FR-002)
│   └── errors.ts                    # YCK_* constants + diagnostic factory
├── contracts/
│   └── check.ts                     # NEW — CheckResult, CheckOptions, YckDiagnostic, YCK_* codes
├── index.ts                         # UPDATE: add export { check, CheckResult, CheckOptions } from './check/index.js'
packages/pilot/
└── test/
    ├── check/
    │   ├── override-targets.spec.ts   # US1 AC1-3
    │   ├── env-in-patch.spec.ts       # US2 AC1-3
    │   ├── resource-consistency.spec.ts # US4 AC1-3
    │   ├── terraform-validate.spec.ts # US6 AC1-3
    │   ├── aggregation.spec.ts        # US5 AC1-3
    │   ├── generated-loader.spec.ts   # FR-002: load generated TF files
    │   └── fixtures/                  # hermetic fixture projects
    │       ├── canonical/             # full valid project (user_service + analytics + frontend + openapi)
    │       ├── missing-target/        # extension target → non-existent resource
    │       ├── env-in-patch/          # extension patch with {{$ENV}}
    │       ├── unresolved-ref/        # resources.yaml ref without generated TF counterpart
    │       └── terraform-fail/        # terraform validate failure (mocked)
    └── unit/
        └── check-module.test.ts       # structural: YCK_* constants vs contracts/ycsf-check.json
```

**Structure Decision**: `ycsf check` — внутренний модуль pilot (`src/check/`), не отдельный пакет. Следует паттерну существующих модулей: `src/extensions/`, `src/outputs/`, `src/moves/` — каждый со своим `index.ts`, `errors.ts`, loader и validation модулями. `categories/` поддиректория содержит отдельные модули для каждой новой проверки (C1, C4, C7, C13); reuse-проверки (C2–C3, C5–C6, C8–C12) вызываются напрямую из `check.ts` без обёрток. Тесты в `packages/pilot/test/check/` с fixture projects (hermetic, мемо-файловая система не нужна — fixtures на диске).

## Complexity Tracking

No constitution violations introduced — all gates pass. Check module is a thin orchestration layer reusing existing validators; no new packages, no new dependency cycles, no magic.

## Phase 0: Research (Generated Artifacts)

See `specs/020-ycsf-check/research.md`. Key decisions resolved there:

- **D-RE-1**: Generated resources loading — read `.ycsf/*.ycsf.json` files via `readdir` + `JSON.parse`, filter by `FILENAME_RE` (reuse `materialize/serialize.ts` pattern). Not through dispatch pipeline.
- **D-RE-2**: Reuse strategy — `check.ts` imports and calls `loadExtensions`/`applyExtensions` (015), `checkEnvRequirements` (011), `validateBuilders` (013), `buildOutputs` (016), `validateMoves` (017) directly. Results flattened into `CheckResult.diagnostics`.
- **D-RE-3**: `{{$ENV}}` in patch scan — recursive walk of patch object string values using `ENV_REF_RE` from `model/env-requirements.ts`. No false positives from Terraform `${...}` (different syntax).
- **D-RE-4**: Resource consistency (C4) — IDL domain→TF type mapping from `extensions/idl.ts` (`IDL_DOMAIN_BY_TF_TYPE`). Iterate `resources.yaml` entries, look up matching `TerraformResource` by type+name in generated model.
- **D-RE-5**: `terraform validate` invocation — `child_process.spawnSync('terraform', ['validate', '-no-color'], { cwd: infraDir })`. Optional, off by default. Base errors → skip terraform step (fail-fast per spec). Binary not found → `YCK_TERRAFORM_UNAVAILABLE`, base checks continue.
- **D-RE-6**: Generated model loader — readdir `.ycsf/` + filter `*.ycsf.tf.json` + JSON.parse each + extract `resource.*` blocks → flatten to `TerraformResource[]`. Empty dir → empty array (C1/C4 report all targets as missing).
- **D-RE-7**: `buildOutputs` reuse for validation (C9) — call `buildOutputs(input)` for validation side-effect only; result file discarded, only `errors` collected. Need `OutputsYaml` + `materializerOutputs` (empty for standalone check) + `resources` (generated model).
- **D-RE-8**: Check is sync for base checks (C1–C12), async only for `terraform validate` (C13). Overall: `async function check(rootDir, options?) → CheckResult`.
- **D-RE-9**: No `terraform init` for base checks — pure contract validation, no terraform state/provider cache/module sources needed. `--validate-tf` requires init as user responsibility.
- **D-RE-10**: Duplicate diagnostics — `applyExtensions` (015) already emits `EXT_UNRESOLVED_TARGET` for missing targets. Check layer emits `YCK_MISSING_TARGET` additionally (different abstraction level, different diagnostic code). Both appear in `CheckResult.diagnostics` per spec SC-005/AC5.3.

## Phase 1: Design & Contracts (Generated Artifacts)

### Data Model (`data-model.md`)

Entities: `CheckResult`, `CheckOptions`, `YckDiagnostic`, `GeneratedModel`, `YCK_*` codes (5), aggregation model (collect-all across 6 existing + 4 new validators), config surface (`--validate-tf`, `--generated-dir`).

### Contracts (`contracts/ycsf-check.json`)

Machine-readable: `YCK_*` codes (5), exit codes (0/1), `CheckResult` schema, `CheckOptions` schema, `YckDiagnostic` fields.

### Quickstart (`quickstart.md`)

Validation scenarios Sc1–Sc6: override targets valid/missing (US1), ENV in patch present/absent (US2), template variables resolved/unresolved (US3), resource consistency valid/unresolved (US4), full aggregation (US5), terraform validate pass/fail/unavailable (US6). Each maps to hermetic tests and SC-001–SC-008.

## Post-Design Constitution Re-Check

All gates still PASS; no new violations. Key points: check is pure validation reusing existing modules (I); test-first per AC (II); additive `YCK_*` + `CheckResult` (III); no provider schema modeling (IV); constant-compared `YCK_*` codes (V); apps/resources ownership respected (VI).
