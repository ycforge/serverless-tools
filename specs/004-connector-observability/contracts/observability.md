# Contract: Observability (004)

Область контракта — публичные изменения `@ycforge/nestjs-connector`, вводимые фичей 004. Все изменения аддитивны; поведение spec 001 для успешных ответов и транспортов не меняется.

## 1. `trace_id` в `YandexExecutionContext`

- `YandexExecutionContext.trace_id: string` — идентификатор корреляции вызова. **Значение равно `awsRequestId`** (clarify Q1→A). Поле всегда присутствует.
- `toJSON()` включает `trace_id` наряду с существующей редакцией: `token → REDACTED_TOKEN`, `raw`/`rawEvent` исключены (FR-003).
- Доступ для приложения: `@YandexContext()` (оба транспорта), либо неявно через провайдер (см. §4).

## 2. Boundary-лог в stdout (формат записи)

Connector пишет структурированные записи в **`stdout`**, по одной JSON-линии на запись (FR-005/011). Схема `BoundaryLogRecord`:

```jsonc
{
  // event: "start" | "finish" | "error"
  "event": "start",
  "trace_id": "f18fed85-7096-4f0e-a6db-e2c5e37e925f",
  "awsRequestId": "f18fed85-7096-4f0e-a6db-e2c5e37e925f",   // опц. [R1/R4]
  "transport": "http",                                       // "http" | "message-queue"; опц.
  "status": 200,                                             // finish: HTTP-статус || число сообщений MQ
  "durationMs": 12,                                          // finish/error, >= 0
  "code": "UNKNOWN_INVOCATION_EVENT",                        // error границы (ConnectorError)
  "errorClass": "Error",                                     // error приложения (имя класса)
  "message": "no registered transport adapter claimed..."    // безопасный текст (без значений)
}
```

**Инварианты** (FR-006..011):
- Минимум `start` + `finish|error` на инвокацию в scope.
- `trace_id`/`awsRequestId` одинаковы во всех записях одного вызова.
- `finish.status` — HTTP-статус для `http`; число успешно доставленных сообщений для `message-queue`.
- Никогда не содержат: `token`, значения headers/body, фрагменты payload, `raw`/`rawEvent`, текст/stack trace исключений. Bootstrap-ошибки и `UNKNOWN` — запись error без `trace_id` при недоступности id (edge case 1).
- Ошибка writer'а не влияет на результат инвокации (fail-open). Записи атомарны построчно при конкуренции.

## 3. `trace_id` в HTTP error-ответах

ВСЕ HTTP error-ответы несут `trace_id` (clarify Q2→B, FR-016):

- **Last-resort 500** (нет ответа от фильтров): `{"statusCode":500,"message":"Internal server error","trace_id":"<id>"}`.
- **Mapped exception-filter 4xx/5xx** (например, BadRequest 400): к телу фильтра добавляется ключ `trace_id`; `statusCode` и остальное тело НЕ изменяются; если фильтр уже вернул `trace_id` в body — он НЕ перезаписывается (FR-017).
- **404 not-found** (`Cannot <METHOD> <path>`): тот же конверт с `trace_id`.
- Изменение применяется только на error-пути dispatch; успешные ответы (`{statusCode,headers,body,isBase64Encoded}`) не меняются.
- Envelope не содержит значений запроса (headers, body, credentials) кроме `statusCode`/`message`/`trace_id` (FR-018).
- MQ-транспорт error-конверты не формирует (FR-019).

## 4. `YandexLogger` — публичный провайдер для application-кода

Инжектируется в NestJS-компоненты (контроллеры/сервисы/guards) приложения через DI (FR-012):

```ts
@Controller("/x")
class XController {
  constructor(private readonly logger: YandexLogger) {}
  @Get()
  get() {
    this.logger.info("handled request", { userId });
  }
}
```

```ts
interface YandexLogger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}
```

**Гарантии** (FR-013..015):
- Каждая запись автоматически несёт `trace_id`/`awsRequestId` текущего вызова (из invocation scope).
- Вне invocation scope (bootstrap, teardown, модульная инициализация) запись пишется БЕЗ `trace_id`/`awsRequestId` — не падает (US4/AC2).
- `context` проходит редакцию §6.2: ключи `token`, `authorization`, `cookie`, `raw`, `rawEvent` — редактируются/исключаются; значения-примитивы сохраняются (FR-014).
- Провайдер fail-open и атомарен построчно, как boundary-лог (FR-015).
- Регистрация автоматическая (bootstrap connector-а); отдельная настройка sink/уровня в v1 отсутствует (см. Assumptions spec).

## 5. Экспорты (§ package-exports.md)

- Root barrel: `export { YandexLogger }` (+ type контракты записей/уровня).
- Subpath `@ycforge/nestjs-connector/logger`: `export { YandexLogger }` (+ типы).