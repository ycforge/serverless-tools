# Feature Specification: unified logger в stdout + `trace_id` в контексте и error-ответе — закрытие gap-ов 10–12 из specs/001

**Feature Branch**: `004-connector-observability`

**Created**: 2026-09-04

**Status**: Draft — greenfield в рамках Project A; закрывает расхождения №10–12 таблицы «Расхождения с IDEA.md» specs/001-connector-reverse

**Input**: Greenfield-spec для Project A (`@ycforge/nestjs-connector`): unified logger в stdout, `trace_id` приложению в execution-контексте и в HTTP error-ответе. Источники требований: `IDEA.md` §2 (пункты «предоставлять unified logger (в вывод stdout) и `trace_id` приложению в контексте»; «маппить ошибки/исключения NestJS (exception filters) в корректный HTTP-ответ в формате API Gateway payload 2.0 (включая статус, тело, `trace_id`)»). Зависимость: spec 001 (reverse-spec, фиксирует отсутствие функциональности: пп. 10–12 таблицы расхождений).

> Аппаратная проверка из specs/001 (код `ycsf-nestjs-connector@0.0.3`): в `src/` нет ни одного упоминания logger (grep по `Logger`/`logger` пуст; README: «the connector itself logs nothing»); поля `trace_id` в контексте нет (есть `awsRequestId`, опциональный `uberTraceId` и gateway `requestId` на `NormalizedHttpRequest`); конверт 500 статический `{"statusCode":500,"message":"Internal server error"}` без `trace_id`. Этот spec описывает, ЧТО должно появиться.

## Clarifications

### Session 2026-09-04

- **Q1 (семантика `trace_id`)** → **вариант A**: `trace_id` — новое поле `YandexExecutionContext`, значение равно `awsRequestId` текущего вызова. `awsRequestId` наблюдается в 97/97 captured-инвокаций и всегда присутствует; W3C/uber-trace-пропагация в `trace_id` не используется (формально закрывает IDEA §2 «trace_id в контексте» без отдельного трейс-правила).
- **Q2 (scope `trace_id` в error-ответах)** → **вариант B**: `trace_id` присутствует во ВСЕХ HTTP error-ответах — last-resort конверт 500, mapped exception-filter 4xx/5xx и 404 not-found. Тела фильтров дополняются без перезаписи (FR-017); затрагивает тесты http-failure-semantics.
- **Q3 (поверхность logging)** → **вариант B**: boundary-события connector-а (start/finish/error) ПЛЮС публичный logger-провайдер для application-кода через Nest DI (уровни debug..error, структурированные записи в stdout с автоматическим `trace_id`/`awsRequestId`). Публичная поверхность пакета расширяется; редакция §6.2 применяется и к провайдеру.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Разработчик получает `trace_id` для сквозной корреляции (Priority: P1)

Каждая инвокация (HTTP или MQ, холодная или тёплая) имеет стабильный в пределах вызова идентификатор трассировки `trace_id`. Разработчик получает его как поле `YandexExecutionContext.trace_id` в `@YandexContext()`, а также в структурированных записях лога connector-а и в теле HTTP error-ответов. Сквозная корреляция работает: по одному `trace_id` можно восстановить лог запроса от входа connector-а до ошибки/ответа и связать его с вызовом в Yandex Cloud Functions logs.

**Why this priority**: `trace_id` — фундамент наблюдаемости; без него нельзя связать логи connector-а, лог приложения и платформенные логи в одну историю вызова. Logger-а и error-response-корреляции без него просто нечем связывать.

**Independent Test**: unit-тест инвокации: `@YandexContext()`-параметр имеет `trace_id`; значение идентично в записях лога одного вызова и НЕ повторяется между разными вызовами (изоляция через invocation scope, как в spec 001 FR-009).

**Acceptance Scenarios**:

1. **Given** любой валидный вызов (HTTP или MQ), **When** выполняется пользовательский код, **Then** `YandexExecutionContext` содержит строковое непустое поле `trace_id` со значением, равным `awsRequestId` текущего вызова (clarify Q1 → A: новое поле, дублирующее `awsRequestId`).
2. **Given** горячий последовательный вызов, **When** выполняется вызов N+1, **Then** `trace_id` вызова N+1 отличается от `trace_id` вызова N (данные вызова N недоступны в N+1 — изоляция invocation scope сохраняется).
3. **Given** `JSON.stringify(context)`, **When** сериализуется контекст, **Then** `trace_id` присутствует в сериализованном виде НАРЯДУ с существующей редакцией `token → REDACTED_TOKEN`; `raw`/`rawEvent` по-прежнему исключаются (расширение spec 001 FR-029 без нарушения редакции).

---

### User Story 2 — Connector пишет структурированные boundary-логи в stdout (Priority: P1)

Connector при каждом вызове пишет в `stdout` структурированные записи о границах инвокации: начало вызова, завершение (status/duration/transport) и ошибки границы — каждая запись несёт `trace_id` и `awsRequestId`. Разработчик получает связную картину вызовов в платформенных логах без ручной инструментации. Application-код данную фичу не трогает: логи добавляются connector-ом, а не приложением.

**Why this priority**: «unified logger (в вывод stdout)» — прямое требование IDEA §2 и gap №10; это основное содержимое фичи. Наблюдаемость boundary-сбоев (кодов `ConnectorError`) — ключевая польза: иначе провалы валидации/детекции видны только как голые ошибки облака.

**Independent Test**: conformance-тест: прогон известной HTTP/MQ-фикстуры перехватывает вывод `stdout` и проверяет наличие записей начала и завершения с `trace_id`, `status`/`duration`, `transport`; для ошибочного вызова — запись ошибки с кодом `ConnectorError`.

**Acceptance Scenarios**:

1. **Given** успешный HTTP-вызов, **When** завершается инвокация, **Then** в `stdout` появляются минимум две структурированные записи — начало и завершение вызова — с одинаковым `trace_id`, `awsRequestId`, `transport: "http"`, `status` (HTTP-статус ответа) и `durationMs` (>= 0).
2. **Given** успешная MQ-доставка, **When** завершается обработка, **Then** записи начала/завершения содержат `transport: "message-queue"`, `trace_id` и `awsRequestId`, а поле статуса — число успешно доставленных сообщений (не HTTP-код).
3. **Given** вызов отклоняется границей (`ConnectorError` c кодом `UNKNOWN_INVOCATION_EVENT`), **When** инвокация завершается ошибкой, **Then** в `stdout` появляется запись уровня error с `code` этого кода и тем же `trace_id`/`awsRequestId`.
4. **Given** приложение бросает необработанное исключение, **When** HTTP-вызов завершается конвертом 500, **Then** в `stdout` появляется запись error с `trace_id`, без stack trace/текста исключения и без значений payload (соблюдается редакция, как в spec 001 §6.2).

---

### User Story 3 — HTTP error-ответы несут `trace_id` для поддержки клиентов (Priority: P2)

Когда HTTP-запрос завершается ошибкой (mapped через exception filters или last-resort конверт), тело ответа содержит `trace_id`, по которому клиент/поддержка/разработчик может указать именно этот вызов в логах. Правило применяется ко ВСЕМ HTTP error-ответам (last-resort 500, mapped 4xx/5xx из exception filters, 404 not-found); добавление `trace_id` не нарушает существующие маппинги exception filters и обещание «нет эха значений запроса».

**Why this priority**: заявлено в IDEA §2 («включая статус, тело, `trace_id`») и это gap №12; ценно для поддержки, но не блокирует US1–US2 (лог и контекст уже дают корреляцию).

**Independent Test**: HTTP-тест: выполнить запрос, приводящий к 4xx/5xx (mapped фильтром и last-resort), проверить наличие `trace_id` в JSON-теле и его идентичность со значением `@YandexContext()` того же вызова.

**Acceptance Scenarios**:

1. **Given** необработанное приложением исключение (нет сформированного фильтрами ответа), **When** connector возвращает last-resort конверт 500, **Then** тело имеет вид `{"statusCode":500,"message":"Internal server error","trace_id":"<id>"}` с `trace_id` текущего вызова.
2. **Given** ошибка, сформированная NestJS exception filter-ом (например, BadRequest 400), **When** возвращается ответ, **Then** тело ответа дополняется `trace_id` текущего вызова, а фильтр/статус/остальное тело НЕ изменяются.
3. **Given** любой HTTP error-ответ — last-resort 500, mapped 4xx/5xx из exception filters или 404 not-found, **When** возвращается ответ, **Then** тело содержит `trace_id` текущего вызова; у mapped-ответов сохраняются статус и тело фильтра (clarify Q2 → B).

---

### User Story 4 — Application code логгирует через предоставленный logger-провайдер (Priority: P2)

Разработчик инжектирует logger-провайдер connector-а в свои сервисы/контроллеры/guards через Nest DI и пишет структурированные записи (уровни debug..error). Каждая запись автоматически несёт `trace_id` и `awsRequestId` текущего вызова (из invocation scope) и пишется в `stdout` той же структурной политикой, что и boundary-логи connector-а — приложение получает единый «unified logger» из IDEA §2, не заботясь о том, как собрать префикс корреляции.

**Why this priority**: расширение из clarify Q3 → B; заявка на «unified logger» как публичный API. Boundary-логи (US2) уже дают наблюдаемость; провайдер добавляет наблюдаемость приложения с той же корреляцией, но не является самодостаточным MVP.

**Independent Test**: интеграционный тест с инъекцией провайдера в сервис приложения: вызов метода, логирующего на уровне info/warn/error; записи перехватываются из `stdout` и содержат `trace_id`/`awsRequestId` текущего вызова.

**Acceptance Scenarios**:

1. **Given** провайдер инжектирован в сервис приложения, **When** сервис логирует сообщение на уровне `info`, **Then** в `stdout` появляется структурированная запись с этим уровнем, переданными сообщением/контекстом, `trace_id` и `awsRequestId` текущего вызова.
2. **Given** вызов вне invocation scope (например, bootstrap/модульная инициализация), **When** сервис логирует, **Then** запись пишется без `trace_id`/`awsRequestId` (поля отсутствуют, не падает).
3. **Given** application-код передаёт в logger значение, которое connector считает секретом (например, IAM `token` из контекста), **When** запись сериализуется, **Then** `token` редактируется до `REDACTED_TOKEN` (редакция §6.2 распространяется на провайдер).

---

### Edge Cases

- Холодный старт завершился ошибкой инициализации приложения: ошибка обязана попасть в `stdout` (запись error), но `awsRequestId`/`trace_id` при недоступности runtime-контекста отсутствуют — формат записи допускает их отсутствие у bootstrap-ошибок (опровергает требование «trace_id у каждой записи»).
- Вызов, не заявленный ни одним транспортом (`UNKNOWN_INVOCATION_EVENT`), не имеет контекста приложения; `trace_id` = `awsRequestId`, если значение доступно из runtime-контекста (иначе поле опускается, как у bootstrap-ошибок); лог-запись уровня error пишется в любом случае.
- Пустой массив `messages: []` (не MQ-вызов → `UNKNOWN_INVOCATION_EVENT`): лог-запись error присутствует.
- MQ с несколькими `@QueueHandler()`: `trace_id`/`awsRequestId` один для всей доставки, одинаковый во всех записях; per-message идентификация остаётся по `messageId` существующей модели.
- Logger обязан НЕ логировать: IAM `token`, значения headers/body, фрагменты payload, `raw`/`rawEvent`, stack trace/text исключений приложения, текст диагностики `ConnectorError` не содержит значений (обеспечивается на уровне вызова logger-а).
- Потокобезопасность: инвокации в одном runtime выполняются конкурентно; записи разных вызовов в `stdout` должны быть атомарными построчно (не перемешаны) — `trace_id` внутри каждой строки неразрывно связан со своей записью.
- Вызовы провайдера вне invocation scope (bootstrap, модульная инициализация, teardown): `trace_id`/`awsRequestId` отсутствуют в записи (поля опускаются), запись не падает (US4/AC2).
- Переполнение/ошибка самого logger-а не должна менять результат инвокации: сбой записи в `stdout` не роняет транспортный результат (fail-open).

## Requirements *(mandatory)*

### Functional Requirements

Trace ID:

- **FR-001**: THE CONNECTOR SHALL предоставлять per-invocation строковый `trace_id` равным `awsRequestId` текущего вызова (значение из runtime-контекста: `awsRequestId` наблюдается в 97/97 captured-инвокаций, поле всегда присутствует; clarify Q1 → A) (`IDEA §2`, gap №11).
- **FR-002**: THE CONNECTOR SHALL предоставлять `trace_id` приложению как поле `YandexExecutionContext`, доступное через `@YandexContext()` для обоих транспортов (HTTP и MQ).
- **FR-003**: THE CONNECTOR SHALL включать `trace_id` в `toJSON()` контекста наряду с существующей редакцией `token → REDACTED_TOKEN`, `raw`/`rawEvent` — исключёнными (не нарушая spec 001 FR-029).
- **FR-004**: THE CONNECTOR SHALL изолировать `trace_id` между вызовами через invocation scope: значение вызова N SHALL NOT наблюдаться в вызове N+1 (spec 001 FR-009).

Logger:

- **FR-005**: THE CONNECTOR SHALL писать структурированные boundary-логи в `stdout` (единственный sink; платформа собирает stdout в логи функции) — подключение внешних sink-ов вне scope (`IDEA §2`, gap №10).
- **FR-006**: THE CONNECTOR SHALL писать минимум две записи на инвокацию — начало и завершение — каждая с `trace_id` и `awsRequestId`; завершение SHALL содержать `durationMs` и транспортно-специфичный статус (для HTTP — HTTP-статус ответа, для MQ — число успешно доставленных сообщений) (US2/AC1–AC2).
- **FR-007**: WHEN инвокация завершается ошибкой, THE CONNECTOR SHALL писать запись уровня error: для `ConnectorError` — с его стабильным `code`; для ошибки приложения — только с классом/именем ошибки, БЕЗ текста исключения, stack trace и значений payload (clarify Q3 → B; подробные детали приложения логгируются самим приложением через провайдер, US4) (US2/AC3–AC4).
- **FR-008**: WHEN инициализация приложения на холодном старте провалилась, THE CONNECTOR SHALL писать запись error bootstrap-ошибки; при недоступности runtime-контекста запись SHALL допускать отсутствие `trace_id`/`awsRequestId` (US2, edge case 1).
- **FR-009**: THE LOGGER SHALL NOT логировать секреты и значения: IAM `token`, значения headers/body, `raw`/`rawEvent`, фрагменты payload, текст исключений приложения; редакция SHALL быть консистентна с `toJSON()` контекста (IDEA §2 + AGENTS.md §6.2; parity с spec 001 FR-029/SC-005).
- **FR-010**: THE LOGGER SHALL быть fail-open: сбой записи в `stdout` SHALL NOT изменять транспортный результат инвокации.
- **FR-011**: THE CONNECTOR SHALL писать записи атомарно построчно, не смешивая записи конкурентных инвокаций (edge case stream safety).

Logger provider (application interface):

- **FR-012**: THE CONNECTOR SHALL предоставлять logger-провайдер, доступный приложению через Nest DI (инъекция в контроллеры/сервисы/guards) для обоих транспортов (HTTP и MQ) (clarify Q3 → B).
- **FR-013**: THE PROVIDER SHALL поддерживать уровни debug..error и писать структурированные записи в `stdout` единой структурной политикой; каждая запись SHALL автоматически нести `trace_id`/`awsRequestId` текущего вызова из invocation scope; вне invocation scope эти поля SHALL отсутствовать (не падать) (US4/AC1–AC2).
- **FR-014**: THE PROVIDER SHALL применять редакцию §6.2: секреты (IAM `token`, значения headers/body, `raw`/`rawEvent`) SHALL редактироваться/исключаться и в записях провайдера (US4/AC3).
- **FR-015**: THE PROVIDER SHALL быть fail-open и атомарным построчно, как boundary-лог (FR-010, FR-011).

Error response:

- **FR-016**: THE CONNECTOR SHALL включать `trace_id` во ВСЕ детерминированные HTTP error-ответы: последняя инстанция last-resort конверт 500, mapped exception-filter 4xx/5xx и 404 not-found (clarify Q2 → B; gap №12, US3).
- **FR-017**: WHEN `trace_id` добавляется в mapped-ответы, THE CONNECTOR SHALL NOT изменять statusCode и существующее тело исключения/фильтра — только дополнение без перезаписи (`trace_id` не переопределяет user-поля) (US3/AC2–AC3).
- **FR-018**: THE ERROR ENVELOPE SHALL NOT содержать никаких значений запроса (headers, body, credentials) кроме `statusCode`/`message`/`trace_id`; поведение зафиксировано spec 001 FR-017 (edge case 5).
- **FR-019**: THE MQ transport SHALL NOT формировать HTTP-конверт для error-ответа (MQ-сбои видны только через fail-fast propagation и лог); `trace_id`-механика в MQ ограничивается контекстом и логом (spec 001 FR-026).

### Key Entities

- **TraceId**: стабильный строковый per-invocation идентификатор корреляции; значение равно `awsRequestId` текущего вызова (clarify Q1 → A); единый для контекста, лога и error-ответа одного вызова.
- **BoundaryLogEntry**: структурированная запись лога (`trace_id`, `awsRequestId`?, `transport`, `type`/`event` — `start`/`finish`/`error`, `durationMs`, статус, для ошибок — `code`); пишется connector-ом в stdout.
- **LoggerProvider**: публичный logger-провайдер для application-кода через Nest DI; уровни debug..error; структурированные записи в stdout с автоматическим `trace_id`/`awsRequestId` из invocation scope и редакцией §6.2 (US4; clarify Q3 → B).
- **ErrorEnvelope**: детерминированный HTTP error-конверт (`statusCode`, `message`, `trace_id`); last-resort 500 — расширение существующей формы spec 001 FR-017.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Каждый acceptance scenario US1–US3 покрыт минимум одним выполняемым тестом; выполнение `pnpm --filter @ycforge/nestjs-connector test` зелёное (traceability, Constitution II).
- **SC-002**: 100% валидных инвокаций (HTTP + MQ) дают минимум начало и завершение в `stdout` с одинаковым `trace_id` и `awsRequestId`; тест перехватывает stdout conformance-фикстур (HTTP-фикстуры 11 из 11, MQ-фикстуры 5 из 5).
- **SC-003**: `trace_id` одинаков (1:1) в контексте, во всех записях лога и в error-конвертах одного вызова; для горячих последовательных вызовов тест изоляции подтверждает различие значений (данные N не видны в N+1).
- **SC-004**: Ни одна запись лога и ни один error-конверт не содержат значений payload (token, headers, body, фрагменты) — автоматический проверочный тест редакции на conformance-выводах (расширение spec 001 SC-005).
- **SC-005**: ВСЕ error-конверты HTTP-транспорта (last-resort 500, mapped 4xx/5xx, 404 not-found) содержат `trace_id` в 100% случаев; mapped-ответы фильтров сохраняют статус и тело — паритетный тест на conformance-фикстурах (clarify Q2 → B).
- **SC-006**: Интеграционный тест инъекции провайдера в приложение подтверждает: записи провайдера несут `trace_id`/`awsRequestId` вызова, уровни debug..error работают, `token` редактируется; вызов вне invocation scope не падает (US4, FR-012..015).

## Assumptions

- `awsRequestId` наблюдается в 100% captured-инвокаций (spec 001, 97/97) — `trace_id` переиспользует его напрямую (clarify Q1 → A); W3C-пропагация через `uberTraceId` остаётся как есть (observability-поле), в `trace_id` не участвует.
- `stdout` — единственный sink лога; платформенный сбор логов (Cloud Logging) делегируется инфраструктуре, connector не форматирует для неё специальные поля.
- Редакция логов/ответов консистентна с существующей редакцией `toJSON()` (spec 001 FR-029): никакое значение, запрещённое к логированию в контексте, не появляется в логе.
- Logger-провайдер для application-кода ВХОДИТ в фичу (clarify Q3 → B); под публичным API подразумевается расширение корневого barrel и/или соответствующего subpath-экспорта (`/context`? — уточняется на плане), с сохранением совместимости существующей поверхности spec 001/003.
- Требования оставляют поведение spec 001 нетронутым: транспортная детекция, нормализация, dispatch, fail-fast MQ-семантика, конверт `{statusCode,headers,body,isBase64Encoded}` для успешных ответов.
- Зависимость: spec 001 (только); с spec 003 (auth) общий changefile не предполагается, но `trace_id`-механика должна согласованно работать с global guard-ом (guard-сбои — это error-путь, покрытый FR-007).

## Точки неоднозначности (для clarify)

| # | Место | Проблема | Влияние на 004 |
|---|-------|----------|----------------|
| 1 | §2, gap №11 (001) | Какое значение является `trace_id`: переиспользовать `awsRequestId` напрямую (самый дешёвый, cross-transport id уже есть — 97/97), независимое поле `trace_id` с правилом приоритет—`uberTraceId` trace-segment → fallback `awsRequestId` (более «настоящий» W3C-стиль трейс-пропагации), либо только `uberTraceId` без fallback | **РЕШЕНО 2026-09-04**: вариант A — `trace_id` дублирует `awsRequestId` (FR-001) |
| 2 | §2, gap №12 (001) | Какие HTTP error-ответы несут `trace_id`: только last-resort конверт 500 (минимальный wire change), или также mapped 404 not-found и все 4xx/5xx из exception filters (полная корреляция для клиентов, но меняет контракт фильтров и требует аккуратного дополнения тела) | **РЕШЕНО 2026-09-04**: вариант B — все error-ответы (FR-016, FR-017) |
| 3 | §2, gap №10 (001) | Поверхность logging: boundary-события только (start/finish/error) как минимальный v1, или также публичный логер-провайдер приложению (инъекция в Nest DI, уровни debug..error, политика структурности) как заявка на «unified logger» из IDEA §2 | **РЕШЕНО 2026-09-04**: вариант B — boundary-события + публичный провайдер (FR-005..011, FR-012..015) |