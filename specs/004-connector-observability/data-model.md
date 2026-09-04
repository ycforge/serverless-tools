# Data Model: 004-connector-observability

Домен — per-invocation наблюдаемость `@ycforge/nestjs-connector`. Модель отражает сущности и их атрибуты БЕЗ деталей реализации (формат данных контрактов — `contracts/observability.md`).

## Entities

### TraceContext (расширение `YandexExecutionContext`)

Per-invocation идентичность вызова, доступная приложению через `@YandexContext()`.

- `trace_id: string` — идентификатор корреляции вызова; **значение равно `awsRequestId`** (clarify Q1→A). Присутствует всегда, не секрет.
- (наследует) `awsRequestId`, `functionName`, `functionVersion`, `functionFolderId`, `memoryLimitInMB`, `deadlineMs`, `logGroupName`, опц. `uberTraceId`, `token` (секрет → `REDACTED_TOKEN`), `raw`/`rawEvent` (escape hatches, исключаются из сериализации).

**Правила**:
- `trace_id` изолирован между вызовами через invocation scope: значение вызова N недоступно в N+1 (FR-004).
- `toJSON()` включает `trace_id` наряду с существующей редaction: `token → REDACTED_TOKEN`, `raw`/`rawEvent` отсутствуют (FR-003).

### BoundaryLogRecord

Структурированная запись лога, которую connector пишет в `stdout` (FR-005..011). Одно полное свойство на строку.

- `event: "start" | "finish" | "error"` — тип границы инвокации (FR-006).
- `trace_id: string` — корреляция вызова (всегда в пределах scope).
- `awsRequestId?: string` — дубликат корреляции; отсутствует у bootstrap-ошибок без runtime-контекста (edge case 1).
- `transport?: "http" | "message-queue"` — заявивший транспорт; отсутствует на фатальных границах до детекции.
- `status?: number` — HTTP-статус ответа (для HTTP finish) ИЛИ число успешно доставленных сообщений (для MQ finish) (FR-006).
- `durationMs?: number` — >= 0, время от start до finish/error (FR-006).
- `code?: string` — стабильный код `ConnectorError` для ошибок границы (FR-007).
- `errorClass?: string` — имя/класс ошибки приложения, БЕЗ текста/stack trace (FR-007).
- `message?: string` — только безопасный структурный текст (без значений payload).

**Инварианты**:
- Минимум 2 записи на инвокацию в scope: start + finish|error (FR-006).
- Запись никогда не содержит: `token`, header/body значения, фрагменты payload, `raw`/`rawEvent`, текст исключений (FR-009, §6.2).
- Записи одного вызова имеют одинаковый `trace_id` и `awsRequestId` (FR-006, SC-003).
- Строка атомарна: конкурентные вызовы не перемешивают байты одной записи (FR-011).
- Writer fail-open: ошибка записи не влияет на результат вызова (FR-010).

### LoggerProviderEntry (лог приложения через `YandexLogger`)

Запись, порождаемая application-кодом через провайдер (FR-012..015).

- `level: "debug" | "info" | "warn" | "error"` — уровень вызова пользователя.
- `trace_id?`, `awsRequestId?` — подставляются провайдером из invocation scope автоматически; вне scope отсутствуют, запись не падает (FR-013).
- `message: string` — сообщение пользователя.
- `context?: unknown` — пользовательские поля; проходят через редакцию §6.2 (FR-014): ключи `token`/`authorization`/`cookie`/`raw`/`rawEvent` редактируются/исключаются.
- `timestamp` — время записи (техническое поле).

**Правила**: провайдер инжектируется через Nest DI (FR-012); fail-open и построчная атомарность — как у boundary-лога (FR-015).

### ErrorEnvelope (расширение HTTP error-конверта)

Детерминированный HTTP error-ответ (FR-016..018).

- `statusCode: number` — 4xx/5xx (last-resort 500, mapped exception-filter, 404 not-found).
- `message: string` — текст тела (сохранение существующего).
- `trace_id: string` — корреляция вызова (добавляется; не перезаписывает user-`trace_id`, если фильтр уже вернул такой ключ).

**Инварианты**:
- `trace_id` добавляется ТОЛЬКО в error-ответы (error-путь dispatch): success-конверт spec 001 (`{statusCode,headers,body,isBase64Encoded}`) не меняется (FR-016 vs success).
- Mapped exception-filter: `statusCode` и существующее тело не модифицируются — только дополнение ключа `trace_id` (FR-017).
- Никаких значений запроса в envelope кроме `statusCode`/`message`/`trace_id` (FR-018).
- MQ-транспорт error-конвертов не формирует (FR-019).

## Relationships

```text
Invocation
 ├── YandexExecutionContext (trace_id = awsRequestId)  ← провайдер/контекст
 ├── BoundaryLogRecord start / finish | error          ← вывод в stdout
 └── ErrorEnvelope (HTTP error-путь)                    ← ответ клиенту
        └── trace_id = тот же
```

- `trace_id` — единый ключ корреляции для контекста, всех записей лога и error-конвертов одного вызова (SC-003).
- ProviderEntry связан с Invocation опционально (вне scope — без trace_id).

## State transitions (жизненный цикл инвокации в логе)

```text
[детекция] --UNKNOWN--> error(trace_id?=raw)         (фатальная граница, до scope)
   |
[getApplication] --bootstrap fail--> error(trace_id?)  (edge case 1)
   |
[buildContext -> scope]
   |--> start(event=start, trace_id, transport)
   |      |
   |      +--[invoke success]--> finish(event=finish, status, durationMs)
   |      +--[invoke error]----> error(event=error, code|errorClass, durationMs)
```

Вне scope провайдер пишет без `trace_id` (US4/AC2) — переход `[module/bootstrap] --> ProviderEntry(trace_id absent)`.