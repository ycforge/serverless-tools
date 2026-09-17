# Research: 036 — APIGW HTTP Transport (Phase 0)

**Date**: 2026-09-17

## Исследуемые артефакты

| Артефакт | Что дал |
|---|---|
| `packages/nest-bridge/src/core/transports.ts` | Реестр ровно 2 транспортов: `httpApiGatewayV2Transport`, `createMessageQueueTransport`. Детерминированный порядок и попарная непересекаемость дискриминаторов. |
| `packages/nest-bridge/src/http/adapter.ts` | Дискриминатор v2: `version === "2.0" && typeof rawPath === "string" && typeof rawQueryString === "string"`; `supports()` — O(1), не бросает. `invoke()` → `validateHttpApiGatewayV2Event` → `normalizeHttpRequest` → `YandexHttpAdapter.dispatch`. |
| `packages/nest-bridge/src/http/validate-raw-event.ts` | Валидатор v2 требует `requestContext.http.{method,path,sourceIp,userAgent}` и все поля (46/46-подход). Для v1-события `requestContext.http` отсутствует → прямое переиспользование валидатора невозможно. |
| `packages/nest-bridge/src/http/normalize-request.ts` | Читает `event.requestContext.http.method/sourceIp/userAgent`, `rawPath`, `rawQueryString`, `queryStringParameters`, `multiValueParameters`, `pathParameters`, `headers`, `body`+`isBase64Encoded`, `requestId`; жёстко пишет `httpVersion: "2.0"`. |
| `examples/reference-project/apps/openapi/openapi.yaml` | `x-yc-apigateway-integration: { type: cloud_functions, function_id, service_account_id }`. |
| Deployment 035 (реальный YC) | `GET /users` через шлюз → 502 (`unknownInvocationEvent`); прямой ALB v2.0 `yc invoke` → 200. |

## Эвиденс: захват реальных событий (2026-09-17)

Временный echo-хендлер на `user_service` + `curl` через шлюз; 6 кейсов; боевая версия восстановлена.

**Наблюдаемая форма v1-события (санитизировано):**

```json
{
  "httpMethod": "GET",
  "path": "/users",
  "url": "/users?limit=2&offset=0",
  "headers": { "User-Agent": "...", "X-Request-Id": "..." },
  "multiValueHeaders": { "User-Agent": ["..."] },
  "queryStringParameters": { "limit": "2", "offset": "0" },
  "multiValueQueryStringParameters": { "limit": ["2"], "offset": ["0"] },
  "params": {},
  "multiValueParams": {},
  "pathParams": {},
  "body": "",
  "isBase64Encoded": true,
  "requestContext": {
    "identity": { "sourceIp": "212.220.200.34", "userAgent": "curl/8.19.0-CPRO" },
    "httpMethod": "GET",
    "requestId": "e117d237-a232-47d9-a3df-4c175049f158",
    "requestTime": "17/Sep/2026:04:19:34 +0000",
    "requestTimeEpoch": 1789618774
  }
}
```

**Критичные находки (расхождение с draft-спекой и превратностями документации):**

1. **Имена полей**: НЕ `parameters`/`multiValueParameters` (как в v2-форме), а `params`/`multiValueParams`/`pathParams`. Нет `operationId`.
2. **Нет top-level `time`/`timeEpoch`**: время в `requestContext.requestTime` (human-readable строка) / `requestContext.requestTimeEpoch` (epoch). Нет `time`.
3. **Нет `requestContext.http`**: вместо него `requestContext.identity.{sourceIp, userAgent}` — реальный источник IP/User-Agent (НЕ синтез пустыми строками, как предполагалось для v1).
4. **`url`** — полный target, каноничен для `rawQueryString`; для запроса без query — `"/users?"` (хвостовой `?`, маппится в `""`).
5. `queryStringParameters`/`multiValueQueryStringParameters` присутствуют всегда (пустые объекты при отсутствии query); повторы — в `multiValueQueryStringParameters`.
6. `params`/`multiValueParams`/`pathParams` = `{}` при отсутствии path-параметров.
7. Bodiless GET → `body:""` + `isBase64Encoded:true` (совпадает с политикой v2).
8. **`tag` в query зарезервирован шлюзом** как выбратор версии функции: `/users?tag=a` → 404 «Tag a not found for function …», функция НЕ вызвана. Вне зоны коннектора.
9. `version` отсутствует во всех 6 захватах → дискриминатор v1 требует `version === undefined`.

## Решения Phase 0

1. **Ветка discriminator-а** (FR-001): заявка v1 = `typeof httpMethod === "string" && typeof path === "string" && typeof version === "undefined"`. Гибрид `version:"2.0"+httpMethod` → v2-ветка (US3/AC2).
2. **Валидация (ядро/опционал)** (FR-002/003): ядро (INVALID): `httpMethod`, `path`, `headers`, `queryStringParameters`, `body`, `isBase64Encoded`, `requestContext.{identity.{sourceIp,userAgent}, httpMethod, requestId, requestTime, requestTimeEpoch}`. Опционал (tolerant → `{}`/`""`): `url`, `multiValueHeaders`, `multiValueQueryStringParameters`, `params`, `multiValueParams`, `pathParams`, `operationId`, неизвестные.
3. **Мост-адаптер** (FR-004): маппинг по таблице data-model.md; `rawQueryString` из `url`-query (fallback: serialize); `requestContext.http` синтезируется из `httpMethod`/`path`/`identity` (реальные значения).
4. **`httpVersion`** (FR-005): `normalizeHttpRequest(event, opts?: { httpVersion })`, дефолт `"2.0"`; v1-ветка → `"1.0"`.

## Риски и открытые вопросы

- Строки `params`/`multiValueParams` при наличии path-параметров не захвачены (в `/users` нет path-template). При необходимости уточнить маппинг `parameters`/`multiValueParameters` в canonical на втором захвате w/ path vars; на текущем эвиденсе — verbatim-промап. (roads: параметризованные пути вне reference-проекта, не блокирует.)
- Round-trip `rawQueryString` не гарантирован для экзотических энкодингов; компенсация: `queryStringParameters`/`searchParams` читаются напрямую.
- Fail-safe: если на деплое обнаружится, что формат вдруг другой (v2-shaped) — персонализируем fixture во v2 и спек корректируется (SC-000).