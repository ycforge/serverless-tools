# Tasks: 036 — APIGW HTTP Transport

**Input**: Design documents from `/specs/036-apigw-http-transport/` (spec.md, plan.md, research.md, data-model.md, contracts/transport-registry.md)

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Test-first — RED до реализации (constitution II; FR-011).

**Organization**: Tasks grouped by user story; тесты пишутся первыми и падают до реализации.

## Phase 1: Setup & Evidence (Foundational — блокирует все US)

**Purpose**: эвиденс зафиксирован (захват реальных событий шлюза 2026-09-17 выполнен), fixtures + RED-тест.

- [x] T001 [US1] **ВЫПОЛНЕНО**: захват реальных v1-событий шлюза — временный echo-хендлер в `user_service`, `curl` через шлюз `d5dh7d6flrd3cm28mrle.nnekmrav.apigw.yandexcloud.net` (6 кейсов: базовый GET, `?limit=2&offset=0`, `?a=b&c=d`, `?x=%20`, `?limit=2`, `?tag=a` → 404 на уровне шлюза); боевая версия функции восстановлена (`main.handler`, 200→502 снова). Дампы: `/var/folders/5z/j6z6rscd3s10cls83q4wbnt40000gn/T/opencode/captured-apigw-event*.json`
- [x] T002 [US1] Санитизировать захваты (IP, requestId, timestamps, заголовки → плейсхолдеры; имя/структура полей verbatim) в `packages/nest-bridge/fixtures/http-apigw/{get-without-query,repeated-query-parameters}.json` (fixture envelope: `kind:"reconstructed"`, `evidence:"real Yandex API Gateway (cloud_functions) capture, spec 036"`, `timestamp`, `node`, `event`, `context`) — минимум 2 события: «GET без query» и «GET с query + повторы»; следовать правилам `fixtures/README.md`
- [x] T003 [US1] ДО реализации: RED-тест conformance — `packages/nest-bridge/test/http-apigw-transport.spec.ts`: минимальное Nest-приложение с `GET /users`, прогон fixture через `createYandexHandler` → ожидается `{statusCode:200}`; до фикса падает `unknownInvocationEvent`

**Checkpoint**: fixtures в репо, тест RED.

## Phase 2: Discriminator & Адаптер (US1/US2/US3-ядро)

- [x] T004 [P] [US1] `packages/nest-bridge/src/http/yc-apigw-raw-event.ts` — тип `YcApiGatewayEvent` + `YcApiGatewayRequestContext` (поле `identity`, `requestTime`/`requestTimeEpoch`; вербальные имена; index signature) (data-model.md)
- [x] T005 [P] [US1] `packages/nest-bridge/src/http/validate-yc-apigw-event.ts` — ядро strict: `httpMethod`, `path`, `headers`, `queryStringParameters`, `body`, `isBase64Encoded`, `requestContext.{identity.{sourceIp,userAgent}, httpMethod, requestId, requestTime, requestTimeEpoch}` → `ConnectorError.invalidInvocationEvent("http", ...)`; опционал tolerant: `url`, `multiValueHeaders`, `multiValueQueryStringParameters`, `params`, `multiValueParams`, `pathParams`, `operationId`, неизвестные поля (FR-002/003/008)
- [x] T006 [P] [US1] `packages/nest-bridge/src/http/yc-apigw-event-adapter.ts` — `adaptYcApiGatewayEventToV2(raw): RawHttpApiGatewayV2Event`: маппинг по data-model.md (rawPath:=path; rawQueryString из `url`-query/fallback-serialize; requestContext.http из `httpMethod`/`path`/`identity`; time/timeEpoch из requestTime/requestTimeEpoch; pathParameters:=pathParams; parameters:=params; multiValueParameters:=multiValueParams??multiValueQueryStringParameters) (FR-004/006)
- [x] T007 [US1] `packages/nest-bridge/src/http/normalize-request.ts` — параметризация `normalizeHttpRequest(event, options?: { httpVersion?: "2.0" | "1.0" })`, дефолт `"2.0"` (FR-005)
- [x] T008 [US1] `packages/nest-bridge/src/http/adapter.ts` — `supports()`: OR-ветка `httpMethod:string && path:string && version===undefined`; `invoke()`: validate→adapt→normalize(`{httpVersion:"1.0"}`)→dispatch (FR-001/007; из события с `version:"2.0"` ветка не заявляется)

**Checkpoint**: suite GREEN для новых тестов.

## Phase 3: User Story 1 — маршрут через шлюз отвечает 200 (P1 🎯 MVP)

**Goal**: `GET /users` через реальный шлюз → 200.

**Independent Test**: conformance-тест (T003) + e2e curl.

- [x] T009 [US1] Зелёный уточняющий unit: fixture (T002) → `createYandexHandler` → 200 + `body` = `{"users":["alice","bob"]}`; `normalized.httpVersion==="1.0"`, `method==="GET"`, `path==="/users"`, `requestId`/`sourceIp`/`userAgent` из requestContext
- [x] T010 [US1] Пересборка коннектора `pnpm --filter @ycforge/nestjs-connector build`; пересборка user_service: `rm -rf examples/reference-project/.ycsf/cache`, `pnpm build` (builders-core/pilot правильными workdir), `ycsf materialize`, `terraform apply`
- [x] T011 [US1] **MVP-check**: `curl -i https://d5dh7d6flrd3cm28mrle.nnekmrav.apigw.yandexcloud.net/users` → `200 {"users":["alice","bob"]}`

## Phase 4: User Story 2 — прямой invoke тем же событием (P1)

**Goal**: `yc serverless function invoke` с captured-событием без шлюза → тот же результат.

- [x] T012 [US2] Unit-кейс (в `http-apigw-transport.spec.ts`): fixture с повторами query → повторы в `multiValueParameters` не слиты
- [x] T013 [US2] **Проверка**: `yc serverless function invoke user-service --data-file <fixture event>` (без envelope) → `{"statusCode":200}` в deployment

## Phase 5: User Story 3 — fail-fast не ослаблен (P2)

- [x] T014 [US3] Табличный unit `discriminator`: v2 → `"http"`/v2-правила; v1 → `"http"`/v1-правила; гибрид `version:"2.0"+httpMethod` → v2-ветка; `messages[]` → мq; `{}`/массив/`null` → `UNKNOWN`; диагностика value-free (FR-007/008)
- [x] T015 [US3] Регрессионный прогон: `pnpm --filter @ycforge/nestjs-connector test` зелёный; существующие v2/MQ-conformance не тронуты

## Phase 6: Polish & Docs (cross-cutting)

- [ ] T016 [P] Документация: `AGENTS.md` nest-bridge §4.x (3 дискриминатора), `docs/ARCHITECTURE.md` §4 (registry: порядок, непересекаемость), README-таблица транспортов (FR-012)
- [ ] T017 [P] `IDEA.md` §2: «API Gateway payload 2.0» → «API Gateway/ALB payload (v2.0 for ALB, v1 cloud_functions event for API Gateway)» (Точки неоднозначности; спека выигрывает)
- [ ] T018 [P] Git-мета: строка README-roadmap 036 (🚧 до converge), `.specify/feature.json` → `specs/036-apigw-http-transport` (выполнено); финальный PR — единый на ветке 035 (clarify 2026-09-17)

## Dependencies & Execution Order

- **Phase 1** блокирует все (эвиденс обязателен, FR-011). T002 перед T003.
- **Phase 2**: T004–T006 [P] параллельны; T007/T008 после них.
- **Phase 3**: MVP T009→T010→T011 (реальный YC). **Phase 4/5** после Phase 2. **Phase 6** после 3–5.

### Внутри user story (test-first)

- US1: T003 (RED) → T002 (fixture) → T004–T008 (GREEN) → T009
- US3: T014 пишется до/вместе с T008 (таблица-дискриминатор), RED до фикса

## Implementation Strategy

1. **MVP First**: Phase 1 → Phase 2 → Phase 3 → STOP → validate curl
2. Затем Phase 4 (US2) → Phase 5 (US3) → Phase 6 (docs/README/git)
3. Регрессий по v2/MQ нет (T015)

## Convergence Log (2026-09-17)

- **GREEN**: `src/http/apigw-transport.spec.ts` — 10/10 (дискриминатор-таблица + оба v1-fixture через `createYandexHandler` + INVALID + гибрид→UNKNOWN); полный suite пакета 452/452, `tsc --noEmit` чист.
- **Реализовано**: `validate-yc-apigw-event.ts` (строгий core/толерантный optional), `yc-apigw-event-adapter.ts`, `normalize-request.ts` (`options.{httpVersion,raw}`), `adapter.ts` (тип-union + ветвление `isApiGatewayV2Event`, общий `dispatch`), `normalized-request.ts` (`httpVersion: "1.0" | "2.0"`).
- **Деплой**: `pnpm --filter @ycforge/nestjs-connector build` → `node ../../packages/pilot/dist/cli/index.js build --target user_service --no-cache` (после `rm -rf .ycsf/cache`) → `check` ✅ → `materialize` → `terraform apply` (план одобрен пользователем: полностью — код + timeout 5s + отсоединение СА с функции, канон `extensions.yaml`).
- **T011 (MVP-check)**: `curl -i .../users` → `HTTP/1.1 200` `{"users":["alice","bob"]}`; `?limit=1` и `?limit=2&limit=3` → 200; `POST /users` → 405 (гейтвей, функция не вызвалась).
- **T013**: `yc serverless function invoke --id d4epb2ae3gj7j0rt0g9q --data-file <fixture v1 event>` → `{"statusCode":200,"header":..., body:{"users":["alice","bob"]}}`; garbage `{"nope":1}` → 502 + `errorType: ConnectorError` (fail-fast, value-free).
- **Остатки до converge**: T016 (док-обновления), T017 (IDEA.md §2), T018 (README-roadmap 036 ✅, единый PR в dev на ветке 035).