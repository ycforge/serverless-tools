# Research: 004-connector-observability

Все NEEDS CLARIFICATION из Technical Context закрыты (подход провайдера/субpath/логирования). Решения ниже — основание для Phase 1. Evidence — реализация `packages/nest-bridge` после spec 003 (коммит 0681b67 + последующие).

## R1. `trace_id` = `awsRequestId` (FR-001..004)

- **Decision**: новое поле `YandexExecutionContext.trace_id: string`, значение равно обязательно присутствующему `awsRequestId` из raw context (`src/context/build-yandex-execution-context.ts:35` — `readRequiredString(source, "awsRequestId")`). Поле включается в `toJSON()` рядом с существующей редракцией (`build-yandex-execution-context.ts:50-70`).
- **Rationale**: clarify Q1→A; `awsRequestId` наблюдается в 97/97 captured-инвокаций (spec 001), всегда строка, не секрет — отдельная редакция не нужна. Поле аддитивно: существующие read-сценарии не ломаются.
- **Alternatives**: independent `trace_id` из `uberTraceId` (валится на опциональности + W3C-зависимости), только `uberTraceId` (нет fallback) — отвергнуты clarify Q1.

## R2. Structured logger без внешней зависимости (FR-005..011)

- **Decision**: мини-логгер в `src/logger/`: `serializeRecord` производит один JSON-объект, `createLogWriter(sink?)` делает ОДИН `sink.write(line + "\n")` (реализация по умолчанию — `process.stdout.write`), вся запись — в try/catch fail-open (FR-010). `record.ts` описывает `BoundaryLogRecord` (type), поля: `trace_id`, `awsRequestId?`, `transport`, `event: start|finish|error`, `status?`, `durationMs?`, `code?`, `message?` (только для error и безопасного текста).
- **Rationale**: A — тонкий runtime adapter (Constitution I): внешний logger (pino и т.п.) добавил бы runtime-зависимость и конфигурационную поверхность, которых не требует ни spec, ни platform. Одна JSON-линия на запись — нативный формат Cloud Logging/Yandex, парсится платформой без кастомного форматтера. Single `write()` одного буфера не перемешивает байты разных invocations (FR-011) — атомарность записи гарантируется на уровне одного write-вызова; конкурирующие вызовы пишут целиковые строки последовательно.
- **Alternatives**: pino/winston — лишняя зависимость и «магия» конфигурации против Constitution V; мультистрочный вывод — ломает построчный парсинг; `console.log` — неуправляемый формат, нельзя fail-open обернуть потокобезопасно.

## R3. Место логирования boundary — handler, не транспорты (FR-006..008)

- **Decision**: start/finish/error пишет `create-yandex-handler.ts` вокруг `transport.invoke` ВНУТРИ `runInInvocationScope` (после построения executionContext). `status` для finish выводится по `transportId`: для HTTP — `statusCode` возвращённого `YandexFunctionHttpResponse`; для MQ — `batch.messages.length` через `resolveInvocationQueueBatch()` (scope активен). Фатальные границы ДО scope (UNKNOWN_INVOCATION_EVENT, bootstrap-провал) — error-запись с tolerant `trace_id` из raw context (R6).
- **Rationale**: FR-006 требует «минимум 2 записи на инвокацию» с единым `trace_id` — единственная точка (handler) гарантирует это для обоих транспортов, не дублируя логику. Статус finish — «транспортно-специфичный» (сам FR-006), поэтому ветвление по `transportId` допустимо и явно. Фазовый порядок spec 001 (детекция → приложение → контекст → scope) НЕ меняется: context строится на прежнем месте.
- **Alternatives**: логика в каждом транспорте — дублирование start/детекции и рассинхрон записей; лог в middleware — не покрывает детекцию/bootstrap и MQ.

## R4. Tolerant `trace_id` до scope (edge case 1, UNKNOWN)

- **Decision**: отдельный `readInvocationTraceId(rawContext): string | undefined` — читает `awsRequestId` как строку без throw (аналог `readOptionalString` из `build-yandex-execution-context.ts:107-111`). Используется только для error-записей ДО построения scope; поле опускается, если значение недоступно (не падает).
- **Rationale**: bootstrap-провалы (FR-008) и `UNKNOWN_INVOCATION_EVENT` происходят до контекста; strict-построение там кинуло бы ошибку в логгере и нарушило fail-open. «trace_id у каждой записи» опровергнут edge case'ом spec — формат записывает `awsRequestId?`/`trace_id?` опционально.
- **Alternatives**: пробрасывать нехватку id в лог как ошибку — нарушает FR-008/fail-open; пустая строка вместо отсутствия — вводит ложное значение, против «absence is observable».

## R5. `trace_id` в error-конверте — seam на error-пути dispatch (FR-016..018)

- **Decision**: `createResponseFacade()` получает опциональный `attachTraceId(traceId)` (не-enumerable seam). `runDispatch` вызывает его ТОЛЬКО при входе в `invokeErrorLayer` и перед `invokeNotFound`/last-resort. После attach `json(object)`/`send(object)` добавляют `{ trace_id }` в корень объекта ТОЛЬКО если ключ `trace_id` отсутствует (FR-017: не перезаписывать body фильтра). Скалярные body (string/Buffer) не модифицируются. Last-resort 500 и 404 (`writeLastResortResponse`, `respondWithCannotFind`) получают trace_id через тот же attach перед `json`.
- **Rationale**: merge ограничен error-путём dispatch и защищает success-конверт spec 001 от изменений. Внедрение на уровне response facade — единственная точка, где Nest exception filters уже записали body; post-merge JSON-строки потребовал бы парсинга и ломал бы FR-017. Проверка `hasHeader` не нужна — merge в объект, не header. Статус фильтра не трогается (записан до attach).
- **Alternatives**: модифицировать `serializeResponse` глобально (добавил бы trace_id и в успешные ответы — нарушение FR-016); патчить body после ошибки через парсинг `bodyPayload` (FR-017-риск); перехват на уровне адаптера (размазано по transport).

## R6. Регистрация провайдера через `@Global()` bootstrap-модуль (FR-012)

- **Decision**: `createConnectorBootstrapModule` становится `@Global()` и регистрирует `{ provide: YandexLogger, useClass: YandexLogger }` (DEFAULT scope). `@Global()` делает провайдеры видимыми любому модулю приложения, включая компоненты `AppModule` (контроллеры/сервисы/guards). Class-токен `YandexLogger` — инъекция `constructor(private readonly logger: YandexLogger)`. Экземпляр пишет в stdout по умолчанию; sink инъектируем только внутренне (конструктор принимает опциональный writer, в public API не экспонируется отдельной опцией).
- **Rationale**: провайдеры bootstrap-модуля видны только его собственным компонентам и импортированным-модулям через exports — компоненты `AppModule` (охватываемые через `imports: [appModule]`) НЕ видят провайдеры родителя без `@Global()`. `@Global()` — штатный Nest-механизм без ручной регистрации в каждом модуле (Constitution V: явное, но без магии — глобальность документально зафиксирована).
- **Alternatives**: dynamic module + инжекция в AppModule — интрузивно для пользователя; регистрация через APP-инъекцию контекста (без DI-провайдера) — ломает «инъекция в guards» из FR-012; `useValue` на каждый handler — не нужно, writer потокобезопасен.

## R7. Subpath-export `./logger` (FR-012, package surface)

- **Decision**: новый entry `src/logger/index.ts` → `tsup`: `"logger/index": "src/logger/index.ts"`; `package.json.exports` блока `"./logger": { types, import, require }` по образцу `./auth`/`./queue`/`./context`; root barrel `src/index.ts` добавляет `export { YandexLogger }` (+ type-контракты). Guard-тест `no-root-barrel-import.spec.ts` — `GUARDED_DIRS` += `"logger"`.
- **Rationale**: spec Assumption («расширение корневого barrel и/или subpath-экспорта — уточняется на плане»); конвенция subpath-ов из spec 003/FR-007 уже установлена; `./logger` — точечный срез публичного API провайдера, tree-shaking-friendly; root barrel сохраняет совместимость. Новая зависимость-экспорт аддитивна.
- **Alternatives**: только root barrel — теряется subpath-консистентность (003 декларировал паттерн); `./observability` — имя уже занято смыслом (лог — часть наблюдаемости, но провайдер называется logger); экспорт в `./context` — смешение ответственности контекста и логгера.

## R8. Тестирование stdout (SC-002..006)

- **Decision**: unit-тесты `writer`/`serializeRecord`/`redact` — на инъектируемом sink (массив строк). Интеграционные: `vi.spyOn(process.stdout, "write")` в conformance-тестах — прогон HTTP (11) + MQ (5) фикстур, сбор записей, проверка start/finish, durationMs, status, кодов error, изоляции trace_id между warm-вызовами. Паритетный тест: повторное ожидание конвертов `{statusCode, headers, body, isBase64Encoded}` и списков заголовков для успешных ответов неизменны (spec 001). Отрицательные тесты редакции: в любом собранном record отсутствуют значения `token`, headers/body, фрагменты.
- **Rationale**: spy на `process.stdout` работает и в vitest (stream объект), сохраняет публичную поверхность (никаких test-only export). Conformance-фикстуры уже покрывают 16 трасс — переиспользуются для observability-слоя (traceability SC-002).
- **Alternatives**: test-only экспорт sink'а — расширяет публичный API зря; mock модуля stdout — хрупче относительно ошибок ввода-вывода.

## R9. Провайдер вне invocation scope (FR-013, US4/AC2)

- **Decision**: методы провайдера оборачивают `resolveInvocationExecutionContext()` в try/catch: вне scope (bootstrap, teardown, модульная инициализация) `trace_id`/`awsRequestId` в record просто отсутствуют, запись пишется. `resolveInvocationExecutionContext` кидает (по контракту sec: `src/context/invocation-scope.ts:105-113`) — ловим ровно эту ошибку.
- **Rationale**: spec edge case «вызов вне scope не падает» (US4/AC2) и FR-013 «вне scope поля отсутствуют (не падать)». Единый механизм уже есть (AsyncLocalStorage scope) — не дублируем state.
- **Alternatives**: отдельный флаг «есть scope» в модуле — лишний глобальный state против AGENTS §11.

## R10. Мульти-handler MQ (edge case)

- **Decision**: `trace_id`/`awsRequestId` — одно на всю доставку (из executionContext, строится один раз на вызов). Per-message идентификация — через `messageId` модели `QueueMessage` (`src/mq/message.ts`), без дублирования в лог. finish для MQ — count = `batch.messages.length` (успешно доставлено), независимо от числа handlers (fan-out — деталь dispatch, не транспорта).
- **Rationale**: корреляция по вызову (не по сообщению) соответствует FR-006 «статус = число успешно доставленных сообщений» и edge case'у spec. сообщение-level логи — заявлены провайдером, если пользователь их пишет.
- **Alternatives**: per-message лог — контракт літеральный, превышает FR-006.

## R11. Производительность durationMs

- **Decision**: `performance.now()` (Node 22) — diff между start и finish/error в `invocation-logger.ts`. Запись start — сразу после построения scope; finish — `durationMs = round(now() - startedAt)`.
- **Rationale**: FR-006 требует `durationMs >= 0`; `performance.now()` монотонен и дёшев; hrtime.bigint не нужен (точность ms достаточно).
- **Alternatives**: `process.hrtime.bigint()` — избыточная точность; `Date.now()` — не монотонен (перевод часов).

## Phase 0 output summary

Все unknowns Technical Context закрыты. Решён главный концептуальный вопрос: единый `LogWriter` + единственная точка boundary-логирования в handler + seam `attachTraceId` на error-пути dispatch + `@Global()` провайдер + subpath `./logger`. Нарушений Constitution нет.