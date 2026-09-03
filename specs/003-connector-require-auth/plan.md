# Implementation Plan: `@RequireAuth` + global guard + subpath exports (003)

**Branch**: `003-connector-require-auth` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-connector-require-auth/spec.md` (clarified 2026-09-04, маркеров не осталось)

## Summary

Закрыть gap-ы 15–17 из specs/001 в пакете `packages/nest-bridge` (`@ycforge/nestjs-connector`): декоратор `@RequireAuth(scheme, guard)` с metadata `ycsf:auth:scheme`/`ycsf:auth:guard` и `ApiSecurity`-интеграцией; глобальный guard, регистрируемый bootstrap-ом `createYandexHandler`, с precedence method > controller > project-default (bootstrap-опция) и делегированием заявленному guard через Nest DI; subpath exports `./auth`, `./queue`, `./context` при сохранённом корневом barrel.

Поскольку `packages/nest-bridge` ещё не существует, план начинается с **блокирующего миграционного preamble**: перенос кода и тестов `ycsf-nestjs-connector@v0.0.3` (tag `v0.0.3`, commit `a4f4e2d`, источник — https://github.com/ycforge/ycsf-nestjs-connector) в монорепу под именем `@ycforge/nestjs-connector`, с приведением к конвенциям workspace (ESM, tsup, vitest) и зелёными существующими тестами. Только после этого — feature-задачи (test-first по Constitution II).

## Technical Context

**Language/Version**: TypeScript ^5.9, Node.js >= 22, ESM (`"type": "module"`)
**Primary Dependencies**: `@nestjs/common`, `@nestjs/core` ^11 (peer dependencies — см. specs/001, раздел зависимостей); `@nestjs/swagger` (peer, для `ApiSecurity`); dev: tsup ^8.5, vitest ^3.2, typescript ^5.9 (конвенции packages/pilot)
**Storage**: N/A
**Testing**: vitest (unit + integration через Nest testing module); статический guard-тест для FR-008
**Target Platform**: Yandex Cloud Functions runtime (Node.js 22), npm-библиотека
**Project Type**: library (npm-пакет в pnpm-монорепе)
**Performance Goals**: N/A (библиотечный контракт; global guard — O(1) reflector lookups на запрос)
**Constraints**: A не импортирует B/composer, не пишет auth.yaml (Constitution I); subpath-модули не импортируют корневой barrel (FR-008); `@RequireAuth` — HTTP-only (FR-011)
**Scale/Scope**: один пакет `packages/nest-bridge`; новые модули `src/auth/` (декоратор, metadata, global guard), bootstrap-опция, реструктуризация exports

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Принцип | Проверка | Статус |
|---------|----------|--------|
| I. Разделение A/B/C/Terraform | A добавляет только runtime/decorator/packaging; auth.yaml и scheme-валидация остаются в B (FR-010) | PASS |
| II. Spec-first, Test-first | Spec clarified; каждый acceptance scenario → тест до реализации (RED→GREEN). Миграционный preamble переносит существующие тесты как есть (перенос, не новая логика) — characterization baseline | PASS |
| III. Контракты версионируются | Новые публичные контракты (subpath exports, metadata-ключи, bootstrap-опция) фиксируются в contracts/; версия пакета при миграции поднимается выше 0.0.3 | PASS |
| IV. Terraform настоящий | Не затрагивается | PASS |
| V. Явное вместо магии | Guard не выводится из scheme (FR-006); project-default — только явная bootstrap-опция | PASS |
| VI. Ownership apps/resources | Не затрагивается (Project A) | PASS |

Нарушений нет — Complexity Tracking не требуется.

## Project Structure

### Documentation (this feature)

```text
specs/003-connector-require-auth/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── auth-decorator.md
│   └── package-exports.md
└── tasks.md             # Phase 2 (/skill:speckit-tasks)
```

### Source Code (repository root)

```text
packages/nest-bridge/                    # НОВЫЙ пакет (миграция из ycsf-nestjs-connector@v0.0.3)
├── package.json                         # name: @ycforge/nestjs-connector, exports: ., ./auth, ./queue, ./context
├── tsup.config.ts                       # entry: index + auth/queue/context
├── vitest.config.ts
├── tsconfig.json
├── src/
│   ├── index.ts                         # корневой barrel (сохраняется, обратная совместимость)
│   ├── auth/
│   │   ├── index.ts                     # subpath entry ./auth: RequireAuth, metadata-типы, GlobalAuthGuard
│   │   ├── require-auth.decorator.ts    # FR-001, FR-002, FR-009
│   │   ├── auth-metadata.ts             # ключи 'ycsf:auth:scheme' / 'ycsf:auth:guard'
│   │   └── global-auth.guard.ts         # FR-003..FR-006 (method > controller > project default)
│   ├── queue/                           # subpath entry ./queue: @QueueHandler/@QueueMessage (ре-экспорт из mq/)
│   ├── context/                         # subpath entry ./context: @YandexContext (ре-экспорт)
│   ├── core/                            # createYandexHandler: регистрация global guard + опция defaultAuthGuard
│   ├── http/                            # перенос без изменений поведения
│   └── mq/                              # перенос без изменений поведения
└── test/
    ├── auth/                            # unit (decorator metadata), integration (Nest testing module, DI guard)
    ├── packaging/                       # compile-фикстуры subpath imports + статический guard-тест FR-008
    └── (перенесённые тесты v0.0.3, fixtures/)
```

**Structure Decision**: пакет `packages/nest-bridge` по конвенциям `packages/pilot` (tsup/vitest/ESM/`exports`-мапа). Исходная структура `ycsf-nestjs-connector@v0.0.3` (`src/core`, `src/http`, `src/mq`, `fixtures/`) сохраняется; новое — `src/auth/`, тонкие entry-модули `src/queue`/`src/context` (ре-экспорт существующих декораторов без переноса логики), bootstrap-опция. `src/queue|context` не импортируют `src/index.ts` (FR-008).

## Phases

### Phase M (preamble, blocking) — миграция пакета

Per Assumptions spec.md: миграция не завершена → блокирующий preamble.

1. Импортировать исходники и тесты `ycsf-nestjs-connector` tag `v0.0.3` в `packages/nest-bridge`.
2. `package.json`: name `@ycforge/nestjs-connector`, version `0.1.0`, ESM, peer `@nestjs/common`/`@nestjs/core` ^11, `@nestjs/swagger` ^11, скрипты build/test/typecheck по образцу pilot.
3. Привести tooling к workspace (tsup, vitest, tsconfig); legacy tooling оригинального репозитория заменить.
4. Критерий выхода: `pnpm --filter @ycforge/nestjs-connector test` зелёный на перенесённых тестах (characterization baseline, Constitution II: существующее поведение зафиксировано до новых изменений).

### Phase 0 — research

См. `research.md`: регистрация global guard в `createYandexHandler`, DI-резолв guard-класса, precedence через Reflector, multi-entry tsup + exports map, статический guard-тест FR-008.

### Phase 1 — design

См. `data-model.md`, `contracts/auth-decorator.md`, `contracts/package-exports.md`, `quickstart.md`.

### Phase 2 — tasks

`/skill:speckit-tasks` (не часть этого плана).

## Constitution Check (post-design re-evaluation)

| Принцип | Результат дизайна | Статус |
|---------|-------------------|--------|
| I | Global guard живёт в A; схемы/валидация — в B; A не импортирует B (contracts фиксируют) | PASS |
| II | quickstart.md и contracts содержат тест-кейсы на каждый AC; implement идёт test-first | PASS |
| III | contracts/package-exports.md — версионируемый публичный контракт пакета | PASS |
| V | FR-006: никакого вывода guard из scheme; default только через явную опцию | PASS |

Нарушений нет.
