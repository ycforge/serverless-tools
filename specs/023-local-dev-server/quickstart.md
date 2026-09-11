# Quickstart: local-dev-server (spec 023)

**Spec**: [specs/023-local-dev-server/spec.md](./spec.md) | **Branch**: `023-local-dev-server` | **Date**: 2026-09-11

Runnable validation scenarios (Sc1..Sc12). Каждый сценарий доказывает конкретную часть фичи end-to-end. Канонический пример — `user_service` (как в specs/README, IDEA §5) — в тестах представлен фикстурой `packages/js-dev-tools/test/fixtures/user-service/`. Реализация — `packages/js-dev-tools/src/server/*`. Тесты не обращаются к Yandex Cloud: IAM exchange мокается (инжектированный `fetchImpl`), сеть — только для backoff-кейсов с локальным mock-сервером.

---

## Prerequisites

```bash
cd packages/js-dev-tools
pnpm install
pnpm build                      # tsup: dist/server/index.{js,cjs,d.ts}
pnpm typecheck && pnpm lint     # чисто (SC-007)
pnpm test                       # tsup && vitest run (RED → GREEN по US1..US7/FR-001..029)
```

Запуск dev-server поверх TS-entry — через host-loader (`tsx`), т.к. пакет не транслирует (S-3/A-2):

```bash
node --import tsx test/fixtures/dev-server.mjs   # entry: './test/fixtures/user-service/app.module.ts'
```

или `entry` на собранный JS. Публичный API:

```ts
import { createYcsfLocalServer, resolveIamToken } from '@ycforge/js-dev-tools/server';
```

---

## Sc1: Первый запрос через настоящий handler — cold start (US1, FR-001..003, FR-007)

**Fixture**: `test/fixtures/user-service/app.module.ts` (named export `AppModule`), `GET /api/users` → `{ users: [] }`.

```bash
node --import tsx -e "
import { createYcsfLocalServer } from './dist/server/index.js';
const s = await createYcsfLocalServer({ entry: './test/fixtures/user-service/app.module.ts', port: 0 });
const r = await fetch(s.baseUrl + '/api/users');
console.log(r.status, await r.text());   // 200 {"users":[]}
await s.stop();
"
```

**Ожидания**:
- Promise резолвится **после** bind; `baseUrl` сразу пригоден для fetch (D-2).
- Первый запрос — cold start (коннектор баутстрапит приложение), повторный — warm, handler переиспользован (FR-007/S-4) — проверка в тесте по времени (SC-001: p50 warm < 50ms локально).

**Тест**: `test/server.integration.spec.ts` «US1 cold/warm».

---

## Sc2: Payload 2.0 фиделити (US2, FR-010..015)

Чистая функция `buildGatewayV2Event` тестируется без сети: из фикстур входящих запросов (GET/POST/JSON/form/бинарный/encoded path/повторные query и заголовки) — событие, сверяемое с эталонной структурой по всем полям S-5.

```bash
pnpm vitest run test/payload.spec.ts
```

**Ключевые ожидания** (US2-SC1..SC6):
- `GET /api/users?tags=a&tags=b&limit=10` → `rawPath "/api/users"`, `rawQueryString "tags=a&tags=b&limit=10"`, `queryStringParameters.tags "a,b"`, `multiValueParameters.tags ["a","b"]`, `limit "10"`.
- POST JSON → `body '{"name":"x"}'`, `isBase64Encoded false`, `http.method "POST"`, `http.path` с query-суффиксом.
- Повторный заголовок `X-Foo: a` + `b` → `headers["X-Foo"] === "a,b"`.
- Бинарный body → base64 + `true`; `Buffer.from(body,'base64')` == исходные байты.
- GET без query → `rawQueryString ""`, `queryStringParameters {}`, `multiValueParameters {}`, `pathParameters {}`, `parameters {}`, `operationId ""`.
- Encoded path `/api/users%2Factive` → `rawPath "/api/users%2Factive"` (без декодирования, US2-SC6).

---

## Sc3: Raw context: `@YandexContext()` видит токен/folderId/trace (US1-SC3, FR-016..020)

Fixture-controller `GET /context` возвращает поля `YandexExecutionContext` (через `@YandexContext()`).

```bash
node --import tsx -e "
import { createYcsfLocalServer } from './dist/server/index.js';
const s = await createYcsfLocalServer({
  entry: './test/fixtures/user-service/app.module.ts', port: 0,
  yandexContext: { token: 'abc', folderId: 'folder123' },
});
const r = await fetch(s.baseUrl + '/context', { headers: { 'Uber-Trace-Id': 't:s:p:1' } });
console.log(await r.text());
await s.stop();
"
```

**Ожидания**: `token === 'abc'`, `functionFolderId === 'folder123'`, `functionName === 'local-function'`, `functionVersion === 'local-dev'`, `memoryLimitInMB === '1024'`, `logGroupName === ''`, `uberTraceId === 't:s:p:1'`, и равенство `ctx.trace_id === ctx.awsRequestId === event.requestContext.requestId` (FR-019).

Per-request: `requestId` в событии и `awsRequestId` в контексте — один uuid; `deadlineMs` ≈ now+15000; `cloudId` доступен через `ctx.raw.cloudId`.

---

## Sc4: IAM-цепочка env → OAuth → SA key (US3, FR-023..025)

Unit: `test/iam.spec.ts` (mock `fetchImpl`, temp `~/.yc` через `homeDir`):

1. `YC_IAM_TOKEN=abc` → `resolveIamToken()` === `"abc"`, сетевых вызовов ноль (US3-SC1).
2. Нет env, `~/.yc/config.yaml` `{ current: dev, profiles: { dev: { token: <oauth> } } }` → мок exchange вернул `iamToken` → результат из обмена (US3-SC2).
3. Нет env/config, `~/.yc/keys/sa-key.json` → JWT (iss/aud/iat/exp, PS256) формируется, мок exchange возвращает токен (US3-SC3).
4. env + OAuth-конфиг одновременно → результат из env, config не читается (приоритет, US3-SC4).
5. Нет ни одного источника / сетевой сбой → `undefined` + `reason`; `createYcsfLocalServer` стартует с warning `JDT_IAM_UNAVAILABLE`, `@YandexContext().token === undefined`, запросы работают (US3-SC5, FR-024).
6. Banner со значением токена — **отсутствует** (US3-SC6, FR-026/028).

---

## Sc5: Response mapping без потерь (US4, FR-021..022)

Fixture-controller честно возвращает: `201 + X-Custom`; `302 + Location`; два `Set-Cookie` (multiValueHeaders); svg-бинарный body.

**Ожидания** (US4-SC1..SC4):
- 201 + `X-Custom: v` + тело `{"ok":true}`.
- Оба `Set-Cookie` **отдельными строками** (не comma-join).
- Бинарный body — байт-в-байт (base64 decode).
- Throw handler → HTTP 500 JSON `{ error, message, trace_id }`, header `X-Trace-Id`, секретов нет; stack в логе с тем же trace_id (US7-SC3/FR-022).

**Тест**: `test/response.spec.ts` (+ интеграционный прогон в `server.integration.spec.ts`).

---

## Sc6: Fail-fast на конфигурации (US5, FR-004, FR-029)

```bash
# messageQueue: true → JDT_MQ_UNSUPPORTED
# apiGatewayV2: false, messageQueue: false → JDT_NO_TRANSPORT
# entry: './missing.ts' → JDT_ENTRY_RESOLVE_FAILED
# entry без экспорта модуля → JDT_ENTRY_MODULE_NOT_FOUND (с перечнем допустимых экспортов)
# entry с named AppModule + другим default → JDT_ENTRY_MODULE_AMBIGUOUS
# занятый порт → JDT_PORT_IN_USE (с номером порта)
# port: NaN/дробный/вне диапазона → JDT_INVALID_PORT (аддитивный код, см. план)
```

Каждый случай — отклонённый promise `LocalDevServerError { code }`; ни один не поднимает listener и не создаёт handler (FR-004). **Тест**: `test/server.integration.spec.ts` «US5 fail-fast».

---

## Sc7: Graceful lifecycle (US6, FR-003, FR-009)

```bash
const s = await createYcsfLocalServer({ entry, port: 0 });
await s.stop();
// повторный create на том же порту — успешен; fetch(s.baseUrl) → connection refused
// stop() дважды — idempotent, не бросает
// stop() во время in-flight — текущая инвокация завершается корректно
```

**Тест**: `test/server.integration.spec.ts` «US6 lifecycle».

---

## Sc8: Observability и секреты (US7, FR-026..028)

Захват stderr:
- Banner: `local-dev-server listening on http://127.0.0.1:<port> (apiGatewayV2) — IAM token resolved` / `— IAM unavailable (JDT_IAM_UNAVAILABLE: <reason>) — running without token`.
- Per-request: `GET /api/users → 200 (12 ms) trace_id=<id>` (разные id на запросы).
- Error: stack с тем же `trace_id`.
- При заданном токене/Authorization/Cookie — ни одно значение не встречается в stderr (redaction, US7-SC4).

**Тест**: `test/server.integration.spec.ts` «US7 observability» (mock stderr/spy).

---

## Sc9: Entry contract — main-guard (S-3/FR-005, A-6)

Канонический `main.ts` НЕ слушает порт на import-тайме; main-guard — код пользователя (`@ycforge/js-dev-tools` не экспортирует helpers, FR-001 — только `createYcsfLocalServer`/`resolveIamToken`). Пример (`test/fixtures/side-effect-bootstrap.ts`):

```ts
import path from 'node:path';
import { createYcsfLocalServer } from '@ycforge/js-dev-tools/server';

const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  // «боевая» точка запуска: сервер доступен только при запуске file напрямую
  const s = await createYcsfLocalServer({ entry: './src/app.module.ts', port: 3000 });
  process.once('SIGINT', () => void s.stop());
}
```

или `entry` указывает файл модуля (`src/app.module.ts`). Side-effect bootstrap на import-тайме — контрактное нарушение; сервер детектировать его не может (Q-1) и отвечает `JDT_ENTRY_MODULE_NOT_FOUND`, если модуль при этом ничего не экспортирует.

---

## Sc10: Host-loader — TS entry под `tsx` (A-2)

```bash
node --import tsx dist/server/index.js …   # примеры выше
```

Пакет **не транслирует** (FR-005): под plain `node` TS-entry упадёт на импорте → `JDT_ENTRY_RESOLVE_FAILED` с подсказкой про `tsx`/`node --import`. Проверка — e2e-подпроцессом (`test/host-loader.e2e.spec.ts`). CJS-entry (`module.exports = class`) валиден (Node interop, edge case spec).

---

## Sc11: Documented fidelity deviations (R-10) — локально ≠ облако

| Случай | Платформа (наблюдение) | Локальный сервер | Когда заметно |
|--------|------------------------|------------------|---------------|
| `rawPath` с %-encoding | декодирован gateway | raw, без декодирования (US2-SC6) | NestJS-маршрут по %-сегменту может не совпасть |
| пустое тело | `isBase64Encoded: true` | `""` + `false` (FR-014) | приложения, читающие флаг напрямую |
| клиентский `X-Request-Id` | requestId = эхо заголовка | всегда новый uuid (FR-019) | trace_id ≠ клиентский X-Request-Id |
| `http.path` | переупорядочен/перекодирован gateway | `rawPath + '?' + rawQueryString` (S-5) | код, парсящий `requestContext.http.path` |

Это осознанные решения spec (виновата не эмуляция): фиделити-тесты (`payload.spec.ts`) фиксируют spec-поведение, а не платформенное. Отклонения документируются в README пакета.

---

## Sc12: Edge cases

- HEAD/OPTIONS — проходят как методы, NestJS сам решает ответ.
- `Content-Type: application/x-www-form-urlencoded` — текст без re-encoding.
- Бинарный content-type, но валидный UTF-8 буфер → текст (грай-зона A-11 в пользу text, документировано).
- Пустой `rawQueryString` → `""` (не `undefined`).
- Одновременные запросы при cold start — коннектор шарит promise инициализации (S-4, edge spec) — сервер ничего не придумывает.
- `yandexContext`, известный на старте, не меняется на лету; per-request отличаются только id/time (A-7).

---

## Test mapping

| Scenario | US / FR | Test file |
|----------|---------|-----------|
| Sc1 | US1, FR-001..003/007 | `test/server.integration.spec.ts` |
| Sc2 | US2, FR-010..015 | `test/payload.spec.ts` |
| Sc3 | US1-SC3, FR-016..020 | `test/context.spec.ts` |
| Sc4 | US3, FR-023..025 | `test/iam.spec.ts` |
| Sc5 | US4, FR-021..022 | `test/response.spec.ts`, `test/server.integration.spec.ts` |
| Sc6 | US5, FR-004/029 | `test/server.integration.spec.ts` |
| Sc7 | US6, FR-003/009 | `test/server.integration.spec.ts` |
| Sc8 | US7, FR-026..028 | `test/server.integration.spec.ts` (stderr capture) |
| Sc9 | S-3, FR-005 | `test/entry.spec.ts` (main-guard fixture) |
| Sc10 | A-2, FR-005 | `test/host-loader.e2e.spec.ts`, `test/entry.spec.ts` |
| Sc11 | R-10 | `test/payload.spec.ts` (fidelity), README |
| Sc12 | Edge Cases | `test/payload.spec.ts`, `test/server.integration.spec.ts` |

---

## Diagnostics / contracts quick ref

- **createYcsfLocalServer + handle + JDT_***: [contracts/local-dev-server.json](./contracts/local-dev-server.json)
- **resolveIamToken chain + fail-open reasons**: [contracts/iam-resolution.json](./contracts/iam-resolution.json)
- **Data model (типы, lifecycle, invariants)**: [data-model.md](./data-model.md)
- **Research decisions (R-1..R-10)**: [research.md](./research.md)