---
description: "Task list for local-dev-server — @ycforge/js-dev-tools/server, payload 2.0 эмуляция"
---

# Tasks: local-dev-server — `@ycforge/js-dev-tools/server`, payload 2.0 эмуляция

**Input**: Design documents from `/specs/023-local-dev-server/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/local-dev-server.json, contracts/iam-resolution.json, quickstart.md

**Tests**: Test-first per constitution (II). Каждый FR-001..FR-029 и US1–US7 → ≥1 тест (RED → GREEN). Тесты пишутся ДО реализации и подтверждаются RED. Constitution II exception не применяется — payload/context/response/iam модули чистые функции, unit-testable без сети/сервера. Entry/orchestration — thin wrappers, testable through fixtures.

**Organization**: Задачи сгруппированы по фазам Setup / Foundational (diagnostics, payload, context, response, connector, iam, request-id, lifecycle, fixtures — блокируют все US) / US2 payload fidelity / US1 server lifecycle / US4 response mapping / US3 IAM resolution / US5 fail-fast / US6 graceful lifecycle / US7 observability / Fidelity deviations / Polish. Новый пакет `packages/js-dev-tools` — нет существующего кода, нет new-package exception.

## Format: `[ID] [P?] [USn] Description with file path`

- **[P]**: Can run in parallel (different files, no incomplete deps)
- **[US1]–[US7]**: User story labels (required in US phases)
- Include exact file paths in descriptions

## Path Conventions

- **Package root**: `packages/js-dev-tools/` — `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`
- **Source modules**: `packages/js-dev-tools/src/server/` — `index.ts` (PUBLIC subpath), `diagnostics.ts`, `options.ts`, `payload.ts`, `context.ts`, `response.ts`, `iam.ts`, `connector.ts`, `entry.ts`, `request-id.ts`, `create.ts`
- **Diagnostic codes**: `packages/js-dev-tools/src/server/diagnostics.ts` — `JDT_*` constants, `LocalDevServerError`, `redactSecrets()`
- **Tests**: `packages/js-dev-tools/test/` — `payload.spec.ts`, `context.spec.ts`, `response.spec.ts`, `iam.spec.ts`, `entry.spec.ts`, `server.integration.spec.ts`, `host-loader.e2e.spec.ts`
- **Fixtures**: `packages/js-dev-tools/test/fixtures/user-service/` — `app.module.ts` (named `AppModule`), `default-export.ts`, `ambiguous.ts`, `no-module.ts`
- **Spec amendment**: `specs/023-local-dev-server/spec.md` FR-029 → add `JDT_INVALID_PORT`, `specs/023-local-dev-server/contracts/local-dev-server.json` → already includes `JDT_INVALID_PORT` in `#/definitions/jdtDiagnosticCode/enum`
- **Root**: `pnpm-workspace.yaml` — already includes `packages/*`, no change needed (R-1)

---

## Phase 1: Setup (New Package Scaffolding)

**Purpose**: Создание `packages/js-dev-tools` (@ycforge/js-dev-tools) с тулчейном, зеркалящим nest-bridge: tsup dual build, vitest+swc, tsconfig strict. Без этого ни один модуль не скомпилируется и не протестируется.

- [x] T001 Create `packages/js-dev-tools/package.json` — `"name": "@ycforge/js-dev-tools"`, `"type": "module"`, `"engines": { "node": ">=22" }`, `"exports": { "./server": { "types": "./dist/server/index.d.ts", "import": "./dist/server/index.js", "require": "./dist/server/index.cjs" } }`, `"files": ["dist"]`, `"sideEffects": false`, `"publishConfig": { "access": "public" }`, scripts: `{ "build": "tsup", "test": "tsup && vitest run", "typecheck": "tsc --noEmit" }`, dependencies: `{ "@ycforge/nestjs-connector": "workspace:*", "yaml": "^2.7.1" }`, peerDependencies: `{ "@nestjs/common": "^11.0.0", "@nestjs/core": "^11.0.0" }`, devDependencies: `{ "@nestjs/common": "^11.2.1", "@nestjs/core": "^11.2.1", "@swc/core": "^1.16.1", "@types/node": "^22.15.0", "reflect-metadata": "^0.2.2", "tsx": "^4.21.3", "tsup": "^8.5.0", "typescript": "^5.9.0", "vitest": "^3.2.0" }`. Mirror `packages/nest-bridge/package.json` conventions (R-1). **Ref**: spec S-1, plan R-1, constitution I.
- [x] T002 Create `packages/js-dev-tools/tsconfig.json` — exact copy of `packages/nest-bridge/tsconfig.json` (strict, noUncheckedIndexedAccess, experimentalDecorators + emitDecoratorMetadata, types: ["node", "vitest/globals"], noEmit: true). Include `src/**/*.ts` + `test/**/*.ts` + config files. **Ref**: plan R-1, data-model §1.
- [x] T003 Create `packages/js-dev-tools/tsup.config.ts` — entry `{ 'server/index': 'src/server/index.ts' }`, format `['esm', 'cjs']`, dts: true, clean: true, sourcemap: true, minify: false. Mirror `packages/nest-bridge/tsup.config.ts:3-16`. **Ref**: plan R-1.
- [x] T004 [P] Create `packages/js-dev-tools/vitest.config.ts` — copy `packages/nest-bridge/vitest.config.ts:14-51` with swc `emitDecoratorMetadata` plugin (NECESSARY for `@YandexContext()` fixture controllers with NestJS DI), globals: true, setupFiles: ['reflect-metadata'], include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'], pool: 'threads', maxWorkers: 2, maxConcurrency: 1. **Ref**: plan R-1, quickstart Prerequisites.
- [x] T005 Verify `pnpm-workspace.yaml` already includes `packages/*` glob — no root change needed; `@ycforge/js-dev-tools` is auto-discovered (R-1: `pnpm-workspace.yaml:1`). Run `pnpm install` from root to link workspace dependency. **Ref**: plan R-1.

**Checkpoint**: `pnpm --filter @ycforge/js-dev-tools build` runs (empty dist), `pnpm --filter @ycforge/js-dev-tools typecheck` clean, `pnpm --filter @ycforge/js-dev-tools test` runs (zero test files).

---

## Phase 2: Foundational (Contracts, Core Modules, Fixtures)

**Purpose**: Диагностические коды `JDT_*` (включая spec-п amendment `JDT_INVALID_PORT`), чистые модули перевода контекста/пейлоада/ответа/IAM, entry-загрузка, обёртка коннектора, orchestration lifecycle, fixtures. ALL user story work depends on this phase. Модули independently testable — тесты пишутся РАНЬШЕ реализации (RED → GREEN).

### Spec Amendment: JDT_INVALID_PORT (FR-029 catalog update)

- [x] T010 Amend `specs/023-local-dev-server/spec.md` FR-029 — add `JDT_INVALID_PORT` to the diagnostic codes list (additive entry, keeps FR-029 index consistent): change enum string list to include `"JDT_INVALID_PORT"` (invalid port value — not integer in [0,65535] — fail-fast before probe/bind, S-2 option validation surface). `contracts/local-dev-server.json` already includes `JDT_INVALID_PORT` in `#/definitions/jdtDiagnosticCode/enum` — no contract change needed. **Ref**: plan deviation 1, constitution V explicit-over-magic.

### Diagnostics module (RED → GREEN)

- [x] T011 Create `packages/js-dev-tools/src/server/diagnostics.ts` — `JdtDiagnosticCode` union type with 8 members (`JDT_MQ_UNSUPPORTED`, `JDT_NO_TRANSPORT`, `JDT_PORT_IN_USE`, `JDT_INVALID_PORT`, `JDT_ENTRY_RESOLVE_FAILED`, `JDT_ENTRY_MODULE_NOT_FOUND`, `JDT_ENTRY_MODULE_AMBIGUOUS`, `JDT_IAM_UNAVAILABLE`); `LocalDevServerError extends Error` class with `code: JdtDiagnosticCode` and optional `cause`; `redactSecrets(text: string, secrets: (string | undefined)[]): string` (replaces each non-empty secret value with `[REDACTED]`). Per data-model §2.7, FR-029. **Ref**: FR-029, plan deviation 1.
- [x] T012 [P] RED unit-test `packages/js-dev-tools/test/diagnostics.test.ts` — (a) `JdtDiagnosticCode` has exactly 8 members matching `specs/023-local-dev-server/contracts/local-dev-server.json` `#/definitions/jdtDiagnosticCode/enum` byte-for-byte; (b) `JDT_IAM_UNAVAILABLE` included (warning, not error); (c) `JDT_INVALID_PORT` included (additive, plan deviation); (d) `LocalDevServerError` has `.code` property, `.name === 'LocalDevServerError'`, instanceof Error; (e) `redactSecrets` replaces token/Authorization/Cookie values with `[REDACTED]`, leaves clean text untouched, handles undefined secrets. RED: diagnostics.ts stub. **Ref**: FR-029, US5-SC1..6.

### Options validation (RED → GREEN)

- [x] T013 Create `packages/js-dev-tools/src/server/options.ts` — `YcsfLocalServerOptions` interface (data-model §2.1): `entry` (required string), `apiGatewayV2?` (boolean, default true), `messageQueue?` (boolean, default false), `port?` (number, default 3000), `yandexContext?` (Readonly object); `validateOptions(options: unknown): YcsfLocalServerOptions` — fail-fast validation per FR-004: `messageQueue === true` → `JDT_MQ_UNSUPPORTED`; `!apiGatewayV2 && !messageQueue` → `JDT_NO_TRANSPORT`; `port` not a finite integer in `[0, 65535]` → `JDT_INVALID_PORT` (additive); `entry` absent/not string/empty → `JDT_ENTRY_RESOLVE_FAILED`. Throws `LocalDevServerError` on failure. **Ref**: FR-002, FR-004, FR-029, data-model §2.1, plan deviation 1.
- [x] T014 [P] RED unit-test `packages/js-dev-tools/test/options.test.ts` — (a) valid options with defaults: `{ entry: './x.ts' }` → `{ entry: './x.ts', apiGatewayV2: true, messageQueue: false, port: 3000, yandexContext: {} }`; (b) `messageQueue: true` → throw `JDT_MQ_UNSUPPORTED`; (c) `apiGatewayV2: false, messageQueue: false` → throw `JDT_NO_TRANSPORT`; (d) `port: NaN` → throw `JDT_INVALID_PORT`; (e) `port: -1` → throw `JDT_INVALID_PORT`; (f) `port: 70000` → throw `JDT_INVALID_PORT`; (g) `port: 3000.5` → throw `JDT_INVALID_PORT`; (h) `entry: ''` → throw `JDT_ENTRY_RESOLVE_FAILED`; (i) `entry: undefined` (missing) → throw `JDT_ENTRY_RESOLVE_FAILED`. RED: options.ts stub. **Ref**: FR-002, FR-004, US5-SC1..6, plan deviation 1.

### Payload translation module (RED → GREEN)

- [x] T015 Create `packages/js-dev-tools/src/server/payload.ts` — pure functions: `buildGatewayV2Event(req: IncomingMessage, body: Buffer, opts: { requestId: string }): RawHttpApiGatewayV2Event` — complete field mapping per S-5/data-model §2.3: `version: "2.0"`, `rawPath` = first `?` split of `req.url` WITHOUT decode (FR-010, R-8), `rawQueryString` = after first `?` or `""`, `headers` from `req.rawHeaders` original case comma-join `,` without space (FR-011, R-8), `queryStringParameters`/`multiValueParameters` parsed via form-decode (`+`→space, `decodeURIComponent`, broken escape → raw fallback) (FR-012), `pathParameters: {}`, `parameters: {}`, `operationId: ""` (FR-015, D-5), `body`/`isBase64Encoded` via `encodeBody()` (FR-014), `requestContext` per S-5 table (FR-013); `encodeBody(buffer: Buffer, contentType?: string): { body: string; isBase64Encoded: boolean }` — A-11 rules: empty→`""`+`false`; text/json/form-urlencoded→utf8+`false`; `buffer.isUtf8()`→utf8+`false`; else→base64+`true`; `toClfTime(date: Date): string` — Apache CLF UTC `dd/Mon/yyyy:HH:mm:ss +0000` (R-9); helper `parseRawQuery(query: string)` (R-8). Per data-model §2.3, spec S-5, research R-3/R-8/R-9. **Ref**: FR-010..015, US2.
- [x] T016 [P] RED unit-test `packages/js-dev-tools/test/payload.spec.ts` — US2 AC1–AC6 fixture-driven tests (quickstart Sc2): (a) GET with repeated query `?tags=a&tags=b&limit=10` → `version "2.0"`, `rawPath "/api/users"`, `rawQueryString "tags=a&tags=b&limit=10"`, `queryStringParameters.tags "a,b"`, `multiValueParameters.tags ["a","b"]`, `limit "10"`; (b) POST JSON body → `body '{"name":"x"}'`, `isBase64Encoded false`, `http.method "POST"`; (c) duplicate header `X-Foo: a` + `X-Foo: b` → `headers["X-Foo"] "a,b"` (comma-join); (d) binary body (PNG bytes) → `isBase64Encoded true`, round-trip decode equals original; (e) GET no query → `rawQueryString ""`, `queryStringParameters {}`, `multiValueParameters {}`, `pathParameters {}`, `parameters {}`, `operationId ""`; (f) encoded path `/api/users%2Factive` → `rawPath "/api/users%2Factive"` (NO decode, US2-SC6); (g) `requestContext.http.path` = `rawPath + '?' + rawQueryString` (with trailing `?` when no query); (h) CLF time format matches regex `^\d{2}/[A-Z][a-z]{2}/\d{4}:\d{2}:\d{2}:\d{2} \+0000$`; (i) `requestContext.timeEpoch` is integer seconds; (j) `X-Forwarded-For: 10.0.0.1` → `sourceIp "10.0.0.1"`, no header → `"127.0.0.1"`; (k) empty body → `body ""`, `isBase64Encoded false` (R-10 documented deviation); (l) `User-Agent` present → included in `http.userAgent`, absent → `""`. RED: payload.ts stub. **Ref**: FR-010..015, US2-SC1..SC6, quickstart Sc2, R-10.

### Context synthesis module (RED → GREEN)

- [x] T017 Create `packages/js-dev-tools/src/server/context.ts` — pure function: `buildRawContext(opts: { requestId: string; uberTraceId?: string; yandexContext: Readonly<Record<string, unknown>> }): Record<string, unknown>` — base defaults per S-6/data-model §2.4: `awsRequestId: requestId`, `requestId: requestId`, `functionName: "local-function"`, `functionVersion: "local-dev"`, `functionFolderId: yandexContext.folderId ?? ""`, `memoryLimitInMB: "1024"` (string), `deadlineMs: Date.now() + 15000`, `logGroupName: ""`; `token` only if `yandexContext.token` is string (FR-017); `uberTraceId` only if provided (D-9, R-7); `cloudId` from `yandexContext.cloudId` if string (FR-018); all remaining `yandexContext` keys merged over defaults (escape hatch S-6); `awsRequestId`/`requestId` always per-request, never overridden. **Ref**: FR-016..020, US1-SC3, data-model §2.4, R-5.
- [x] T018 [P] RED unit-test `packages/js-dev-tools/test/context.spec.ts` — US1-SC3, quickstart Sc3: (a) required connector fields present: `awsRequestId`, `functionName`, `functionVersion`, `functionFolderId`, `memoryLimitInMB`, `deadlineMs`, `logGroupName`; (b) types correct: `memoryLimitInMB` is string `"1024"`, `deadlineMs` is number ≈ now+15000; (c) `token` present only when `yandexContext.token` set, absent otherwise; (d) `functionFolderId` from `yandexContext.folderId`, defaults to `""`; (e) `awsRequestId === requestId === trace_id` equality guarantee (one randomUUID per invocation); (f) `uberTraceId` present only when header present, verbatim copy; (g) `cloudId` in raw context from `yandexContext.cloudId`; (h) extra `yandexContext` keys merged over defaults (override escape hatch); (i) `awsRequestId`/`requestId` NOT overridden by extra `yandexContext` keys (per-request invariant). RED: context.ts stub. **Ref**: FR-016..020, US1-SC3, R-5, D-6.

### Entry loading module (RED → GREEN)

- [x] T019 Create `packages/js-dev-tools/src/server/entry.ts` — `loadEntryModule(entry: string): Promise<Type<unknown>>` — resolve path relative to cwd (FR-005); check `existsSync` → `JDT_ENTRY_RESOLVE_FAILED` if missing; `await import(pathToFileURL(resolved))` → catch → `JDT_ENTRY_RESOLVE_FAILED` (with cause); extract named `AppModule` → default export → fallback; both present + different classes → `JDT_ENTRY_MODULE_AMBIGUOUS`; neither → `JDT_ENTRY_MODULE_NOT_FOUND` (message lists allowed exports); throws `LocalDevServerError`. Per data-model §3, spec S-3, FR-005..006. **Ref**: FR-005, FR-006, US5-SC3..5.
- [x] T020 [P] RED unit-test `packages/js-dev-tools/test/entry.spec.ts` — US5-SC3..5, quickstart Sc9, Sc10: (a) fixture with named `AppModule` export → returns the class; (b) fixture with only default export → returns the class; (c) fixture with no module export → throws `JDT_ENTRY_MODULE_NOT_FOUND`; (d) fixture with named `AppModule` AND different default class → throws `JDT_ENTRY_MODULE_AMBIGUOUS`; (e) non-existent entry path → throws `JDT_ENTRY_RESOLVE_FAILED`; (f) entry that throws on import → `JDT_ENTRY_RESOLVE_FAILED` with cause; (g) CJS entry (`module.exports = class`) → valid (Node interop); (h) relative path resolved from cwd. RED: entry.ts stub. **Ref**: FR-005, FR-006, US5, quickstart Sc9.

### Response mapping module (RED → GREEN)

- [x] T021 Create `packages/js-dev-tools/src/server/response.ts` — `applyEnvelope(res: ServerResponse, envelope: YandexFunctionHttpResponse, traceId: string): void` — set `statusCode` (FR-021), single headers via `setHeader`, multiValueHeaders via `append` per element (FR-021, Set-Cookie without comma-join), body decode: `isBase64Encoded ? Buffer.from(body, 'base64') : body` → `res.end()`; set `X-Trace-Id: traceId` after envelope (FR-020); `errorResponse(res: ServerResponse, statusCode: number, error: unknown, traceId: string): void` — JSON `{ error, message: redactSecrets(error.message, []), trace_id }` + `X-Trace-Id`; `isYandexFunctionHttpResponse(result: unknown): result is YandexFunctionHttpResponse` — type guard (statusCode number, body string, isBase64Encoded boolean). Per data-model §2.5, spec S-7, FR-021..022. **Ref**: FR-021, FR-022, US4.
- [x] T022 [P] RED unit-test `packages/js-dev-tools/test/response.spec.ts` — US4, quickstart Sc5: (a) envelope `201 + X-Custom: v` → statusCode 201, header set; (b) `multiValueHeaders['set-cookie'] = ['c1','c2']` → two separate `Set-Cookie` headers (not comma-join); (c) `isBase64Encoded: true` + base64 body → `Buffer.from(body, 'base64')` round-trip; (d) throw handler → `errorResponse` produces JSON `{ error, message, trace_id }` with `X-Trace-Id`; (e) `isYandexFunctionHttpResponse` returns true for valid envelope, false for null/array/string/wrong shape; (f) `X-Trace-Id` always present in both success and error paths; (g) `redactSecrets` applied to error message (token/Authorization/Cookie values → `[REDACTED]`). RED: response.ts stub. **Ref**: FR-021, FR-022, US4, quickstart Sc5.

### Connector wrapper (RED → GREEN)

- [x] T023 Create `packages/js-dev-tools/src/server/connector.ts` — thin wrapper: `createHandler(appModule: Type<unknown>): { handler: YandexCloudFunctionHandler; close: () => Promise<void> }` — calls `createYandexHandler(appModule)` (sync, lazy cold start R-2), wraps `close()` for idempotent shutdown (FR-009). ONLY uses public API from `@ycforge/nestjs-connector`: `createYandexHandler`, `ClosableYandexCloudFunctionHandler`. Per spec S-4, FR-007..008, R-2. **Ref**: FR-007, FR-008, S-4, R-2.
- [x] T024 [P] RED unit-test `packages/js-dev-tools/test/connector.test.ts` — (a) `createHandler` returns `{ handler, close }` where handler is a function; (b) handler is the same function as `createYandexHandler` result (delegation verified); (c) `close()` is idempotent — calling twice does not throw; (d) no imports from `@nestjs/core`, `NestFactory`, or `@ycforge/nestjs-connector` internal paths (static check via import list). RED: connector.ts stub. **Ref**: FR-007, FR-008, SC-008.

### IAM resolution module (RED → GREEN)

- [x] T025 Create `packages/js-dev-tools/src/server/iam.ts` — `resolveIamToken(options?: ResolveIamTokenOptions): Promise<string | undefined>` (public, S-8); `resolveIamTokenDetailed(options?): Promise<{ token?: string; reason?: IamUnavailableReason }>` (internal, for banner); chain: (1) `process.env.YC_IAM_TOKEN` non-empty → return as-is, no network (US3-SC1); (2) `~/.yc/config.yaml` read via `yaml` package → `current` profile → token field; `t1.`-prefixed → already IAM, return as-is; else → OAuth exchange POST `{iamEndpoint}/iam/v1/tokens` body `{ yandexPassportOauthToken }` → `{ iamToken }` (US3-SC2); (3) `~/.yc/keys/*.json` → first parseable with `service_account_id`/`private_key`/`key_algorithm: RSA_2048`/`id` → JWT (PS256, `iss: service_account_id`, `aud: iamEndpoint + /iam/v1/tokens`, `iat/exp`, sign via `crypto.sign('RSA-PSS-SHA256')` with `createPrivateKey(private_key.replace(/\\n/g, '\n'))`, RSA_PKCS1_PSS_PADDING, SHA256_DIGEST_LENGTH) → exchange POST with `{ jwt }` → `{ iamToken }` (US3-SC3); all steps try/catch → fail-open (FR-024): `undefined` + `IamUnavailableReason` (`"no-credential"` | `"io"` | `"exchange-error"` | `"network-error"`). Options: `homeDir?` (tests: temp dir; default `os.homedir()`), `iamEndpoint?` (default `"https://iam.api.cloud.yandex.net"`), `fetchImpl?` (default `globalThis.fetch`). Per data-model §2.6, spec S-8, FR-023..025, R-6. **Ref**: FR-023..025, US3.
- [x] T026 [P] RED unit-test `packages/js-dev-tools/test/iam.spec.ts` — US3, quickstart Sc4: (a) `YC_IAM_TOKEN=abc` → returns `"abc"`, mock fetch NOT called (US3-SC1); (b) no env, config.yaml `{ current: dev, profiles: { dev: { token: '<oauth>' } } }` → mock exchange returns `iamToken` → result from exchange (US3-SC2); (c) no env, no config, keys dir with valid `sa-key.json` → JWT PS256 generated, mock exchange returns token (US3-SC3); (d) env + config → env wins, config not read (US3-SC4 priority); (e) no credential anywhere → `undefined` + `reason: "no-credential"`, no throw (US3-SC5 fail-open); (f) config.yaml present but `token` field empty → falls through to step 3; (g) config.yaml `t1.`-prefixed token → returned as-is (already IAM), no exchange; (h) SA key with invalid PEM → `undefined` + `reason`; (i) network error (fetch throws) → `undefined` + `reason: "network-error"`; (j) IAM API non-2xx → `undefined` + `reason: "exchange-error"`. All tests use mock `fetchImpl` and temp `homeDir` (no real network, SC-007). RED: iam.ts stub. **Ref**: FR-023..025, US3-SC1..6, quickstart Sc4, R-6.

### Request ID module (RED → GREEN)

- [x] T027 Create `packages/js-dev-tools/src/server/request-id.ts` — `newRequestId(): string` = `crypto.randomUUID()` (FR-019). One per invocation (S-6). **Ref**: FR-019, R-10.

### Lifecycle orchestration module (RED → GREEN)

- [x] T028 Create `packages/js-dev-tools/src/server/create.ts` — `createYcsfLocalServer(options: YcsfLocalServerOptions): Promise<LocalDevServer>` orchestration per data-model §4: validateOptions → loadEntryModule → probePort (temporary `net.Server` bind+close to detect EADDRINUSE before handler creation, FR-004) → resolveIam (`yandexContext.token ?? await resolveIamTokenDetailed()`; token → banner reason "token resolved"; undefined → warning `JDT_IAM_UNAVAILABLE` once, not blocking) → `createHandler(appModule)` (lazy, sync) → `http.createServer` (async handler: `onRequest` per data-model §4 per-request path: requestId, readBody, buildGatewayV2Event, buildRawContext, try handler → isYandexFunctionHttpResponse → applyEnvelope | else → errorResponse; catch → errorResponse + log redacted stack; finally → perRequestLog) → `await server.listen(port, '127.0.0.1')` (EADDRINUSE fallback → `JDT_PORT_IN_USE`) → stderr banner (S-9, FR-026: URL, mode, IAM status, NO token value) → return `LocalDevServer { port, baseUrl: "http://127.0.0.1:<port>", stop }`. `stop()`: `server.close()` (drain in-flight) + `await close()` (handler idempotent, FR-009); double-stop safe (flag `closed`). Per data-model §4, spec S-2, FR-003, FR-004, FR-009. **Ref**: FR-003, FR-004, FR-007, FR-009, US1, US5, US6.
- [x] T029 [P] RED unit-test `packages/js-dev-tools/test/create.test.ts` — lifecycle validation without network (mock all deps): (a) `validateOptions` is called first (mock order assertion); (b) `loadEntryModule` called with resolved entry; (c) `probePort` called before `createHandler` (EADDRINUSE → `JDT_PORT_IN_USE` thrown before handler); (d) `resolveIamTokenDetailed` not called when `yandexContext.token` set (skip network); (e) `resolveIamTokenDetailed` called when no `yandexContext.token`; (f) handler called exactly once with `(rawEvent, rawContext)` signature; (g) `stop()` calls `server.close()` then `close()`. RED: create.ts stub. **Ref**: FR-003, FR-004, FR-009, data-model §4.

### Test fixtures (setup)

- [x] T030 [P] Create `packages/js-dev-tools/test/fixtures/user-service/app.module.ts` — minimal NestJS module with named export `AppModule`: `@Module({ controllers: [AppController] })`, `AppController` with `@Get('/api/users')` → `{ users: [] }` and `@Get('/respond/error')` → throws (`Error('boom')` → HTTP 500 envelope with trace_id). Spec amendment A-13: NO `@YandexContext()` controller over HTTP (connector does not fill it via Nest router dispatch → 500). US4 envelope routes (`@Res()`/`@HttpCode`/`@Header` 201, multi Set-Cookie, binary) are added in T060. **Ref**: quickstart Sc1, Sc3, US1-SC3, US4, A-13.
- [x] T031 [P] Create `packages/js-dev-tools/test/fixtures/user-service/default-export.ts` — same module as default export only (no named `AppModule`), for entry.spec.ts FR-006 test. **Ref**: FR-006, US5-SC4.
- [x] T032 [P] Create `packages/js-dev-tools/test/fixtures/user-service/ambiguous.ts` — named `AppModule` export + a different class as default export (e.g. `class OtherModule`), for `JDT_ENTRY_MODULE_AMBIGUOUS` test. **Ref**: FR-006, US5-SC5.
- [x] T033 [P] Create `packages/js-dev-tools/test/fixtures/user-service/no-module.ts` — exports an object/function but NOT a class (no `AppModule`, no class default), for `JDT_ENTRY_MODULE_NOT_FOUND` test. **Ref**: FR-006, US5-SC4.
- [x] T034 [P] Create `packages/js-dev-tools/test/fixtures/side-effect-bootstrap.ts` — main-guard example: conditional `createYcsfLocalServer()` only when `isMainModule`, documentation-only fixture (Sc9). **Ref**: S-3, A-6, quickstart Sc9.

**Checkpoint**: `pnpm --filter @ycforge/js-dev-tools test` — all `test/diagnostics.test.ts`, `test/options.test.ts`, `test/payload.spec.ts`, `test/context.spec.ts`, `test/entry.spec.ts`, `test/response.spec.ts`, `test/connector.test.ts`, `test/iam.spec.ts`, `test/create.test.ts` GREEN. All core modules implemented (RED→GREEN). Typecheck clean.

---

## Phase 3: US2 — Payload 2.0 fidelity (Priority: P1)

**Goal**: Входящий HTTP-запрос точно транслируется в `RawHttpApiGatewayV2Event` по всем полям S-5. Payload translation — чистая функция, тестируется без сети.

**Independent Test**: Fixture-driven `test/payload.spec.ts` по US2-SC1..SC6: ≥6 типов запросов → событие, сверяемое по 100% полей S-5. Encode/decode body round-trip. Encoded path raw. Comma-join headers.

### Tests for US2 (RED — write FIRST)

- [x] T040 [P] [US2] RED unit-test section in `packages/js-dev-tools/test/payload.spec.ts` (US2 completeness) — expand T016 tests with remaining US2 acceptance scenarios: (a) `Content-Type: application/x-www-form-urlencoded` body → text, `isBase64Encoded: false`; (b) HEAD/OPTIONS methods pass through; (c) multiple `Set-Cookie` in response mapped correctly (response spec, but payload event for request includes all header types); (d) `requestContext.http.method` uppercase even if request sends lowercase (Node normalizes); (e) `requestContext.apiGateway.operationContext: {}` always; (f) `requestContext.authorizer: {}` always. RED: payload tests incomplete. **Ref**: US2-SC1..SC6, FR-010..015, quickstart Sc2.

### Implementation for US2 (GREEN)

- [x] T041 [US2] Verify `packages/js-dev-tools/src/server/payload.ts` covers all US2-SC1..SC6 cases — confirm encodeBody handles form-urlencoded text, toClfTime handles edge timestamps, parseRawQuery handles `+`-space and `%`-encoding, rawHeaders case preservation, empty body → `""` + `false` (R-10 deviation). This is a verification pass — the implementation was done in Phase 2 (T015). Mark US2 GREEN only if all T040 tests pass. **Ref**: FR-010..015, US2.

**Checkpoint**: `pnpm --filter @ycforge/js-dev-tools test -- --run test/payload.spec.ts` GREEN. All 12+ payload tests pass. Fidelity matches spec S-5 precisely (including R-10 documented deviations).

---

## Phase 4: US1 — Server lifecycle: start → handler → response → stop (Priority: P1) 🎯 MVP

**Goal**: `await createYcsfLocalServer({ entry })` → HTTP server listening → fetch → NestJS controller responds through real `createYandexHandler` → `stop()` releases. Cold start + warm reuse. Raw context синтезируется с token/folderId (unit-контракт T018); trace_id correlation сквозная end-to-end (envelope/header/log).

**Independent Test**: Fixture `user_service/app.module.ts` + `createYcsfLocalServer` + `fetch(baseUrl + '/api/users')` → 200 + JSON. Second request faster (warm). Raw context fields verified at unit level (T018); trace correlation asserted end-to-end (T050 d/e; A-13).

### Tests for US1 (RED — write FIRST)

- [x] T050 [P] [US1] RED integration-test `packages/js-dev-tools/test/server.integration.spec.ts` (US1 section) — (a) `await createYcsfLocalServer({ entry: './test/fixtures/user-service/app.module.ts', port: 0, yandexContext: { token: 'test-token', folderId: 'f1' } })` → promise resolves, `baseUrl` starts with `http://127.0.0.1:`, `port > 0`; (b) `fetch(baseUrl + '/api/users')` → 200, body `{"users":[]}`; (c) second request → also 200 (warm, handler reused); (d) `GET /respond/error` → HTTP 500, JSON-body содержит `trace_id`, значение body-`trace_id` === заголовок `X-Trace-Id` ответа === `trace_id` в per-request лог-строке сервера (один uuid; spec amendment A-13 — trace-correlation proof вместо `@YandexContext()` /context); (e) два запроса к `/respond/error` → разные uuid (per-request id uniqueness, FR-019); (f) `stop()` → `fetch(baseUrl)` fails with connection refused; (g) `GET /nonexistent` → NestJS 404 (not server-level). Fixture must use `tsx` or pre-compiled JS for host-loader (A-2). RED: integration test fails (no server implementation). **Ref**: US1-SC1..4, FR-001..003, FR-007, quickstart Sc1, Sc3, A-13.

### Implementation for US1 (GREEN)

- [x] T051 [US1] Wire `createYcsfLocalServer` in `packages/js-dev-tools/src/server/index.ts` — export `createYcsfLocalServer` and `resolveIamToken` from subpath `./server` (FR-001); export types `YcsfLocalServerOptions`, `LocalDevServer`. This is the public API entry point (S-1). The actual `create.ts` lifecycle was implemented in Phase 2 (T028); this task wires the exports. **Ref**: FR-001, S-1.
- [x] T052 [US1] Verify full integration: `createYcsfLocalServer` → `fetch` → NestJS handler → response → `stop()` — run T050 tests, confirm cold start (first request non-trivial latency) and warm reuse (second request fast). If any integration test fails, fix `create.ts` orchestration or `payload.ts`/`context.ts` module. **Depends**: T028, T015, T017, T021, T023, T030.

**Checkpoint**: `pnpm --filter @ycforge/js-dev-tools test -- --run test/server.integration.spec.ts` US1 section GREEN. Real NestJS handler processes request end-to-end through connector.

---

## Phase 5: US4 — Response mapping without loss (Priority: P2)

**Goal**: Envelope `YandexFunctionHttpResponse` → HTTP-ответ: statusCode, headers, multiValueHeaders (Set-Cookie), binary base64, error 500 with trace_id.

**Independent Test**: Fixture-контроллеры возвращающие разные envelope → проверка HTTP-ответа.

### Tests for US4 (RED — write FIRST)

- [x] T060 [P] [US4] RED integration-test section in `packages/js-dev-tools/test/server.integration.spec.ts` (US4) — extend fixture `app.module.ts` with response-specific controllers: (a) `GET /respond/201` → `{ statusCode: 201, headers: { 'X-Custom': 'v' }, body: '{"ok":true}', isBase64Encoded: false }` → HTTP 201, header present, body correct; (b) `GET /respond/multicookie` → `multiValueHeaders: { 'set-cookie': ['a=1', 'b=2'] }` → TWO separate `Set-Cookie` lines in HTTP response; (c) `GET /respond/binary` → `body: base64(PNG bytes)`, `isBase64Encoded: true` → client receives decoded binary; (d) `GET /respond/error` → controller throws → HTTP 500, JSON body содержит `trace_id`, `X-Trace-Id` header present, trace_id равен X-Trace-Id, no secrets in body. Observed envelope for Nest-handled throws: `{ statusCode: 500, message, trace_id }` (Nest default exception layer + connector attaches trace_id to >=400 envelopes; probe in T050/US1 — do NOT fake `{ error, ... }` shape; the emulator's `{ error, message, trace_id }` errorResponse is for non-envelope handler results). RED: response integration tests fail. **Ref**: US4-SC1..SC4, FR-021..022, quickstart Sc5.

### Implementation for US4 (GREEN)

- [x] T061 [US4] Verify `applyEnvelope` + `errorResponse` in `packages/js-dev-tools/src/server/response.ts` handle all US4 cases end-to-end through server integration. Confirm `multiValueHeaders` mapping produces separate `Set-Cookie` lines (not comma-joined). Confirm binary round-trip. Confirm 500 error JSON shape and trace_id. **Depends**: T021, T051.

**Checkpoint**: `pnpm --filter @ycforge/js-dev-tools test -- --run test/response.spec.ts` unit GREEN + `test/server.integration.spec.ts` US4 section GREEN.

---

## Phase 6: US3 — IAM token resolution (Priority: P1)

**Goal**: `resolveIamToken()` env→OAuth→SA key цепочка с приоритетом, fail-open. Токен прокидывается в raw context (`token` key; контракт `@YandexContext()`-параметров — граница Project A, A-13).

**Independent Test**: Unit-тесты `iam.spec.ts` с mock `fetchImpl` и temp `~/.yc` (SC-007: no Cloud).

### Tests for US3 (RED — write FIRST)

- [x] T070 [P] [US3] Expand RED unit-test section in `packages/js-dev-tools/test/iam.spec.ts` — additional edge cases: (a) `config.yaml` YAML parse error → `undefined` + `reason: "io"`; (b) `~/.yc/keys/` directory with multiple JSON files → first parseable wins; (c) `~/.yc/keys/` with no valid JSON → `undefined` + `reason: "no-credential"`; (d) SA key JWT claims: `iss` = `service_account_id`, `aud` = `{iamEndpoint}/iam/v1/tokens`, `exp - iat = 3600`; (e) OAuth exchange with IAM API returning 401 → `undefined` + `reason: "exchange-error"`; (f) `fetchImpl` not called when `YC_IAM_TOKEN` env set (zero network on env path). RED: iam edge cases fail. **Ref**: US3-SC1..6, FR-023..025, quickstart Sc4.

### Implementation for US3 (GREEN)

- [x] T071 [US3] Wire IAM resolution in `createYcsfLocalServer` lifecycle (`packages/js-dev-tools/src/server/create.ts`) — when `yandexContext.token` absent, call `resolveIamTokenDetailed()` before server listen; resolved token → merged into raw context; `undefined` → warning `JDT_IAM_UNAVAILABLE` to stderr once, banner shows "no token"; server continues. Verify (spec amendment A-13 — contract verified at raw-context level, not via over-HTTP `@YandexContext()`): no token → raw context has NO `token` field (unit `buildRawContext` T018; integration: banner `JDT_IAM_UNAVAILABLE` warning once, requests work); token present (`yandexContext.token` or resolved) → raw context contains it (mock `yandexContext`/create.test or unit). **Depends**: T025, T028, T051.

**Checkpoint**: `pnpm --filter @ycforge/js-dev-tools test -- --run test/iam.spec.ts` GREEN + US3 integration cases GREEN.

---

## Phase 7: US5 — Fail-fast on invalid configuration (Priority: P2)

**Goal**: `messageQueue:true`, `!apiGatewayV2&&!messageQueue`, invalid port, bad entry → rejected promise with `JDT_*` code before handler/listener created.

**Independent Test**: `createYcsfLocalServer` с каждой невалидной опцией → rejected promise `LocalDevServerError { code }`.

### Tests for US5 (RED — write FIRST)

- [x] T080 [P] [US5] RED integration-test section in `packages/js-dev-tools/test/server.integration.spec.ts` (US5) — (a) `messageQueue: true` → promise rejects `JDT_MQ_UNSUPPORTED`, no listener; (b) `apiGatewayV2: false, messageQueue: false` → `JDT_NO_TRANSPORT`; (c) `entry: './does-not-exist.ts'` → `JDT_ENTRY_RESOLVE_FAILED`; (d) entry with no module export → `JDT_ENTRY_MODULE_NOT_FOUND` (message lists allowed exports); (e) entry with ambiguous exports → `JDT_ENTRY_MODULE_AMBIGUOUS`; (f) port: NaN → `JDT_INVALID_PORT`; (g) port: -1 → `JDT_INVALID_PORT`; (h) port: 70000 → `JDT_INVALID_PORT`; (i) port: 3000.5 → `JDT_INVALID_PORT`; (j) `LocalDevServerError` instanceof Error, `.code` matches expected. All cases: verify no listener on any port (mock net.Server not called, or port not bound). RED: fail-fast integration tests fail. **Ref**: US5-SC1..6, FR-004, FR-029, quickstart Sc6.

### Implementation for US5 (GREEN)

- [x] T081 [US5] Verify all fail-fast paths in `packages/js-dev-tools/src/server/create.ts` and `packages/js-dev-tools/src/server/options.ts` — validateOptions runs FIRST (before loadEntryModule, before probePort, before handler); each error code matches `JdtDiagnosticCode` union. `probePort` runs before `createHandler` (no handler created on EADDRINUSE). Confirm via T080 integration tests. **Depends**: T013, T019, T028.

**Checkpoint**: `pnpm --filter @ycforge/js-dev-tools test -- --run test/server.integration.spec.ts` US5 section GREEN. All `JDT_*` codes reachable.

---

## Phase 8: US6 — Graceful lifecycle: stop() (Priority: P2)

**Goal**: `stop()` closes listener + handler.close(); double-stop idempotent; stop during in-flight completes current request.

**Independent Test**: Start → request → stop → verify port released → restart on same port.

### Tests for US6 (RED — write FIRST)

- [x] T090 [P] [US6] RED integration-test section in `packages/js-dev-tools/test/server.integration.spec.ts` (US6) — (a) start server, `await stop()`, `fetch(baseUrl)` → connection refused; (b) start on port P, stop, start on port P again → success (port released); (c) `stop()` called twice → no throw, no error (idempotent); (d) start server, fire long-running request + immediately `stop()` → request completes (200) before connection drops (in-flight drain). RED: lifecycle tests fail. **Ref**: US6-SC1..3, FR-003, FR-009, quickstart Sc7.

### Implementation for US6 (GREEN)

- [x] T091 [US6] Verify `stop()` implementation in `packages/js-dev-tools/src/server/create.ts` — `server.close()` then `await close()` (handler); closed flag prevents double-stop; Node `server.close` drains active connections (new connections refused). Confirm via T090 integration tests. **Depends**: T028, T051.

**Checkpoint**: `pnpm --filter @ycforge/js-dev-tools test -- --run test/server.integration.spec.ts` US6 section GREEN. No port leaks.

---

## Phase 9: US7 — Observability: banner + per-request logs (Priority: P3)

**Goal**: Startup banner (URL, mode, IAM status, no token value), per-request `method path → status (latency ms) trace_id=<id>`, error logs with stack, secret redaction.

**Independent Test**: Capture stderr during start + requests; verify format, no secrets.

### Tests for US7 (RED — write FIRST)

- [x] T100 [P] [US7] RED integration-test section in `packages/js-dev-tools/test/server.integration.spec.ts` (US7) — (a) stderr contains `local-dev-server listening on http://127.0.0.1:<port> (apiGatewayV2) — IAM token resolved` when token provided; (b) stderr contains `— IAM unavailable (JDT_IAM_UNAVAILABLE: <reason>) — running without token` when no token; (c) per-request line matches `GET /api/users → 200 (\d+ ms) trace_id=<uuid>`; (d) two requests → two different `trace_id` values; (e) error handler invocation → stderr contains error stack with same `trace_id`; (f) when token `secret-value` is set in options, `secret-value` does NOT appear anywhere in stderr (redaction). RED: observability tests fail. **Ref**: US7-SC1..4, FR-026..028, quickstart Sc8.

### Implementation for US7 (GREEN)

- [x] T101 [US7] Verify startup banner + per-request log format in `packages/js-dev-tools/src/server/create.ts` and `packages/js-dev-tools/src/server/diagnostics.ts` (redactSecrets). Banner: `process.stderr.write(...)` with URL, mode, IAM status (no token value). Per-request: `method path → statusCode (${ms} ms) trace_id=${requestId}`. Error log: stack via `redactSecrets`. Confirm via T100 stderr capture. **Depends**: T011, T028, T051.

**Checkpoint**: `pnpm --filter @ycforge/js-dev-tools test -- --run test/server.integration.spec.ts` US7 section GREEN. Grep-stable log format. Zero secrets in stderr.

---

## Phase 10: Fidelity Deviations & Spec Reconciliation

**Purpose**: Explicit tasks to ASSERT spec-mandated deviation behavior in tests (encode the decision D-5/R-10), and plan the future CONVERGE reconcile note.

- [x] T110 [P] [US2] Add assertion tests in `packages/js-dev-tools/test/payload.spec.ts` that SPECIFY deviation behavior (encode D-5/R-10 into tests): (a) `rawPath` for `/api/users%2Factive` → stays `%2F`-encoded (NOT decoded); assert `event.rawPath === "/api/users%2Factive"`; (b) empty body GET → `body: ""` + `isBase64Encoded: false` (NOT platform's `true`); (c) `requestId` always `randomUUID()` even if client sends `X-Request-Id` header; (d) `requestContext.http.path` = `rawPath + '?' + rawQueryString` (trailing `?` when no query), NOT sorted/re-encoded. These tests lock spec behavior. **Ref**: R-10, D-5, quickstart Sc11.
- [x] T111 Add reconcile note comment in `packages/js-dev-tools/src/server/payload.ts` header — `// DEVIATION from platform: R-10 fidelity deviations documented in specs/023-local-dev-server/research.md §R-10 and quickstart.md Sc11. Reconcile at /speckit.converge.` — placeholder for future convergence step. **Ref**: R-10.

**Checkpoint**: All R-10 deviation tests GREEN (encode spec behavior). Reconcile note present.

---

## Phase 11: Host-loader E2E & Entry Edge Cases

**Purpose**: E2E test via child process (`node --import tsx`) + CJS entry edge case (A-2, spec edge cases).

- [x] T120 [P] RED e2e-test `packages/js-dev-tools/test/host-loader.e2e.spec.ts` — (a) spawn `node --import tsx` with TS entry file → `createYcsfLocalServer` succeeds, fetch returns 200; (b) spawn plain `node` with TS entry (no loader) → exit non-zero, error mentions TS/tsx; (c) CJS entry file (`module.exports = class`) → succeeds with Node interop. Uses child process + temp files. RED: e2e tests fail (no e2e test file). **Ref**: A-2, FR-005, quickstart Sc10.
- [x] T121 Create CJS fixture `packages/js-dev-tools/test/fixtures/user-service/cjs-entry.cjs` — `module.exports = require('./app.module').AppModule` (or inline class) for CJS interop test. **Ref**: spec edge cases.

**Checkpoint**: `pnpm --filter @ycforge/js-dev-tools test -- --run test/host-loader.e2e.spec.ts` GREEN.

---

## Phase 12: Polish & Cross-Cutting

**Purpose**: Quickstart validation (Sc1..Sc12), typecheck, lint, full regression, README, export map.

- [x] T130 Verify quickstart Sc1 — `createYcsfLocalServer` + `fetch` → 200 + JSON, cold/warm latency. **Depends**: T051, T052.
- [x] T131 Verify quickstart Sc2 — `payload.spec.ts` covers all US2-SC1..SC6 cases, encoded path raw, comma-join headers. **Depends**: T016, T040.
- [x] T132 Verify quickstart Sc3 — `context.spec.ts` raw context unit contract (token/folderId/defaults, `awsRequestId == requestId`, uberTraceId) + trace correlation via `server.integration.spec.ts` (envelope trace_id == X-Trace-Id == log trace_id; A-13). **Depends**: T018, T051.
- [x] T133 Verify quickstart Sc4 — `iam.spec.ts` env/OAuth/SA-key paths, priority, fail-open. **Depends**: T026, T071.
- [x] T134 Verify quickstart Sc5 — response mapping: 201+header, multiSet-Cookie, binary, 500+trace_id. **Depends**: T022, T061.
- [x] T135 Verify quickstart Sc6 — all `JDT_*` codes: MQ_UNSUPPORTED, NO_TRANSPORT, INVALID_PORT, PORT_IN_USE, ENTRY_RESOLVE_FAILED, ENTRY_MODULE_NOT_FOUND, ENTRY_MODULE_AMBIGUOUS. **Depends**: T080, T081.
- [x] T136 Verify quickstart Sc7 — `stop()` releases port, double-stop idempotent, in-flight drain. **Depends**: T090, T091.
- [x] T137 Verify quickstart Sc8 — banner format, per-request log, secret redaction. **Depends**: T100, T101.
- [x] T138 Verify quickstart Sc9 — main-guard fixture, side-effect-free entry contract. **Depends**: T020, T034.
- [x] T139 Verify quickstart Sc10 — host-loader e2e (`tsx`), CJS entry interop. **Depends**: T120, T121.
- [x] T140 Verify quickstart Sc11 — documented deviations asserted in payload tests (R-10). **Depends**: T110.
- [x] T141 Verify quickstart Sc12 — edge cases: HEAD/OPTIONS, form-urlencoded, UTF-8 grey zone, empty rawQueryString, concurrent cold start, yandexContext stable. **Depends**: T016, T052.
- [x] T142 Structural consistency audit — (a) `JDT_*` constants byte-for-byte == `specs/023-local-dev-server/contracts/local-dev-server.json` `#/definitions/jdtDiagnosticCode/enum` (8 values); (b) `LocalDevServerError.name === 'LocalDevServerError'`; (c) no string-literal `JDT_*` comparisons in `src/server/*` (only constant imports, constitution V); (d) FR-029 catalog in spec.md matches contract enum. **Depends**: T010, T011, T012.
- [x] T143 Typecheck clean — `pnpm --filter @ycforge/js-dev-tools typecheck` (`tsc --noEmit`, strict, noUncheckedIndexedAccess) → zero errors (including all new modules, fixture decorators, vitest globals). **Depends**: T002, T015, T017, T019, T021, T023, T025, T028.
- [x] T144 Lint clean — `pnpm exec eslint packages/js-dev-tools/src packages/js-dev-tools/test` → zero errors (scoped, root `pnpm lint` has pre-existing 23+ baseline errors NOT to fix). **Depends**: T143.
- [x] T145 Full build — `pnpm --filter @ycforge/js-dev-tools build` (`tsup`) → `dist/server/index.{js,cjs,d.ts}` present, `exports["./server"]` resolves, no new external deps added to dist. **Depends**: T001, T003.
- [x] T146 Full test suite + zero-regression — `pnpm --filter @ycforge/js-dev-tools test` → ALL tests GREEN (`test/diagnostics.test.ts`, `test/options.test.ts`, `test/payload.spec.ts`, `test/context.spec.ts`, `test/entry.spec.ts`, `test/response.spec.ts`, `test/connector.test.ts`, `test/iam.spec.ts`, `test/create.test.ts`, `test/server.integration.spec.ts`, `test/host-loader.e2e.spec.ts`). **Depends**: T143, T144, T145.
- [x] T147 Docs sync — verify `specs/023-local-dev-server/quickstart.md` Sc1..Sc12 match implemented API; if spec and `IDEA.md §38` diverge, update `IDEA.md` (§38 local development section) per AGENTS.md (specs win, IDEA.md updated). Check `specs/README.md` roadmap still ⬜ until converge. **Depends**: T130..T141.
- [x] T148 SC-001 performance sanity — `createYcsfLocalServer` + `fetch` warm request p50 < 50 ms (fixture `user_service`). Record result. **Depends**: T052.
- [x] T149 SC-008 delegation boundary — static verification: `grep -r "NestFactory\|@nestjs/core" packages/js-dev-tools/src/` returns zero matches; only `@ycforge/nestjs-connector` import is `createYandexHandler` + public types (FR-008). **Depends**: T023, T024.

---

## Phase 13: Convergence

**Purpose**: Gaps found during `/speckit.converge` (read-only audit, `pnpm --filter @ycforge/js-dev-tools test` full, `typecheck`/`lint` clean, quickstart probes). Verdict placeholder — populate after implementation.

- [x] T150 Convergence findings placeholder — read-only audit during final verification (spec 023 is also the Arbitrator-verified amended baseline): full suite 128/128 GREEN (11 files), typecheck zero errors, scoped eslint zero errors, tsup build produces `dist/server/index.{js,cjs,d.ts}`, T148 warm p50 0.46 ms (< 50 ms), trace-correlation probe lock (envelope `{ statusCode, message, trace_id }`, header `x-trace-id`, log line all carry one uuid), IDEA.md §38 synced to A-13 ground truth. Verdict: Converged within v1 scope; RED→GREEN discipline held per phase; deviations documented (R-10 tests, T111 note).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No deps — can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 (package exists). BLOCKS all US phases. Internal order: T010/T011/T013/T015/T017/T019/T021/T023/T025/T027/T028 [P] (modules) → T012/T014/T016/T018/T020/T022/T024/T026/T029 (tests) — RED before GREEN per file. Fixtures T030–T034 [P].
- **Phase 3 (US2)**: Depends on Phase 2 (payload module + fixtures). T040 (RED) → T041 (verify GREEN).
- **Phase 4 (US1)**: Depends on Phase 2 complete + fixtures. T050 (RED) → T051 (exports) → T052 (integration GREEN). MVP checkpoint.
- **Phase 5 (US4)**: Depends on Phase 2 + Phase 4 (server integration exists). T060 (RED) → T061 (GREEN).
- **Phase 6 (US3)**: Depends on Phase 2 (iam module). T070 (RED) → T071 (GREEN wiring).
- **Phase 7 (US5)**: Depends on Phase 2 (options/entry/connector). T080 (RED) → T081 (GREEN verify).
- **Phase 8 (US6)**: Depends on Phase 2 + Phase 4 (lifecycle integration). T090 (RED) → T091 (GREEN verify).
- **Phase 9 (US7)**: Depends on Phase 2 + Phase 4 (server running, logs emitted). T100 (RED) → T101 (GREEN verify).
- **Phase 10 (Fidelity Deviations)**: Depends on Phase 2 (payload module) + Phase 3 (US2 tests). T110 [P] (deviation assertions) + T111 (reconcile note).
- **Phase 11 (Host-loader E2E)**: Depends on Phase 4 (working server). T120 (RED) + T121 (fixture).
- **Phase 12 (Polish)**: Depends on all US phases (3–11). T130–T141 [P] (quickstart) → T142 → T143 → T144 → T145 → T146 → T147 → T148 → T149.
- **Phase 13 (Convergence)**: Depends on Polish complete. T150 placeholder.

### User Story Dependencies

```
Phase 1 (Setup) ─────────────────────────────────────────────────────┐
                                                                      ▼
Phase 2 (Foundational) ──────────┬──────────────────────────────────┐
                                  │                                   │
                                  ├──► Phase 3 US2 payload ──────────┤
                                  │        │                         │
                                  ├──► Phase 4 US1 lifecycle ────────┼──► Phase 5 US4 response
                                  │        │                         │         │
                                  │        ├──► Phase 8 US6 stop ────┤         │
                                  │        │                         │         │
                                  │        └──► Phase 11 host-loader ┤         │
                                  │                                   │         │
                                  ├──► Phase 6 US3 IAM ──────────────┤         │
                                  │                                   │         │
                                  ├──► Phase 7 US5 fail-fast ────────┤         │
                                  │                                   │         │
                                  ├──► Phase 9 US7 observability ────┤         │
                                  │                                   │         │
                                  └──► Phase 10 fidelity deviations ─┘         │
                                                                               │
                                                            Phase 12 Polish ──┘
                                                                   │
                                                            Phase 13 Convergence
```

- **US2 (payload)**: Can start in parallel with US1 after Phase 2 (different files).
- **US1 (lifecycle)**: Foundation for US4 (response), US6 (stop), US7 (observability), US11 (host-loader) — server must exist.
- **US3 (IAM)**: Independent of US1/US2 (pure unit tests, no server); but wiring in create.ts (T071) depends on Phase 4.
- **US5 (fail-fast)**: Independent of US1 content (tests only check rejection, not running server); depends on Phase 2 options/entry.
- **US4 (response)**: Depends on US1 (server integration for response mapping tests).
- **US6 (lifecycle)**: Depends on US1 (server must exist to stop).
- **US7 (observability)**: Depends on US1 (server emits logs).
- **US10 (fidelity deviations)**: Depends on US2 (payload tests exist).
- **US11 (host-loader E2E)**: Depends on US1 (server works end-to-end).
- **Polish**: Depends on all US phases.

### Parallel Opportunities

- **Phase 2**: T015/T017/T019/T021/T023/T025/T027/T028 [P] (different source files); T016/T018/T020/T022/T024/T026/T029 [P] (different test files); T030–T034 [P] (different fixture files).
- **After Phase 2**: US2 (payload), US1 (lifecycle), US3 (IAM unit), US5 (fail-fast), US9 (observability) can start in parallel by different developers.
- **After Phase 4 (US1)**: US4 (response), US6 (stop), US7 (observability), US11 (host-loader) can start in parallel.
- **Phase 12**: T130–T141 [P] (quickstart per scenario, independent probes).

### Parallel Example: After Phase 2

```bash
# Foundational done — parallel US chains:
Task: "US2: payload fidelity T040 → T041"
Task: "US1: lifecycle T050 → T051 → T052 (MVP)"
Task: "US3: IAM unit T070 → T071"
Task: "US5: fail-fast T080 → T081"
Task: "US7: observability T100 → T101"
# After US1 (MVP):
Task: "US4: response T060 → T061"
Task: "US6: stop T090 → T091"
Task: "US11: host-loader E2E T120 → T121"
Task: "US10: fidelity deviations T110 → T111"
# Then:
Task: "Phase 12: Polish T130..T149"
```

---

## Implementation Strategy

### MVP First (US1 only — lifecycle + handler)

1. Complete Phase 1: Setup (package scaffolding).
2. Complete Phase 2: Foundational (diagnostics, payload, context, response, connector, iam, entry, lifecycle, fixtures).
3. Complete Phase 4: US1 — lifecycle (RED T050 → GREEN T051/T052).
4. **STOP and VALIDATE**: `createYcsfLocalServer` + `fetch` → 200 + JSON through real NestJS handler via connector. `stop()` works.
5. MVP: local dev server works end-to-end.

### Incremental Delivery

1. Setup + Foundational → package buildable + all core modules.
2. US1 (lifecycle) → Test independently → MVP! (SC-001)
3. US2 (payload fidelity) → Payload accuracy (SC-002)
4. US4 (response mapping) → Response without loss (SC-005)
5. US3 (IAM resolution) → Token chain (SC-004)
6. US5 (fail-fast) → Configuration safety (SC-006)
7. US6 (graceful lifecycle) → stop() reliability
8. US7 (observability) → Logs and trace (SC-007 partial)
9. Fidelity deviations → Documented D-5/R-10 behavior locked
10. Host-loader E2E → TS entry works (A-2)
11. Polish → quickstart, typecheck, lint, regression, docs/IDEA.md.

### Parallel Team Strategy

With multiple developers:
1. Together: Phase 1 + Phase 2 (Foundational).
2. Once Foundational done:
   - Developer A: US1 (lifecycle, MVP) + US6 (stop) + US11 (host-loader) — server core
   - Developer B: US2 (payload) + US10 (fidelity deviations) — translation layer
   - Developer C: US3 (IAM) + US5 (fail-fast) + US7 (observability) — config/logs
3. After A completes US1:
   - Developer D: US4 (response) — depends on A's server
4. After A+B+C+D: Polish together — quickstart, typecheck, lint, regression, IDEA.md.

---

## Notes

- [P] tasks = different files, no dependencies — safe to parallelize.
- [USn] label maps task to specific user story for traceability (FR→AC→task).
- Each US: tests (RED) MUST be written and FAIL before implementation (GREEN) — Constitution II, spec SC-007.
- Commit after each task or logical group.
- Stop at any checkpoint to validate story independently (`pnpm --filter @ycforge/js-dev-tools test -- --run <file>`).
- Avoid: vague tasks, same-file conflicts, cross-story deps that break independence.
- New package: no existing tests to break; zero-regression means zero NEW failures, not zero pre-existing.
- Deviation `JDT_INVALID_PORT`: spec amendment (T010) updates FR-029; contract already updated; lock in tests (T012, T014, T080).
- Deviation R-10: tests encode spec behavior (T040, T110); NOT platform behavior; reconcile note (T111) for future CONVERGE.
- Fixture applications require NestJS decorator metadata → swc plugin in vitest.config.ts is MANDATORY (R-1).
- `tsx` is devDependency only (tests/host-runner), NOT runtime dependency (S-1).
