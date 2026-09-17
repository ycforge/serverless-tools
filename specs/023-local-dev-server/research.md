# Research: local-dev-server (spec 023)

**Spec**: [specs/023-local-dev-server/spec.md](./spec.md) | **Branch**: `023-local-dev-server` | **Date**: 2026-09-11

Решения технических неопределённостей Phase 0, заземлённые на локальное чтение кода (все ссылки — файлы репозитория, сети нет). Каждый раздел — Decision / Rationale / Alternatives / Влияние.

---

## R-1 — Монорепо-конвенции нового пакета `packages/js-dev-tools`

**Decision**: Пакет зеркалирует nest-bridge 1-в-1 по конвенциям:

- `pnpm-workspace.yaml:1` — `packages/*` подхватывает новый пакет автоматически; зависимости — `workspace:*`.
- `package.json`: `"name": "@ycforge/js-dev-tools"`, `"type": "module"`, `"engines": { "node": ">=22" }`, `"exports"`: единственный subpath `"./server"` с `{ types, import, require }` (энтри-стиль nest-bridge `./auth`/`./queue`/`./context`/`./logger` в `packages/nest-bridge/package.json:25-51`). Root export отсутствует (spec S-1: «root export не требуется») — импорт из `@ycforge/js-dev-tools` без subpath даст `ERR_PACKAGE_PATH_NOT_EXPORTED`, это контракт.
- Сборка: `tsup` (как nest-bridge/composer), entry `{ 'server/index': 'src/server/index.ts' }`, `format: ['esm','cjs']`, `dts`, `clean`, `sourcemap`, `minify: false` (зеркало `packages/nest-bridge/tsup.config.ts:3-16`). CJS-леги от tsup дают dist `server/index.cjs` — `exports["./server"].require` указывает на него.
- `tsconfig.json` — точная копия nest-bridge (strict, `noUncheckedIndexedAccess`, `experimentalDecorators`+`emitDecoratorMetadata` нужны для fixture-модулей тестов с `@Controller`/`@Get` из NestJS; `types: ["node", "vitest/globals"]`).
- `vitest.config.ts` — копия nest-bridge со swc-плагином emit-decorator-metadata (`packages/nest-bridge/vitest.config.ts:14-33`): fixture-приложения в `test/` используют NestJS DI через `design:paramtypes`, esbuild/vite его не шлют. `pool: threads, maxWorkers: 2, maxConcurrency: 1`, `include: ['src/**/*.spec.ts', 'test/**/*.spec.ts']`.
- Скрипты: `build: tsup`, `test: tsup && vitest run`, `typecheck: tsc --noEmit` (pattern nest-bridge `package.json:59-63`).
- `dependencies`: `@ycforge/nestjs-connector` (`workspace:*`) — единственная runtime-зависимость от рантайма; `yaml` (парсинг `~/.yc/config.yaml`, S-8; уже используется composer/pilot репо). `peerDependencies`: `@nestjs/common`/`@nestjs/core` (spec S-1; пакет их не импортирует, но host-процесс содержит приложение пользователя, и peer-контракт честно это декларирует). `devDependencies`: `tsup`, `vitest`, `typescript`, `@types/node`, `reflect-metadata` (tests), `tsx` (только host-запуск/тесты, НЕ runtime; spec S-1), `@nestjs/common`/`@nestjs/core` (fixtures).

**Rationale**: Единый стиль пакетов (A/B/C) снижает стоимость ревью и эксплуатации; tsup-дуал-билд совместим и с ESM, и с CJS host-процессами. swc-плагин обязателен — без него fixture `@YandexContext()` в тестах вернёт `undefined` (та же проблема, что решена в nest-bridge).

**Alternatives**: 1) Положить код в nest-bridge — заблокировано Constitution I + spec D-1. 2) esbuild/rollup вместо tsup — в репо нет прецедента.

**Влияние**: `packages/js-dev-tools/{package.json, tsconfig.json, tsup.config.ts, vitest.config.ts}`.

---

## R-2 — Delegation boundary: публичный API коннектора (единственная интеграция)

**Decision**: Рукопожатие только с `createYandexHandler(appModule)` из `@ycforge/nestjs-connector`:

- Сигнатура (`packages/nest-bridge/src/core/create-yandex-handler.ts:63-70`): `createYandexHandler(appModule: Type<unknown>, options?: CreateYandexHandlerOptions): ClosableYandexCloudFunctionHandler`. Синхронная, создаёт handler **без побочных эффектов** — bootstrap ленивый на первый инвокации (`applicationPromise` внутри замыкания, `:87-119`), конкурентные cold start шарят один promise.
- `ClosableYandexCloudFunctionHandler` = `YandexCloudFunctionHandler` + `close(): Promise<void>` (idempotent, `:30-44`, `:197-207`; `applicationPromise` сбрасывается, повторный вызов безопасен). `LocalDevServer.stop()` обязан звать `close()` (S-4, FR-009).
- Handler вызывается ровно как `(rawEvent, rawContext) => Promise<unknown>` — тип `YandexCloudFunctionHandler` (`src/core/transport.ts:24-27`). Внутри handler сам детектит транспорт (`detect-transport.ts:20-31`) и для HTTP возвращает **envelope ответа** `YandexFunctionHttpResponse` (транспорт `http/adapter.ts:41-62` → `dispatch` → `serializeResponse`). Никакого доступа к `InvocationContainer`/`NestFactory` из js-dev-tools — глубокие импорты заблокированы контрактом пакета (`src/index.ts:1-13`, docs/ARCHITECTURE.md §2).
- Транспортная детекция: HTTP-транспорт заявляет событие по `version === "2.0"` + string `rawPath` + string `rawQueryString` (`src/http/adapter.ts:29-39`). Эмулятор обязан собрать событие именно с такими полями (S-5 их выставляет — совпадает).
- `CreateYandexHandlerOptions` (`src/core/handler-options.ts:56-57`) — опционально прокидвается как `options` второго аргумента; v1 сервера не вводит своих опций для коннектора и вызывает `createYandexHandler(appModule)` без options (spec: «один handler создаётся через `createYandexHandler(appModule)`»). Escape hatch: опция `handlerOptions` у сервера — future, не v1 (explicit-over-magic).

**Rationale**: FR-008 запрещает `NestFactory` и deep imports; единственный разрешённый путь — публичный `createYandexHandler`. Detection-контракт (`version 2.0` + rawPath/rawQueryString) подтверждает, что S-5-маппинга достаточно для HTTP-маршрутизации события.

**Alternatives**: 1) Собственный bootstrap (`NestFactory.create`) — вторая реимплементация runtime, нарушение I/III. 2) Импорт internal-модулей — блокировано exports-картой коннектора и FR-008.

**Влияние**: `src/server/connector.ts` (тонкий wrapper: create + close + вызов handler), SC-008.

---

## R-3 — Payload 2.0: эталонная структура события и фиделити-наблюдения

**Decision**: Полевый маппинг S-5 опирается на реальный тип `RawHttpApiGatewayV2Event` (`src/http/raw-event.ts:36-63`) и наблюдаемые фикстуры `fixtures/http/*.json`. Ключевые фиделити-факты из фикстур:

1. **`headers` — оригинальный кейс и порядок**: в облаке пробрасываются как присланы (`Accept`, `Host`, `User-Agent`, `X-Forwarded-For` — capital case). Node `http.IncomingMessage.headers` сам **lowercase-ит** имена и joins повторы с `, ` — его нельзя использовать. Воспроизведение — из `req.rawHeaders` (плоский массив `[name, value, ...]` с оригинальным кейсом без Node-нормализации).
2. **Comma-join повторов без пробела**: spec US2-SC3 — `headers["X-Foo"] === "a,b"`; RFC-style `, ` Node не годится.
3. **Query**: `rawQueryString` — verbatim (без повторного decode); `queryStringParameters` — **значения декодированы** (фикстура `url-encoded-query-values.json:30-35`: `text=%D1%82...` → `"тест"`, `%2F%3F%26%3D%25%23%2B` → `"/?&=%#+"`); повторы comma-join в `queryStringParameters` (`repeated-query-parameters.json:30-32`: `multi: "one,two,three"`), мультиплицитность в `multiValueParameters` (`:65-70`). Декодер — стандартная form-семантика (`+` → space, `decodeURIComponent`), совпадает с `URLSearchParams`; битый percent-escape → ленивый fallback на raw-подстроку (не бросать).
4. **`rawPath`**: платформа **декодирует** путь (`encoded-path-characters.json:9-10`: `X-Envoy-Original-Path: /probe/with%20space/and%2Fencoded%3Fchars` → `rawPath: /probe/with space/and/encoded`). **Spec S-5 + US2-SC6 требуют локально raw (без декодирования)** — `rawPath === "/api/users%2Factive"`. Спецификация первична: эмулятор отдаёт raw-путь из request line. Наблюдение фиксируется как **документированное отклонение эмулятора от платформы** для %-encoded путей (маршрутизация NestJS идёт по `event.rawPath` через `normalize-request.ts:34`, поэтому для %-сегментов локальный маршрут может не совпасть с облачным — см. R-10).
5. **`requestContext.http.path`**: не равен `rawPath + '?'` стереотипно: платформа **сортирует и переписывает кодировки** query (`repeated-query-parameters.json:38`: keys сортируются, `%20`→`+`, lowercase-hex; `normalize-request.ts:11-13` прямо говорит: `requestContext.http.path` «never consulted», он переупорядочивает параметры). Spec S-5 фиксирует формулу `path + ('?' + query)`, US2-SC2 требует лишь «query-суффикс при наличии». **Решение**: формула spec `rawPath + '?' + rawQueryString` (трайлинг-`?` при пустой query — как в фикстуре `get-without-query.json:35` `/probe/ping?`). Платформенная нормализация (сортировка/перекодировка) НЕ воспроизводится в v1 — иначе пришлось бы реимплементировать gateway-нормализатор (магия, Constitution V); фиксируется как документированное отклонение (R-10).
6. **`isBase64Encoded` на пустом/GET-теле**: платформа ставит `true` даже на bodiless GET (`get-without-query.json:53`, комментарий `normalize-request.ts:17-19`: флаг трекает «not application/json», включая пустые GET). **Spec FR-014/S-5 требует `""` + `false` для пустого тела** — следуем spec (R-10).
7. **`pathParameters`/`parameters`/`multiValueParameters`/`operationId`/`authorizer`/`apiGateway.operationContext`**: gateway-injected (`get-without-query.json` показывает `ID` catch-all и `operationId` хеш). Локально спеки нет — `{}`/`""`/`{}` по D-5/US2-SC5.
8. **`requestContext.time`** — Apache CLF `dd/Mon/yyyy:HH:mm:ss +0000` (`21/Aug/2026:21:44:34 +0000`), **`timeEpoch`** — секунды. Воспроизводим по UTC (`+0000`), детерминированно для тестов.
9. **`requestId`**: платформа отражает клиентский `X-Request-Id` при его наличии (`get-without-query.json:25,39` — один и тот же uuid и в заголовке, и в `requestId`, и в `awsRequestId`). **Spec FR-019 фиксирует «генерировать per-request id»** → v1 всегда `randomUUID()` (`node:crypto`), осознанное отличие от платформенного эха заголовка (R-10).

**Rationale**: Spec детерминирует все поля (S-5 таблица + US2). Где spec молчит (кейс заголовков, декодировка query, CLF), берём наблюдаемое платформенное поведение из фикстур. Где spec **спорит** с наблюдением (rawPath, isBase64Encoded на empty, requestId), spec первична — а отклонение документируется открыто, чтобы «работает локально ≠ облако» не стало сюрпризом (это прямо пункт US2 rationale).

**Alternatives**: 1) Воспроизводить платформенную нормализацию http.path (сортировка/перекодировка) — скрытая магия, Constitution V. 2) Декодировать rawPath «как в облаке» — нарушает явный US2-SC6.

**Влияние**: `src/server/payload.ts` (buildGatewayV2Event — чистая функция), `contracts/payload-event.json` (маппинг).

---

## R-4 — Response mapping: envelope → HTTP-ответ

**Decision**: `http.invoke` возвращает `Promise<YandexFunctionHttpResponse>` (`src/http/adapter.ts:41-62`); envelope снапнут как `{ statusCode, headers, multiValueHeaders?, body, isBase64Encoded }`, deep-frozen (`src/http/response.ts:9-33`, `serialize-response.ts:44-57`). Маппинг по S-7/FR-021:

- `statusCode` → `res.statusCode`.
- `headers` (одиночные) → `res.setHeader(name, value)`.
- `multiValueHeaders` → каждый элемент **отдельным** заголовком (`res.append`/повторный `setHeader`) — критично для нескольких `Set-Cookie` (комментарий entry `response.ts:20-28`: comma-join потерял бы данные, знак запятой легален в атрибуте Set-Cookie).
- `body` + `isBase64Encoded=false` → строка; `true` → `Buffer.from(body, 'base64')`.
- После маппинга envelope сервер безусловно ставит `X-Trace-Id: <trace_id>` (S-6/FR-020); коннектор не выдаёт этого заголовка в envelope (X-Trace-Id — платформенный, фикстуры показывают его в входящих `headers`, не в envelope), конфликта нет; если приложение само вернуло `X-Trace-Id` в headers/multiValueHeaders — серверный echo **перезаписывает** (корреляция важнее).
- **Не-envelope результат** (handler вернул не объект с number `statusCode` + string `body`, либо array/null): fail-open на неизвестной форме — HTTP 500 JSON `{ error, message, trace_id }` + `X-Trace-Id` (spec Edge Cases «Handler возвращает не-envelope»). Аналогично маркируем тайп-валидацию через узкий type guard `isYandexFunctionHttpResponse`.
- **Throw handler-а**: HTTP 500 JSON `{ error: <name/code>, message: <safe>, trace_id }` + `X-Trace-Id`; stack — в лог; секреты (token, Authorization, Cookie) — исключены из лога и тела.

**Rationale**: Единая точка маппинга envelope → wire (как `serialize-response` на in-пути коннектора — зеркальная пара). Не-envelope и throw — две разные семантики (невалидный контракт коннектора/приложения vs ошибка приложения), обе fail-open на 500 с trace_id (D-10).

**Alternatives**: 1) Ретранслировать результат как есть — сломает multiValueHeaders (Set-Cookie) и binary; envelope доступен только в мутированном виде. 2) Генерировать HTML-страницу ошибки — нарушает «JSON + trace_id» (FR-022).

**Влияние**: `src/server/response.ts` (mapEnvelopeToHttpServerResponse + error handler), тест US4.

---

## R-5 — Синтез raw context: обязательные поля коннектора

**Decision**: `buildYandexExecutionContext(rawEvent, rawContext)` (`src/context/build-yandex-execution-context.ts:26-80`) fail-loud требует на raw context: string `awsRequestId`, `functionName`, `functionVersion`, `functionFolderId`, `memoryLimitInMB`, `logGroupName`, number `deadlineMs` (`:93-111`); опциональные string `token`, `uberTraceId` копируются только когда string (`:113-118`). `trace_id` коннектор ставит равным `awsRequestId` (`:36-40`). Эталонный raw context — `fixtures/http/get-without-query.json:65-76` (все required + `requestId`, `invokedFunctionArn`, `token`, `uberTraceId`, `_data`).

Синтез сервера (`src/server/context.ts`, чистая функция):
- `awsRequestId` = `requestContext.requestId` = per-request `randomUUID()` (одинаковое значение, S-6/FR-019; коннектор сделает `trace_id` = этот же id → гарантировано `trace_id == awsRequestId == requestId`).
- `requestId` — то же значение (наблюдается у платформы: `get-without-query.json:66-67`).
- `functionName: "local-function"`, `functionVersion: "local-dev"`, `memoryLimitInMB: "1024"` (string! коннектор бросит на number), `logGroupName: ""`, `deadlineMs: Date.now() + 15000` (number; **per-request** — per-request поля отличаются id/временем, edge case spec).
- `functionFolderId: yandexContext.folderId ?? ""` (required → хоть и пустая, но string; spec S-6: «если задан» — при отсутствии ставим `""`, коннектор не упадёт; полного отсутствия required-поля коннектор не допускает).
- `token` — только если `yandexContext.token` задан (иначе поле отсутствует, spec FR-017; коннектор копирует только присутствующие).
- `uberTraceId` — только если входящий `Uber-Trace-Id` есть (copy verbatim, D-9).
- `cloudId` — `yandexContext.cloudId`, если задан (в raw context; в normalized его нет — только escape hatch `.raw`, Q-2/FR-018).
- прочие поля `yandexContext` merged поверх defaults (override escape hatch, spec S-6; `deadlineMs` не переопределяется через yandexContext? — override разрешён, документируем приоритет: явные поля yandexContext побеждают defaults, кроме `awsRequestId`/`requestId`, которые всегда per-request).

**Rationale**: Коннектор не коэрсит и бросается на невалидных типах; синтез обязан дать корректный контекст с первого вызова (cold start коннектора провалится позже внутри автотеста — но fail-loud произойдёт внутри инвокации и превратится в 500, что маскирует баг эмулятора). Deterministic defaults дают предсказуемое поведение (US1-SC3: `functionName === 'local-function'`).

**Alternatives**: 1) Пустой raw context — немедленный fail-loud коннектора → все инвокации 500. 2) Коэрсинг/дефолты в коннекторе — вне scope (контракт коннектора не меняется, Constitution III).

**Влияние**: `src/server/context.ts`, `contracts/raw-context-synthesis.json`.

---

## R-6 — IAM-цепочка: env → OAuth → SA key, exchange абстрагирован

**Decision**: `resolveIamToken(options?)` реализует цепочку S-8/FR-023 с **fail-open** (FR-024) и **одним резолвом** (FR-025):

1. `YC_IAM_TOKEN` env установлен (непустая строка) → вернуть as-is. **Сети нет.** Приоритет жёсткий: если env есть — config.yaml/keys не читаются вообще.
2. `~/.yc/config.yaml` → профиль по ключу `current`, у активного профиля поле `token`. Формат Yandex CLI: `{ current: <profile>, profiles: { <name>: { token, cloud-id, folder-id } } }` — парсится пакетом `yaml`. Если `token` отсутствует/пуст → переход к 3. Если значение уже IAM-токен (префикс `t1.`) → вернуть as-is (YC CLI хранит актуальный IAM-токен профиля); иначе трактуем как OAuth → exchange.
   Exchange (OAuth): `POST https://iam.api.cloud.yandex.net/iam/v1/tokens` body `{ "yandexPassportOauthToken": "<oauth>" }` → `{ iamToken, expiresAt, expiresIn }` → вернуть `iamToken`.
3. `~/.yc/keys/*.json` — перечислить `*.json`, выбрать первый парсящийся с полями `service_account_id`, `private_key`, `key_algorithm` (`RSA_2048`), `id`. Сформировать JWT: header `{ alg: "PS256", typ: "JWT" }`, claims `{ iss: service_account_id, aud: "https://iam.api.cloud.yandex.net/iam/v1/tokens", iat: now, exp: now + 3600 }`, подпись RSA-PSS-SHA256 (`crypto.sign('RSA-PSS-SHA256', data, { key: createPrivateKey(private_key.replace(/\\n/g, '\n')), padding: RSA_PKCS1_PSS_PADDING, saltLength: SHA256_DIGEST_LENGTH })`) — `key_algorithm: RSA_2048` требует PS256. Exchange (JWT): тот же `POST .../iam/v1/tokens` body `{ "jwt": "<jwt>" }` → `iamToken`.
4. Конфигурируемость для тестов (`ResolveIamTokenOptions`): `homeDir?: string` (baseline `~`), `iamEndpoint?: string` (default `https://iam.api.cloud.yandex.net`), `fetchImpl?: typeof fetch` (default global fetch). **Все сетевые вызовы идут только через инжектированный клиент** — юнит-тесты подставляют мок; реальная программа ни одного HTTP-вызова в тестах не делает (SC-007).

Fail-open-cемантика: каждый шаг — `try/catch`; нет env/config/keys → `undefined` + `reason: no-credential`; сетевой сбой (fetch throws, non-2xx, malformed JSON) → `undefined` + `reason: network | exchange | io`. Внутренний `resolveIamTokenDetailed(): Promise<{ token?: string; reason?: IamUnavailableReason }>` (reason — для banner-лога), публичный `resolveIamToken(): Promise<string | undefined>` — подмножество (S-8: «вернуть `undefined` (и код причины)» — причина доступна через internal-деталь и используется сервером для `JDT_IAM_UNAVAILABLE`).

Тайминг v1: сервер вызывает резолв **до bind** (D-7: «до начала слушания»), если `yandexContext.token` не задан (задан → берём as-is, без сети). Один резолв на старт, без TTL-refresh (D-7/A-8). Значение токена никогда не логируется и не попадает в banner (FR-026/FR-028); коннектор дополнительно редиктит `token` в `toJSON` (`build-yandex-execution-context.ts:72-74`).

**Влияние**: `src/server/iam.ts` (resolveIamToken(Detailed) + chain), `src/server/diagnostics.ts` (JDT_IAM_UNAVAILABLE), `contracts/iam-resolution.json`.

---

## R-7 — Trace propagation: `Uber-Trace-Id` → `uberTraceId`, `X-Trace-Id` echo

**Decision** (D-9): входящий header `Uber-Trace-Id` (формат `traceId:spanId:parentSpanId:flags`, наблюдаемый `19fcffb9e777c3fb:5bb6aa5c66657d30:06d027ab0322c8c9:1`) копируется verbatim в `uberTraceId` raw context (коннектор сам положит его в normalized `YandexExecutionContext.uberTraceId` — `yandex-execution-context.ts:63`). Ответ всегда несёт header `X-Trace-Id: <requestId>` (== `trace_id`), чтобы локальная цепочка вызовов коррелировалась как в облаке (IDEA §38). Идентичное наблюдение: коннектор ставит `trace_id = awsRequestId` (`build-yandex-execution-context.ts:40`), поэтому серверу достаточно гарантировать `awsRequestId == requestId == trace_id` (S-6/FR-019/FR-020). Явная генерация `X-Trace-Id` в ответе эмулятора — серверная корреляция, не связана с `Uber-Trace-Id` (который тоже транслируется как заголовок запроса сквозь `headers` — no special handling).

**Rationale**: D-9 зафиксирован в spec; коннектор уже реализует трейс-часть (`readInvocationTraceId` — `build-yandex-execution-context.ts:130-134` — читает `awsRequestId` толерантно для пре-инвокационных логов). Сервер лишь обеспечивает равенство id — не реимплементирует трейсинг.

**Alternatives**: 1) Парсить `Uber-Trace-Id` и подменять span — вне scope (эмулятор не tracer). 2) Полагаться на входящий `Traceparent` — платформенный id — `Uber-Trace-Id`, это наблюдаемый контракт коннектора.

**Влияние**: `src/server/context.ts` (+header read), `src/server/response.ts` (echo).

---

## R-8 — Node HTTP-семантика: `rawHeaders`, query-parse, body-buffer

**Decision**: На стороне `node:http` сервера:

- **Path/query/ruby split**: `req.url` — сырой URL-path+query **без декодирования** (Node отдаёт как из request line). Разделение: первый `?` → `rawPath` = до, `rawQueryString` = после (`""` если нет). `rawPath` НЕ декодируется (spec).
- **Headers**: использовать `req.rawHeaders` (плоский массив с оригинальным кейсом) — не `req.headers` (Node lowercase + join `, `). Повторы → comma-join `,` без пробела в `headers` map (US2-SC3). Порядок — первый встреченный (как gateway).
- **Query-декодер**: `split('&')` → пара `name=value` (без `value` → `""`) → form-decode обоих (`+`→space, `decodeURIComponent`; битый escape → raw fallback). `queryStringParameters[name] = values.join(',')`, `multiValueParameters[name] = values` (повторение порядка из потока). Порядок ключей — порядок потока (платформа сортирует только в `http.path`, не в картах).
- **Body**: аккумуляция chunks в `Buffer` (v1 buffered, A-4). Правило A-11: `Content-Type` начинается с `text/` или равен `application/json`/`application/x-www-form-urlencoded` → текст (`isBase64Encoded: false`); иначе `buffer.isUtf8(buf)` → текст (грай-зона разрешена в пользу text, A-11); иначе base64 (`true`). Пустой буфер → `""` + `false` (FR-014, победил spec — см. R-10#6). `application/x-www-form-urlencoded` → текст без re-encoding (edge case spec).
- **sourceIp**: `X-Forwarded-For` первое значение (trim) если есть, иначе `127.0.0.1` (S-5).
- **userAgent**: `User-Agent` заголовок или `""`.
- **Событие `error` на сервере/сокете** до/после bind: до bind (`EADDRINUSE`/`EACCES`) → `JDT_PORT_IN_USE` (kernel message preserved в `cause`), после — логируется и инвокация завершается 500 с trace_id (если применимо).

**Rationale**: Node-семантика фиксирует «где взять raw» — вся сырость приходит из request line/rawHeaders, повторных decode нет. Точечное комma-join `,` — из spec US2-SC3, не RFC-стиль Node.

**Alternatives**: 1) `req.url` из `new URL()` — декодирует и ломает rawPath/rawQueryString. 2) Парсить query через `URLSearchParams` — тот же результат form-декодирования, но скрытые детали `+`-обработки и порядка; эквивалентно, решено вручную для контроля.

**Влияние**: `src/server/payload.ts` (helpers: splitPathAndQuery, parseRawQuery, readBody, buildHeadersMap).

---

## R-9 — requestContext.time (CLF) и timeEpoch

**Decision**: `time` — Apache CLF: `dd/Mon/yyyy:HH:mm:ss +0000`, вычисляется из `new Date()` по UTC (месяцы — английские сокращения, день — 2 digits, `+0000` фиксирован). `timeEpoch` — `Math.floor(now / 1000)` (секунды; фикстура `1787348674`). Детерминированность для тестов: чистая функция `toClfTime(date: Date)` принимает заранее созданный Date; `timeEpoch` и `time` берутся из одного «момента» инвокации.

**Rationale**: Фикстуры показывают `+0000` (UTC). Отдавать локальный offset → недетерминированные тесты и неповторяемые логи; UTC — наблюдаемый контракт.

**Alternatives**: 1) Локальный offset (`+0300` и т.п.) — не совпадает с фикстурами. 2) `Date.toUTCString()` — другой формат.

**Влияние**: `src/server/payload.ts:toClfTime`.

---

## R-10 — Документированные фиделити-отклонения (spec > наблюдение платформы)

**Decision**: Три случая, где spec противоречит наблюдениям фикстур, разрешены в пользу spec и **явно документированы** (в план/quickstart/README пакета), чтобы «работает локально ≠ облако» не читалось как баг эмулятора:

| Поле | Платформа (фикстура) | Локальный эмулятор (spec) | Прим. |
|------|----------------------|---------------------------|-------|
| `rawPath` для %-encoded путей | декодирован (`/probe/with space...`) | raw (undecoded, US2-SC6) | NestJS маршрутизирует по `rawPath` (normalize-request.ts:34) → для encoded-сегментов локальный маршрут может не совпасть с облачным — документированное ограничение v1. |
| `isBase64Encoded` пустого тела | `true` (bodiless GET) | `false` + `""` (FR-014) | Пустое тело локально — текст. |
| `requestId` при клиентском `X-Request-Id` | отражает заголовок | всегда `randomUUID()` (FR-019) | Локальная trace_id не равна клиентскому X-Request-Id. |
| `requestContext.http.path` | переупорядочен/перекодирован | `rawPath + '?' + rawQueryString` (S-5) | Gateway-нормализация не воспроизводится (Constitution V). |

**Rationale**: Constitution главнее фикстур, spec главнее IDEA; план обязан следовать spec и не молчать о расхождениях — иначе тест «payload-fidelity» окажется зелёным вопреки реальному облаку. Анализ на `/speckit.analyze` сверяет, что spec осознанно фиксирует эти отклонения.

**Alternatives**: 1) Переписать spec под наблюдения — не задача plan-фазы. 2) Умолчать в плане — недопустимо (explicit-over-magic).

**Влияние**: раздел «Documented deviations» в quickstart.md и README пакета.

---

## Все NEEDS CLARIFICATION решены

| # | Неопределённость | Решение |
|---|------------------|---------|
| 1 | Package/build conventions | R-1: зеркало nest-bridge (tsup dual, exports `./server`, vitest+swc, tsconfig) |
| 2 | Integration surface | R-2: только `createYandexHandler(appModule)` public API; handler вызывается как `(rawEvent, rawContext) => Promise<unknown>` |
| 3 | Event fidelity эталон | R-3: RawHttpApiGatewayV2Event + фикстуры `fixtures/http/*.json`; spec-поля приоритетны |
| 4 | Response mapping | R-4: envelope → HTTP (multiValueHeaders по-элементно, base64 decode, X-Trace-Id echo) |
| 5 | Raw context synthesis | R-5: required-поля коннектора + deterministic defaults ⊕ yandexContext (per-request id/time) |
| 6 | IAM chain | R-6: env → OAuth (`~/.yc/config.yaml`, yaml-парсинг) → SA key (`~/.yc/keys/*`, JWT PS256) → общий endpoint `/iam/v1/tokens`; fetch инжектируется |
| 7 | Trace propagation | R-7: uberTraceId verbatim, X-Trace-Id = trace_id = awsRequestId = requestId |
| 8 | Node HTTP-семантика | R-8: rawHeaders (case, `,`-join), form-decode query, buffered body, A-11-кодирование |
| 9 | CLF time/timeEpoch | R-9: UTC `dd/Mon/yyyy:HH:mm:ss +0000`, секунды, чистая функция |
| 10 | Spec vs наблюдения | R-10: 3+1 документированных отклонения, spec первична |

## Constitution Check (re-check after research)

All gates PASS (см. plan.md). Research не вводит новых нарушений: пакет делегирует всё коннектору через public API (I, R-2); контракты коннектора не меняются, новая public API `@ycforge/js-dev-tools` версионируется semver (III, R-1); entry-контракт явный, документированные дефолты вместо магии, fail-fast на конфигурации и fail-open на окружении (V, R-3/R-8/R-10); Terraform/apps-ownership не затронуты (IV/VI, N/A). Изменение одного детектируемого поведения (rawPath/isBase64Encoded/requestId/http.path) — документированные фиделити-отклонения по выбору spec (R-10), не молчаливая деградация.