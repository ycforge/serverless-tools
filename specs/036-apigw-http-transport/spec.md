# Feature Specification: HTTP transport для события Yandex API Gateway (`cloud_functions`), закрытие гэпа «шлюз → функция = 502»

**Feature Branch**: `036-apigw-http-transport`

**Created**: 2026-09-17

**Status**: Draft — внутри Project A (`packages/nest-bridge`); расширяет существующий HTTP-транспорт вторым discriminator-адаптером.

**Input**: Reference-проект (spec 024, ветка `035-cloud-deployable-reference`) развёрнут в реальном Yandex Cloud: API Gateway → Cloud Function `user_service`. Запрос через шлюз `GET /users` возвращает **HTTP 502**, тогда как прямой `yc serverless function invoke --d-format=json` с ALB v2.0-событием (`version:"2.0"`, `rawPath`, `requestContext.http`) возвращает 200 `{"users":["alice","bob"]}`. Причина: `createBuiltinTransports()` (packages/nest-bridge/src/core/transports.ts) регистрирует только два транспорта — `http` (событие API Gateway v2.0/ALB: `version === "2.0"` + `rawPath`) и `message-queue` (`messages[]`). Yandex API Gateway доставляет в функцию через интеграцию `x-yc-apigateway-integration: cloud_functions` **другой** формат события (v1): верхнеуровневые `httpMethod`, `path`, `url`, `headers`, `queryStringParameters`, `body`, `isBase64Encoded`, `requestContext`, без поля `version`. Ни один transport не заявляет это событие → `ConnectorError.unknownInvocationEvent` → 502.

> Аппаратная проверка: `createYandexHandler`/`createBuiltinTransports` → ровно два транспорта (`transports.ts`, `detect-transport.ts`); discriminator `http`-транспорта требует `version === "2.0"` (`adapter.ts:34-38`). Событие реального шлюза (формат v1) этим discriminator-ом не заявляется — подтверждено 502 в deployment 035.
>
> **Эвиденс (захват реальных событий 2026-09-17)**: временный echo-хендлер в `user_service` + `curl` через шлюз `d5dh7d6flrd3cm28mrle.nnekmrav.apigw.yandexcloud.net`; получено 6 событий (базовый GET, GET с query, `a=`, `x=%20`). Наблюдаемая форма (санитизированный дамп — fixture в этом спеке, T002):
>
> ```json
> {
>   "httpMethod": "GET",
>   "path": "/users",
>   "url": "/users?limit=2&offset=0",
>   "headers": { "User-Agent": "...", "X-Request-Id": "..." },
>   "multiValueHeaders": { "User-Agent": ["..."] },
>   "queryStringParameters": { "limit": "2", "offset": "0" },
>   "multiValueQueryStringParameters": { "limit": ["2"], "offset": ["0"] },
>   "params": {},
>   "multiValueParams": {},
>   "pathParams": {},
>   "body": "",
>   "isBase64Encoded": true,
>   "requestContext": {
>     "identity": { "sourceIp": "212.220.200.34", "userAgent": "curl/8.19.0-CPRO" },
>     "httpMethod": "GET",
>     "requestId": "e117d237-a232-47d9-a3df-4c175049f158",
>     "requestTime": "17/Sep/2026:04:19:34 +0000",
>     "requestTimeEpoch": 1789618774
>   }
> }
> ```
>
> Ключевые факты: **нет** `version`, `operationId`, `parameters`/`multiValueParameters` (реальные имена — `params`/`multiValueParams`/`pathParams`); `requestContext` использует `identity` + `requestTime`/`requestTimeEpoch` (не top-level `time`/`timeEpoch`, не `http`); `url` содержит полный target (для запроса без query — `"/users?"` с хвостовым `?`); bodiless GET → `body:""` + `isBase64Encoded:true`. API Gateway резервирует query-параметр `tag` как выбратор версии функции (`/users?tag=a` → 404 «Tag a not found for function …» на уровне шлюза, функция не вызывается) — вне зоны коннектора.

## Clarifications

### Session 2026-09-17 — решения по механике (подтверждены clarify)

> Подтверждено пользователем: строгое ядро + толерантный опционал; `httpVersion` = честный `"1.0"` через аддитивную параметризацию `normalizeHttpRequest`; работа продолжается на ветке 035 (единый PR e2e, спека 036 — отдельный каталог).

- Q: Один транспорт заявляет обе HTTP-фигуры или новый отдельный transport id? → A (вариант A): расширяем существующий `httpApiGatewayV2Transport` (id `"http"`) вторым OR-ветвлением discriminator-а: заявка при `httpMethod: string && path: string && version === undefined`. Обоснование: обе фигуры — это plain-HTTP входящие функции; семантика транспорта (`"http"`, boundaryStatus, logging) одна; отдельный id плодил бы дублирующую нормализацию. Дискриминаторы остаются попарно непересекающимися (v2 требует `version:"2.0"`; APIGW-ветка требует ОТСУТСТВИЕ `version`; MQ требует `messages[]`).
- Q: Жёсткий валидатор «все поля параноидально обязательны» (как для v2: 46/46 полей) или толерантность к опциональным полям? → A (вариант B): строгость к обязательному ядру, толерантность к опционалу. Ядро (обязательно, иначе `INVALID_INVOCATION_EVENT`): `httpMethod`, `path`, `headers`, `queryStringParameters`, `body`, `isBase64Encoded`, `requestContext.{identity.{sourceIp,userAgent}, httpMethod, requestId, requestTime, requestTimeEpoch}` — все по наблюдённым типам. Опционал (отсутствие НЕ ошибка): `url`, `multiValueHeaders`, `multiValueQueryStringParameters`, `params`, `multiValueParams`, `pathParams`, `operationId`, неизвестные аддитивные поля. Отсутствующий опционал нормализуется в `{}`/`""`. Обоснование: поля реального шлюза (эвиденс выше); требовать не-наблюдаемые поля — выдуманный контракт.
- Q: `requestContext.http` у APIGW-события отсутствует (это слой ALB), а `normalizeHttpRequest` читает `requestContext.http.{method,sourceIp,userAgent}` и жёстко пишет `httpVersion:"2.0"`. → A: параметризуем `normalizeHttpRequest(raw, { httpVersion })` (аддитивно, дефолт `"2.0"` — обратная совместимость); APIGW-ветка синтезирует канонический вид: `requestContext.http := {method: httpMethod, path, sourceIp: identity.sourceIp, userAgent: identity.userAgent}` (реальные значения из `identity`), `httpVersion: "1.0"` — честная метка wire-формата.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Маршрут за API Gateway отвечает 200 (Priority: P1)

Разработчик развернул OpenAPI-спецификацию с `x-yc-apigateway-integration: { type: cloud_functions }` (как в reference-project `apps/openapi/openapi.yaml`). Пользователь вызывает составной маршрут через шлюз — `GET https://<gw>.apigw.yandexcloud.net/users`. Шлюз доставляет в функцию событие v1 (`httpMethod`/`path`); nest-bridge заявляет его HTTP-транспортом, конвертирует в канонический вид и передаёт в NestJS-приложение как обычный HTTP-запрос со статусом 200. Раньше такой вызов упирался в 502.

**Why this priority**: это объявленная цель роадмап-спеки 024/reference-проекта («API Gateway → function работает»); без этого транспорта e2e через шлюз невозможно (только прямой ALB v2-вызов).

**Independent Test**: e2e на real deployment: `curl -i https://d5dh7d6flrd3cm28mrle.nnekmrav.apigw.yandexcloud.net/users` → `HTTP/1.1 200` с телом `{"users":["alice","bob"]}`; плюс unit: проигрывание captured-fixture через `createYandexHandler` (минимальное Nest-приложение с `GET /users`) даёт `{statusCode:200}`.

**Acceptance Scenarios**:

1. **Given** развёрнутый reference-project (шлюз + функция `user_service` версии с новым транспортом), **When** выполняется `GET /users` через шлюз, **Then** ответ `200` и тело `{"users":["alice","bob"]}`.
2. **Given** captured fixture v1-события, поданное в `createYandexHandler`, **When** обработано, **Then** transport claimed `"http"`, приложение получило `method === "GET"`, `path === "/users"`, `sourceIp`/`userAgent` из `requestContext.identity`, `requestId` из `requestContext.requestId`.
3. **Given** fixture с `?limit=2&offset=0`, **When** обработано, **Then** `queryStringParameters` идентичен пришедшему, `searchParams.get('limit') === '2'`, повторы в `multiValueParameters` не слиты.
4. **Given** body-событие (JSON, `isBase64Encoded: false`), **When** обработано, **Then** тело декодировано как UTF-8 и доступно приложению (переиспользование `decodeEventBody`).

---

### User Story 2 — Прямой вызов тем же событием возможен и через `yc invoke` (Priority: P1)

Разработчик отлаживает функцию вне шлюза: берёт ровно то же тело события (httpMethod/path, без `version`), которое шлёт реальный шлюз, и вызывает `yc serverless function invoke user-service --data-file <event.json>`. Результат совпадает с результатом через шлюз. Это же тело — основание fixture (эвиденс зафиксирован в репозитории как reconstructed с provenance).

**Why this priority**: дешёвый feedback-цикл без шлюза и честный RED→GREEN-тест на этапе реализации (fixture из реального захвата; ядро тестируется без dependency на облако).

**Independent Test**: `yc serverless function invoke user-service --data-file packages/nest-bridge/fixtures/http-apigw/get-without-query.json` → `200 {"users":["alice","bob"]}` (без `unknownInvocationEvent`).

**Acceptance Scenarios**:

1. **Given** файл-fixture с реальным v1-событием (без `version`, с `httpMethod`), **When** прямой `yc serverless function invoke`, **Then** `200` без `ConnectorError.unknownInvocationEvent`.
2. **Given** событие с повторами query-параметров (`multiValueQueryStringParameters`), **When** invoke/us1-тест, **Then** обработка успешна, повторы сохраняются в `multiValueParameters` (не слиты в одно значение).

---

### User Story 3 — Fail-fast не ослаблен; чужие события по-прежнему отвергаются (Priority: P2)

Разработчик коннектора гарантирует, что добавление второй ветки discriminator-а не «просадило» контракт: события, которые НЕ являются ни HTTP-событием (v2 или APIGW-v1), ни MQ-событием, по-прежнему завершаются `ConnectorError.unknownInvocationEvent`; событие с `version:"2.0"`, имеющее и `httpMethod`, заявляется ТОЛЬКО v2-веткой (детерминизм). P2: критично для регрессий в 024/goldens и в 001–003.

**Why this priority**: деградация fail-fast — это ломка контракта A; новые типы событий должны оставаться «шумными» ошибками, а не тихим 200.

**Independent Test**: unit-таблица дискриминатора: v2 → `"http"` (v2-правила); APIGW-v1 → `"http"` (api-v1-правила); гибрид `version:"2.0"+httpMethod` → v2-ветка; MQ → `"mq"`; `{}`/массив/`null` → `UNKNOWN`; диагностика value-free.

**Acceptance Scenarios**:

1. **Given** событие `{version:"2.0", rawPath, rawQueryString, requestContext.http,...}` (v2-шаблон), **When** detect, **Then** claimed transport id `"http"`, нормализация по v2-правилам (без изменений существующего поведения).
2. **Given** событие `{version:"2.0", httpMethod, path}` (гибрид), **When** detect, **Then** заявлен v2-веткой; APIGW-ветка не претендует (требует `version === undefined`).
3. **Given** не-объект / массив / `null` / `{}`, **When** detect, **Then** `UNKNOWN`, диагностика без значений (как до изменения).
4. **Given** событие `{messages:[...]}` (MQ), **When** detect, **Then** заявлен MQ-транспортом, HTTP-транспорт не вмешивается.

### Edge Cases

- Событие без query: `url: "/users?"`, `queryStringParameters: {}`, `multiValueQueryStringParameters: {}` — адаптер отдаёт `rawQueryString: ""`.
- Bodiless GET: `body:""` + `isBase64Encoded:true` → тело коллапсируется в `null` (тот же вырожденный путь, что в v2 — без выдумывания Content-Type).
- Повторные query-параметры: `queryStringParameters` — comma-joined (по факту шлюза), `multiValueQueryStringParameters` — списки; ОБА остаются непристыкованными (unmerged), как в v2 (AGENTS section 4.3).
- `tag`-кваери резервируется шлюзом для выбора версии функции → 404 на уровне шлюза, функция не вызывается; ВНЕ зоны коннектора (документируется, никакого кода).
- `requestContext.identity` может не быть, если событие пришло не от шлюза (например, прямой `yc invoke` с неполным событием) — если `httpMethod`+`path` присутствуют, событие заявляется, но `sourceIp`/`userAgent` → `""` (ядро требует `identity`? НЕТ: core требует identity.{sourceIp,userAgent}; событие без identity → INVALID, НЕ синтез. Уточнение: строгость ядра распространяется на identity — реальный шлюз его всегда шлёт).
- Поля `params`/`multiValueParams`/`pathParams` при отсутствии path-template-переменных = `{}` (наблюдаемо); при наличии — verbatim.
- `x-request-id` / `traceparent` / `x-envoy-*` в заголовках — простые пары `{string:string}`; мульти-значений no (в `multiValueHeaders` дубли) — передаются как есть.
- `requestTime` — human-readable строка, а не ISO; `requestTimeEpoch` — число. Контекст сохраняет оба (метаданные для `@YandexContext`; парсить календарно-строку НЕ требуется).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: THE HTTP TRANSPORT (`httpApiGatewayV2Transport`, id `"http"`) SHALL заявлять событие Yandex API Gateway `cloud_functions` v1 WHEN `httpMethod` — строка И `path` — строка И `version === undefined` (IDEA §2; дискриминатор-ветка 2, ортогональная v2-ветке и MQ; AGENTS §10: дешёвый, детерминированный, без side-effects, не бросает).
- **FR-002**: WHEN выполняется структурная валидация v1-события, THE VALIDATOR SHALL требовать ядро: `httpMethod: string`, `path: string`, `headers: Record<string,string>`, `queryStringParameters: Record<string,string>`, `body: string`, `isBase64Encoded: boolean`, `requestContext: object` с `identity: {sourceIp: string, userAgent: string}`, `requestContext.httpMethod: string`, `requestContext.requestId: string`, `requestContext.requestTime: string`, `requestContext.requestTimeEpoch: number` (эвиденс 6/6 захватов; нарушение → `INVALID_INVOCATION_EVENT(id:"http")`, value-free).
- **FR-003**: THE VALIDATOR SHALL NOT требовать опциональные поля: `url`, `multiValueHeaders`, `multiValueQueryStringParameters`, `params`, `multiValueParams`, `pathParams`, `operationId`, неизвестные аддитивные поля; при отсутствии они SHALL нормализовываться в `{}`/`""` (кларификация 2026-09-17, вариан B).
- **FR-004**: THE ADAPTER SHALL мапить v1 в канонический `RawHttpApiGatewayV2Event`: `rawPath := path`; `rawQueryString := url`-query-часть (при наличии `url`) либо сериализация `queryStringParameters`∪`multiValueQueryStringParameters`; `requestContext.http := {method: httpMethod, path, sourceIp: identity.sourceIp, userAgent: identity.userAgent}`; `requestContext.requestId := requestContext.requestId`, `time := requestTime`, `timeEpoch := requestTimeEpoch`; `pathParameters := pathParams`, `parameters := params`, `multiValueParameters := multiValueQueryStringParameters` (при непустом; иначе `multiValueParams` — эвиденс: повторы приходят именно в `multiValueQueryStringParameters`, а `multiValueParams` наблюдаемо пуст) (реальные имена полей — эвиденс); `body`/`isBase64Encoded` — verbatim. Нормализация — существующим `normalizeHttpRequest` (переиспользование, без копипасты проекции).
- **FR-005**: THE NORMALIZER SHALL параметризовать `httpVersion` (аддитивный аргумент `NormalizeHttpRequestOptions.httpVersion`, дефолт `"2.0"`); для v1-события `NormalizedHttpRequest.httpVersion === "1.0"` — реальный формат, не ложная маркировка (кларификация 2026-09-17).
- **FR-006**: THE ROUTING SHALL строиться из `path` + пришедшей query (из `url`/`queryStringParameters`), включая повторы из `multiValueQueryStringParameters`; правило «`rawPath` каноничен» из v2 НЕ переносится (для v1 канон — приходящий `path`/`url`, не синтезированный).
- **FR-007**: THE TRANSPORT REGISTRY order SHALL оставаться `[http, mq]`; дискриминаторы v2/v1/MQ SHALL оставаться попарно непересекающимися (присутствие vs отсутствие `version`; `messages[]`); событие c `version:"2.0"` + `httpMethod` SHALL заявляться v2-веткой (US3/AC2).
- **FR-008**: THE `INVALID_INVOCATION_EVENT`/`UNKNOWN_INVOCATION_EVENT` диагностики SHALL оставаться value-free и совместимыми с существующим контрактом (имена полей/типы, без значений; AGENTS §6.2).
- **FR-009**: THE RESPONSE SHALL формироваться существующим `YandexHttpAdapter` без изменений: приложение отвечает через обычные NestJS-механики; конверсия в `{statusCode, headers, body, isBase64Encoded}` переиспользуется.
- **FR-010**: THE CONNECTOR SHALL NOT изменять MQ-транспорт, контракты `@QueueHandler`, привязку контейнеров, клиентское API, subpath exports и версии контрактов; изменения ограничены `packages/nest-bridge` (Constitution: A owns runtime).
- **FR-011**: THE ПАКЕТ SHALL фиксировать эвиденс: fixture реального v1-события в `packages/nest-bridge/fixtures/` как reconstructed (provenance: «real API Gateway (cloud_functions) capture, spec 036», значения санитизированы); conformance-тесты US1–US3 проигрывают его через публичное API (Test-first: fixture → RED → GREEN).
- **FR-012**: THE DOCS SHALL быть обновлены: `AGENTS.md` (список дискриминаторов), `docs/ARCHITECTURE.md` §4 (registry: порядок, непересекаемость), README-таблица транспортов; расхождение с `IDEA.md` §2 задокументировано (см. «Точки неоднозначности»).

### Key Entities

- **YcApiGatewayEvent** (raw): наблюдаемый формат события `cloud_functions` v1; вербальные поля (включая `url`, `params`, `multiValueParams`, `pathParams`, `requestContext.identity`); index signature для аддитивных полей (AGENTS §36). Новый тип raw-event-слоя.
- **RawHttpApiGatewayV2Event** (canonical internal): по-прежнему каноническая внутренняя фигура, в неё v1-адаптер мапит перед `normalizeHttpRequest`.
- **NormalizedHttpRequest**: неизменный контекст (`@YandexContext`); `httpVersion` параметризуем, дефолт `"2.0"` не меняется.
- **TransportAdapter registry**: `httpApiGatewayV2Transport` (v2 ∪ v1-ветки), `createMessageQueueTransport`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `GET https://d5dh7d6flrd3cm28mrle.nnekmrav.apigw.yandexcloud.net/users` отвечает `HTTP 200` c `{"users":["alice","bob"]}` после редеплоя функции с новым коннектором (US1/AS1; реальный e2e в Yandex Cloud).
- **SC-002**: Прямой `yc serverless function invoke user-service --data-file packages/nest-bridge/fixtures/http-apigw/get-without-query.json` (зеркало реального захвата) → `200`, без `unknownInvocationEvent`/`INVALID` (US2).
- **SC-003**: Fixture v1-события закоммичен в `packages/nest-bridge/fixtures/` c provenance; conformance-тест проигрывает его через публичное API коннектора (FR-011).
- **SC-004**: Табличный unit-тест дискриминатора: v2 → `"http"` (v2-правила), v1 → `"http"` (v1-правила), гибрид `version:"2.0"` → v2-ветка, MQ → `"mq"`, `{}`/массив/`null` → `UNKNOWN`; suite `pnpm --filter @ycforge/nestjs-connector test` зелёный (FR-001/007).
- **SC-005**: Отсутствие регрессий: build всех packages (builders-core/pilot/materializers-core/composer) зелёный; composer-выйхода reference-project не изменяется (FR-010).

## Assumptions

- Реальный API Gateway доставляет v1-событие (`httpMethod`/`path`, без `version`) — **подтверждено 6-ти кратным захватом** (см. Input/эвиденс); fixturы — санитазированная форма этих захватов.
- `x-yc-apigateway-integration: cloud_functions` — единственный тип интеграции шлюз→функция в reference/spec 024; websocket-стеки и исходящий HTTP→MQ вне скоупа (Constitution: HTTP→MQ — интеграция Gateway, не A).
- Serverless Containers/`serverless_containers` integration не требует изменений A (отдельный Docker-path; 404 «no revisions» у контейнера analytics — отдельная история, в этом спеке не решается).
- Изменения ограничены `packages/nest-bridge`; контракты версии, subpath exports, barrel-экспорты A-пакета не меняются; только аддитивная параметризация `httpVersion` с сохранением дефолта.
- Значения в fixtures санитизируются (IP, requestId, timestamps заменены плейсхолдерами); структура и имена полей сохраняются verbatim (правило fixtures README, как в 001–003).

## Точки неоднозначности IDEA.md (для clarify)

- `IDEA.md` §2: «адаптировать HTTP invocation из API Gateway payload 2.0». Реальный API Gateway (cloud_functions) шлёт НЕ payload 2.0, а v1-событие (`httpMethod`/`path`). Поле `httpVersion` оказывается разным для двух входов: `"2.0"` (ALB) и `"1.0"` (API Gateway). Спек вводит параметризацию (FR-005); после merge-а **IDEA.md §2 обновляется** (specs устраняют расхождение).
- Документация YC упоминает имена `params`/`multiValueParams`/`pathParams`; в проекте draft-спеки фигурировали `parameters`/`multiValueParameters` (имена из v2) — эвиденс 6/6 фиксирует реальные имена v1; следуем наблюдению, не документации (explicit-over-magic).
- `url` для запроса без query содержит хвостовой `?` (`"/users?"`) — при адаптации `rawQueryString` = `""` (не `"?"`).