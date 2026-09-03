# Phase 0 Research: `@ycforge/pilot/contracts`

Дата: 2026-09-03. Все NEEDS CLARIFICATION из Technical Context разрешены локально (зелёное поле, контекст полностью задан spec + constitution + IDEA.md; внешних интеграций нет).

## R-01: Пакетный менеджер и форма монорепы

- **Decision**: pnpm workspaces (pnpm 11, доступен в окружении; Node 22). Корневой `package.json` (`private: true`) + `pnpm-workspace.yaml` со списком `packages/*` и `examples/*`.
- **Rationale**: AGENTS.md фиксирует «монорепозиторий npm/pnpm»; пакетов будет минимум четыре (A, B, C, builders) + примеры. pnpm строже разрешает peer-зависимости (критично для модели «плагин объявляет peer-dep на `@ycforge/pilot`», IDEA §43).
- **Alternatives considered**: npm workspaces — отклонены: слабее изоляция peer-зависимостей, нет `workspace:`-протокола той же зрелости.

## R-02: Система модулей и сборка пакета

- **Decision**: TypeScript, strict, ESM-first (`"type": "module"`, `module: NodeNext`); сборка через `tsup` (dev dependency) с двумя entry points (`index` — внутренний C, пока placeholder; `contracts` — публичный контракт), выдающая ESM + CJS + `.d.ts`.
- **Rationale**: потребители contracts — внешние npm-пакеты, в том числе из CJS-мира (NestJS-экосистема, Project A). Type-only контракты + pure-функции собираются tsup без конфигурационной сложности; `tsc --noEmit` остаётся отдельным типовым gate (SC-002/SC-003) и не заменяет сборку.
- **Alternatives considered**: tsc-only ESM — отклонено: закрывает CJS-потребителей; dual-package вручную через два tsconfig — отклонено: лишняя сложность, tsup делает то же самое штатно.

## R-03: Тестовый стек и стратегия type-тестов

- **Decision**: vitest (dev dependency, пакетный scope — `packages/pilot`) с включённым typecheck-режимом (`.test-d.ts` + `expectTypeOf`) для compile-time тестов (SC-002) и обычными `.test.ts` для поведения парсера/predicate (SC-004). Отдельный gate `tsc --noEmit` — компиляция example-пакета (SC-003).
- **Rationale**: contracts-модуль — преимущественно типы; type-тесты первичны (Constitution II). vitest typecheck даёт и запуск, и статическую проверку в одном раннере; `expectTypeOf` ломается при смене сигнатуры. Runtime-тестов мало (парсер, форматтер, predicate, ContractError) — полноценный фреймворк не нужен, но vitest уже требуется для typecheck, одним раннером проще.
- **Alternatives considered**: `node:test` + ручной tsc — отклонено: нет type-assertions, два разных механизма запуска; `expect-type` отдельно — отклонено: vitest реэкспортирует тот же движок.

## R-04: Граница zero-dependency (SC-001) и её проверка

- **Decision**: `src/contracts/**` импортирует только относительные модули и type-only символы; никаких `dependencies` в `package.json` пакета pilot (runtime-deps отсутствуют целиком). Проверка — тест, сканирующий исходники contracts на non-relative import, плюс assertion, что `dependencies`/`peerDependencies` отсутствуют.
- **Rationale**: FR-019 требует zero runtime-зависимостей на уровне модуля; статическая проверка импорт-графа — простейший исполняемый gate.
- **Alternatives considered**: ESLint `import/no-extraneous-dependencies` — отклонено: лишняя dev-инфраструктура ради одного правила; проще прямой тест.

## R-05: Дискриминант `TerraformBlock`

- **Decision**: каждый член union-типа несёт readonly-литеральный дискриминант `kind` (`'resource' | 'moved' | 'variable' | 'data' | 'output'`); поля `TerraformMoved`/`TerraformVariable`/`TerraformData`/`TerraformOutput` — минимальные структурные формы (moved: `from`/`to`; variable: `name` + `configuration?`; data: `type`/`name`/`configuration`; output: `name`/`value`/`description?`).
- **Rationale**: без общего дискриминанта C не сможет типобезопасно сериализовать union в `.tf.json` (зона C, specs 014/016/017); IDEA §23 перечисляет состав блоков, не фиксируя полей moved/variable/data/output — они сознательно минимальны и расширяемы optional-полями (non-breaking). Отклонение от буквальной формы `TerraformResource {type,name,configuration}` из IDEA §23 осознанно: добавление `kind: 'resource'` не меняет семантику минимального representation, а делает union сужаемым. Зафиксировано в data-model.md.
- **Alternatives considered**: union без дискриминанта — отклонено: сужение через `in`-проверки хрупкое; отдельные entry-функции вместо union — отклонено: противоречит FR-009.

## R-06: Example-пакет стороннего плагина (SC-003)

- **Decision**: `examples/third-party-contracts-plugin/` — отдельный workspace-пакет (`@ycforge-example/contracts-plugin`), peer/dev-зависимость `@ycforge/pilot: workspace:*`, type-only импорт только из `@ycforge/pilot/contracts`; reference builder (function) + reference materializer с `output.declare`; gate — `tsc --noEmit` по его собственному tsconfig.
- **Rationale**: прямо воспроизводит User Stories 1–2: компиляция примера без импортов из других пакетов монорепы доказывает самодостаточность subpath export.
- **Alternatives considered**: тестовый пакет внутри `packages/pilot/test/fixtures` — отклонено: не доказывает независимость от внутренних путей (может резолвиться через относительные импорты).

## R-07: Контроль версии (SC-005)

- **Decision**: `CONTRACT_VERSION: 1` экспортируется из `version.ts`; unit-тест читает `package.json` пакета и утверждает равенство `CONTRACT_VERSION === semver.major(pkg.version)`. Migration guide: на major > 1 обязателен `MIGRATION.md` в корне пакета; проверка — существование файла, когда major > 1 (на v1 тривиально истинно, тест фиксирует правило).
- **Rationale**: реализация уточнения 2026-09-03 (FR-018): две независимые линии версионирования.
