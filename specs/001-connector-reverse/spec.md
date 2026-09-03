# Feature Specification: YCSF Connector — reverse specification существующей реализации

**Feature Branch**: `001-connector-reverse`

**Created**: 2026-09-03

**Status**: Brownfield — документ описывает ФАКТИЧЕСКОЕ поведение существующего кода, а не желаемое

**Input**: Reverse-specification для Project A (`@ycforge/ycsf-nestjs-connector`), исходный код: https://github.com/ycforge/ycsf-nestjs-connector (версия 0.0.3, снятие состояния 2026-09-03). Все ссылки вида `path:line` указывают на файлы этого репозитория. Код будет мигрирован в данную монорепу в `packages/nest-bridge`; эта монорепа — исходный код инструментов YCSF (nest-bridge, composer, pilot), а не деплоимое приложение.

> Это REVERSE spec: требования (EARS) сформулированы по наблюдаемому поведению кода и подтверждены его тестами/фикстурами. Раздел «Расхождения с IDEA.md» в конце фиксирует, где код расходится с архитектурным замыслом.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — HTTP-запрос через API Gateway payload 2.0 доходит до NestJS controller и обратно (Priority: P1)

Разработчик NestJS-приложения экспортирует `handler = createYandexHandler(AppModule)`. Yandex Cloud Function вызывает handler с событием API Gateway формата 2.0; connector детектирует HTTP-транспорт, валидирует событие, нормализует запрос, прогоняет его через стандартный NestJS pipeline (middleware → route → guards/pipes/interceptors/filters) и возвращает ответ в формате payload 2.0.

**Why this priority**: это основной сценарий использования пакета; без него пакет бесполезен.

**Independent Test**: вызвать handler с фикстурой `fixtures/http/*.json` против тестового NestJS-приложения и проверить структуру ответа `{statusCode, headers, body, isBase64Encoded}` (покрыто `src/http/conformance-fixtures.spec.ts`).

**Acceptance Scenarios**:

1. **Given** холодное окружение и событие с `version: "2.0"`, **When** вызывается handler, **Then** NestJS-приложение инициализируется один раз, запрос доходит до подходящего controller-метода, а ответ сериализуется в конверт payload 2.0 (`src/core/create-yandex-handler.ts:100-128`, `src/http/serialize-response.ts:15-58`).
2. **Given** уже тёплое окружение, **When** приходит следующее HTTP-событие, **Then** приложение НЕ пересоздаётся — переиспользуется закэшированный `INestApplication` (`src/core/create-yandex-handler.ts:76-98`).
3. **Given** событие с `isBase64Encoded: true` и бинарным body, **When** выполняется нормализация, **Then** body декодируется из Base64 в `Uint8Array` без порчи данных, решение принимается только по `isBase64Encoded`, не по `Content-Type` (`src/http/normalize-request.ts:54-58`).
4. **Given** handler возвращает `Buffer`, **When** сериализуется ответ, **Then** body кодируется в Base64 с `isBase64Encoded: true` (`src/http/serialize-response.ts:23-26`).
5. **Given** handler выставил несколько значений одного header (например, `Set-Cookie`), **When** сериализуется ответ, **Then** повторные значения уходят в поле `multiValueHeaders`, а одиночные — в плоский `headers` (`src/http/serialize-response.ts:30-42`).

---

### User Story 2 — MQ trigger доставка доходит до `@QueueHandler()`-методов (Priority: P1)

Приложение регистрирует provider/controller с методом `@QueueHandler()`. Событие вида `{messages: [...]}` детектируется MQ-транспортом, нормализуется в `QueueBatch`, и каждое сообщение последовательно доставляется КАЖДОМУ обнаруженному handler-методу (fan-out) с инъекцией `@QueueMessage()` и `@YandexContext()`.

**Why this priority**: второй транспорт пакета, заявлен как primary use case.

**Independent Test**: вызвать handler с фикстурой `fixtures/mq/*.json` и проверить, что handler получил нормализованное сообщение с сохранёнными `body`, `attributes`, `messageAttributes`, `raw` (покрыто `src/mq/conformance-fixtures.spec.ts`, `src/mq/handler-dispatch.spec.ts`).

**Acceptance Scenarios**:

1. **Given** событие с непустым массивом `messages` с envelope-фингерпринтом, **When** вызывается handler, **Then** событие валидируется, нормализуется в batch и каждый `@QueueHandler()`-метод получает каждое сообщение последовательно в порядке доставки (`src/mq/adapter.ts:58-81`, `src/mq/dispatch.ts:233-247`).
2. **Given** в приложении нет ни одного `@QueueHandler()`, **When** приходит валидная MQ-доставка, **Then** вызов завершается ошибкой `ConnectorError` с кодом `NO_QUEUE_HANDLER` (`src/mq/dispatch.ts:238-240`).
3. **Given** handler читает `message.payload` при валидном JSON body, **When** происходит первое чтение, **Then** payload вычисляется один раз (lazy + memoized) стратегией strict-JSON (`src/mq/body-deserialization.ts:53-76`).
4. **Given** body не является валидным JSON и используется дефолтная стратегия, **When** handler читает `message.payload`, **Then** бросается `ConnectorError` с кодом `QUEUE_BODY_DESERIALIZATION_FAILED` без включения фрагментов body в сообщение (`src/mq/body-deserialization.ts:24-30`).
5. **Given** handler бросает исключение, **When** dispatch обрабатывает batch, **Then** весь вызов функции завершается этой ошибкой, последующие сообщения batch НЕ обрабатываются, ранее успешные не повторяются — для срабатывания retry/DLQ со стороны Yandex Message Queue (`src/mq/dispatch.ts:228-231`).

---

### User Story 3 — Доступ к нормализованному execution context через `@YandexContext()` (Priority: P2)

Код приложения (controller или queue handler) получает единый `YandexExecutionContext` с runtime-метаданными (`awsRequestId`, `functionName`, `functionVersion`, `functionFolderId`, `memoryLimitInMB`, `deadlineMs`, `logGroupName`, опциональные `token`, `uberTraceId`) и escape hatches `rawEvent`/`raw`.

**Why this priority**: сквозная возможность для обоих транспортов, но не самостоятельный сценарий — работает внутри P1-потоков.

**Independent Test**: инжектировать `@YandexContext()` в handler и проверить значения полей и `toJSON()`-редакцию токена (покрыто `src/context/*.spec.ts`).

**Acceptance Scenarios**:

1. **Given** любой валидный вызов (HTTP или MQ), **When** выполняется пользовательский код, **Then** `@YandexContext()`-параметр получает контекст текущего вызова, изолированный через AsyncLocalStorage — данные вызова N недоступны в вызове N+1 (`src/context/invocation-scope.ts:55-68`).
2. **Given** runtime context содержит IAM `token`, **When** контекст сериализуется через `JSON.stringify`, **Then** токен заменяется на `REDACTED_TOKEN`, а `raw`/`rawEvent` исключаются (`src/context/build-yandex-execution-context.ts:50-70`).
3. **Given** обязательное поле контекста нарушает наблюдаемый тип (например, `memoryLimitInMB` — не строка), **When** строится контекст, **Then** вызов падает с value-free диагностикой (имя поля и ожидаемый тип), значения никогда не коэрсятся (`src/context/build-yandex-execution-context.ts:87-105`).

---

### User Story 4 — Детерминированная обработка граничных и ошибочных вызовов (Priority: P2)

События, которые не распознаёт ни один транспорт, и события, прошедшие детекцию, но невалидные структурно, отклоняются явными ошибками границы с машиночитаемыми кодами — до инициализации приложения или до запуска пользовательского кода.

**Why this priority**: корректность failure semantics критична для retry-логики платформы, но это защитный слой поверх P1-сценариев.

**Independent Test**: вызвать handler с `null`, массивом, `{}`, объектом без фингерпринтов; проверить коды `UNKNOWN_INVOCATION_EVENT` / `INVALID_INVOCATION_EVENT` (покрыто `src/core/create-yandex-handler.spec.ts`, `src/http/http-failure-semantics.spec.ts`).

**Acceptance Scenarios**:

1. **Given** событие, которое не заявил ни один транспорт, **When** вызывается handler, **Then** бросается `ConnectorError` с кодом `UNKNOWN_INVOCATION_EVENT` ДО инициализации NestJS, диагностика содержит только имена полей верхнего уровня (макс. 20), без значений (`src/core/detect-transport.ts:20-60`).
2. **Given** событие заявлено транспортом, но не проходит глубокую структурную валидацию, **When** выполняется `invoke`, **Then** бросается `ConnectorError` с кодом `INVALID_INVOCATION_EVENT` и `transportId` заявившего транспорта (`src/http/validate-raw-event.ts:19-35`, `src/core/connector-error.ts:62-68`).
3. **Given** cold start завершился ошибкой Nest-инициализации, **When** приходит следующий вызов, **Then** инициализация повторяется с нуля — проваленный cold start не кэшируется; все конкурентные вызовы одного cold start наблюдают одну и ту же ошибку (`src/core/create-yandex-handler.ts:90-95`).
4. **Given** HTTP-handler бросил необработанное исключение, **When** Nest exception layer не сформировал ответ, **Then** возвращается статический непрозрачный конверт 500 `{"statusCode":500,"message":"Internal server error"}` без stack trace и текста исключения (`src/http/dispatch-pipeline.ts:141-153`).

---

### User Story 5 — Управление жизненным циклом и teardown (Priority: P3)

Среды, требующие корректного освобождения ресурсов (тесты, custom runtimes), вызывают `handler.close()`, который закрывает закэшированное приложение; следующий вызов выполняет cold start заново.

**Why this priority**: вспомогательная возможность; на реальном рантайме Yandex Cloud Functions teardown не гарантирован и не требуется.

**Independent Test**: вызвать handler, затем `close()`, затем handler снова; проверить повторную инициализацию и идемпотентность `close()` (`src/core/create-yandex-handler.ts:130-140`).

**Acceptance Scenarios**:

1. **Given** handler ни разу не вызывался, **When** вызывается `close()`, **Then** операция завершается успешно как no-op (идемпотентность).
2. **Given** идёт инициализация приложения, **When** вызывается `close()`, **Then** `close()` дожидается in-flight инициализации и освобождает приложение.

---

### Edge Cases

- Пустое body при `isBase64Encoded: true` (типичный GET) → `body: null` в нормализованном запросе (`src/http/normalize-request.ts:54-58`).
- Повторные query-параметры доступны в двух несмешиваемых представлениях: `queryStringParameters` (comma-joined) и `multiValueParameters` (массивы) — оба verbatim (`src/http/normalize-request.ts:37-38`).
- `HEAD` без явного HEAD-route → fallback на GET-handler (`src/http/dispatch-pipeline.ts:110-119`).
- Route pattern вне поддерживаемого подмножества (regex/optional-параметры, wildcard не в конце) → `ConnectorError` `UNSUPPORTED_ROUTE_PATTERN` на cold start, при регистрации (`src/http/path-matching.ts:95-132`).
- Пустой массив `messages: []` → событие НЕ заявляется MQ-транспортом → `UNKNOWN_INVOCATION_EVENT` (`src/mq/adapter.ts:52-54`).
- Платформенные возможности, не имеющие смысла в Functions (`listen`, `useStaticAssets`, `setViewEngine`, `render`, `enableCors`, `applyVersionFilter`), падают с явной ошибкой при попытке использования (`src/http/yandex-http-adapter.ts:76-118`).
- Custom `deserializeBody` через `options.queue`: возвращаемое значение (включая `undefined`) становится `payload`; ошибки стратегии пробрасываются verbatim (`src/core/handler-options.ts:10-18`, `src/mq/body-deserialization.ts:53-76`).

## Requirements *(mandatory)*

### Functional Requirements

Транспортная детекция и границы:

- **FR-001**: WHEN вызывается handler, THE SYSTEM SHALL ровно один раз определить транспорт по дешёвому детерминированному дискриминатору, опрашивая зарегистрированные адаптеры в фиксированном порядке (HTTP первым, MQ вторым) (`src/core/transports.ts:21-26`).
- **FR-002**: WHEN ни один транспорт не заявил событие, THE SYSTEM SHALL отклонить вызов `ConnectorError` с кодом `UNKNOWN_INVOCATION_EVENT` до любой инициализации приложения; диагностика SHALL содержать только имена полей, не значения.
- **FR-003**: WHEN транспорт заявил событие, THE SYSTEM SHALL выполнить глубокую структурную валидацию наблюдаемого контракта; при нарушении SHALL отклонить вызов кодом `INVALID_INVOCATION_EVENT` до запуска пользовательского кода.
- **FR-004**: THE SYSTEM SHALL предоставлять класс `ConnectorError` со стабильными кодами (`UNKNOWN_INVOCATION_EVENT`, `INVALID_INVOCATION_EVENT`, `UNSUPPORTED_ROUTE_PATTERN`, `NO_QUEUE_HANDLER`, `QUEUE_BODY_DESERIALIZATION_FAILED`) как единственный дискриминатор граничных ошибок; ошибки приложения SHALL пробрасываться verbatim, без обёртывания (`src/core/errors.ts:30-35`).

Жизненный цикл приложения:

- **FR-005**: THE SYSTEM SHALL инициализировать NestJS-приложение лениво при первом вызове через `NestFactory.create(AppModule, YandexHttpAdapter)` + `init()` и переиспользовать его при всех warm-вызовах.
- **FR-006**: THE SYSTEM SHALL гарантировать race-safe cold start: конкурентные первые вызовы разделяют один initialization promise.
- **FR-007**: WHEN cold start провалился, THE SYSTEM SHALL НЕ кэшировать провал и повторять инициализацию при следующем вызове.
- **FR-008**: THE SYSTEM SHALL предоставлять идемпотентный `handler.close()`, освобождающий закэшированное приложение; автоматические shutdown hooks SHALL отсутствовать.
- **FR-009**: THE SYSTEM SHALL изолировать данные вызовов через AsyncLocalStorage invocation scope; никакое invocation-specific состояние SHALL NOT храниться в module-level singleton.

HTTP-транспорт (API Gateway payload 2.0):

- **FR-010**: THE SYSTEM SHALL детектировать HTTP-событие по `version === "2.0"` + строковым `rawPath`/`rawQueryString` (`src/http/adapter.ts:29-39`).
- **FR-011**: THE SYSTEM SHALL использовать `rawPath` и `rawQueryString` как каноническое представление URI и SHALL NOT восстанавливать URI из `requestContext.http.path` (`src/http/normalize-request.ts:29-46`).
- **FR-012**: THE SYSTEM SHALL сохранять `queryStringParameters` (comma-joined) и `multiValueParameters` (списки) рядом, без взаимной конвертации.
- **FR-013**: THE SYSTEM SHALL декодировать body строго по `isBase64Encoded`, никогда не угадывая по `Content-Type`; пустое body SHALL представляться как `null`; декодирование SHALL быть binary-safe.
- **FR-014**: THE SYSTEM SHALL прогонять запрос через записанный при cold start стек слоёв (body parser → middleware → routes → not-found/error proxies), сохраняя семантику NestJS guards/pipes/interceptors/exception filters, не реализуя её заново (`src/http/yandex-http-adapter.ts:48-66`, `src/http/dispatch-pipeline.ts:131-238`).
- **FR-015**: THE SYSTEM SHALL парсить JSON body только для `Content-Type: application/json*`; невалидный JSON SHALL маппиться через error layer в детерминированный ответ 400 (`src/http/dispatch-pipeline.ts:57-82`).
- **FR-016**: THE SYSTEM SHALL сериализовать ответ в конверт `{statusCode, headers, body, isBase64Encoded}`; `Buffer` SHALL кодироваться в Base64; повторные значения headers SHALL выноситься в `multiValueHeaders`; неявные `Content-Type` (`application/json`, `text/plain; charset=utf-8`, `application/octet-stream`) SHALL применяться только при отсутствии явного (`src/http/response-facade.ts:67-69`).
- **FR-017**: WHEN необработанное исключение не преобразовано exception filters в ответ, THE SYSTEM SHALL вернуть статический конверт 500 `{"statusCode":500,"message":"Internal server error"}` без stack trace, текста исключения и эха значений запроса.
- **FR-018**: THE SYSTEM SHALL поддерживать подмножество path patterns: статические сегменты, `:param`, tail wildcards; всё остальное SHALL отклоняться с `UNSUPPORTED_ROUTE_PATTERN` на cold start (`src/http/path-matching.ts:11-34`).

MQ-транспорт:

- **FR-019**: THE SYSTEM SHALL детектировать MQ-событие по непустому массиву `messages`, каждый элемент которого несёт фингерпринт `event_metadata` + `details.queue_id` + `details.message.message_id` (`src/mq/adapter.ts:46-56`, `src/mq/adapter.ts:95-118`).
- **FR-020**: THE SYSTEM SHALL нормализовывать доставку в `QueueBatch` (всегда массив, batch-capable), сохраняя `body`, checksums, system attributes verbatim (строки остаются строками), message attributes как `{dataType, stringValue}` без декодирования значений (`src/mq/normalize-batch.ts:43-120`).
- **FR-021**: THE SYSTEM SHALL доставлять КАЖДОЕ сообщение КАЖДОМУ методу `@QueueHandler()` последовательно в порядке доставки; возвращаемые значения handlers SHALL игнорироваться (`src/mq/dispatch.ts:233-247`).
- **FR-022**: THE SYSTEM SHALL резолвить экземпляры handlers через DI один раз на сообщение в едином DI sub-tree (REQUEST-scoped providers — новые на сообщение, согласованные между handlers; DEFAULT — singletons; TRANSIENT — обновляются) (`src/mq/dispatch.ts:249-275`).
- **FR-023**: THE SYSTEM SHALL поддерживать параметры `@QueueMessage()` (текущее сообщение) и `@YandexContext()` в handler-методах; недекорированные позиции получают `undefined` (`src/mq/dispatch.ts:297-317`).
- **FR-024**: WHEN в приложении нет ни одного `@QueueHandler()`, THE SYSTEM SHALL отклонить валидную доставку кодом `NO_QUEUE_HANDLER`.
- **FR-025**: THE SYSTEM SHALL вычислять `QueueMessage.payload` лениво при первом доступе с мемоизацией; дефолтная стратегия SHALL быть strict-JSON, при невалидном body SHALL бросать `QUEUE_BODY_DESERIALIZATION_FAILED` без фрагментов body в диагностике.
- **FR-026**: WHEN handler или десериализация падают, THE SYSTEM SHALL завершить весь вызов этой ошибкой (fail-fast, any-failure = retry всего batch); сообщения после первого сбоя SHALL NOT обрабатываться; успешная доставка SHALL резолвиться нормализованным `QueueBatch`, не HTTP-конвертом.
- **FR-027**: THE SYSTEM SHALL позволять заменить стратегию десериализации body через `options.queue.deserializeBody`; ошибки custom-стратегии SHALL пробрасываться verbatim (`src/core/handler-options.ts:10-18`).

Контекст и декораторы:

- **FR-028**: THE SYSTEM SHALL предоставлять `YandexExecutionContext` с полями `awsRequestId`, `functionName`, `functionVersion`, `functionFolderId`, `memoryLimitInMB` (строка, без коэрсии), `deadlineMs`, `logGroupName`, опциональными `token`, `uberTraceId` и escape hatches `rawEvent`/`raw`; контекст SHALL быть одинаковым для обоих транспортов (`src/context/yandex-execution-context.ts:12-77`).
- **FR-029**: THE SYSTEM SHALL редактировать `token` до `REDACTED_TOKEN` и исключать `raw`/`rawEvent` при `JSON.stringify` контекста.
- **FR-030**: THE SYSTEM SHALL экспортировать публичный API только через корневую точку входа пакета: `createYandexHandler`, `ConnectorError`, `YandexContext`, `QueueHandler`, `QueueMessage` и type-only контракты (`src/index.ts:15-65`; `package.json` exports: только `"."`).

### Key Entities

- **RawHttpApiGatewayV2Event**: сырое событие API Gateway payload 2.0; валидируется структурно, никогда не мутируется.
- **NormalizedHttpRequest**: нормализованный запрос (`method`, `path`, `rawQueryString`, `searchParams`, обе query-view, `pathParameters`, `headers`, `body: Uint8Array | null`, `sourceIp`, `userAgent`, `requestId`, `raw`).
- **YandexFunctionHttpResponse**: проводной конверт ответа (`statusCode`, `headers`, опциональный `multiValueHeaders`, `body`, `isBase64Encoded`).
- **RawQueueEvent / QueueBatch / QueueMessage\<T\>**: сырая доставка → нормализованный batch → сообщение (`messageId`, `md5OfBody`, `body`, `attributes`, `messageAttributes`, `md5OfMessageAttributes`, `queueId`, `eventMetadata`, lazy `payload`, `raw`).
- **YandexExecutionContext**: нормализованный runtime-контекст вызова (см. FR-028).
- **ConnectorError / ConnectorErrorCode**: граничная ошибка и её стабильные коды.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Все 11 HTTP-фикстур и 5 MQ-фикстур из `fixtures/` проходят end-to-end через публичный API с ожидаемыми конвертами/батчами (conformance suite).
- **SC-002**: Ни один из наблюдаемых runtime-фактов (rawPath-каноничность, comma-joined query, base64-флаг, string-тип `memoryLimitInMB`) не нарушается — каждый покрыт regression-тестом.
- **SC-003**: Данные вызова N не наблюдаются в вызове N+1 (тесты изоляции invocation scope проходят при повторных warm-вызовах).
- **SC-004**: Проваленный MQ-вызов никогда не возвращает успешный результат — retry/DLQ-семантика платформы наблюдает отказ в 100% случаев handler-ошибок.
- **SC-005**: Ни одна диагностика границы не содержит значений payload (headers, body, токенов) — проверяется value-free форматом сообщений `ConnectorError`.

## Assumptions

- Runtime-контракты Yandex Cloud (payload 2.0, MQ trigger shape, context fields) зафиксированы по наблюдениям (97 захваченных вызовов, DATA-ANALYSE.md репозитория) и могут измениться платформой — connector валидирует строго и падает loudly.
- Peer-зависимости: `@nestjs/common`, `@nestjs/core` ^11; Node.js >= 22.
- Текущий MQ trigger доставляет по одному сообщению, но модель намеренно batch-capable.
- Пакет не занимается deployment, Terraform, конфигурацией API Gateway, provisioning — это вне границ по дизайну.

---

## Расхождения с IDEA.md

Проверка каждого пункта раздела 2 («Что умеет A») и раздела 11 («@RequireAuth») IDEA.md против кода `ycsf-nestjs-connector@0.0.3`. Ссылки — на файлы репозитория Project A.

| # | Требование IDEA.md | Статус | Детали и ссылки |
|---|---|---|---|
| 1 | Запуск/reuse NestJS application в Cloud Function | **есть** | Ленивый bootstrap + кэш + race-safe + retry после провала: `src/core/create-yandex-handler.ts:74-98` |
| 2 | Адаптация HTTP invocation из API Gateway payload 2.0 | **есть** | `src/http/adapter.ts`, `src/http/normalize-request.ts` |
| 3 | Адаптация Message Queue invocation | **есть** | `src/mq/adapter.ts` |
| 4 | Поддержка queue handlers | **есть** | `src/mq/dispatch.ts` |
| 5 | `@QueueHandler()` и `@QueueMessage()` | **есть** | `src/mq/queue-handler.decorator.ts:30-39`, `src/mq/queue-message.decorator.ts:28-45` |
| 6 | Нормализация single/batch queue messages | **есть** | Всегда batch-модель: `src/mq/normalize-batch.ts:43-53` |
| 7 | Unified execution context с runtime metadata/raw event через `@YandexContext()` | **есть** | `src/context/yandex-execution-context.ts`, `src/context/yandex-context.decorator.ts:25-42` |
| 8 | Стандартный NestJS lifecycle (guards, pipes, interceptors, filters, decorators, middleware, DI) | **есть** | Replay записанных Nest-прокси: `src/http/dispatch-pipeline.ts:131-238`; DI через warm-контейнер: `src/mq/dispatch.ts:249-275`. Оговорка: `enableCors`, `useStaticAssets`, view engine, controller versioning — явно не поддерживаются (`src/http/yandex-http-adapter.ts:96-118`) |
| 9 | Переиспользование приложения между warm invocations | **есть** | `src/core/create-yandex-handler.ts:76-98` |
| 10 | Unified logger (в stdout) | **ОТСУТСТВУЕТ** | В `src/` нет ни одного упоминания logger (grep по `Logger`/`logger` пуст); README явно фиксирует: «the connector itself logs nothing». Никакого logger-провайдера приложению не предоставляется |
| 11 | `trace_id` приложению в контексте | **ОТЛИЧАЕТСЯ** | Поля `trace_id` нет. Есть `awsRequestId` (как cross-transport correlation id, `src/context/yandex-execution-context.ts:21`) и опциональный `uberTraceId` (`src/context/yandex-execution-context.ts:48-53`). Для HTTP есть также `requestId` gateway на `NormalizedHttpRequest` (`src/http/normalized-request.ts:65-66`). Требуется решение: достаточно ли `awsRequestId`/`uberTraceId` или нужен отдельный `trace_id` |
| 12 | Маппинг ошибок NestJS (exception filters) в HTTP-ответ payload 2.0 «включая статус, тело, `trace_id`» | **ОТЛИЧАЕТСЯ** | Статус и тело маппятся корректно через Nest exception layer + last-resort 500 (`src/http/dispatch-pipeline.ts:92-104, 141-153`; `src/http/serialize-response.ts`). Но `trace_id` в тело ошибки НЕ включается: конверт 500 статический `{"statusCode":500,"message":"Internal server error"}` (`src/http/dispatch-pipeline.ts:103`) |
| 13 | Batch MQ error semantics: по умолчанию any-failure = retry всего batch | **есть** | Fail-fast propagation: `src/mq/dispatch.ts:228-247`; README «Failure semantics» §3 |
| 14 | Batch MQ error semantics: опциональный per-message partial-failure response | **ОТСУТСТВУЕТ** | Единственная опция транспорта — `deserializeBody` (`src/core/handler-options.ts:10-18`); partial-failure отчётности нет; ack/delete/retry counters/DLQ management сознательно отсутствуют (README «Failure semantics») |
| 15 | `@RequireAuth(scheme, guard)` decorator | **ОТСУТСТВУЕТ** | Ни декоратора, ни metadata `ycsf:auth:guard`/`ycsf:auth:scheme`, ни `ApiSecurity`-интеграции в коде нет (grep пуст) |
| 16 | Global guard с делегированием по metadata `ycsf:auth:guard` (method > controller) | **ОТСУТСТВУЕТ** | Никакой регистрации глобального guard в `createYandexHandler` нет; runtime-применение auth-guard не реализовано |
| 17 | Subpath exports: `.../auth`, `.../queue`, `.../context` | **ОТСУТСТВУЕТ** | `package.json` exports содержит только `"."`; весь публичный API идёт через корневой barrel `src/index.ts`. Приложение не может импортировать auth/queue/context контракты точечно, не поднимая весь connector |

### Дополнительные наблюдения (не противоречия, но отличия от духа IDEA.md)

- IDEA.md не требует, а код предоставляет: `handler.close()`, кастомный `deserializeBody`, строгую структурную валидацию событий с `INVALID_INVOCATION_EVENT`, запрет route patterns вне подмножества (`UNSUPPORTED_ROUTE_PATTERN`). Это расширения, не конфликты.
- Авторизация по IDEA.md раздела 2 («Authentication») остаётся в обычных NestJS Guard приложения — это совместимо с текущим кодом (lifecycle guards работает), но заявленный в разделе 11 контракт `@RequireAuth` + global guard отсутствует целиком (пп. 15–17).
