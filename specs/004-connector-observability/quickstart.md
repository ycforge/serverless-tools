# Quickstart: 004-connector-observability

Валидационные сценарии, доказывающие фичу end-to-end. Детали форматов — `contracts/observability.md`, `contracts/package-exports.md`; сущности — `data-model.md`.

## Prerequisites

- pnpm >= 11, Node >= 22.
- Зависимая монорепа: `packages/nest-bridge` (spec 003 базис на месте).
- Установка: `pnpm install`.

## Setup

```bash
pnpm --filter @ycforge/nestjs-connector build   # сборка dist (exports-карта, ./logger)
```

## Validation scenarios

### V1. `trace_id` в контексте (FR-001..004)

```bash
pnpm --filter @ycforge/nestjs-connector test -- --run src/context
```

- Вызов handler (HTTP/MQ фикстура) → `@YandexContext().trace_id === awsRequestId`; `JSON.stringify(context)` содержит `trace_id`, `token` → `REDACTED_TOKEN`, `raw`/`rawEvent` отсутствуют.
- Горячий warm N+1: `trace_id` N+1 ≠ N (изоляция).

**Expected**: зелёные unit-тесты builder `build-yandex-execution-context.spec.ts` + новые assertions на `trace_id`.

### V2. Boundary-логи в stdout (FR-005..011)

```bash
pnpm --filter @ycforge/nestjs-connector test -- --run src/core test/packaging
```

- Прогон HTTP (11 фикстур) и MQ (5 фикстур) с `vi.spyOn(process.stdout, "write")`.
- Для каждой инвокации в перехваченных записях: ровно `start` + `finish` (или `error`), одинаковые `trace_id`/`awsRequestId`; у `finish`: `transport`, `status` (HTTP-статус / число сообщений MQ), `durationMs >= 0`.
- Ошибка границы (`UNKNOWN_INVOCATION_EVENT`) → запись `error` с `code`; bootstrap-провал → `error` без `trace_id` (edge case 1).
- Отрицательные проверки: ни одна запись не содержит фрагменты `token`/header/body/`raw` (редaction).

**Expected**: conformance-тесты зелёные; паритетный тест успешных wire-конвертов 001 не изменён.

### V3. `trace_id` в error-ответах (FR-016..018)

```bash
pnpm --filter @ycforge/nestjs-connector test -- --run src/http
```

- Last-resort 500: тело = `{"statusCode":500,"message":"Internal server error","trace_id":"<id>"}`.
- BadRequest через exception filter: тело фильтра + `trace_id`, статус/прочее тело не изменены; если фильтр вернул свой `trace_id` — он сохраняется.
- 404 not-found: конверт `Cannot <METHOD> <path>` + `trace_id`.
- Успешные ответы: `{statusCode,headers,body,isBase64Encoded}` без `trace_id`.

**Expected**: тесты `http-failure-semantics` + новые assertions.

### V4. Провайдер `YandexLogger` (FR-012..015)

```bash
pnpm --filter @ycforge/nestjs-connector test -- --run src/logger test
```

- Инъекция `YandexLogger` в сервис приложения; записи `debug/info/warn/error` с автоподстановкой `trace_id`/`awsRequestId`; `context` с ключами `token`/`authorization`/`cookie` редактируется.
- Вызов вне invocation scope (модульная инициализация): запись без `trace_id`/`awsRequestId`, без exception.
- Import только `@ycforge/nestjs-connector/logger` компилируется без root-импорта (guard-тест `no-root-barrel-import.spec.ts` с `GUARDED_DIRS` + `logger`).

**Expected**: зелёные интеграционный тест инъекции + провайдера + guard-тест.

### V5. Полный прогон

```bash
pnpm --filter @ycforge/nestjs-connector test
pnpm --filter @ycforge/nestjs-connector typecheck
```

**Expected**: зелёные (SC-001, traceability каждого AC spec).

## Out of scope (не валидировать здесь)

- Настройка уровня/фильтра логов и внешних sink-ов (в v1 отсутствуют — Assumptions spec).
- Формат для специфического Cloud Logging-парсинга (stdout собирается платформой как есть).
- Поведение транспортов spec 001 (детекция/нормализация/dispatch) и spec 003 (auth) — не регрессируют, но уровень работы — их собственные тесты.