# Data Model: local-dev-server (spec 023)

**Spec**: [specs/023-local-dev-server/spec.md](./spec.md) | **Branch**: `023-local-dev-server` | **Date**: 2026-09-11

Сущности `@ycforge/js-dev-tools/server`. Пакет — dev-tooling поверх публичного API коннектора (Constitution I/III); типы события/контекста/ответа — контракты `@ycforge/nestjs-connector`, используются без изменений (deep imports заблокированы).

---

## 1. Структура пакета

```text
packages/js-dev-tools/
├── package.json              # @ycforge/js-dev-tools, type:module, exports: { "./server": {types,import,require} }
├── tsconfig.json             # зеркало nest-bridge (strict, noUncheckedIndexedAccess, decorators for fixtures)
├── tsup.config.ts            # entry: { 'server/index': 'src/server/index.ts' }, esm+cjs, dts
├── vitest.config.ts          # swc emit-decorator-metadata plugin (как nest-bridge), maxWorkers 2
├── src/
│   ├── diagnostic-codes.ts   # JDT_* константы + типы (JDT_MQ_UNSUPPORTED, JDT_NO_TRANSPORT, JDT_PORT_IN_USE,
│   │                         #   JDT_ENTRY_RESOLVE_FAILED, JDT_ENTRY_MODULE_NOT_FOUND, JDT_ENTRY_MODULE_AMBIGUOUS,
│   │                         #   JDT_IAM_UNAVAILABLE) + redactSecrets()
│   ├── server/
│   │   ├── index.ts          # PUBLIC subpath entry: createYcsfLocalServer, resolveIamToken + типы опций/handle
│   │   ├── options.ts        # YcsfLocalServerOptions валидация/defaults (S-2, FR-002)
│   │   ├── diagnostics.ts    # LocalDevServerError { code } fail-fast; warning emission
│   │   ├── entry.ts          # loadEntryModule(): dynamic import, AppModule/default extract, ambiguity
│   │   ├── payload.ts        # buildGatewayV2Event(incomingMessage) — чистая функция (S-5, FR-010..015)
│   │   ├── context.ts        # buildRawContext() — синтез raw context (S-6, FR-016..020)
│   │   ├── response.ts       # applyEnvelopeToServerResponse() + errorResponse(), isYandexFunctionHttpResponse (FR-021..022)
│   │   ├── iam.ts            # resolveIamToken(Detailed), цепочка env→OAuth→SA key, IamTokenExchanger (FR-023..025)
│   │   ├── request-id.ts     # newRequestId() = randomUUID() per-request (FR-019)
│   │   └── create.ts         # createYcsfLocalServer orchestration: validate→entry→probe port→iam→handler→listen→banner
│   └── cli/ (не в v1)
└── test/
    ├── fixtures/
    │   ├── user-service/
    │   │   ├── app.module.ts        # @@Module AppController: GET /api/users, @YandexContext() controller export
    │   │   ├── default-export.ts    # вариант с default export'ом модуля
    │   │   ├── ambiguous.ts         # named AppModule + другой default-класс (JDT_ENTRY_MODULE_AMBIGUOUS)
    │   │   └── no-module.ts         # экспортов модуля нет (JDT_ENTRY_MODULE_NOT_FOUND)
    │   └── side-effect-bootstrap.ts # main-guard-пример (не слушает на import-тайме)
    ├── payload.spec.ts       # FR-010..015, US2 (чистая функция, фикстуры запросов)
    ├── context.spec.ts       # FR-016..020, US1-SC3 (синтез raw context)
    ├── response.spec.ts      # FR-021..022, US4 (envelope mapping, ошибки, секреты)
    ├── iam.spec.ts           # FR-023..025, US3 (env/OAuth/SA-key, приоритет, fail-open; mock fetchImpl)
    ├── entry.spec.ts         # FR-005..006 (import, named/default/ambiguous, CJS interop)
    ├── server.integration.spec.ts # US1, US5..US7 (create/stop/fail-fast/banner/лог)
    └── host-loader.e2e.spec.ts    # child process: node --import tsx + TS entry (A-2 host-loader)
```

**Structure Decision**: Публичный entry — только `./server` (spec S-1); внутренние модули — `src/server/*` (зеркало nest-bridge subpath layout: auth/, context/, logger/ — один subpath = один каталог + index). Чистые преобразования (payload/context/response/iam) — отдельные модули для независимого тестирования без сети/сервера (Key Entities spec: LocalDevPayloadBuilder / LocalDevContextBuilder / LocalDevResponseMapper).

---

## 2. Типы

### 2.1 YcsfLocalServerOptions (S-2, FR-002)

```ts
export interface YcsfLocalServerOptions {
  /** Обязательно: путь к модулю корневого NestJS-модуля (relative → от cwd, или absolute). FR-002/FR-005. */
  readonly entry: string;
  /** Эмуляция HTTP/API Gateway v2 (payload 2.0). Default true. */
  readonly apiGatewayV2?: boolean;
  /** MQ-эмуляция. true → fail-fast JDT_MQ_UNSUPPORTED. Default false. */
  readonly messageQueue?: boolean;
  /** TCP-порт. Default 3000. 0 → OS-назначенный (tests). */
  readonly port?: number;
  /** Вход синтеза raw context. Default {}. */
  readonly yandexContext?: Readonly<{
    token?: string;
    folderId?: string;
    cloudId?: string;
    [key: string]: unknown;   // override escape hatch (merged поверх defaults, S-6)
  }>;
}
```

**Defaults**: `apiGatewayV2 = true`, `messageQueue = false`, `port = 3000`, `yandexContext = {}`. Bind host V1 — `127.0.0.1` (A-3), не опция.

**Validation (fail-fast, до любых побочных эффектов, FR-004)**:

| Условие | Диагностика |
|---------|-------------|
| `messageQueue === true` | `JDT_MQ_UNSUPPORTED` |
| `!apiGatewayV2 && !messageQueue` | `JDT_NO_TRANSPORT` |
| `port` не число / вне [0, 65535] (NaN, дробное, negative) | `JDT_PORT_IN_USE`? нет — добавляем `JDT_INVALID_PORT` (см. §4: расширение JDT_*) |

### 2.2 LocalDevServer (S-2, FR-003)

```ts
export interface LocalDevServer {
  /** Фактический порт (после bind; при port:0 — OS-назначенный). */
  readonly port: number;
  /** `http://127.0.0.1:<port>` — URL для fetch/тестов. */
  readonly baseUrl: string;
  /** Idempotent: закрывает listener + handler.close() коннектора (FR-009). Асинхронный. */
  stop(): Promise<void>;
}
```

`createYcsfLocalServer(options): Promise<LocalDevServer>` резолвится **после** успешного `listen` (`server.listening === true`), отклоняется `LocalDevServerError { code: JdtDiagnosticCode, message, cause? }`.

### 2.3 RawHttpApiGatewayV2Event — цель translation (контракт коннектора, S-5)

Тип — `@ycforge/nestjs-connector` (`src/http/raw-event.ts:36-63`), не переэкспортируется и не копируется. Полевый маппинг синтеза (`buildGatewayV2Event`):

| Поле (type connector) | Источник (node:http IncomingMessage) |
|------------------------|--------------------------------------|
| `version: "2.0"` | константа |
| `rawPath: string` | `req.url` до первого `?`, **без декодирования** (US2-SC6) |
| `rawQueryString: string` | `req.url` после первого `?`, verbatim; отсутствие → `""` |
| `headers: Record<string,string>` | `req.rawHeaders`, оригинальный кейс, повторы comma-join `,` без пробела |
| `queryStringParameters` | form-decode (`+`→space + `decodeURIComponent`, битый escape → raw); повторы comma-join `,` |
| `multiValueParameters` | те же значения массивами (мультиплицитность) |
| `pathParameters` | `{}` (D-5) |
| `parameters` | `{}` (D-5) |
| `operationId` | `""` (D-5) |
| `body: string` | buffered body; text → utf8 string, иначе base64 (A-11) |
| `isBase64Encoded` | `false` для текста/пустого, `true` для base64 (FR-014) |
| `requestContext.authorizer` | `{}` |
| `requestContext.http.method` | `req.method` (uppercase) |
| `requestContext.http.path` | `rawPath + '?' + rawQueryString` (S-5; trailing `?` как у платформы, R-3#5) |
| `requestContext.http.sourceIp` | первый `X-Forwarded-For` (trim) или `127.0.0.1` |
| `requestContext.http.userAgent` | `User-Agent` или `""` |
| `requestContext.requestId` | `newRequestId()` (randomUUID, FR-019) |
| `requestContext.time` | `toClfTime(now)` — `dd/Mon/yyyy:HH:mm:ss +0000` (UTC, R-9) |
| `requestContext.timeEpoch` | `Math.floor(now/1000)` |
| `requestContext.apiGateway.operationContext` | `{}` (D-5) |

**Invariants** (обеспечивают прохождение детекции HTTP и валидации коннектора — `http/adapter.ts:29-39`, `validate-raw-event.ts:19-35`):
- `version === "2.0"` + `rawPath`/`rawQueryString` — string.
- `headers/queryStringParameters/pathParameters/parameters` — `Record<string,string>`; `multiValueParameters` — `Record<string,string[]>`;
- `requestContext.requestId/time` string, `timeEpoch` number; `authorizer` object; `http.*` 4 string.
- `body` string, `isBase64Encoded` boolean.

**Тело (A-11, детерминированно)** — функция `encodeBody(buffer: Buffer, contentType?: string): { body: string; isBase64Encoded: boolean }`:
1. `buffer.length === 0` → `{ body: "", isBase64Encoded: false }` (FR-014).
2. contentType `text/*` | `application/json` | `application/x-www-form-urlencoded` → utf8 string, `false`.
3. `buffer.isUtf8(buffer)` → utf8 string, `false` (грай-зона → текст, A-11).
4. иначе → `buffer.toString('base64')`, `true`.

### 2.4 Raw context синтез (S-6, FR-016..020)

```ts
export interface RawLocalDevContext extends Record<string, unknown> {
  awsRequestId: string;        // == requestContext.requestId (FR-019)
  requestId: string;           // то же значение (наблюдается у платформы)
  functionName: string;        // "local-function"
  functionVersion: string;     // "local-dev"
  functionFolderId: string;    // yandexContext.folderId ?? ""
  memoryLimitInMB: string;     // "1024" (string, НЕ number)
  deadlineMs: number;          // Date.now() + 15000 (per-request)
  logGroupName: string;        // ""
  token?: string;              // только если yandexContext.token set (FR-017)
  uberTraceId?: string;        // только если входящий Uber-Trace-Id set (verbatim, FR-020)
  cloudId?: string;            // yandexContext.cloudId (escape hatch .raw, FR-018)
  // прочие поля yandexContext merged поверх defaults (override escape hatch)
}
```

**Синтез** — `buildRawContext({ requestId, uberTraceId, yandexContext }): RawLocalDevContext` (чистая функция):
- Base = `{ awsRequestId: requestId, requestId, functionName: "local-function", functionVersion: "local-dev", functionFolderId: yandexContext.folderId ?? "", memoryLimitInMB: "1024", deadlineMs: Date.now() + 15000, logGroupName: "" }`.
- Merge: `token`/`cloudId`/прочие поля `yandexContext` поверх base (явный override побеждает; `awsRequestId`/`requestId` не переопределяются — всегда per-request).
- `uberTraceId` добавляется только когда заголовок был (иначе ключ отсутствует — коннектор читает optional string, `readOptionalString`).

**Обязательные для коннектора** (fail-loud, `build-yandex-execution-context.ts:36-47`): `awsRequestId` (string), `functionName`, `functionVersion`, `functionFolderId`, `memoryLimitInMB` (string), `deadlineMs` (number), `logGroupName` (string) — все покрыты. `trace_id` коннектор приравняет к `awsRequestId` сам (spec 004).

### 2.5 Envelope ответа и маппинг (S-7, FR-021..022)

```ts
// YandexFunctionHttpResponse — публичный тип коннектора (src/http/response.ts:9-33)
export interface YandexFunctionHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly multiValueHeaders?: Readonly<Record<string, readonly string[]>>;
  readonly body: string;
  readonly isBase64Encoded: boolean;
}
```

**Маппинг** — `applyEnvelope(res, envelope, traceId)`:
1. `res.statusCode = envelope.statusCode`.
2. `headers` → `res.setHeader(name, value)` (по одному).
3. `multiValueHeaders[name]` → каждый элемент отдельным `res.append(name, value)` (Set-Cookie без comma-join).
4. body: `isBase64Encoded ? Buffer.from(body, 'base64') : body` → `res.end()`.
5. `res.setHeader('X-Trace-Id', traceId)` — после envelope (echo перезаписывает приложение, R-4).

**Ошибка инвокации** (throw handler / не-envelope результат): `res.statusCode = 500`, JSON `{ error: <name>, message: <sanitized>, trace_id: <traceId> }`, header `X-Trace-Id`. Sanitized message: `redactSecrets(error.message, requestSecrets)` — из строки удаляются значения `yandexContext.token`, `Authorization`, `Cookie` (заменяются `[REDACTED]`). Stack пишется в лог также через redactSecrets.

### 2.6 IamTokenResolver (S-8, FR-023..025)

```ts
export interface ResolveIamTokenOptions {
  readonly homeDir?: string;          // тесты: temp ~ ; default os.homedir()
  readonly iamEndpoint?: string;      // default "https://iam.api.cloud.yandex.net"
  readonly fetchImpl?: typeof fetch;  // тесты: mock exchange; default globalThis.fetch
}

export type IamUnavailableReason =
  | "no-credential"        // нет env, config.yaml без token, keys пусто/непарсятся
  | "io"                   // config/keys read fail
  | "exchange-error"       // IAM API non-2xx / malformed response
  | "network-error";       // fetch throw

// внутренний (для banner reason):
export async function resolveIamTokenDetailed(options?): Promise<{ token?: string; reason?: IamUnavailableReason }>;
// публичный:
export async function resolveIamToken(options?): Promise<string | undefined>;
```

**Цепочка** (приоритет жёсткий, первый успех — финальный; каждый шаг try/catch → fail-open):

| Шаг | Источник | Действие |
|-----|----------|----------|
| 1 | `process.env.YC_IAM_TOKEN` (непустая) | вернуть as-is. Сети нет. |
| 2 | `~/.yc/config.yaml` (yaml-parse; профиль `current` → `profiles[<current>].token`) | `t1.`-префикс → as-is (уже IAM); иначе exchange OAuth → `{ iamToken }` |
| 3 | `~/.yc/keys/*.json` (первый парсящийся) | JWT (PS256, iss/aud/iat/exp) → exchange JWT → `{ iamToken }` |
| — | — | все шаги мимо → `undefined` + `reason` |

**Exchange client** (`IamTokenExchanger`, инжектится): `POST {iamEndpoint}/iam/v1/tokens`; OAuth body `{ "yandexPassportOauthToken": "<oauth>" }`, JWT body `{ "jwt": "<jwt>" }`; успех — 200 `{ iamToken: string }`; любой сбой → `undefined`. В v1 без refresh (A-8/A-9), один резолв на старт сервера.

**JWT (шаг 3)** — стандартный для IAM SA key: header `{ alg: "PS256", typ: "JWT" }`; claims `{ iss: service_account_id, aud: "{iamEndpoint}/iam/v1/tokens", iat: now, exp: now + 3600 }`; подпись `crypto.sign('RSA-PSS-SHA256', data, { key: createPrivateKey(privateKeyPem), padding: RSA_PKCS1_PSS_PADDING, saltLength: SHA256_DIGEST_LENGTH })`, base64url. `private_key` из JSON-ключа содержит `\\n` — вычищается в PEM перед `createPrivateKey`.

### 2.7 Diagnostics (S-2/F-029, LocalDevServerError)

```ts
export type JdtDiagnosticCode =
  | "JDT_MQ_UNSUPPORTED"           // messageQueue: true
  | "JDT_NO_TRANSPORT"             // !apiGatewayV2 && !messageQueue
  | "JDT_PORT_IN_USE"              // EADDRINUSE (bind)
  | "JDT_INVALID_PORT"             // порт не целое в [0,65535] — аддитивный код вне закрытого FR-029 (см. план, deviation)
  | "JDT_ENTRY_RESOLVE_FAILED"     // import throw / файл не существует
  | "JDT_ENTRY_MODULE_NOT_FOUND"   // нет AppModule/default экспорта
  | "JDT_ENTRY_MODULE_AMBIGUOUS"   // named AppModule и different default класс
  | "JDT_IAM_UNAVAILABLE";         // WARNING (не throw, сервер стартует)

export class LocalDevServerError extends Error {
  readonly code: JdtDiagnosticCode;
  readonly cause?: unknown;
}
```

---

## 3. Entry contract: алгоритм извлечения модуля (S-3, FR-005..006)

```text
resolveEntryPath(entry):
  relative → path.resolve(process.cwd(), entry)

loadEntryModule(entryPath) → module namespace:
  1. existsSync(entryPath)? НЕТ → LocalDevServerError JDT_ENTRY_RESOLVE_FAILED
  2. try await import(pathToFileURL(entryPath))
     catch e → LocalDevServerError JDT_ENTRY_RESOLVE_FAILED (cause=e;
               включает ERR_UNKNOWN_FILE_EXTENSION для необработанного TS-хоста — подсказка tsx/node --import)
  3. named  = mod.AppModule            (top-level named export)
     default = mod.default             (ESM default; для CJS — module.exports через interop)
  4. named === undefined && default === undefined
       → JDT_ENTRY_MODULE_NOT_FOUND (message: «ожидался named export AppModule или default export»)
     named !== undefined && default !== undefined && named !== default
       → JDT_ENTRY_MODULE_AMBIGUOUS
     иначе → (named ?? default) — корневой Type<unknown>
```

Замечания (R-8/эдж-кейсы spec):
- **CJS**: dynamic import отдаёт `{ default: module.exports, ...named }`; если `module.exports` — класс, `mod.default` валиден (edge case spec: «default export CJS-модуля — объект module.exports; если это класс — валидный корневой модуль»). Если `module.exports` — объект с полем `AppModule` и лексер не извлёк named (редкий edge), `mod.AppModule` может быть `undefined` → NOT_FOUND с подсказкой. Это документированный предел, не auto-discovery.
- **Side-effect на import-тайме** (main без main-guard): сервер детектировать не может (Q-1/FR-005); контракт + пример main-guard в fixtures (`side-effect-bootstrap.ts`); диагностика — только отсутствие экспорта.

---

## 4. Lifecycle orchestrasyon (`create.ts`): фазы старта

```text
validateOptions(options)                    → JDT_MQ_UNSUPPORTED | JDT_NO_TRANSPORT | (invalid port → JDT_INVALID_PORT)
  → loadEntryModule(entry)                  → JDT_ENTRY_RESOLVE_FAILED | NOT_FOUND | AMBIGUOUS
  → probePort(port)                         → EADDRINUSE → JDT_PORT_IN_USE (временный net.Server, закрывается до handler)
  → resolveIam: yandexContext.token ?? await resolveIamTokenDetailed()
       (token → banner "token resolved"; undefined → warn JDT_IAM_UNAVAILABLE один раз; не блокирует)
  → const handler = createYandexHandler(appModule)     // sync, ленивый bootstrap, без побочных эффектов
  → server = http.createServer(async (req, res) => ...)
  → await listen(host=127.0.0.1, port)      → резолв или JDT_PORT_IN_USE (EADDRINUSE fallback, TOCTOU)
  → banner(stderr): http://127.0.0.1:<port> | apiGatewayV2 | IAM status (без значения токена)
  → return LocalDevServer { port: server.address().port, baseUrl, stop }
```

**stop()**: сначала закрывает listener (`server.close()` — ждёт in-flight запросы), затем `await handler.close()` (idempotent). Повторный stop — безопасен (флаг `closed`, повторный вызов — no-op). Во время in-flight запроса `close` даёт текущей инвокации завершиться (Node `server.close` semantics: новые соединения отклоняются, активные завершаются).

**Per-request path**:
```text
onRequest(req, res):
  requestId = newRequestId()
  bytes = await readBodyChunks(req)          // buffered
  event  = buildGatewayV2Event(req, bytes, { requestId })
  rawCtx = buildRawContext({ requestId, uberTraceId: reqUberTraceId, yandexContext })
  t0 = now
  try:
    result = await handler(event, rawCtx)     // строго (rawEvent, rawContext) => Promise<unknown>
    if isYandexFunctionHttpResponse(result) → applyEnvelope(res, result, requestId)
    else → errorResponse(res, 500, "invalid handler result", requestId)
  catch err:
    log stack (redactSecrets)
    errorResponse(res, 500, err, requestId)
  finally:
    perRequestLog: `${method} ${path} → ${res.statusCode} (${ms} ms) trace_id=${requestId}`
```

---

## 5. Observability и секреты (S-9, FR-026..028)

| Событие | Куда | Формат |
|---------|------|--------|
| Startup banner | stderr | `local-dev-server listening on http://127.0.0.1:<port> (apiGatewayV2) — IAM token resolved` / `— IAM unavailable (JDT_IAM_UNAVAILABLE: <reason>) — running without token` |
| Per-request | stderr | `GET /api/users → 200 (12 ms) trace_id=<id>` (grep-stable) |
| Warning `JDT_IAM_UNAVAILABLE` | stderr | один раз на старт, до banner |
| Ошибка инвокации | stderr | stack через `redactSecrets` |
| Значение токена | **никогда** | не в banner, не в логах, не в ответах (FR-028) |

`redactSecrets(text, secrets: string[])` — заменяет каждое известное секретное значение на `[REDACTED]`; secrets = `{ yandexContext.token, request.headers.authorization, request.headers.cookie }` (при наличии). Значение токена дополнительно редиктится коннектором в `toJSON` (`build-yandex-execution-context.ts:72-74`).

---

## 6. Validation rules

| Rule | Source | Enforcement |
|------|--------|-------------|
| `entry` обязателен и string | FR-002 | validateOptions → `JDT_ENTRY_RESOLVE_FAILED` если absent/не string |
| `messageQueue: true` → fail-fast до listener/handler | FR-004 D-8 | validateOptions первым |
| `!apiGatewayV2 && !messageQueue` → fail-fast | FR-004 | validateOptions |
| Ни одна стартовая ошибка не поднимает listener и не создаёт handler | FR-004 | probePort(port) до `createYandexHandler`; fallback EADDRINUSE → close |
| Один handler на весь lifecycle | FR-007 | создаётся один раз в create; stop() → close() |
| Токен не логируется/не в ответах | FR-017/028 | redactSecrets + тест-скан |
| Pорядок id: awsRequestId == requestId == trace_id | FR-019 | один `requestId` на инвокацию |
| resolveIamToken — один раз на старт, без сети на env-пути | FR-023/025 | create вызывает detailed только при отсутствии `yandexContext.token` |

---

## 7. Invariants

```text
invariants:
  Delegation (Constitution I, FR-007/008):
    → единственная интеграция — public createYandexHandler(appModule)
    → handler вызывается ровно (rawEvent, rawContext) => Promise<unknown>
    → нет NestFactory, нет deep imports коннектора (SC-008 статически)

  Payload fidelity по spec (S-5, US2):
    → все поля S-5 воспроизводятся; gateway-only поля документированные пустые ({} / "")
    → детекция HTTP-транспорта проходит: version "2.0" + rawPath/rawQueryString string
    → rawPath/rawQueryString без повторного декодирования

  Context contract (S-6, FR-016):
    → все required-поля коннектора присутствуют с правильными типами
    → trace_id == awsRequestId == requestId (равенство гарантируется сервером)

  Response no-loss (S-7, FR-021):
    → multiValueHeaders по-элементно (Set-Cookie), base64 байт-в-байт
    → X-Trace-Id echo всегда

  Error semantics (D-10, FR-022/024):
    → конфигурация/entry/порт — fail-fast JDT_* до побочных эффектов
    → IAM — fail-open (warning JDT_IAM_UNAVAILABLE, сервер работает)
    → handler throw — HTTP 500 JSON {error, message, trace_id}, детали в лог

  Secrets (FR-028):
    → token/Authorization/Cookie не в логах, не в banner, не в ответах

  Versioning (Constitution III):
    → public API @ycforge/js-dev-tools — semver; контракты коннектора не меняются
```