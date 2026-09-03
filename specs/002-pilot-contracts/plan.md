# Implementation Plan: `@ycforge/pilot/contracts` — контракты экосистемы serverless-tools

**Branch**: `002-pilot-contracts` | **Date**: 2026-09-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-pilot-contracts/spec.md` (после clarify 2026-09-03)

## Summary

Greenfield-реализация subpath export `@ycforge/pilot/contracts` пакета `packages/pilot` (`@ycforge/pilot`): type-level контракты Builder/BuildContext/Artifact, Materializer/MaterializationContext/OutputBuilder, Terraform model (TerraformResource + TerraformBlock union), ResourceReference с canonical парсером, diagnostics (`ContractError`) и носитель версии (`CONTRACT_VERSION`). Runtime-код ограничен pure-функциями (парсер, форматтер, predicate), zero runtime-зависимостей (FR-019). Пакет собирается tsup (ESM+CJS+types), тесты — vitest с typecheck-режимом; example-пакет стороннего плагина доказывает самодостаточность контракта (SC-003). Монорепа инициализируется (pnpm workspaces), т.к. код в репозитории отсутствует.

## Technical Context

**Language/Version**: TypeScript (strict, `module: NodeNext`), Node ≥ 22

**Primary Dependencies**: нет runtime-зависимостей (FR-019); dev: `typescript`, `tsup`, `vitest` (typecheck-режим)

**Storage**: N/A (type-level контракты + pure-функции)

**Testing**: vitest (runtime `.test.ts` + type `.test-d.ts` с `expectTypeOf`), gate `tsc --noEmit` для example-пакета

**Target Platform**: npm-пакеты (Node ≥ 20), ESM + CJS dual output

**Project Type**: library (монорепа инструментов; пакет `@ycforge/pilot`, subpath export `./contracts`)

**Performance Goals**: N/A (compile-time контракты; парсер — микросекунды на вызов, не регламентируется)

**Constraints**: zero runtime-зависимостей модуля contracts (FR-019, SC-001); публичный API только через subpath `./contracts` (FR-020); контракты не моделируют Terraform provider schema (Constitution IV)

**Scale/Scope**: один пакет, ~8 модулей contracts, ~10 тестовых файлов, 1 example-пакет

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Принцип | Оценка | Комментарий |
|---|---|---|
| I. Разделение A/B/C/Terraform | PASS | contracts — публичный API C, но не тянут runtime C; никаких схем NestJS/OpenAPI/YAML, нет provisioning-логики; диспетчеризация/сериализация явно вынесены в зону C |
| II. Spec-First, Test-First | PASS | acceptance criteria spec → тесты до реализации (type-тесты SC-002, парсер SC-004); RED→GREEN фиксируется в tasks.md |
| III. Контракты версионируются | PASS | `CONTRACT_VERSION` + semver major + migration guide (FR-017/018, SC-005); две независимые линии (clarify 2026-09-03, IDEA §43 обновлён) |
| IV. Terraform остаётся настоящим | PASS | `TerraformBlock` — generic representation, `configuration: unknown`; provider schema — зона materializer-а; сериализация `.tf.json` — зона C |
| V. Явное вместо магии | PASS | explicit subpath export, fail-fast `ContractError` с кодами, коллизии `output.declare` = error, грамматика ref явная |
| VI. Ownership apps/resources | PASS | парсер `ResourceReference` не различает managed/external; ownership-семантика — зона C |

Post-design re-check (после Phase 1): решение R-05 (дискриминант `kind` в `TerraformBlock`) не нарушает IV — provider schema по-прежнему не моделируется; расширение полей блоков только optional (non-breaking). **GATE PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/002-pilot-contracts/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── public-api.md    # контракт публичного API subpath export
└── tasks.md             # Phase 2 output (следующий шаг — /speckit.tasks)
```

### Source Code (repository root)

```text
package.json                          # private root, scripts-делегирование в пакеты
pnpm-workspace.yaml                   # packages/*, examples/*
packages/pilot/
├── package.json                      # @ycforge/pilot; exports: {".", "./contracts"}; без runtime-deps
├── tsconfig.json                     # strict, NodeNext, ESM
├── tsup.config.ts                    # dual ESM+CJS, d.ts, entries index + contracts
├── vitest.config.ts                  # typecheck.enabled (test/types/*.test-d.ts)
├── src/
│   ├── index.ts                      # внутренний entry C (placeholder, не публичный контракт)
│   └── contracts/
│       ├── index.ts                  # единственный barrel публичного API (FR-020)
│       ├── builder.ts                # Builder, BuildContext, Artifact
│       ├── materializer.ts           # Materializer, MaterializationContext, OutputBuilder
│       ├── terraform.ts              # TerraformResource, TerraformMoved/Variable/Data/Output, TerraformBlock
│       ├── resource-reference.ts     # ResourceReference, ParsedResourceReference, parse/format
│       ├── artifact-type.ts          # ARTIFACT_TYPE_PATTERN, isArtifactType
│       ├── diagnostic.ts             # Diagnostic, ContractError, Diagnostics (коды)
│       └── version.ts                # CONTRACT_VERSION
├── test/
│   ├── unit/
│   │   ├── resource-reference.test.ts   # грамматика, round-trip, ContractError (SC-004)
│   │   ├── artifact-type.test.ts        # predicate, канонические примеры
│   │   ├── contract-error.test.ts       # instanceof, name, code/message
│   │   └── version.test.ts            # CONTRACT_VERSION === major(pkg.version) (SC-005)
│   ├── types/
│   │   ├── fr-001-003-builder.test-d.ts    # Builder/BuildContext/Artifact сигнатуры
│   │   ├── fr-005-007-materializer.test-d.ts
│   │   ├── fr-008-009-terraform.test-d.ts
│   │   ├── fr-010-013-reference.test-d.ts
│   │   ├── fr-016-diagnostics.test-d.ts
│   │   └── zero-dependency.test.ts    # SC-001: import-граф contracts без non-relative импортов
│   └── examples/
│       └── acceptance-canonicals.test.ts  # SC-004 канонические примеры IDEA §15
examples/
└── third-party-contracts-plugin/
    ├── package.json                   # @ycforge-example/contracts-plugin; peer+dev @ycforge/pilot workspace:*
    ├── tsconfig.json                  # moduleResolution: NodeNext; gate: tsc --noEmit
    └── src/
        ├── builder.ts                 # reference builder (type-only import contracts)
        └── materializer.ts            # reference materializer + output.declare
```

**Structure Decision**: вариант «single library package» (Option 1 шаблона, адаптированный под монорепу). Контракты физически внутри `packages/pilot/src/contracts` и публикуются только через subpath `./contracts` (FR-020); example-пакет вынесен в `examples/` (workspace), чтобы gate SC-003 не мог резолвиться относительными импортами внутрь исходников pilot (research R-06). Внутренний entry `src/index.ts` — намеренно пустой placeholder до specs 011+.

## Complexity Tracking

Нарушений constitution нет; секция не требуется.
