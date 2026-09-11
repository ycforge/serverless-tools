# Spec 023: local-dev-server — `@ycforge/js-dev-tools/server`, payload 2.0 эмуляция

## Metadata

- **Spec ID**: 023
- **Title**: local-dev-server — `@ycforge/js-dev-tools/server`, payload 2.0 эмуляция
- **Feature Branch**: `023-local-dev-server`
- **Created**: 2026-09-11
- **Status**: 🚧 In Progress
- **Input**: roadmap row `023 | local-dev-server — @ycforge/js-dev-tools/server, payload 2.0 эмуляция | §38 | ⬜ | 001`
- **Dependencies**: 001 (connector-reverse ✅ — Project A public API), 003 (connector-require-auth ✅ — guard работает локально), 004 (connector-observability ✅ — boundry-логи коннектора)
- **IDEA.md sections**: §38 (Local development)
- **Packages**: `packages/js-dev-tools` (`@ycforge/js-dev-tools`, subpath `./server`)

---

## Problem Statement

Yandex Cloud Functions-приложения на NestJS (через `@ycforge/nestjs-connector`, Project A) можно локально проверить только двумя способами: запустить приложение на нейтивном Nest HTTP-сервере (но тогда `@YandexContext()`, payload 2.0 и ближайший к облаку путь выполнения не воспроизводятся) либо деплоить в облако для каждой итерации (медленно, требует provisioning).

IDEA §38 определяет решение: **новый dev-tooling пакет `@ycforge/js-dev-tools`** с subpath `/server`, экспортирующим `createYcsfLocalServer()`:

```ts
import { createYcsfLocalServer, resolveIamToken } from '@ycforge/js-dev-tools/server';

createYcsfLocalServer({
  entry: './src/main.ts',        // NestJS entry point (корневой модуль)
  apiGatewayV2: true,            // Эмуляция payload 2.0
  messageQueue: false,           // MQ trigger emulation (вне v1)
  port: 3000,
  yandexContext: {
    token: await resolveIamToken(),
    folderId: process.env.YC_FOLDER_ID,
    cloudId: process.env.YC_CLOUD_ID,
  },
});
```

Сервер поднимает HTTP-сервер, транслирует входящие запросы в **API Gateway v2 payload (payload 2.0)**, вызывает handler из Project A (`createYandexHandler(appModule)`), возвращает ответ клиенту и синтезирует raw context с `trace-id`/IAM-полями. Конечный контракт `@YandexContext()` живёт внутри коннектора: по HTTP-пути (`YandexHttpAdapter.dispatch`) параметр декоратора не заполняется — это известная граница Project A (см. A-13) и follow-up за spec 001.

Это **НЕ Project A и НЕ Project C**: `@ycforge/js-dev-tools` — отдельный dev-tooling пакет, который **только эмулирует окружение вызова** (HTTP → payload 2.0 → handler → response). Все runtime-семантики он делегирует nest-bridge через публичный API (`createYandexHandler`), а bootstrap NestJS, transpile/build, deploy/provision — вне его ответственности (Constitution I).

На сегодня такого инструмента нет: ни один пакет не умеет локально отдавать payload 2.0 в handler коннектора. Spec 023 добавляет этот слой, не меняя контракты Project A/B/C и не реимплементируя runtime.

---

## Scope (In Scope)

### S-1 — Пакет и публичный API

| Аспект | Решение |
|--------|---------|
| **Package** | `packages/js-dev-tools`, имя `@ycforge/js-dev-tools`, workspace-зависимость от `@ycforge/nestjs-connector`. |
| **Subpath** | `@ycforge/js-dev-tools/server` — единственный public export v1 (root export не требуется). Экспорты: `createYcsfLocalServer`, `resolveIamToken`. |
| **Node/ESM** | `"type": "module"`, `"engines": { "node": ">=22" }` — зеркалит conventions nest-bridge/pilot. |
| **Dependencies** | `@ycforge/nestjs-connector` (workspace), peer-зависимости NestJS (`@nestjs/common`, `@nestjs/core`), devDeps: `tsup`, `vitest`, `@types/node`, `typescript`, `tsx` (только для тестов/host-запуска, НЕ runtime-зависимость пакета). |
| **Пакет НЕ** | не импортирует internal-модули nest-bridge (deep imports заблокированы контрактом пакета, docs/ARCHITECTURE.md §2), не вызывает `NestFactory`, не транслирует, не билдит, не деплоит, не провиженит (Constitution I). |

### S-2 — Сигнатура `createYcsfLocalServer(options)`

**Options contract** (все поля необязательны кроме `entry`):

| Поле | Тип / default | Семантика |
|------|---------------|-----------|
| `entry` | `string` (обязательно) | Путь к модулю, экспортирующему корневой NestJS-модуль (relative → резолв от cwd, или absolute). |
| `apiGatewayV2` | `boolean`, default `true` | Включить эмуляцию HTTP/API Gateway v2 (payload 2.0). |
| `messageQueue` | `boolean`, default `false` | Эмуляция MQ-триггера. `true` → fail-fast `JDT_MQ_UNSUPPORTED` (вне v1). |
| `port` | `number`, default `3000` | TCP-порт для HTTP-сервера. |
| `yandexContext` | `{ token?, folderId?, cloudId? }`, default `{}` | Входные данные для синтеза raw context инвокации (см. S-6). |

**Возврат**: `Promise<LocalDevServer>` — handle `{ port: number, baseUrl: string, stop(): Promise<void> }`. Promise резолвится после того, как HTTP-сервер реально слушает порт.

**Fail-fast на старте** (Constitution V, диагностики семейства `JDT_*`):

| Условие | Диагностика |
|---------|-------------|
| `messageQueue: true` | `JDT_MQ_UNSUPPORTED` |
| `!apiGatewayV2 && !messageQueue` | `JDT_NO_TRANSPORT` |
| Порт занят | `JDT_PORT_IN_USE` |
| `entry` не резолвится / файл не существует | `JDT_ENTRY_RESOLVE_FAILED` |
| Импорт entry не даёт корневого модуля | `JDT_ENTRY_MODULE_NOT_FOUND` |
| Названный `AppModule` и default export одновременно, и это разные классы | `JDT_ENTRY_MODULE_AMBIGUOUS` |

### S-3 — Entry contract (как получить корневой NestJS-модуль)

`createYandexHandler(appModule)` коннектора принимает `Type<unknown>`. Локальный сервер должен **получить этот класс из файла, указанного в `entry`**, не выполняя bootstrap сам:

- Сервер выполняет **динамический import** `entry` через стандартный loader хост-процесса (`import()`) — **без собственной трансформации**. Собранный JS или TypeScript под хост-загрузчиком (например `tsx`/`node --import`) — допустимо; пакет не имеет transpile-пайплайна.
- Из экспортов модуля извлекается корневой класс: **named export `AppModule`** (приоритет) → **default export** → иначе `JDT_ENTRY_MODULE_NOT_FOUND`.
- Если есть и named `AppModule`, и default export, и это разные классы → `JDT_ENTRY_MODULE_AMBIGUOUS` (fail-fast, не угадывание).
- **Side-effect-free import**: entry НЕ должен на import-тайме вызывать `NestFactory.create(...).listen(...)` в «боевой» манере, иначе bootstrap выполнится до передачи в коннектор. Документированный приём для `main.ts` — main-guard (см. Assumptions A-6). Пакет НЕ детектирует этот класс ошибок намеренно (невозможно надёжно), но контракт и примеры это фиксируют.

### S-4 — Delegation boundary (только public API Project A)

- Один handler создаётся через `createYandexHandler(appModule, options?)` из `@ycforge/nestjs-connector` — **единственная точка интеграции**.
- Connector сам делает lazy cold start на первом вызове и кэширует приложение для тёплых вызовов — серверу это даёт «холодный старт, как в облаке» без какой-либо работы.
- `LocalDevServer.stop()` вызывает handle.close() коннектора (idempotent) и закрывает listener.
- Сервер вызывает handler как `(rawEvent, rawContext) => Promise<unknown>` — ровно сигнатуру `YandexCloudFunctionHandler`. Никакого доступа к внутренностям коннектора.

### S-5 — Payload 2.0 translation (HTTP-запрос → `RawHttpApiGatewayV2Event`)

Входящий `http.IncomingMessage` маппится в событие типа `RawHttpApiGatewayV2Event` (nest-bridge, `src/http/raw-event.ts`):

| Поле события | Источник |
|--------------|----------|
| `version` | `"2.0"` (константа) |
| `rawPath` | необработанный URL-path из request line, **без декодирования** (как пришёл) |
| `rawQueryString` | необработанная query-строка **без повторного декодирования**; отсутствие query → `""` |
| `headers` | map `{ name: value }`; повторяющиеся заголовки — comma-joined в одну строку (как gateway), единообразно с уже наблюдаемым поведением платформы |
| `queryStringParameters` | распарсенные query-значения строкой; повторяющиеся — comma-joined |
| `multiValueParameters` | мультиплицитность query-значений `{ name: string[] }` |
| `pathParameters` | `{}` — локально отсутствует gateway-маршрутизация (см. D-5) |
| `parameters` | `{}` |
| `operationId` | `""` — gateway-поле, локально отсутствует спецификация API Gateway |
| `body` | тело запроса: UTF-8 текст как строка, иначе base64 (см. ниже) |
| `isBase64Encoded` | `false` для текстового тела, `true` для бинарного |
| `requestContext.authorizer` | `{}` |
| `requestContext.http.method` | HTTP-метод |
| `requestContext.http.path` | `path` + (`?` + query) — как наблюдается у gateway |
| `requestContext.http.sourceIp` | `127.0.0.1` (локальный) или из `X-Forwarded-For`, если присутствует |
| `requestContext.http.userAgent` | `User-Agent` заголовок или `""` |
| `requestContext.requestId` | per-request id (совпадает с `awsRequestId`, см. S-6) |
| `requestContext.time` | timestamp в Apache CLF-формате |
| `requestContext.timeEpoch` | unix epoch (seconds) |
| `requestContext.apiGateway.operationContext` | `{}` — gateway-поле, локально пустое |
| `requestContext[key: string]` / `[key: string]` | допускается аддитивными полями (escape hatches событий) |

**Body-кодирование**: тело читается как `Buffer` полностью (buffered, не streaming в v1). Если `Content-Type` текстовый/JSON или буфер валиден как UTF-8 → строка, `isBase64Encoded: false`; иначе — base64-строка, `isBase64Encoded: true`. Пустое тело → `body: ""`, `isBase64Encoded: false`.

### S-6 — Execution context (raw context для `@YandexContext()`)

Connector строит `YandexExecutionContext` из raw context через `buildYandexExecutionContext(rawEvent, rawContext)` и **жёстко требует** (fail loud) string-поля: `awsRequestId`, `functionName`, `functionVersion`, `functionFolderId`, `memoryLimitInMB`, `logGroupName` и number-поле `deadlineMs` (src/context/build-yandex-execution-context.ts). Сервер обязан синтезировать валидный raw context, где:

| Поле raw context | Значение |
|------------------|----------|
| `awsRequestId` | per-request id (uuid/случайный), стабильный в рамках одной инвокации |
| `requestId` | то же значение (наблюдается у платформы: requestId == awsRequestId) |
| `functionFolderId` | `yandexContext.folderId` (если задан) |
| `token` | `yandexContext.token` (опционально; отсутствие → поле отсутствует) |
| `uberTraceId` | из заголовка `Uber-Trace-Id` входящего запроса (опционально) |
| `cloudId` | `yandexContext.cloudId` — передаётся в raw context (escape hatch `@YandexContext().raw`); в normalized context поля нет |
| `functionName`, `functionVersion`, `memoryLimitInMB`, `deadlineMs`, `logGroupName` | детерминированные defaults: `"local-function"`, `"local-dev"`, `"1024"`, `Date.now() + 15000`, `""` |
| прочие поля `yandexContext` | merged поверх defaults (explicit override escape hatch) |

`trace_id` = `awsRequestId` ставит сам коннектор (spec 004) — сервер гарантирует равенство `trace_id == awsRequestId == requestId`, чтобы локально и в облаке корреляция совпадала.

**Trace propagation**: ответ сервера содержит заголовок `X-Trace-Id` (значение = per-request trace id), а `uberTraceId` в raw context зеркалит входящий `Uber-Trace-Id` — так цепочки локальных вызовов коррелируются. IDEA §38 формулирует требование как прокидывание `trace-id`/IAM в `@YandexContext()`; на уровне 023 это реализуется синтезом корректного raw context, а коннектор строит из него `YandexExecutionContext` (заполнение параметров декоратора при HTTP-диспатче — внутренняя граница Project A, см. A-13).

### S-7 — Response mapping (`YandexFunctionHttpResponse` → HTTP-ответ)

Handler коннектора возвращает envelope `YandexFunctionHttpResponse { statusCode, headers, multiValueHeaders?, body, isBase64Encoded }` (src/http/response.ts). Сервер маппит:

| Envelope | HTTP-ответ |
|----------|------------|
| `statusCode` | `res.statusCode` |
| `headers` | по одному заголовку каждый |
| `multiValueHeaders` | каждый элемент добавляется отдельно (критично для нескольких `Set-Cookie`) |
| `body` + `isBase64Encoded: false` | строка как body |
| `body` + `isBase64Encoded: true` | `Buffer.from(body, 'base64')` как бинарный body |

**Ошибка инвокации**: если результат handler-а не является валидным envelope — сервер возвращает клиенту HTTP 500 с JSON `{ "error": <code/name>, "message": <safe message>, "trace_id": <id> }` и заголовком `X-Trace-Id` (errorResponse). Если ошибка брошена внутри NestJS (throw в controller-е) — эмулятор возвращает envelope коннектора как есть: наблюдаемый 500-body `{ "statusCode": 500, "message": "...", "trace_id": <id> }` (Nest default exception layer + коннектор добавляет `trace_id` к ответам >=400). В обоих случаях `body.trace_id === X-Trace-Id === per-request лог trace_id`. Детали ошибки пишутся в лог (стек), но secret-поля (token, `Authorization`, `Cookie`) из ошибки и ответа исключаются.

### S-8 — IAM token resolution (`resolveIamToken`)

Пакет экспортирует `resolveIamToken(options?): Promise<string | undefined>` с цепочкой из IDEA §38:

1. **`YC_IAM_TOKEN` env** — переменная установлена → вернуть значение as-is (без валидации, без сети).
2. **`~/.yc/config.yaml` (OAuth)** — если профиль содержит OAuth-токен → обменять на IAM-токен через IAM API Yandex Cloud.
3. **`~/.yc/keys/*` (SA key)** — прочитать ключ сервисного аккаунта (JSON), сформировать JWT (iss/aud стандартные для IAM), обменять JWT на IAM-токен через IAM API.

Правила:

- Порядок приоритетный: env → OAuth → SA key; первый успешный — финальный.
- **Fail-open**: если токен не разрешился (нет env, нет конфига, сетевой сбой) → вернуть `undefined` (и код причины). Локальный сервер продолжает работу без токена (в raw context поле `token` отсутствует; через HTTP-диспатч Nest router `@YandexContext().token` не заполняется в любом случае — известная граница Project A, см. A-13), на старте выдаётся один warning `JDT_IAM_UNAVAILABLE`. Local dev НЕ падает из-за токена.
- **Один резолв на старт**: сервер резолвит токен до начала слушания (или принимает уже разрешённый из `yandexContext.token`) и использует его на всех инвокациях без refresh (TTL ~12ч платформенного IAM-токена локально не управляется в v1 — documented limitation, ротация = перезапуск).
- Вызовы IAM API выполняются только когда это реально нужно (env-путь не делает сетевых вызовов). В тестах обмен мокается.

### S-9 — Observability

- **Startup banner** (stderr): listening URL `http://127.0.0.1:<port>`, режим (`apiGatewayV2`), status IAM-resolution (`token resolved` / `no token — warning`), никогда — само значение токена.
- **Per-request лог**: `method path → status (latency ms) trace_id=<id>` — стабильный формат для grep.
- **Секреты**: IAM-токен, `Authorization`, `Cookie` не логируются и не попадают в ответы (AGENTS.md section 6.2; коннектор уже редиктит `token` в `toJSON`).

---

## Scope Boundaries (Out of Scope)

| Что | Почему не в scope | Кто/когда |
|-----|-------------------|-----------|
| Эмуляция Message Queue триггера (`messageQueue: true`) | §38 показывает `messageQueue: false`; v1 — только HTTP payload 2.0 | Future spec |
| Транспиляция/bundling TypeScript | «MUST NOT … transpile» (граница задачи); загрузка — через хост-loader (`tsx`/`node --import`) или собранный JS | Host / Project C builders |
| Hot-reload / watch исходников | Инструмент эмулирует инвокацию, не сборку; перезапуск при изменении — на усмотрение пользователя/CLI | Future |
| Bootstrap/деплой/provisioning | Constitution I: A owns runtime, C owns orchestration, Terraform owns provisioning | — |
| Эмуляция API Gateway композиции Project B (operationId из OpenAPI, pathParameters по паттернам спеки, authorizer) | Локально нет gateway-спеки; NestJS маршрутизирует по входящему path сам | — |
| Синтез `cloudId` в normalized `YandexExecutionContext` | У коннектора такого typed поля нет; доступно только через `raw` escape hatch | Spec 001 amendment / future |
| IAM-токен refresh/кэш с учётом TTL | v1 — один резолв на старт; ротация перезапуском | Future |
| HTTPS/TLS на локальном сервере | Local dev — plain HTTP в v1 | Future |
| Streaming тела (chunked/streaming request, SSE) | v1 — buffered body | Future |
| Одновременная эмуляция нескольких payloads/apps процессом | Один сервер = один entry + payload 2.0 | Future |

---

## Decisions

### D-1 — Отдельный пакет `@ycforge/js-dev-tools`, а не фича Project A/C (Constitution I)

**Решение**: Локальный dev-сервер живёт в новом пакете `packages/js-dev-tools` (`@ycforge/js-dev-tools`, subpath `./server`). Project A (`nest-bridge`) и Project C (`pilot`) не получают dev-server кода.

**Рациональность**: Constitution I — A owns runtime, C owns orchestration. Local dev — это **эмуляция окружения вызова**, она не является ни runtime-адаптером (A), ни orchestration/build (C), ни provisioning (Terraform). Включение её в nest-bridge раздуло бы публичный контракт; включение в pilot смешало бы dev-tooling с CLI/Terraform. Отдельный пакет переиспользуем и вне toolchain, а его граница зафиксирована: он делегирует ВСЁ в nest-bridge через public API.

### D-2 — `createYcsfLocalServer` возвращает `Promise<LocalDevServer>` (explicit lifecycle)

**Решение**: Функция асинхронная, возвращает `Promise<{ port, baseUrl, stop() }>`, резолвится после успешного bind. IDEA.md §38 показывает вызов без `await` — при расхождении обновляется IDEA.md (specs первичны).

**Рациональность**: Явный lifecycle тестируем без sleep/race: тест может `await createYcsfLocalServer(...)` и сразу ходить в `baseUrl`. `stop()` даёт тестам (и пользователям) детерминированное освобождение порта и ресурсов коннектора. Неявный «сразу слушает, но ты не знаешь когда» — магия, противоречит Constitution V.

### D-3 — Делегирование только через public API коннектора; без `NestFactory` (Constitution I, III)

**Решение**: Единственная интеграция — `createYandexHandler(appModule)` из `@ycforge/nestjs-connector`. Пакет не импортирует `@nestjs/core` баутстрап, не знает внутренних модулей коннектора (deep imports заблокированы его контрактом, docs/ARCHITECTURE.md §2), не трогает типы payload кроме экспортированных.

**Рациональность**: Если бы js-dev-tools реимплементировал вызов/app bootstrap — появилась бы вторая, расходящаяся реализация runtime (двойной источник истины). Принцип I/III: контракты коннектора версионируются и являются единственной runtime-семантикой; dev-server — просто трансформер on-wire → payload → handler → wire.

### D-4 — Entry contract: `AppModule`/default export из side-effect-free модуля, host-loader import (Constitution V)

**Решение**: Корневой модуль достаётся динамическим import'ом; приоритет named `AppModule` → default → fail-fast диагностики; entry не должен стартовать listener на import-тайме (main-guard паттерн, документируется). Пакет не транслирует.

**Рациональность**: Коннектор требует `Type<unknown>` — это единственный способ получить класс локально. Explicit-over-magic: ровно два документально-разрешённых экспорта + fail-fast на неоднозначность, никакого auto-discovery. Запрет transpile — осознанная граница: загрузка TS делегируется хост-загрузчику (например `tsx`), что снимает с инструмента ответственность за совместимость с метаданными декораторов NestJS. Альтернатива (встроить tsx/esbuild-register) — снова сделала бы пакет build-инструментом (зона C).

### D-5 — Payload fidelity с documented defaults для gateway-only полей

**Решение**: `pathParameters`, `parameters`, `operationId` — пустые (`{}`, `""`); `requestContext.apiGateway.operationContext` — `{}`. Все остальные поля события воспроизводятся точно (S-5).

**Рациональность**: Эти поля инжектятся API Gateway из его спецификации; локально спеки нет, а NestJS маршрутизирует сам по rawPath — пустые значения не влияют на ответ приложения. Фиделити остальных полей критична: приложения читают `headers`, `queryStringParameters`, `rawPath`, `body`, `requestContext` напрямую, и их поведение должно быть идентично облаку. Пустые дефолты — документированное отличие, а не магия.

### D-6 — Синтез raw context: required-поля коннектора + deterministic defaults ⊕ `yandexContext`

**Решение**: Сервер строит raw context, покрывающий все required-поля `buildYandexExecutionContext` (fail-loud в коннекторе). Отсутствующие платформенные поля — фиксированные defaults (`"local-function"`, `"local-dev"`, `"1024"`, `now+15000`, `""`); поля `yandexContext` merged поверх (override escape hatch).

**Рациональность**: Коннектор не коэрсит и бросается на невалидных значниях — сервер обязан дать корректный контекст. Deterministic defaults делают поведение стабильным и предсказуемым (те же значения между запусками). Override через `yandexContext` даёт тестам/пользователям настройку без отдельной параллельной схемы опций.

### D-7 — IAM-резолюция fail-open и без refresh в v1

**Решение**: Цепочка env → OAuth (`~/.yc/config.yaml`) → SA key (`~/.yc/keys/*`), каждый шаг обмена — через IAM API. Отсутствие токена/сетевые сбои → `undefined` + warning, сервер работает. Один резолв на старт, без TTL-refresh.

**Рациональность**: Local dev не должен фейлиться из-за отсутствия/протухания токена: без токена поле `token` в raw context просто отсутствует (опциональность уже заложена в контракте коннектора; при HTTP-диспатче `@YandexContext()`-параметр не заполняется в любом случае — граница A-13). Fail-open — правильная семантика окружения (в отличие от fail-fast на конфигурации, D-10). Refresh — отдельная фича (TTL управление), не обязательна для дебага локально.

### D-8 — `messageQueue: true` → fail-fast `JDT_MQ_UNSUPPORTED` (Constitution V)

**Решение**: Запрос MQ-эмуляции на старте — явная ошибка до поднятия сервера, а не silent ignore/заглушка с warning-only.

**Рациональность**: Constitution V: явное вместо магии, коллизии/неподдерживаемое — ошибки, не тихие деградации. Пользователь, указавший `messageQueue: true`, должен мгновенно узнать, что фичи нет, а не получить сервер, молча не делающий MQ. Семантика 404/пустых ответов для MQ-подобных путей была бы ложью.

### D-9 — Trace-id propagation: `uberTraceId` из `Uber-Trace-Id`, `X-Trace-Id` в ответ

**Решение**: `uberTraceId` контекста зеркалит входящий `Uber-Trace-Id`; ответ содержит `X-Trace-Id`; `trace_id == awsRequestId == requestId`.

**Рациональность**: IDEA §38 описывает прокидывание `trace-id`/IAM в `@YandexContext()`; на уровне 023 это означает синтез raw context с корректными полями (коннектор строит из него `YandexExecutionContext`; заполнение параметров декоратора при HTTP-диспатче — внутренняя граница Project A, см. A-13). Наблюдаемо у платформы: `uberTraceId` соответствует `Uber-Trace-Id` header, а тёплый/холодный trace — сквозной. Отдавая `X-Trace-Id` в ответе, локальная цепочка вызовов (приложение → исходящие вызовы) коррелируется так же, как в облаке. Коннектор уже ставит `trace_id = awsRequestId` — сервер лишь гарантирует равенство id в сыром контексте/событии.

### D-10 — Error semantics: fail-fast на конфигурацию, fail-open на окружение, 500 на инвокацию

**Решение**: Невалидные опции/entry/порт → жёсткая ошибка на старте (`JDT_*`). IAM/сеть → warning + работа без токена. Ошибка handler'а → HTTP 500 с `trace_id`, детали в лог.

**Рациональность**: Разделение по природе сбоя. Конфигурация — вина пользователя, её надо показать сразу (Constitution V). Окружение — временное, деградация лучше недоступности (D-7). Ошибка приложения — это runtime-ошибка приложения, которую клиент должен увидеть как 500, а разработчик — в логе; маскировать её успехом нельзя.

---

## User Scenarios & Testing

### User Story 1 — Разработчик запускает локальный сервер и получает ответ приложения через payload 2.0 (Priority: P1)

Разработчик `user_service` пишет:

```ts
createYcsfLocalServer({
  entry: './src/main.ts',
  apiGatewayV2: true,
  port: 3100,
  yandexContext: { token: await resolveIamToken(), folderId: 'folder123' },
});
```

Затем открывает `http://127.0.0.1:3100/api/users` — NestJS-контроллер отвечает как в облаке: сервер перевёл запрос в payload 2.0, вызвал handler коннектора (cold start на первом запросе), вернул envelope обратно. Контракт полей raw context проверяется unit-уровнем (`buildRawContext`, T018), сквозная корреляция per-request id (`trace_id == awsRequestId == requestId`) — через совпадение envelope-`trace_id`, ответного заголовка `X-Trace-Id` и лог-`trace_id` (см. AC3).

**Why this priority**: Ядро §38 — рабочая локальная инвокация через настоящий handler. Без неё остальные US бессмысленны.

**Independent Test**: Fixture: минимальное NestJS-приложение (`user_service` fixture: `GET /api/users` → `{ "users": [] }`), handler читается из публичного API. `await createYcsfLocalServer({ entry: <fixture module file>, port: 0-or-free })` → `fetch(baseUrl + '/api/users')` → 200 + JSON.

**Acceptance Scenarios**:

1. **Given** fixture-приложение и свободный порт, **When** `await createYcsfLocalServer(...)`, **Then** promise резолвится, `baseUrl` доступен, `fetch(baseUrl + '/api/users')` возвращает 200 и ожидаемый JSON.
2. **Given** первый запрос после старта, **When** он выполнен, **Then** ответ корректный (cold start завершён), повторный запрос отвечает быстрее (warm, handler переиспользован).
3. **Given** fixture-приложение с маршрутом, бросающим ошибку, **When** сервер обработал инвокацию, **Then** `trace_id` в JSON-envelope ошибки === значение заголовка `X-Trace-Id` ответа === `trace_id` в per-request лог-строке сервера (один uuid), а два разных запроса дают разные uuid. Контракт полей raw context (`token`, `functionFolderId`, defaults) проверяется unit-уровнем (`buildRawContext`, T018): `awsRequestId === requestId`, `token` присутствует только при заданном токене. Заполнение `@YandexContext()`-параметра при HTTP-диспатче — внутренняя граница Project A (см. A-13); fixture-контроллер, читающий `@YandexContext()`, локально вернёт 500 (`undefined`).
4. **Given** запрос с несуществующим путём, **When** передан, **Then** NestJS отдаёт 404 (маршрутизация локального приложения, а не сервера).

---

### User Story 2 — Payload 2.0 фиделити: запрос переведён в точный `RawHttpApiGatewayV2Event` (Priority: P1)

Разработчик отлаживает приложение, полагающееся на поля события: `rawQueryString`, повторяющиеся query/header, base64-тело, encoded path. Локальный сервер производит payload, неотличимый от облачного по всем полям, которые платформа выставляет для HTTP.

**Why this priority**: §38 «транслирует входящие запросы в API Gateway v2 payload»; фиделити — это договор об эмуляции. Плохой перевод = ложные баги «работает локально, падает в облаке».

**Independent Test**: Fixture-driven: для каждого типа запроса (GET без query, GET с повторяющимся query, POST JSON, form-urlencoded, бинарный body, encoded path) сгенерировать событие и сравнить по схеме/полям с ожидаемой эталонной структурой. Перевод — чистая функция, тестируется без сети.

**Acceptance Scenarios**:

1. **Given** GET `/api/users?tags=a&tags=b&limit=10`, **When** переведён, **Then** `version === "2.0"`, `rawPath === "/api/users"`, `rawQueryString === "tags=a&tags=b&limit=10"`, `queryStringParameters.tags === "a,b"`, `multiValueParameters.tags === ["a","b"]`, `queryStringParameters.limit === "10"`.
2. **Given** POST JSON `{"name":"x"}`, **When** переведён, **Then** `body === "{\"name\":\"x\"}"`, `isBase64Encoded === false`, `requestContext.http.method === "POST"`, `requestContext.http.path` содержит query-суффикс при его наличии.
3. **Given** заголовок повторяется дважды (`X-Foo: a`, `X-Foo: b`), **When** переведён, **Then** `headers["X-Foo"] === "a,b"` (gateway comma-join).
4. **Given** бинарный body (например PNG bytes), **When** переведён, **Then** `body` — base64-строка, `isBase64Encoded === true`, декодирование `Buffer.from(body,'base64')` восстанавливает исходные байты.
5. **Given** GET без query, **When** переведён, **Then** `rawQueryString === ""`, `queryStringParameters === {}`, `multiValueParameters === {}`, `pathParameters === {}`, `parameters === {}`, `operationId === ""`.
6. **Given** encoded path `/api/users%2Factive`, **When** переведён, **Then** `rawPath === "/api/users%2Factive"` (без декодирования) и NestJS маршрут обрабатывает запрос как в облаке.

---

### User Story 3 — IAM token resolution: цепочка env → OAuth → SA key и прокидывание в `@YandexContext()` (Priority: P1)

Разработчик хочет, чтобы локальные вызовы IAM-зависимых частей приложения работали с настоящим (обмененным) IAM-токеном, а без токена сервер не падал.

**Why this priority**: IDEA §38 задаёт цепочку явно; токен — секрет, но локальная разработка с Lockbox/`@YandexContext().token` требует его или честного отсутствия.

**Independent Test**: env-путь (нет сети), OAuth-путь (мок IAM exchange), SA-key путь (мок JWT+exchange) — unit-тесты с замоканными HTTP-энпоинтами и temp-`~/.yc`.

**Acceptance Scenarios**:

1. **Given** `YC_IAM_TOKEN=abc` в env, **When** `resolveIamToken()`, **Then** возвращает `"abc"` (без сетевых вызовов).
2. **Given** нет env, `~/.yc/config.yaml` с OAuth-токеном, **When** `resolveIamToken()`, **Then** выполняется обмен (мок IAM API), возвращается IAM-токен.
3. **Given** нет env и нет config.yaml, но есть `~/.yc/keys/sa-key.json`, **When** `resolveIamToken()`, **Then** формируется JWT (iss/sub от ключа) и выполняется обмен (мок), возвращается IAM-токен.
4. **Given** приоритет env + присутствует OAuth-конфиг, **When** `resolveIamToken()`, **Then** результат из env (порядок приоритетный, config не читается).
5. **Given** разрешить токен невозможно (нет env/config/ключей или сетевой сбой), **When** `createYcsfLocalServer({ entry, yandexContext: {} })`, **Then** сервер стартует, warning `JDT_IAM_UNAVAILABLE` один раз, в raw context поле `token` отсутствует, запросы работают.
6. **Given** сервер стартовал с токеном, **When** лог старта выведен, **Then** значение токена в логе отсутствует (секрет).

---

### User Story 4 — Response mapping: envelope коннектора вернулся клиенту без искажений (Priority: P2)

Приложение отвечает через NestJS: статусы, заголовки, cookie, бинарные тела (картинки, файлы). Локально клиент должен получить ровно то, что отдал бы API Gateway.

**Why this priority**: Ответ — вторая половина контракта инвокации; искажения (потерянные заголовки, сломанный base64) читаются как баги приложения.

**Independent Test**: Fixture-controller, возвращающий: 201 + заголовок; 302 + Location; два `Set-Cookie`; бинарный body (svg/png). Проверка куратором ответа.

**Acceptance Scenarios**:

1. **Given** controller возвращает `{ statusCode: 201, headers: { 'X-Custom': 'v' }, body: '{"ok":true}', isBase64Encoded: false }`, **When** запрос выполнен, **Then** HTTP-ответ 201, `X-Custom: v`, тело `{"ok":true}`.
2. **Given** response envelope с `multiValueHeaders['set-cookie'] = [c1, c2]`, **When** запрос выполнен, **Then** HTTP-ответ содержит две отдельные строки `Set-Cookie` (c1 и c2).
3. **Given** envelope с `isBase64Encoded: true` и base64-body, **When** запрос выполнен, **Then** клиент получает бинарное тело, декодированное из base64 (байт-в-байт).
4. **Given** handler-контроллер бросает ошибку, **When** запрос выполнен, **Then** HTTP 500, JSON `{ error, message, trace_id }`, заголовок `X-Trace-Id` присутствует, секреты отсутствуют.

---

### User Story 5 — Конфигурация валидируется fail-fast до старта (Priority: P2)

Разработчик ошибся в опциях: `messageQueue: true`, пустой/неверный `entry`, занятый порт. Ошибка должна быть понятной, мгновенной и с кодом диагностики — не тихий режим «вроде работает».

**Why this priority**: Constitution V — явное вместо магии; D-8/D-10 — быстрая и однозначная обратная связь на невалидную конфигурацию критична для UX dev-tooling.

**Independent Test**: Вызвать `createYcsfLocalServer` с каждой невалидной опцией, проверить отклонённый promise + diagnostics-сообщение.

**Acceptance Scenarios**:

1. **Given** `messageQueue: true`, **When** `createYcsfLocalServer(...)`, **Then** promise отклоняется с `JDT_MQ_UNSUPPORTED`, сервер не слушает порт.
2. **Given** `apiGatewayV2: false, messageQueue: false`, **When** вызов, **Then** отклонение `JDT_NO_TRANSPORT`.
3. **Given** `entry: './does-not-exist.ts'`, **When** вызов, **Then** отклонение `JDT_ENTRY_RESOLVE_FAILED`.
4. **Given** entry без экспорта корневого модуля, **When** вызов, **Then** отклонение `JDT_ENTRY_MODULE_NOT_FOUND` с указанием допустимых экспортов (`AppModule`/default).
5. **Given** entry с и named `AppModule`, и другим default-классом, **When** вызов, **Then** отклонение `JDT_ENTRY_MODULE_AMBIGUOUS`.
6. **Given** занятый `port`, **When** вызов, **Then** отклонение `JDT_PORT_IN_USE` с указанием порта.

---

### User Story 6 — Graceful lifecycle: `stop()` освобождает порт и ресурсы (Priority: P2)

Тесты и скрипты несколько раз стартуют/останавливают сервер (например, в cycle тестов или при перезапуске после правки). `stop()` детерминированно закрывает listener и вызывает teardown коннектора.

**Why this priority**: Повторяемость локального цикла; утечка портов/ресурсов ломает следующий запуск.

**Independent Test**: `const s = await createYcsfLocalServer(...)`; `await s.stop()`; повторный `createYcsfLocalServer` на том же порту успешен.

**Acceptance Scenarios**:

1. **Given** работающий сервер на порту P, **When** `await s.stop()`, **Then** listener закрыт, `fetch(s.baseUrl)` падает с connection refused, повторный старт на порту P успешен.
2. **Given** `stop()` вызван дважды, **When** повторный вызов, **Then** не бросает (idempotent), ничего не ломает.
3. **Given** `stop()` во время in-flight запроса, **When** запрос, **Then** текущая инвокация завершается корректно (нет обрыва середины) и последующие соединения отклоняются.

---

### User Story 7 — Observability: понятный старт и per-request трассировка (Priority: P3)

Разработчик видит, что сервер поднялся, какие обработчики/режим активны, статус IAM, и по каждой инвокации — method/path/status/latency/trace-id. Секреты не светятся.

**Why this priority**: Dev-tooling обязан быть прозрачным; корреляция локальных запросов по trace-id — то, что ждёт разработчик, привыкший к облачным логам.

**Independent Test**: Unit-проверка форматных функций/запуска с захватом stderr.

**Acceptance Scenarios**:

1. **Given** успешный старт, **When** лог выведен, **Then** stderr содержит `http://127.0.0.1:<port>`, режим `apiGatewayV2`, статус IAM (resolved/bез токена) — и не содержит значение токена.
2. **Given** два запроса, **When** выполнены, **Then** per-request строки содержат `GET /api/users → 200 (N ms) trace_id=<id>` c разными id.
3. **Given** ошибочная инвокация (handler throw), **When** запрос, **Then** лог содержит stack/ошибку с тем же `trace_id`, что в HTTP-ответе.
4. **Given** токен присутствует в опциях, **When** моделируется любой вывод, **Then** значение токена не встречается в логах (redaction).

---

### Edge Cases

- **Port уже занят другим процессом**: fail-fast `JDT_PORT_IN_USE` до любых побочных эффектов (handler не создаётся).
- **Entry — CJS vs ESM**: dynamic import работает для обоих (Node interop); default export CJS-модуля — объект `module.exports`; если это класс — валидный корневой модуль.
- **Entry имеет side-effect (слушает порт)**: документировано как нарушение контракта (A-6); сервер не может надёжно детектировать, диагностика — только отсутствие модуля.
- **Пустой `rawQueryString`**: `""`, не `undefined`; `queryStringParameters`/`multiValueParameters` — пустые объекты.
- **`Content-Type: application/x-www-form-urlencoded`**: тело передаётся без re-encoding, `isBase64Encoded: false`.
- **Бинарное тело со слабо-валидным UTF-8**: правило — text/JSON content-type или валидный UTF-8 buffer → текст, иначе base64 (детерминированный выбор, документируется).
- **HEAD/OPTIONS**: проходят как обычные метода; NestJS сам решает, как ответить.
- **Множественные `Set-Cookie` в envelope**: multiValueHeaders → отдельные заголовки (не comma-join).
- **Handler возвращает не-envelope (неизвестная форма)**: сервер отвечает 500 с `trace_id` (fail-open на неизвестном результате, как `boundaryStatus` в коннекторе).
- **IAM network сбой при резолве**: `resolveIamToken` возвращает `undefined` + причина; сервер стартует с warning (нет retry-политики в v1).
- **Одновременные запросы при cold start**: коннектор шарит promise инициализации — идентичная облаку конкуренция, сервер ничего не придумывает.
- **`yandexContext` известен на старте, не меняется на лету**: per-request контекст отличается только id/временем; поля токена/folderId/cloudId стабильны в течение жизни сервера.

---

## Requirements

### Functional Requirements

**Package & API surface**

- **FR-001**: System MUST экспортировать `createYcsfLocalServer` и `resolveIamToken` из subpath `@ycforge/js-dev-tools/server` (единственный public export v1).
- **FR-002**: System MUST принимать options `{ entry, apiGatewayV2?, messageQueue?, port?, yandexContext? }` с defaults: `apiGatewayV2=true`, `messageQueue=false`, `port=3000`, `yandexContext={}`.
- **FR-003**: System MUST возвращать `Promise<LocalDevServer>` (`{ port, baseUrl, stop() }`), резолвящийся после bind, и отклоняться с diagnostics-кодом при любой ошибке старта.
- **FR-004**: System MUST fail-fast на конфигурации: `messageQueue:true` → `JDT_MQ_UNSUPPORTED`; `!apiGatewayV2 && !messageQueue` → `JDT_NO_TRANSPORT`; занятый порт → `JDT_PORT_IN_USE`; нерезолвимый `entry` → `JDT_ENTRY_RESOLVE_FAILED`. Ни один из этих случаев не поднимает listener и не создаёт handler.

**Entry & delegation**

- **FR-005**: System MUST загружать `entry` через стандартный dynamic import хост-процесса **без собственной трансформации кода** (JS или TS под хост-загрузчиком).
- **FR-006**: System MUST извлекать корневой NestJS-модуль `Type<unknown>`: named export `AppModule` → иначе default export → иначе `JDT_ENTRY_MODULE_NOT_FOUND`; оба экспорта, если это разные классы → `JDT_ENTRY_MODULE_AMBIGUOUS`.
- **FR-007**: System MUST создавать handler ровно один раз через публичный `createYandexHandler(appModule)` из `@ycforge/nestjs-connector` и вызывать его как `(rawEvent, rawContext) => Promise<unknown>`.
- **FR-008**: System MUST NOT вызывать `NestFactory.create` и MUST NOT импортировать internal-модули nest-bridge (deep imports); только экспортированный public API и экспортированные типы события/ответа/контекста.
- **FR-009**: System MUST на `stop()` закрывать listener и вызывать `close()` handler-а коннектора (idempotent).

**Payload 2.0 translation**

- **FR-010**: System MUST переводить входящий HTTP-запрос в событие типа `RawHttpApiGatewayV2Event` с `version: "2.0"`, `rawPath` = необработанный (без декодирования) URL-path, `rawQueryString` = необработанная query-строка.
- **FR-011**: System MUST строить `headers` как map; повторяющиеся заголовки — comma-joined одной строкой.
- **FR-012**: System MUST парсить query в `queryStringParameters` (повторяющиеся — comma-joined) и сохранять мультиплицитность в `multiValueParameters`.
- **FR-013**: System MUST заполнять `requestContext`: `authorizer: {}`, `http: { method, path, sourceIp, userAgent }`, `requestId` (per-request), `time` (Apache CLF), `timeEpoch` (seconds), `apiGateway: { operationContext: {} }`.
- **FR-014**: System MUST читать тело запроса целиком (Buffer): текст (text/JSON content-type или валидный UTF-8) → строка c `isBase64Encoded: false`; иначе base64 c `isBase64Encoded: true`; пустое тело → `""` + `false`.
- **FR-015**: System MUST выставлять `pathParameters: {}`, `parameters: {}`, `operationId: ""` (gateway-only поля, документированный дефолт локально).

**Execution context**

- **FR-016**: System MUST синтезировать raw context со всеми required-полями коннектора: `awsRequestId` (string), `functionName`, `functionVersion`, `functionFolderId`, `memoryLimitInMB` (string), `logGroupName` (string), `deadlineMs` (number); defaults для платформенных полей: `"local-function"`, `"local-dev"`, `"1024"`, `Date.now()+15000`, `""`; поля `yandexContext` merged поверх defaults.
- **FR-017**: System MUST пробрасывать `yandexContext.token` → `token` в raw context (поле присутствует в raw context — вход для `buildYandexExecutionContext`; чтение в приложении идёт через контракт `@YandexContext()`, заполнение которого при HTTP-диспатче — граница Project A, см. A-13); без токена поле отсутствует. Значение токена MUST NOT попадать в логи или body ответа.
- **FR-018**: System MUST пробрасывать `yandexContext.folderId` → `functionFolderId` и `yandexContext.cloudId` → поле `cloudId` в raw context.
- **FR-019**: System MUST генерировать per-request id, одинаковый для `awsRequestId`, `requestContext.requestId` и (через коннектор) `trace_id`.
- **FR-020**: System MUST устанавливать `uberTraceId` raw context из заголовка `Uber-Trace-Id` входящего запроса (если есть) и MUST включать `X-Trace-Id` в response headers.

**Response mapping**

- **FR-021**: System MUST мапить `YandexFunctionHttpResponse`: `statusCode` → HTTP-статус; `headers` → одиночные заголовки; `multiValueHeaders` → каждый элемент отдельным заголовком (не comma-join); `body` + `isBase64Encoded` → строка либо `Buffer.from(body,'base64')`.
- **FR-022**: System MUST при ошибке инвокации отвечать HTTP 500 с JSON и заголовком `X-Trace-Id`; для результатов вне valid envelope — `{ error, message, trace_id }` (errorResponse), при throw внутри NestJS — envelope коннектора как есть (наблюдаемый body `{ statusCode, message, trace_id }`; T050 probe); в обоих случаях `body.trace_id === X-Trace-Id === лог trace_id`; детали (stack) в лог, секреты из response/логов исключены.

**IAM token resolution**

- **FR-023**: System MUST реализовывать `resolveIamToken()`: 1) `YC_IAM_TOKEN` env (as-is, без сети); 2) `~/.yc/config.yaml` OAuth → exchange (IAM API); 3) `~/.yc/keys/*` SA key → JWT → exchange (IAM API). Приоритет строгий, первый успех — финальный.
- **FR-024**: System MUST быть fail-open: недоступность токена (нет env/конфига/ключей или сетевой сбой) → `undefined` + причина; сервер продолжает работу без токена, warning `JDT_IAM_UNAVAILABLE` один раз за старт.
- **FR-025**: System MUST резолвить токен до старта сервера и НЕ выполнять refresh в v1 (ротация — перезапуском).

**Observability & security**

- **FR-026**: System MUST выводить startup banner: URL, режим, статус IAM-resolution — без значения токена.
- **FR-027**: System MUST логировать каждую инвокацию строкой `method path → status (latency ms) trace_id=<id>` (стабильный формат).
- **FR-028**: System MUST не логировать и не выводить секреты: IAM-токен, `Authorization`, `Cookie` (AGENTS.md section 6.2).

**Diagnostics**

- **FR-029**: System MUST использовать коды семейства `JDT_*`: `JDT_MQ_UNSUPPORTED`, `JDT_NO_TRANSPORT`, `JDT_PORT_IN_USE`, `JDT_INVALID_PORT` (некорректное значение порта — не целое число в [0, 65535], fail-fast до probe/bind), `JDT_ENTRY_RESOLVE_FAILED`, `JDT_ENTRY_MODULE_NOT_FOUND`, `JDT_ENTRY_MODULE_AMBIGUOUS` (ошибки старта), `JDT_IAM_UNAVAILABLE` (warning).

### Key Entities

- **LocalDevServer** — handle от `createYcsfLocalServer`: `{ port: number, baseUrl: string, stop(): Promise<void> }`; инкапсулирует listener + handler коннектора.
- **YcsfLocalServerOptions** — входной контракт: `entry`, `apiGatewayV2`, `messageQueue`, `port`, `yandexContext`.
- **RawHttpApiGatewayV2Event** — тип события payload 2.0 из `@ycforge/nestjs-connector` (public API); цель translation.
- **RawHttpApiGatewayV2RequestContext** — `requestContext` того же события; synthesis по S-5.
- **YandexFunctionHttpResponse** — envelope ответа из коннектора; вход для response mapping.
- **YandexCloudFunctionHandler** — сигнатура handler-а (`(rawEvent, rawContext) => Promise<unknown>`), вызываемая сервером.
- **YandexExecutionContext** — normalized-контекст, который видит `@YandexContext()`; сервер влияет на него только через синтез raw context.
- **IamTokenResolver** — логика цепочки env → OAuth → SA key (FR-023).
- **LocalDevPayloadBuilder / LocalDevContextBuilder / LocalDevResponseMapper** — чистые преобразования (HTTP→event, ->rawContext, envelope→HTTP), тестируемые независимо.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: `await createYcsfLocalServer(...)` на fixture-приложении (`user_service` fixture) → первый запрос обработан (cold start) и повторный (warm) показывает p50 latency тёплой инвокации < 50 ms на локальной машине; ответ по shape эквивалентен облачному.
- **SC-002**: Payload-фиделити: для ≥6 типов запросов (GET без query, GET с query/повторами, POST JSON, form, бинарный body, encoded path) сгенерированное `RawHttpApiGatewayV2Event` совпадает с эталонной структурой по 100% полей, определённых S-5.
- **SC-003**: Контракт контекста (unit-уровень): `buildRawContext` даёт raw context с `token` (только если задан), `functionFolderId`, defaults `functionName`/`functionVersion`/`memoryLimitInMB`/`logGroupName`/`deadlineMs`, `awsRequestId === requestId`, `uberTraceId` verbatim из входящего `Uber-Trace-Id`; сквозная корреляция `trace_id == awsRequestId` подтверждается интеграционно: envelope-`trace_id` ошибки === `X-Trace-Id` ответа === лог-`trace_id` (Project A ставит `trace_id = awsRequestId` при построении `YandexExecutionContext`). Заполнение `@YandexContext()`-параметров при HTTP-диспатче — известная граница Project A (A-13), фиксируется как follow-up за spec 001.
- **SC-004**: IAM-цепочка подтверждена тестами: env-путь без сети; OAuth- и SA-key пути с моком IAM API; приоритет и fail-open (сервер стартует без токена) покрыты.
- **SC-005**: Response mapping без потерь: 201+заголовок, 302+Location, два `Set-Cookie` (отдельные строки), бинарный body — байт-в-байт.
- **SC-006**: Error paths: `messageQueue:true`, `!apiGatewayV2&&!messageQueue`, занятый порт, bad entry — отклонение promise с правильным кодом `JDT_*` до любых побочных эффектов; throw handler-а → HTTP 500 с `trace_id`.
- **SC-007**: 100% FR-001..FR-029 покрыты тестами (Constitution II: каждый FR → ≥1 тест, RED → GREEN). `typecheck`/`lint` пакета чисто. Тесты не требуют доступа к Yandex Cloud (IAM exchange мокается; сеть — только для backoff-кейсов с локальным mock-сервером).
- **SC-008**: Граница делегирования верифицируется статически: код пакета не содержит импортов `@nestjs/core`/`NestFactory` и internal-путей `nestjs-connector`; используется только его публичный API.

---

## Assumptions

- **A-1 — Node ≥22, ESM**: `"type": "module"`; `import()` для entry; `node:fetch`/`node:http`, `node:crypto` (uuid) — built-ins.
- **A-2 — Хост loader для TS**: пакет не транслирует; документация рекомендует запуск dev-server через TS-совместимый загрузчик (`tsx`/`node --import`) либо `entry` на собранный JS. `tsx` — devDependency (тесты), не runtime-зависимость.
- **A-3 — Bind по умолчанию `127.0.0.1`**: локальный сервер не публикуется; публичный host — отдельная опция/future.
- **A-4 — Buffered body**: v1 читает тело целиком (как коннектор получает его в payload); streaming/SSE — future.
- **A-5 — Монопроцессная модель**: сервер и приложение живут в одном Node-процессе; глобальное состояние приложения шарится инвокациями (как в тёплом окружении облака).
- **A-6 — Entry — side-effect-free модуль с экспортом модуля**: канонический `main.ts` использует main-guard (`if (isMainModule()) { bootstrap(); }`) или `entry` указывает файл модуля; bootstrap на import-тайме — нарушение контракта (FR-005). Диагностика — `JDT_ENTRY_MODULE_NOT_FOUND`.
- **A-7 — `yandexContext` стабилен на старте**: токен/folderId/cloudId не меняются per-request; в течение жизни сервера поля контекста стабильны.
- **A-8 — Токен резолвится один раз**: TTL IAM-токена (~12ч/1ч для SA) локально не управляется в v1; refresh — future.
- **A-9 — No refresh/retry на IAM**: сетевая ошибка → `undefined` без retry (fail-open).
- **A-10 — `multiValueParameters` vs `pathParameters`**: локально отсутствует gateway-спека; пустые значения не влияют на NestJS-маршрутизацию (D-5).
- **A-11 — Кодирование body де-факто**: text/JSON content-type или валидный UTF-8 buffer → string; иначе base64. Грей-зоны (бинарный content-type, но валидный UTF-8 buffer) разрешаются детерминированно в пользу text — документируется в README пакета.
- **A-12 — Секретный класс безопасности**: токен/авторизационные заголовки не логируются (AGENTS.md 6.2), не попадают в ответы; это проверяется тестами.
- **A-13 — Известная граница Project A: HTTP-диспатч не заполняет `@YandexContext()`-параметры**: эмулятор ответственен за синтез raw context, а контракт `@YandexContext()`-параметров заполняется внутри коннектора. Эмпирически (spec 001): коннектор диспатчит HTTP-контроллеры через нативный Nest router (`YandexHttpAdapter.dispatch` / `runDispatch`) и НЕ инжектит значения в параметры декоратора; параметры заполняются только на MQ-пути (`getYandexContextParameterIndexes`). Поэтому fixture-контроллер, читающий `@YandexContext()`, локально получит `undefined`/500. 023 фиксирует это как известную границу с follow-up за spec 001 (amendment/future, вне 023): контракт контекста тестируется unit-уровнем (`buildRawContext` → `buildYandexExecutionContext`, T018), интеграция — trace-correlation по per-request id (US1-SC3 AC3, SC-003).

---

## Dependencies

| Dep | Что даёт | Статус |
|-----|----------|--------|
| 001 `connector-reverse` | `createYandexHandler(appModule)`, `ClosableYandexCloudFunctionHandler`, `RawHttpApiGatewayV2Event`, `RawHttpApiGatewayV2RequestContext`, `YandexFunctionHttpResponse`, `YandexExecutionContext` — весь runtime вызова | ✅ |
| 003 `connector-require-auth` | `GlobalAuthGuard`/`@RequireAuth` работают локально: заголовки запроса передаются verbatim, guard-пайплайн — внутри коннектора | ✅ |
| 004 `connector-observability` | `trace_id` в контексте (== `awsRequestId`), boundry-логи коннектора; сервер лишь гарантирует равенство id | ✅ |
| Core: `node:http`, `node:crypto`, built-in IAM calls | HTTP-сервер, per-request id, IAM exchange | built-in |

Без 001 нет handler-а и типов payload — 023 полностью опирается на контракты Project A и не меняет их (Constitution III). 023 — **чистый dev-tooling слой поверх public API коннектора** (Constitution I: не A, не C).

---

## Open Questions

- **Q-1 — Entry: как быть со «штатным» `main.ts`, который на import-тайме вызывает `bootstrap()`?** → **Решение**: Документированный контракт — entry должен быть side-effect-free модулем, экспортирующим `AppModule` (named) или default; «боевой» `main.ts` использует main-guard, либо `entry` указывает файл модуля (`src/app.module`). Детектировать side-effect сервер не может (магия), поэтому — контракт + fail-fast по отсутствию экспорта.
- **Q-2 — Куда попадает `cloudId`, если в normalized-контексте его нет?** → **Решение**: В raw context (через escape hatch `@YandexContext().raw`). Добавление typed-поля `cloudId` в `YandexExecutionContext` — изменение контракта коннектора (spec 001 amendment/future), вне 023.
- **Q-3 — IAM-токен протухает (TTL ~12ч/1ч). Refresh или один резолв?** → **Решение**: v1 — один резолв на старт, ротация перезапуском; refresh с TTL-планированием — отдельная future-фича (D-7).
- **Q-4 — Bind host: только loopback или опция?** → **Решение**: v1 — `127.0.0.1` (A-3); опция host — future.
- **Q-5 — `@YandexContext()` не заполняется при HTTP-диспатче (Project A gap)**: коннектор инжектит параметры декоратора только на MQ-пути; HTTP-маршрут диспатчится нативным Nest router без заполнения параметров → fixture-контроллер с `@YandexContext()` возвращает 500. **Не блокирует v1**: 023 фиксирует границу A-13 — контракт контекста верифицируется unit-уровнем (`buildRawContext`), сквозная корреляция — trace-correlation (US1-SC3 AC3). Заполнение параметров по HTTP-пути — follow-up за Project A (spec 001 amendment/future), вне 023.

Все вопросы — **не блокируют** v1; ответы зафиксированы как решения/assumptions.

---

## References

- IDEA.md §38: Local development — `@ycforge/js-dev-tools`, `createYcsfLocalServer`, payload 2.0, token-цепочка `YC_IAM_TOKEN` → `~/.yc/config.yaml` → `~/.yc/keys`, прокидывание `trace-id`/IAM через синтез raw context (реализация `@YandexContext()`-параметров — граница Project A, A-13)
- Constitution I: A/B/C/Terraform separation — js-dev-tools это dev-tooling, не runtime (A), не orchestration (C), не provisioning
- Constitution II: Spec-first, Test-first (каждый FR → ≥1 тест, RED → GREEN)
- Constitution III: Contracts versioned — 023 не меняет контракты коннектора, использует public API
- Constitution V: Explicit over magic — entry contract, пустые gateway-поля, fail-fast на конфигурации, fail-open на окружении
- `packages/nest-bridge/src/index.ts:16` — `createYandexHandler`, публичные типы (единственный public entry)
- `packages/nest-bridge/src/http/raw-event.ts:15-63` — `RawHttpApiGatewayV2RequestContext`, `RawHttpApiGatewayV2Event` (payload 2.0 shape)
- `packages/nest-bridge/src/http/response.ts:9-33` — `YandexFunctionHttpResponse` (envelope ответа)
- `packages/nest-bridge/src/context/build-yandex-execution-context.ts:26-118` — required-поля raw context (fail-loud)
- `packages/nest-bridge/src/core/create-yandex-handler.ts:63-70` — сигнатура и lazy cold start
- `packages/nest-bridge/src/core/handler-options.ts:56-57` — `CreateYandexHandlerOptions` (опционально пробросить)
- `packages/nest-bridge/fixtures/http/get-without-query.json:65-76` — наблюдаемый raw context (эталон синтеза)
- `pnpm-workspace.yaml:1` — workspace `packages/*` (новый пакет подхватывается автоматически)

---

## Next Steps

1. `/speckit.plan` — технический дизайн: `packages/js-dev-tools` структура (`src/server/create.ts`, `src/server/payload.ts`, `src/server/context.ts`, `src/server/response.ts`, `src/server/iam.ts`, `src/server/diagnostics.ts`), точный маппинг полей payload (S-5), подпись handler-а, диагностики `JDT_*`, тест-фикстуры (`user_service` fixture-приложение через `createYandexHandler`), вариант запуска из корня репо.
2. `/speckit.tasks` — разбивка на задачи с test-first (RED → GREEN) по US-1..US-7, FR-001..FR-029.
3. `/speckit.analyze` — консистентность spec/plan/tasks.
4. `/speckit.implement` — код, тесты, typecheck/lint; при расхождении §38 IDEA.md с фактическим API — обновить IDEA.md (specs первичны).
5. `/speckit.converge` — аудит, roadmap 023 → ✅.

---

## Checklist (для `/speckit.analyze`)

- [ ] Каждый FR имеет ≥1 acceptance scenario в User Stories (traceability)
- [ ] Перевод HTTP → payload 2.0 определён по полям (S-5) с documented defaults для gateway-only полей
- [ ] Входной контракт `entry` (AppModule/default, виде-эффект-free, host-loader) определён и fail-fast на неоднозначность
- [ ] Delegation boundary: только public API `createYandexHandler`, без `NestFactory` и deep imports (статически проверяется)
- [ ] Синтез raw context покрывает все required-поля коннектора (fail-loud) + defaults
- [ ] IAM-цепочка (env → OAuth → SA key), приоритет, fail-open, разовый резолв — определены
- [ ] Response mapping (включая multiValueHeaders/Set-Cookie и base64) определён
- [ ] Error semantics разделены: fail-fast на конфигурации (`JDT_*`), fail-open на окружении, 500 на инвокации
- [ ] Секреты (token, Authorization, Cookie) не логируются и не попадают в ответы
- [ ] Constitution I–VI не нарушены (dev-tooling пакет, не A/C; контракты коннектора не меняются)
- [ ] Out of scope явно отложен (MQ-эмуляция, transpile, hot-reload, HTTPS, streaming, refresh)
- [ ] MQ-эмуляция: `messageQueue:true` — fail-fast, не silent ignore
- [ ] Success criteria измеримые, не зависящие от сети к Yandex Cloud (IAM мокается)