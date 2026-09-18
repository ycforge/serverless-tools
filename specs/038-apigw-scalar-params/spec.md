# Feature Specification: Типизированные параметры API Gateway — скаляры в строках на границе HTTP-транспорта

**Feature Branch**: `038-apigw-scalar-params`

**Created**: 2026-09-19

**Status**: Draft — внутри Project A (`packages/nest-bridge`); снимает 502, найденный облачным e2e спеки 037.

**Input**: При ручной проверке облачного reference-проекта (spec 037) роут `GET /users/logs` в `user_service` объявлял query-параметр `count` как `type: integer, default: 1`. Наблюдаемое поведение:

| Запрос | Результат |
|---|---|
| `/users/logs?level=warn&count=1` | 200 (значение прислал клиент → строка) |
| `/users/logs?level=warn` | **502** |
| `/users/logs` | **502** |
| `/users/logs?level=log&count=999` | 400 (значение-строка доехало до приложения) |

Диагностика функции (из Cloud Logging, spec 037):

```
transport "http" claimed the invocation event but rejected it as structurally invalid:
expected every value of field "params" to be a string
```

Причина: API Gateway валидирует запрос по OpenAPI-схеме операции и **материализует дефолт типизированного параметра в его JSON-типе** — для `type: integer` кладёт в v1-карту `params` число `1`, а не строку `"1"`. Значение, присланное клиентом, приходит строкой (это всегда так на проводе). Валидатор HTTP-транспорта (`validate-yc-apigw-event.ts`) требует, чтобы **каждое** значение карт параметров было строкой, поэтому отвергает всё событие целиком → 502.

Обратная сторона: ломается именно **дефолт**, то есть самый обычный вызов без параметра; явная передача `count=1` работает. Это протечка: штатная OpenAPI-фича (`integer` + `default`) становится несовместимой с рантаймом, хотя число порождает сам шлюз.

> Эвиденс-база: (1) облачный прогон 037 с приведённой таблицей и error-текстом; (2) спецификация параметров в `apps/openapi/openapi.yaml`; (3) реальные v1-захваты спеки 036 (`packages/nest-bridge/fixtures/http-apigw/`), где карты `params`/`pathParams` при отсутствии объявленных параметров пусты (`{}`) и типы не проявляются. Точный санитизированный дамп события с типизированным дефолтом реконструируется в рамках этого спека (FR-008) — по образцу 036.

## Clarifications

### Session 2026-09-19 — решения по механике (подтверждены до spec)

> Пользователь подтвердил: чинить в **A (`nest-bridge`)**, публичный контракт библиотеки можно менять (никто не использует); шлюзовые дефолты в app-запрос **не** мёржить; нормализация — в единственной точке канонизации.

- Q: Где чинить — A (nest-bridge) или B (composer, «не объявлять integer-параметры с дефолтом»)? → **A**. B легитимно генерирует OpenAPI-спеку из пользовательского описания, включая `type: integer`/`default`; числа в событии порождает сам Yandex API Gateway. B не видит рантайм-событие и не должен знать его форму. Фикс в B был бы протечкой абстракции A в спеки пользователей.
- Q: Принимать ли числа/булевы в картах параметров и коэрсить в строки, или оставить строгий «только строки» и запрещать типизированные дефолты? → **Принимать JSON-скаляры и нормализовать в строки**. Значения HTTP-параметров на проводе всё равно строки; число было синтезировано шлюзом из схемы, `String(v)` возвращает проводное представление.
- Q: Как сохранить fail-fast? → **Границы не размываются**: карты параметров принимают только `string | number | boolean`; `null`, объект, массив, `NaN`/`Infinity`, неверный контейнер — по-прежнему `INVALID_INVOCATION_EVENT`. `headers`, `queryStringParameters`, `multiValue*` остаются строгими.
- Q: Где нормализовать? → **В единственной точке канонизации** (`normalizeHttpRequest`), а не в валидаторе (валидатор не трансформирует) и не в v1-адаптере (иначе для «настоящих» v2-событий появится вторая ветка). Канонизация — transformation, not mutation: исходное типизированное событие остаётся доступным в `raw`.
- Q: Должны ли шлюзовые дефолты (значения из `params`, вычисленные шлюзом) попадать в запрос приложения? → **Нет**. Для HTTP канон — то, что прислал клиент (`queryStringParameters`); `default` в OpenAPI — про валидацию/вычисление на шлюзе, а не про инъекцию в код. Приложение само решает, как трактовать отсутствие параметра.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Вызов маршрута с типизированным дефолтом не падает в 502 (Priority: P1)

Разработчик объявил в OpenAPI query-параметр `type: integer` с `default` (штатная фича) и развернул шлюз. Пользователь вызывает маршрут **без** этого параметра (`GET /users/logs`), шлюз подставляет дефолт числом, коннектор принимает событие, нормализует значение в строку и передаёт запрос в NestJS как обычный HTTP-запрос со статусом 200. Приложение видит только клиентские query-параметры и само применяет свою логику по умолчанию. Раньше такой вызов упирался в 502.

**Why this priority**: это и есть обнаруженный дефект; без него штатные OpenAPI-спеки с типизированными дефолтами неработоспособны через шлюз.

**Independent Test**: e2e/облако: `GET /users/logs` (без параметров) → 200; unit: reconstructed-fixture события с `params: { count: 1, flag: true }` через `createYandexHandler` даёт `{statusCode: 200}` вместо `INVALID_INVOCATION_EVENT`.

**Acceptance Scenarios**:

1. **Given** событие v1, где `params` содержит `count: 1` (число) и `flag: true` (булево), **When** обработано, **Then** transport claimed `"http"`, вызов успешен, ошибки `INVALID_INVOCATION_EVENT` нет.
2. **Given** нормализованный запрос из AS1, **When** приложение читает query, **Then** значения `count`/`flag` представлены строками (`"1"`/`"true"`), а клиентские параметры из `queryStringParameters` — verbatim.
3. **Given** развёрнутый reference-проект с обратно возвращённым `type: integer, default: 1`, **When** `GET /users/logs` без параметров через шлюз, **Then** `200` (реальный e2e).

---

### User Story 2 — Fail-fast для структурных аномалий сохранён (Priority: P1)

Разработчик коннектора гарантирует, что послабление касается только скаляров: если шлюз (или подмена) пришлёт в карте параметров объект, массив, `null` или неверный контейнер, событие по-прежнему отвергается громко (`INVALID_INVOCATION_EVENT`, value-free), а `headers`/`queryStringParameters`/`multiValue*` сохраняют прежнюю строгость. Никакого «тихого 200».

**Why this priority**: деградация fail-fast — ломка контракта A; неизвестные/аномальные формы должны оставаться шумной ошибкой.

**Independent Test**: табличный unit-тест: `{a: 1}` ok; `{a: "x"}` ok; `{a: true}` ok; `{a: null}`, `{a: {}}`, `{a: []}`, `3`, `"x"` (не объект) → `INVALID_INVOCATION_EVENT(id:"http")`; `headers: {a: 1}` → ошибка; `multiValueParameters: {a: [1]}` → ошибка.

**Acceptance Scenarios**:

1. **Given** `params: { a: null }` (или объект/массив), **When** обработано, **Then** `INVALID_INVOCATION_EVENT`, диагностика без значений.
2. **Given** `headers: { a: 1 }` / `multiValueParameters: { a: [1] }`, **When** обработано, **Then** поведение идентично прежнему (ошибка), без регрессии.

---

### User Story 3 — Единая нормализация для v1 и v2 (Priority: P2)

Разработчик получает одинаковую семантику независимо от входного формата: и v1-кадр шлюза (`params`/`pathParams`), и «настоящий» v2/ALB-кадр (`parameters`/`pathParameters`) проходят через одну точку канонизации, которая приводит скаляры к строкам; исходное типизированное событие остаётся в `raw` для диагностики.

**Why this priority**: важно для консистентности транспорта; не блокирует P1 (v1 — реальный путь шлюза), но устраняет расхождение путей.

**Independent Test**: unit `normalizeHttpRequest` для v1 (через адаптер) и v2: `parameters`/`pathParameters` со скалярами → строковые карты; `raw` не мутирован; `pathParameters` строковые для path-matching.

**Acceptance Scenarios**:

1. **Given** v2-событие с `parameters: { count: 2, flag: false }`, **When** нормализовано, **Then** `parameters` — `{ count: "2", flag: "false" }`, `raw.parameters` сохраняет исходные типы.
2. **Given** v1-событие с `pathParams: { ID: 7 }`, **When** адаптировано и нормализовано, **Then** `pathParameters` — `{ ID: "7" }`, path-matching получает строку.

### Edge Cases

- Булев дефолт (`type: boolean`) → `true`/`false` → `"true"`/`"false"`.
- Дробное число (`type: number`, `default: 1.5`) → `"1.5"`.
- Число, выглядящее как строка (`"01"`), присланное клиентом, **не** переинтерпретируется: строки проходят verbatim.
- Отсутствие карт (`params`/`pathParams`/`parameters`/`pathParameters`) — как и раньше, нормализуется в `{}`.
- Пустые карты `{}` — допустимы, дают `{}`.
- `null`/объект/массив как значение скалярной карты — ошибка (US2).
- `multiValueParams`/`multiValueParameters` — списки строк, скаляры не допускаются.
- `queryStringParameters`/`headers` — всегда строки, послабление не распространяется.
- Значение из шлюзовых `params` (дефолт) в app-запрос НЕ попадает; приложение видит только клиентские параметры.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: THE HTTP TRANSPORT ВАЛИДАТОР SHALL принимать карты параметров как `Record<string, string | number | boolean>`: v1 `params`/`pathParams` (`validate-yc-apigw-event.ts`) и v2 `parameters`/`pathParameters` (`validate-raw-event.ts`); строка, число и булево — валидные значения (эвиденс 037: число из integer-дефолта).
- **FR-002**: THE ВАЛИДАТОР SHALL по-прежнему отвергать не-скаляры (`null`, объект, массив), не-объектный контейнер, а также `NaN`/`Infinity`, возвращая `INVALID_INVOCATION_EVENT(transportId:"http")` с value-free диагностикой (имена полей/типы, без значений) — fail-fast не ослаблен.
- **FR-003**: THE НОРМАЛИЗАТОР SHALL приводить значения карт параметров к строкам в **единственной точке канонизации** (`normalizeHttpRequest`) для обоих входов (v1 → канонический v2 через адаптер; v2 напрямую): `string` verbatim, `number`/`boolean` — через их проводное строковое представление (`String(v)`).
- **FR-004**: THE НОРМАЛИЗАТОР SHALL формировать строковые карты (`Record<string,string>`) для `parameters`/`pathParameters` (и для `pathParameters`, потребляемого path-matching/`request.params`), как transformation, not mutation: исходное событие с типизированными значениями SHALL оставаться доступным без изменений.
- **FR-005**: THE ТРАНСПОРТ SHALL сохранять строгость для `headers`, `queryStringParameters` (`Record<string,string>`) и `multiValueParameters`/`multiValueParams`/`multiValueQueryStringParameters` (`Record<string,string[]>`); послабление FR-001 ограничено картами скалярных параметров.
- **FR-006**: THE КОННЕКТОР SHALL NOT мёржить шлюзовые `parameters` (вычисленные шлюзом значения, включая дефолты) в запрос приложения: канон query — `queryStringParameters`/`rawQueryString`; отсутствующий параметр остаётся отсутствующим для приложения.
- **FR-007**: THE DISCRIMINATOR/registry SHALL оставаться без изменений: `[http, mq]`, ветки v2/v1/MQ попарно непересекающиеся; нормализация не влияет на выбор транспорта.
- **FR-008**: THE ПАКЕТ SHALL фиксировать эвиденс: reconstructed-fixture v1-события с типизированными значениями в `packages/nest-bridge/fixtures/http-apigw/` (provenance: «real API Gateway (cloud_functions) capture, spec 037/038», значения санитизированы, структура сохранена); conformance-тест проигрывает её через публичное API (fixture → RED → GREEN).
- **FR-009**: THE REFERENCE-ПРОЕКТ SHALL вернуть `count` к `type: integer, default: 1` в `apps/openapi/openapi.yaml`; e2e/ручная проверка подтверждает `200` на `GET /users/logs` без параметров (снятие обхода из 037).
- **FR-010**: THE ДОКУМЕНТАЦИЯ SHALL быть обновлена по факту: `docs/ARCHITECTURE.md`/README A (правило «шлюз типизирует значения по OpenAPI-схеме; адаптер нормализует скаляры в строки; шлюзовые дефолты в приложение не мёржатся»); при расхождении с `IDEA.md` §2 — обновляется IDEA.md (specs первичны).
- **FR-011**: THE CHANGES SHALL быть ограничены `packages/nest-bridge` (+ reference-проект и его golden как следствие) — Constitution: A owns runtime; B/C/Terraform не затрагиваются.

### Key Entities

- **YcApiGatewayEvent** (v1 raw): карты `params`/`pathParams` расширяются до `Record<string, string | number | boolean>`.
- **RawHttpApiGatewayV2Event** (canonical internal): `parameters`/`pathParameters` расширяются до `Record<string, string | number | boolean>`.
- **NormalizedHttpRequest**: `parameters`/`pathParameters` — строго `Readonly<Record<string,string>>` (как результат нормализации); `raw` сохраняет типизированное событие.
- **GatewayScalar** (новый тип): `string | number | boolean` — допустимое значение карты параметров на входе транспорта.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `GET /users/logs` без параметров через реальный шлюз отвечает `200` после редеплоя функции (US1/AS3); ранее — 502.
- **SC-002**: Табличный unit-тест карт параметров: скаляры (`string|number|boolean`) приняты и нормализованы в строки; `null`/объект/массив/`NaN`/неверный контейнер отвергнуты (US1/AS1–2, US2).
- **SC-003**: Conformance-fixture с типизированными значениями закоммичена с provenance и зелёная через публичное API коннектора (FR-008).
- **SC-004**: `pnpm --filter @ycforge/nestjs-connector test` зелёный; отсутствие регрессий по другим пакетам (`pnpm build`/`pnpm test` без новых падений).
- **SC-005**: Шлюзовые дефолты не появляются в запросе приложения: тест подтверждает, что вызов без параметра не добавляет значение в query приложения (FR-006).

## Assumptions

- API Gateway материализует дефолт типизированного параметра в объявленном JSON-типе (число/булево) в v1-карте `params`; значения, присланные клиентом, приходят строками. Основание — облачный прогон 037 (502 только при отсутствии параметра) + семантика OpenAPI `default`. Точная форма реконструируется fixture-ом (FR-008), как это сделано в 036.
- К одному значению применяется только `String(v)`; глубокой сериализации нет — значения карт параметров по контракту скалярны.
- Публичный контракт (`@ycforge/nestjs-connector`) менять допустимо (библиотека не используется внешними потребителями); semver-мажор при необходимости оформляется в plan.
- Изменения ограничены `packages/nest-bridge`; reference-проект правится только откатом spec-обхода и пересборкой golden (hash функции).

## Точки неоднозначности IDEA.md (для clarify)

- `IDEA.md` §2 формулирует вход как «API Gateway payload 2.0», но реальный `cloud_functions` шлёт v1-кадр (зафиксировано 036), а значения параметров типизирует по OpenAPI-схеме (этот спек). После merge — **IDEA.md §2 обновляется**: адаптер A обязан принимать типизированные скаляры в картах параметров и нормализовать их в строки HTTP-домена.
