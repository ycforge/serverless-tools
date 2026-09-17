# Implementation Plan: 036 — APIGW HTTP Transport

**Branch**: `036-apigw-http-transport` (работа на 035, единый PR e2e) | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/036-apigw-http-transport/spec.md`

**Note**: This template is filled in by the `/skill:speckit-plan` command; its definition describes the execution workflow.

## Summary

Yandex API Gateway (интеграция `x-yc-apigateway-integration: cloud_functions`) доставляет в Cloud Function событие HTTP-формата v1 (`httpMethod`/`path`, без `version`). Текущий `http`-транспорт nest-bridge заявляет только событие API Gateway v2.0/ALB (`version:"2.0"` + `rawPath`) → через шлюз получаем 502. Задача: расширить `httpApiGatewayV2Transport` второй OR-ветвью discriminator-а (APIGW v1-событие: `httpMethod: string && path: string && version === undefined`), конвертировать его в канонический `RawHttpApiGatewayV2Event` (мост-адаптер) и прогнать через существующую нормализацию `normalizeHttpRequest` (переиспользование). `httpVersion` параметризуется аддитивно: для APIGW-события честный `"1.0"`, дефолт остаётся `"2.0"` (без регрессий). Валидация: строгое ядро + толерантный опционал (подтверждено clarify 2026-09-17).

**Формат v1-события зафиксирован эвиденсом (6 захватов реального шлюза)**: верхнеуровневые `httpMethod`, `path`, `url`, `headers`, `queryStringParameters`, `body`, `isBase64Encoded`, `requestContext{identity.{sourceIp,userAgent}, httpMethod, requestId, requestTime, requestTimeEpoch}` + опциональные `multiValueHeaders`, `multiValueQueryStringParameters`, `params`, `multiValueParams`, `pathParams`; БЕЗ `version`/`operationId`/`parameters`/`multiValueParameters` (имена `params`/`multiValueParams`/`pathParams` — реальные, не из документации).

## Technical Context

**Language/Version**: TypeScript (моно-репа pnpm); `packages/nest-bridge` публикуется как `@ycforge/nestjs-connector`.

**Primary Dependencies**: NestJS (application layer); esbuild уже в сборке builders-core (не затрагивается).

**Storage**: N/A (stateless runtime, инварианты в fixtures).

**Testing**: `vitest` suite пакета nest-bridge (`pnpm --filter @ycforge/nestjs-connector test`); табличные тесты discriminator-а; conformance-тест с reconstructed-фикстурой из реального захвата; ручной e2e (curl + `yc serverless function invoke`) на реальном deployment.

**Target Platform**: Yandex Cloud Functions (Node.js runtime), вход — HTTP через Yandex API Gateway.

**Project Type**: library (runtime adapter, Project A).

**Performance Goals**: discriminator остаётся O(1) по shape-полям, без десериализации; доп. аллокации на запрос — только для сериализации `rawQueryString` у APIGW-события.

**Constraints**: fail-fast неизвестных событий не ослабляется; диагностики value-free; `supports()` не бросает; порядок реестра `[http, mq]`; контракты A (barrel/subpath exports/версионирование) не меняются.

**Scale/Scope**: один пакет `packages/nest-bridge`; ~3 новых файла + параметризация `normalizeHttpRequest`; фикс-выпа да и docs (AGENTS.md, ARCHITECTURE.md, IDEA.md §2).

## Constitution Check

- ✅ A owns runtime; B owns API composition; C owns orchestration. Изменения только в A `packages/nest-bridge` — граница не нарушается (FR-010).
- ✅ Spec-first: спека 036 утверждена, тесты до реализации (fixture → RED).
- ✅ Contract versioning: публичный API не меняется; `httpVersion` — аддитивный опциональный параметр с дефолтом.
- ✅ Explicit-over-magic: дискриминаторы документированы и попарно непересекающиеся.

## Project Structure

### Documentation (this feature)

```text
specs/036-apigw-http-transport/
├── spec.md              # Feature spec (+ clarify 2026-09-17)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── transport-registry.md   # Реестр транспортов и дискриминаторы
├── checklists/
│   └── requirements.md  # Requirements checklist (заполнен)
└── tasks.md             # Phase 2 output (/skill:speckit-tasks)
```

### Source Code (repository root)

```text
packages/nest-bridge/
├── src/http/
│   ├── yc-apigw-raw-event.ts        # NEW: тип событий cloud_functions v1 (verbatim поля)
│   ├── validate-yc-apigw-event.ts   # NEW: валидатор «строгое ядро + толерантный опционал»
│   ├── yc-apigw-event-adapter.ts    # NEW: мост v1 → RawHttpApiGatewayV2Event (canonical)
│   ├── normalize-request.ts         # EDIT: аддитивная параметризация httpVersion
│   ├── adapter.ts                   # EDIT: supports() ∪ v1-ветка; invoke() маршрутизация
│   └── (raw-event.ts, validate-raw-event.ts, yandex-http-adapter.ts — без изменений)
├── test/                            # табличные дискриминатора, conformance-фикстуры
└── fixtures/
    └── http-apigw/                 # NEW: reconstructed из реальных захватов 036 (T002)
```

**Structure Decision**: интеграция живёт внутри существующего transport-слоя (http/). Два новых файла-реализации (`validate-yc-apigw-event.ts`, `yc-apigw-event-adapter.ts`) + тип (`yc-apigw-raw-event.ts`). Никакого нового transport id — `http` расширяется OR-ветвью.

## Complexity Tracking

> No Constitution violations.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |