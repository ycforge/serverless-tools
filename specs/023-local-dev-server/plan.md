# Implementation Plan: local-dev-server — `@ycforge/js-dev-tools/server` (spec 023)

**Branch**: `023-local-dev-server` | **Date**: 2026-09-11 | **Spec**: [specs/023-local-dev-server/spec.md](./spec.md)

**Input**: Feature specification from `./spec.md` (payload 2.0 эмуляция, §38, S-1..S-9, D-1..D-10, FR-001..029, US1..7)

## Summary

Spec 023 добавляет новый dev-tooling пакет `packages/js-dev-tools` (`@ycforge/js-dev-tools`, subpath `./server`): `createYcsfLocalServer({ entry, apiGatewayV2?, messageQueue?, port?, yandexContext? })` поднимает локальный HTTP-сервер (`127.0.0.1`), переводит входящий HTTP-запрос в **payload 2.0** (`RawHttpApiGatewayV2Event`), вызывает handler коннектора строго как `(rawEvent, rawContext) => Promise<unknown>` через единственный публичный API `createYandexHandler(appModule)` (lazy cold start на первом запросе — как в облаке), маппит envelope ответа без потерь и синтезирует raw context для `@YandexContext()` (token/folderId/cloudId, `trace_id == awsRequestId == requestId`, `uberTraceId` из `Uber-Trace-Id`, `X-Trace-Id` echo). Пакет также экспортирует `resolveIamToken()` — fail-open цепочку `YC_IAM_TOKEN` env → `~/.yc/config.yaml` (OAuth-exhange) → `~/.yc/keys/*.json` (SA key → JWT PS256 → exchange), один резолв на старт, без refresh. Это НЕ A и НЕ C (Constitution I): никакого `NestFactory`/deep imports коннектора, никакого transpile/build/deploy — только делегирование в коннектор. Fail-fast на конфигурации (`JDT_*`), fail-open на окружении (IAM), HTTP 500 с `trace_id` на ошибке инвокации.

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM, `"type": "module"`, `engines.node >= 22`). `node:http`, `node:crypto` (`randomUUID`, `createPrivateKey`, `sign` RSA-PSS), `node:path`, `node:util` (`pathToFileURL`) — built-ins. Никакого внешнего HTTP/express.

**Primary Dependencies**: `@ycforge/nestjs-connector` (`workspace:*`) — единственная runtime-интеграция (pull `createYandexHandler` + типы `RawHttpApiGatewayV2Event`/`YandexFunctionHttpResponse`/`YandexExecutionContext`); `yaml` — парсинг `~/.yc/config.yaml` (S-8). `peerDependencies`: `@nestjs/common`/`@nestjs/core` (host-приложение; пакет их не импортирует). devDeps: `tsup`, `vitest`, `typescript`, `@types/node`, `reflect-metadata`, `tsx` (только тесты/host-запуск, R-1).

**Storage**: N/A (без диска; `~/.yc/config.yaml` и `~/.yc/keys/*` — read-only input IAM-цепочки с override через `homeDir` в тестах).

**Testing**: Vitest (unit + integration). Test-first per Constitution II: каждый FR-001..029 / US1..7 → ≥1 тест, RED → GREEN (quickstart Sc1..Sc12). Unit: чистые преобразования `payload`/`context`/`response`/`iam` (без сети — exchange через мок `fetchImpl`, temp `~/.yc`); интеграция: fixture `test/fixtures/user-service/` (контроллеры с NestJS DI; `@YandexContext()`-параметр over-HTTP не заполняется коннектором — граница A-13, контракт контекста на unit-уровне) через `createYandexHandler`, реальный `await createYcsfLocalServer` + `fetch(baseUrl)`; e2e: child process `node --import tsx` для host-loader (A-2). Vitest-конфиг = nest-bridge со swc emit-decorator-metadata-плагином (зарезолвленные `design:paramtypes` в fixture-контроллерах), `maxWorkers: 2`. Тесты не ходят в Yandex Cloud (SC-007).

**Target Platform**: Node 22+ ESM-пакет `packages/js-dev-tools`, собран tsup (esm+cjs+dts), единственный export subpath `./server`. Дублистайл nest-bridge (`exports["./server"]`, `dist/server/index.js`).

**Project Type**: library/dev-tooling (local HTTP emulator). Не CLI, не деплой, не рантайм.

**Performance Goals**: SC-001 — p50 latency тёплой инвокации < 50 ms локально; encoding/parse overhead эмулятора ≤ нескольких ms (buffered body, без копий где возможно); cold start — как у коннектора (первый запрос).

**Constraints**: Delegation-граница: только публичный API коннектора, глубокие импорты заблокированы (contract `src/index.ts`, docs/ARCHITECTURE.md §2). Frame of fidelity — spec S-5 (rawPath/rawQueryString без повторного декодирования; gateway-only поля `{}`/`""`). Entry-контракт: named `AppModule` → default, без transpile (host-loader). Error semantics: fail-fast на конфигурации (`JDT_*`), fail-open на IAM/сети, 500 + `trace_id` на throw handler (D-10). Секреты (token/Authorization/Cookie) не логируются и не попадают в ответы (FR-028). Кананические `user_service`/`analytics`/`frontend`/`openapi` примеры не ломаются.

**Scale/Scope**: ~1 пакет (7 src-модулей + 1 subpath entry), ~5 вида тестов (unit+e2e), 7 user stories, 29 FR, 2 contract JSON. Новые диагностические коды `JDT_*`. Контракты коннектора не меняются.

## Constitution Check

*GATE: Passed before Phase 0 research; re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Новый пакет `packages/js-dev-tools` — dev-tooling (эмуляция окружения вызова), не runtime (A), не orchestration (C), не provisioning. Единственная интеграция — публичный `createYandexHandler(appModule)` (S-4, D-3, R-2). Никаких `NestFactory.create`, deep imports коннектора, transpile, build, deploy (spec «Пакет НЕ…»). SC-008 верифицирует статически. |
| II. Spec-First, Test-First | ✅ PASS | Каждый FR-001..029 и US1..7 → ≥1 тест (traceability: quickstart Sc1..Sc12, test mapping). RED → GREEN. Исключение Constitution II (thin orchestration) неприменимо — регион чистые функции/emulator, unit-testable. |
| III. Contracts Versioned | ✅ PASS | `@ycforge/js-dev-tools` — новый пакет, публичный API версионируется semver (как nest-bridge/composer/pilot). Контракты коннектора, которые пакет использует (`RawHttpApiGatewayV2Event`, `YandexFunctionHttpResponse`, `YandexExecutionContext`, `createYandexHandler`), не меняются (FR-008). Diagnostics `JDT_*` — аддитивны. Один документированный add-on к закрытому FR-029 (см. ниже). |
| IV. Terraform Stays Terraform | ✅ PASS | Неприменимо: эмулятор не трогает provisioning/`.tf`/state. |
| V. Explicit Over Magic | ✅ PASS | Entry-контракт явный (AppModule/default, fail-fast на неоднозначность), gateway-only поля — документированные пустые дефолты (D-5), body-кодирование детерминировано (A-11/R-8), никаких implicit health-роутов (spec не требует), fail-fast на конфигурации vs fail-open на окружении (D-10). Фиделити-отклонения spec↔наблюдение документированы (R-10), не молчаливы. |
| VI. Ownership: apps=managed | ✅ PASS | Неприменимо (C-level ownership, .ycsf-модель не затрагивается; сервер не видит apps.yaml/resources.yaml). |
| Monorepo Tooling | ✅ PASS | Новый пакет в `packages/*` (pnpm-workspace), конвенции зеркалятся с nest-bridge (R-1), `yaml` — уже используется B/C. |

**Deviations (не проход через silent, осознанные и задокументированные)**:
1. **`JDT_INVALID_PORT`** — аддитивный diagnostic-код вне закрытого списка FR-029: `port` — обязательная fail-fast-поверхность (S-2), невалидное значение не может быть честно названо `JDT_PORT_IN_USE`; добавлен с обоснованием (contract обновлён, data-model/quickstart Sc6). Рекомендуется при `/speckit.analyze` синхронизировать FR-029 spec.
2. **Фиделити-отклонения (R-10)**: `rawPath` (raw vs платформенный decode), `isBase64Encoded` на пустом теле (`false` vs платформенный `true`), `requestId` (всегда `randomUUID()` vs платформенное эхо `X-Request-Id`), `requestContext.http.path` (формула spec vs платформенная нормализация query). Всё — прямое следование spec S-5/FR-014/FR-019; отклонения зафиксированы в quickstart Sc11 и README пакета.

**Gate Decision**: All gates PASS (with two documented, non-silent deviations) — design proceeded to Phase 1 and re-checked post-design: research.confirmed delegation shape (R-2), payload fidelity (R-3), context contract (R-5), IAM fail-open (R-6), Node semantics (R-8); ничего не потребовало правки spec. Constitution re-check after Phase 1: PASS.

## Project Structure

### Documentation (this feature)

```text
specs/023-local-dev-server/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (R-1..R-10, NEEDS CLARIFICATION)
├── data-model.md        # Phase 1 output (options, event, raw context, envelope, IAM, diagnostics, lifecycle)
├── quickstart.md        # Phase 1 output (validation scenarios Sc1..Sc12)
├── contracts/           # Phase 1 output
│   ├── local-dev-server.json   # createYcsfLocalServer options, LocalDevServer handle, JDT_* codes
│   └── iam-resolution.json     # resolveIamToken chain (env → OAuth → SA key) + fail-open reasons
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/js-dev-tools/
├── package.json                  # @ycforge/js-dev-tools, type:module, exports: { "./server": { types, import, require } }
├── tsconfig.json                 # зеркало nest-bridge (strict, noUncheckedIndexedAccess, decorators for fixtures)
├── tsup.config.ts                # entry { 'server/index': 'src/server/index.ts' }, esm+cjs, dts, clean, sourcemap
├── vitest.config.ts              # swc emit-decorator-metadata (как nest-bridge), include src/**/*.spec.ts + test/**/*.spec.ts, maxWorkers 2
├── src/
│   ├── server/
│   │   ├── index.ts              # PUBLIC: createYcsfLocalServer, resolveIamToken (типы опций/handle)
│   │   ├── options.ts            # YcsfLocalServerOptions validation/defaults (S-2, FR-002), JDT_INVALID_PORT
│   │   ├── diagnostics.ts        # LocalDevServerError { code }, JDT_* constants, redactSecrets()
│   │   ├── entry.ts              # loadEntryModule: dynamic import → AppModule/default, AMBIGUOUS/NOT_FOUND (S-3)
│   │   ├── payload.ts            # buildGatewayV2Event: pure HTTP → RawHttpApiGatewayV2Event (S-5) + toClfTime + encodeBody
│   │   ├── context.ts            # buildRawContext: pure synthesis of connector-required raw context (S-6)
│   │   ├── response.ts           # applyEnvelope → HTTP (multiValueHeaders/by-element, base64), errorResponse 500 JSON (S-7)
│   │   ├── iam.ts                # resolveIamToken(Detailed), env→OAuth→SA key chain, IamTokenExchanger (mock seam)
│   │   ├── request-id.ts         # newRequestId() = randomUUID (FR-019)
│   │   ├── create.ts             # lifecycle: validate → entry → probePort → IAM → handler → listen → banner → stop
│   │   └── connector.ts          # thin wrap: createYandexHandler(appModule) + close(); invoke как (rawEvent, rawContext)
│   └── (CLI/module fixtures не входит)
└── test/
    ├── fixtures/
    │   ├── user-service/
    │   │   ├── app.module.ts         # AppModule (named), AppController: GET /api/users, GET /respond/error (throws → 500 envelope with trace_id)
    │   │   ├── default-export.ts     # модуль как default export
    │   │   ├── ambiguous.ts          # named AppModule + другой default → JDT_ENTRY_MODULE_AMBIGUOUS
    │   │   └── no-module.ts          # без экспорта модуля → JDT_ENTRY_MODULE_NOT_FOUND
    │   └── side-effect-bootstrap.ts  # main-guard пример (не слушает на import-тайме)
    ├── payload.spec.ts           # FR-010..015, US2 (fixture-driven, чистая функция)
    ├── context.spec.ts           # FR-016..020, US1-SC3
    ├── response.spec.ts          # FR-021..022, US4 (multiValueHeaders/Set-Cookie, base64, 500+secrets)
    ├── iam.spec.ts               # FR-023..025, US3 (env/OAuth/SA-key, приоритет, fail-open; mock fetchImpl, temp homeDir)
    ├── entry.spec.ts             # FR-005..006, US5-SC3..5, CJS interop
    ├── server.integration.spec.ts# US1, US5..US7 (create/stop/fail-fast/banner/per-request log/redaction)
    └── host-loader.e2e.spec.ts   # child process: node --import tsx + TS entry (A-2, FR-005)
```

**Structure Decision**: Публичный entry — единственный subpath `./server` (spec S-1: «root export не требуется»); один subpath = каталог `src/server/` + `index.ts` (стиль nest-bridge auth/queue/context/logger). Чистые преобразования (`payload`/`context`/`response`) вынесены в отдельные модули — это «LocalDevPayloadBuilder / LocalDevContextBuilder / LocalDevResponseMapper» из Key Entities spec 023, тестируются unit-ами без сервера/сети. Оркестрация (`create.ts`) минимальна и держит lifecycle/фазы старта. Fixture-приложение и вложенные варианты entry — только в `test/fixtures/`. Тесты зеркалят layout nest-bridge (`test/*.spec.ts`, swc-плагин обязателен для `@YandexContext()` fixture).

## Complexity Tracking

> No constitution violations introduced — all gates pass. Net-new dev-tooling package is constitutionally required (dev-tooling is neither A, B, C nor Terraform; placing it in nest-bridge would mutate the A public contract). No source contract of connector/composer/pilot is touched.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Artifacts to review (Phase 0/1)

- [research.md](./research.md) — R-1..R-10 (build conventions, integration surface, payload fidelity, response, context synthesis, IAM chain, trace, Node HTTP semantics, CLF time, documented deviations).
- [data-model.md](./data-model.md) — типы, маппинг, lifecycle, invariants (продолжает спецификацию).
- [contracts/local-dev-server.json](./contracts/local-dev-server.json) — опции + handle + `JDT_*` (вкл. документированный add-on `JDT_INVALID_PORT`).
- [contracts/iam-resolution.json](./contracts/iam-resolution.json) — цепочка + fail-open reasons.
- [quickstart.md](./quickstart.md) — Sc1..Sc12 (потом — задачи и тесты in Phase 2 `/speckit.tasks`).