# Transport Registry Contract: 036 — APIGW HTTP Transport

**Библиотека**: `@ycforge/nestjs-connector` (packages/nest-bridge), внутренний слой.
**Статус**: проектируемый контракт Phase 1 (реализация Phase 2–3). Эвиденс-основа: 6 реальных захватов шлюза 2026-09-17 (`fixtures/http-apigw-event.json`, sanitized).

## Транспорты и дискриминаторы (детерминированный порядок, устойчивый к изменениям)

Реестр формируется `createBuiltinTransports(options?)` и неизменен при исполнении. Порядок: `http` (v2-ветка) → `http` (v1-ветка) → `mq`. Дискриминаторы попарно непересекающиеся.

### `http` — v2-ветка (существующая, без изменений)
Заявляет событие, когда:
```
version === "2.0"   AND   typeof rawPath === "string"   AND   typeof rawQueryString === "string"
```
Затем: `validateHttpApiGatewayV2Event` → `normalizeHttpRequest(raw)` → `httpVersion: "2.0"`.

### `http` — v1-ветка (новая, API Gateway cloud_functions)
Заявляет событие, когда **одновременно**:
```
typeof httpMethod === "string"   AND   typeof path === "string"   AND   typeof version === "undefined"
```
Из события с `version:"2.0"` v1-ветка НЕ заявляется (гибрид → v2-ветка).

Затем: `validateYcApiGatewayEvent` (ядро strict → `INVALID_INVOCATION_EVENT(id:"http")`, опционал tolerant) → `adaptYcApiGatewayEventToV2` → `normalizeHttpRequest(canonical, { httpVersion: "1.0" })` → `YandexHttpAdapter.dispatch`.

### `mq` (существующая, без изменений)
Заявляет событие с непустым массивом `messages`. Первый (по порядку) заявивший транспорт и обрабатывает; конкуренции нет.

## Ошибки (без изменений контракта)

- **`INVALID_INVOCATION_EVENT`**: нарушение ядра v1-ветки; диагностика value-free (имена полей + ожидаемый тип).
- **`UNKNOWN_INVOCATION_EVENT`**: ни один транспорт не заявил → критический fail (fail-fast не ослаблен).

## Raw-форма v1-события (ядро/опционал, по захватам)

Ядро (обязательно): `httpMethod:string`, `path:string`, `headers:Record<string,string>`, `queryStringParameters:Record<string,string>`, `body:string`, `isBase64Encoded:boolean`, `requestContext.object` с `identity.{sourceIp,userAgent}` (string), `httpMethod` (string), `requestId` (string), `requestTime` (string), `requestTimeEpoch` (number).

Опционал (tolerant): `url?:string`, `multiValueHeaders?:Record<string,string[]>`, `multiValueQueryStringParameters?:Record<string,string[]>`, `params?:Record<string,string>`, `multiValueParams?:Record<string,string[]>`, `pathParams?:Record<string,string>`, `operationId?:string`, неизвестные аддитивные поля — через index signature.

## Маппинг в канонический RawHttpApiGatewayV2Event (адаптер)

| Канонический | Источник v1 |
|---|---|
| version | `"2.0"` (внутренняя форма) |
| rawPath | `path` |
| rawQueryString | `url`-query (после `?`, хвостовой `?` опускается) либо serialize(`queryStringParameters` ∪ `multiValueQueryStringParameters`) |
| headers | `headers` |
| queryStringParameters | `queryStringParameters` |
| multiValueParameters | `multiValueParams` ?? `multiValueQueryStringParameters` |
| pathParameters | `pathParams` |
| parameters | `params` |
| body / isBase64Encoded | verbatim |
| requestContext.requestId/time/timeEpoch | `requestId`/`requestTime`/`requestTimeEpoch` |
| requestContext.http.{method,path} | `httpMethod`/`path` |
| requestContext.http.{sourceIp,userAgent} | `identity.sourceIp`/`identity.userAgent` |

## Nullable/missing политика (v1-ветка)

| Семантика | Значение |
|---|---|
| Отсутствующие `multiValue*`/`params`/`pathParams`/`operationId`/`url` | `{}`/`""` — tolerant, НЕ `INVALID` |
| `requestContext.identity` отсутствует (не-шлюзовое событие, неполный payload) | `INVALID` (ядро): реальный шлюз всегда шлёт identity |
| `rawQueryString` | из `url` (каноничен); else serialize |
| `httpVersion` (NormalizedHttpRequest) | `"1.0"` — реальный формат v1 |

## Эволюция контракта

Публичные контракты (barrel, subpath exports, версии) НЕ меняются. Изменяются только внутренние модули `src/http/` (аддитивная параметризация `httpVersion` с дефолтом `"2.0"`). Документация (AGENTS.md §4.x, ARCHITECTURE.md §4, README) обновляется + IDEA.md §2.