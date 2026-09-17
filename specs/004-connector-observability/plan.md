# Implementation Plan: unified logger в stdout + `trace_id` в контексте и error-ответе

**Branch**: `004-connector-observability` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-connector-observability/spec.md`

**Note**: This template is filled in by the `/skill:speckit-plan` command; its definition describes the execution workflow.

## Summary

Фича закрывает gap-ы 10–12 таблицы «Расхождения с IDEA.md» spec 001 в `packages/nest-bridge` (`@ycforge/nestjs-connector`):

- **FR-001..004** — `YandexExecutionContext` получает поле `trace_id = awsRequestId` (clarify Q1→A), включается в `toJSON()`.
- **FR-005..011** — connector пишет структурированные boundary-логи (start/finish/error) в `stdout`: JSON-линия на запись, атомарный single-write, fail-open, редакция §6.2, `durationMs`.
- **FR-012..015** — публичный logger-провайдер `YandexLogger` для application-кода через Nest DI (сам отмечает `trace_id`/`awsRequestId` из invocation scope).
- **FR-016..019** — `trace_id` во ВСЕХ HTTP error-ответах (last-resort 500, mapped 4xx/5xx, 404): merge только на error-пути, без перезаписи body фильтров (clarify Q2→B).

Технический подход (обоснован в research.md): единый `LogWriter` (single `process.stdout.write` строки), единый redactor, `responseFacade.attachTraceId`-seam только на error-пути dispatch, `@Global()` bootstrap-модуль для регистрации провайдера, новый subpath-export `./logger`.

## Technical Context

**Language/Version**: TypeScript 5.9 (target ES2022, strict, ESM-first `"type": "module"`), Node.js >= 22, dual ESM/CJS через tsup.

**Primary Dependencies**: `@nestjs/common`, `@nestjs/core` ^11 (peer; уже стоят). Новых runtime-зависимостей НЕТ — structured logger реализуется вручную (decision R2). `vitest` ^3 для тестов.

**Storage**: N/A — только `stdout` как единственный sink (FR-005). Per-invocation состояние — существующий `AsyncLocalStorage` invocation scope (`src/context/invocation-scope.ts`).

**Testing**: `vitest` (globals, `src/**/*.spec.ts` + `test/**/*.spec.ts`), `pnpm --filter @ycforge/nestjs-connector test`. Unit-тесты writer'a на инъектируемом sink; интеграционные — spy на `process.stdout.write`; conformance-фикстуры HTTP (11) + MQ (5) переиспользуются для анализа stdout.

**Target Platform**: Node.js >= 22, Yandex Cloud Functions runtime (stdout собирается платформой в Cloud Logging).

**Project Type**: библиотека (npm-пакет `@ycforge/nestjs-connector`).

**Performance Goals**: минимальный per-invocation overhead — 2–3 лог-записи на вызов, single-write JSON-линия, `durationMs` через `performance.now()` (`process.hrtime` на warm-контуру не нужен); лог считать «лёгким, но не zero-cost»: Fail-open без влияния на результат.

**Constraints**: fail-open (FR-010/015), атомарность строк при конкурентных invocations (FR-011), редакция секретов §6.2 (FR-009/014), неизменность поведения spec 001 (детекция → приложение → контекст → scope), нулевое изменение успешного wire-конверта `{statusCode,headers,body,isBase64Encoded}`.

**Scale/Scope**: один пакет; публичная поверхность расширяется аддитивно (`trace_id` в контексте, error-конверт, провайдер, subpath `./logger`). Контракт провайдера маленький (5 методов + инъекция). Изменения только в `packages/nest-bridge`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Принцип | Оценка | Комментарий |
|---------|--------|-------------|
| I. A/B/C/Terraform | проходит | Вся работа в A (runtime adapter): logger — boundary-обеспечение runtime; B/C/Terraform не затрагиваются, внешних sink-ов нет (FR-005). |
| II. Spec-first/test-first | проходит | Каждый FR→AC→тест; conformance-фикстуры 001 переиспользуются; traceability в SC-001..006. |
| III. Контракты версионируются | проходит | Аддитивные изменения контрактов (контекст+`trace_id`, error-конверт+`trace_id`, новый public provider, subpath `./logger`); breaking change в формате лога осознанно не делается (формат задокументирован как observable-контракт). |
| IV. Terraform остаётся настоящим | N/A | Никакого Terraform в scope. |
| V. Явное вместо магии | проходит | Нет auto-discovery логгера; sink жёстко `stdout`; `trace_id` = явное поле, не магия вывода; merge в error-конверт — явный seam только на error-пути, не глобальная трансформация body. |
| VI. Ownership apps/resources | N/A | Не относится. |

**Дополнительно**: редакция §6.2 (секреты) — центральное требование FR-009/014; секреты не логируются и не попадают в error-конверт. Монорепозиторий — код инструментов, не приложение (логи — это observable-контракт библиотеки, а не инфраструктура).

GATE: violation-ов нет — «Complexity Tracking» не требуется.

### Re-check после Phase 1 (design)

- **I**: design не выходит за Project A — всё в `src/logger`, `context`, `http`, `core`, `auth` (bootstrap); B/C/Terraform не упоминаются; единственный sink — `stdout`. ✔
- **II**: quickstart (V1–V5) трейсит каждый AC: trace_id (US1), boundary-логи (US2), error-конверт (US3), провайдер (US4); тесты RED→GREEN планируются на `tasks.md`. ✔
- **III**: аддитивные контракты зафиксированы в `contracts/observability.md` и `contracts/package-exports.md`; формат лога задокументирован как observable-контракт; ошибок в стабильной поверхности (успешные ответы, дефолты транспортов) нет. ✔
- **IV**: N/A. **VI**: N/A.
- **V**: нет магии — `trace_id` явное, `attachTraceId` — явный seam только на error-пути, провайдер регистрируется через штатный `@Global()` без auto-discovery, редакция — единый redactor. ✔
- **Дополнительно**: §6.2/редакция прошита в record и provider (FR-009/014); документированы альтернативы из research (без внешних зависимостей). ✔

GATE (повторно): violation-ов нет.

## Project Structure

### Documentation (this feature)

```text
specs/004-connector-observability/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── observability.md # trace_id, лог-формат, error-конверт, провайдер
│   └── package-exports.md # изменения exports-карты (./logger + root)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (packages/nest-bridge)

```text
packages/nest-bridge/
├── src/
│   ├── context/
│   │   ├── yandex-execution-context.ts      # + trace_id (интерфейс) [FR-001..003]
│   │   └── build-yandex-execution-context.ts # + trace_id в builder и toJSON() [FR-001..003]
│   ├── logger/                              # NEW subpath ./logger
│   │   ├── index.ts                         # subpath entry: public API (FR-012..015)
│   │   ├── record.ts                        # BoundaryLogRecord, Level, serializeRecord
│   │   ├── writer.ts                        # createLogWriter(sink?) → single-write, fail-open, atomic (FR-005..011)
│   │   ├── redact.ts                        # redactForLogging() — редакция §6.2 (FR-009/014/018)
│   │   ├── invocation-logger.ts             # createInvocationLogger(writer) → start/finish/error (FR-006..008)
│   │   └── yandex-logger.ts                 # public YandexLogger provider (FR-012..015)
│   ├── auth/bootstrap-module.ts             # + @Global(), + YandexLogger provider (FR-012)
│   ├── core/create-yandex-handler.ts        # tolerant trace_id; start/finish/error вокруг invoke (FR-005..008)
│   ├── http/response-facade.ts              # + attachTraceId() seam — merge только на error-пути (FR-016/017)
│   ├── http/dispatch-pipeline.ts            # attach на invokeErrorLayer/invokeNotFound; trace_id в last-resort (FR-016..018)
│   └── index.ts                             # + export { YandexLogger }; + export type ... logger
├── test/packaging/no-root-barrel-import.spec.ts # GUARDED_DIRS += "logger"
├── package.json                             # exports: + "./logger"; files: dist
└── tsup.config.ts                           # entry: + "logger/index"
```

**Structure Decision**: изменений только в `packages/nest-bridge`. Новый каталог `src/logger/` повторяет subpath-конвенцию 003 (`auth`, `queue`, `context` → `logger`); модули внутри — только относительные импорты, никогда корневой barrel (FR-008 guard). Изменения в bootstrap и handler — минимальные и точечные, сохраняющие порядок фаз spec 001 (детекция → приложение → контекст → scope).

## Complexity Tracking

> Violation не зафиксировано (Constitution Check прошёл) — таблица не заполняется.