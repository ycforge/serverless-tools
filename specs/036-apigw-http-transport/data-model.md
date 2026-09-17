# Data Model: 036 — APIGW HTTP Transport (Phase 1)

**Date**: 2026-09-17

## Поток данных (invocation, без изменений в YandexHttpAdapter)

```text
Yandex API Gateway (cloud_functions)
   │  v1-событие: { httpMethod, path, url?, headers, queryStringParameters,
   │               body, isBase64Encoded, requestContext{identity,...},
   │               multiValue*, params, pathParams }
   ▼
detectTransport(rawEvent)                       // core/detect-transport.ts
   │  1. http-tранспорт: version==="2.0"? +rawPath → v2-ветка
   │  2. http-транспорт: httpMethod && path && version===undefined → v1-ветка [NEW]
   │  3. mq-транспорт: messages[] → mq
   ▼
v1-ветка invoke()
   ▼
validateYcApiGatewayEvent(raw)                  // NEW: ядро strict / опционал tolerant
   ▼
adaptYcApiGatewayEventToV2(raw)                 // NEW: мост в RawHttpApiGatewayV2Event
   │    version:"2.0"  rawPath:=path  rawQueryString:=url?-part | serialize(...)
   │    requestContext.http := { method:httpMethod, path, sourceIp:identity.sourceIp,
   │                             userAgent:identity.userAgent }
   │    requestContext.{requestId,time,timeEpoch} := {requestId,requestTime,requestTimeEpoch}
   │    pathParameters:=pathParams  parameters:=params
   │    multiValueParameters := multiValueQueryStringParameters (если непусто)
   │                              иначе multiValueParams (эвиденс: повторы в mvs; mvp пуст)
   ▼
normalizeHttpRequest(canonical, { httpVersion:"1.0" })   // EDIT: параметризация
   ▼
YandexHttpAdapter.dispatch(normalized)          // переиспользование без изменений
```

## Новые типы

### `YcApiGatewayEvent` (raw input, verbatim — эвиденс 6/6 захватов)

```ts
interface YcApiGatewayRequestContext {
  identity: { sourceIp: string; userAgent: string };   // ядро (IDEA: «постиpreserve»)
  httpMethod: string;                                   // ядро
  requestId: string;                                    // ядро
  requestTime: string;                                  // ядро (`17/Sep/2026:04:19:34 +0000`)
  requestTimeEpoch: number;                             // ядро
  [key: string]: unknown;                               // AGENTS §36 (аддитивность)
}

interface YcApiGatewayEvent {
  httpMethod: string;                                   // ядро
  path: string;                                         // ядро
  headers: Record<string, string>;                      // ядро
  queryStringParameters: Record<string, string>;        // ядро
  body: string;                                         // ядро
  isBase64Encoded: boolean;                             // ядро
  requestContext: YcApiGatewayRequestContext;           // ядро
  // ---- опционал (отсутствие → нормализация {}, "") ----
  url?: string;                                         // полный target "/users?limit=2"
  multiValueHeaders?: Record<string, string[]>;
  multiValueQueryStringParameters?: Record<string, string[]>;
  params?: Record<string, string>;
  multiValueParams?: Record<string, string[]>;
  pathParams?: Record<string, string>;
  operationId?: string;
  [key: string]: unknown;                               // AGENTS §36
}
```

### Canonical output

Переиспользует существующий `RawHttpApiGatewayV2Event`. `version:"2.0"` — внутренняя форма (НЕ ложь: `normalizeHttpRequest.httpVersion` на ветке v1 = `"1.0"`).

## Дискриминатор (обновляемый реестр)

| Порядок | Transport id (ветка) | Дискриминатор | Конфликт |
|---|---|---|---|
| 1 | `http` (v2) | `version==="2.0" && rawPath:string && rawQueryString:string` | гибрид с httpMethod → v2 |
| 2 | `http` (v1) | `httpMethod:string && path:string && version===undefined` | требует отсутствия version |
| 3 | `mq` | непустой `messages[]` | — |

## Формальные правила валидации v1-события (ядро → INVALID, опционал → tolerant)

| Поле | Ядро (INVALID при нарушении) | Опционал (tolerant) |
|---|---|---|
| httpMethod / path | string | — |
| headers / queryStringParameters | `Record<string,string>` | — |
| body | string | — |
| isBase64Encoded | boolean | — |
| requestContext | object | — |
| requestContext.identity.sourceIp / .userAgent | string | — |
| requestContext.httpMethod / requestId / requestTime | string | — |
| requestContext.requestTimeEpoch | number | — |
| url | — | if present: string; absent → `""` |
| multiValueHeaders / multiValueQueryStringParameters | — | if present: `Record<string,string[]>`; absent → `{}` |
| params / multiValueParams / pathParams | — | if present: record (строки / строки-массивы); absent → `{}` |
| operationId | — | if present: string; absent → `""` |
| неизвестные поля | — | передаются через index signature |

> Диагностика value-free: «expected field "requestContext.identity.sourceIp" to be a string» и т.п., без значений (FR-008).

## Маппинг адаптера (подтверждён наблюдением)

| Канонический поле (v2-формы) | Источник из v1 |
|---|---|
| version | `"2.0"` (внутренняя форма) |
| rawPath | `path` |
| rawQueryString | `url`-суффикс после `?` (без хвостового `?` для пустой query); fallback: serialize(qsp ∪ mvs) |
| headers | `headers` |
| queryStringParameters | `queryStringParameters` |
| multiValueParameters | `multiValueQueryStringParameters` если непусто, иначе `multiValueParams` (эвиденс: повторы приходят в mvs; mvp всегда `{}`) |
| pathParameters | `pathParams` |
| parameters | `params` |
| body / isBase64Encoded | verbatim |
| requestContext.requestId | `requestContext.requestId` |
| requestContext.time | `requestContext.requestTime` |
| requestContext.timeEpoch | `requestContext.requestTimeEpoch` |
| requestContext.http.method / .path | `httpMethod` / `path` |
| requestContext.http.sourceIp / .userAgent | `identity.sourceIp` / `identity.userAgent` |