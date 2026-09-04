# Feature Specification: `auth.yaml` — формат и валидация authentication scheme references (Project B)

**Feature Branch**: `007-auth-config`

**Created**: 2026-09-05

**Status**: Draft — greenfield; описывает ЧТО и ЗАЧЕМ, а не КАК

**Input**: Roadmap row 007 — «auth-config — `auth.yaml`, scheme types none/jwt/function, валидация ссылок». Источник требований: `IDEA.md` §11 (`@RequireAuth`), §12 (`auth.yaml`); принципы: `.specify/memory/constitution.md` (особенно I — границы B, III — версионирование контрактов, V — явное вместо магии). Зависимость: spec 002 (контракты и их версионирование).

> B (composer) — единственный потребитель `auth.yaml` в этой спецификации: он валидирует документ и валидирует, что каждый scheme, на который ссылается сгенерированный OpenAPI (`ApiSecurity` из `@RequireAuth`, spec 003), объявлен в `auth.yaml`. Генерация итоговой API Gateway security-конфигурации и применение `defaultScheme` к операциям без `security` — зона композиции (spec 008), здесь зафиксирован только валидный источник для неё (Constitution I).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Автор композиции описывает `auth.yaml`, B валидирует документ целиком (Priority: P1)

Владелец API composition (openapi-приложения) декларирует authentication-контракты для шлюза в `auth.yaml`: проект `version: 1`, ровно один `defaultScheme`, и набор `schemes` с одним из scheme types — `none`, `jwt` или `function`. B до композиции валидирует документ self-contained (структура, известные типы, обязательные поля типа, отсутствие коллизий имён, непротиворечивость `defaultScheme`) — чтобы любая последующая генерация конфигурации шлюза опиралась на заведомо валидный источник.

**Why this priority**: без валидного `auth.yaml` нет смысла в композиции с auth-метаданными вообще; самовалидация — первый барьер fail-fast и условие для валидации ссылок (US2). P1: без неё спецификация шлюза может собраться с битой конфигурацией и упасть на `terraform plan/apply`.

**Independent Test**: валидный fixture-документ со всеми тремя типами схем проходит валидацию; каждый инвалидный вариант (см. AC) отклоняется детерминированной ошибкой с указанием проблемного поля.

**Acceptance Scenarios**:

1. **Given** `auth.yaml` с `version: 1`, одним `defaultScheme`, объявленным среди схем, и схемами `public` (none), `user` (jwt c `jwksUri`, `issuer`, `audience`), `internal` (function с ссылкой на функцию), **When** B валидирует документ, **Then** документ считается валидным, никаких ошибок.
2. **Given** `auth.yaml` без поля `version` либо с `version != 1`, **When** B валидирует, **Then** ошибка fail-fast с указанием поля (контракт версионируется, Constitution III).
3. **Given** `auth.yaml` с отсутствующим `defaultScheme`, **When** B валидирует, **Then** ошибка fail-fast (в §11 предусмотрен project default, поэтому документ без него неполон).
4. **Given** `defaultScheme` указывает на необъявленную схему, **When** B валидирует, **Then** ошибка fail-fast с указанием имени.
5. **Given** схема с неизвестным `type` (например, `type: oauth2`), **When** B валидирует, **Then** ошибка fail-fast — неизвестный тип не игнорируется (Constitution V; расширение модели — аддитивное изменение контракта, а не молчаливый пропуск).
6. **Given** `jwt`-схема без одного из обязательных полей (`jwksUri`/`issuer`/`audience`) либо `function`-схема без поля `function`, **When** B валидирует, **Then** ошибка fail-fast с указанием поля.
7. **Given** `schemes` пуст (нет ни одной схемы), **When** B валидирует, **Then** ошибка fail-fast.

---

### User Story 2 — B валидирует, что каждый scheme из OpenAPI-лэндинга заявлен в auth.yaml (Priority: P1)

Разработчики apps (`user_service`, `orders`) пометили маршруты `@RequireAuth('user', ...)` / `@RequireAuth('public', null)`. A (spec 003) проставил `ApiSecurity('user')` в сгенерированный OpenAPI, а для `public` — никакой записи. B получает документ по цепочке извлечения (spec 006), читает только `security`-метаданные и сверяет каждое имя схемы с объявленными в `auth.yaml`: ссылка на необъявленную схему — fail-fast ошибка с именем схемы и маршрутом. B НЕ доказывает, что guard соответствует семантике схемы (это зона A, spec 003).

**Why this priority**: «валидация ссылок» из roadmap; без неё опечатка в scheme в app-коде молча уедет в рантайм/шлюз. P1: пограничный барьер между A и B.

**Independent Test**: документ со ссылками, все из которых объявлены, — валиден; документ с хотя бы одной необъявленной ссылкой отклоняется с указанием scheme + route; документ с объявленными, но неиспользуемыми схемами — валиден.

**Acceptance Scenarios**:

1. **Given** все имена схем, встречающиеся в `security`-записях извлечённого OpenAPI, объявлены в `auth.yaml`, **When** B валидирует ссылки, **Then** валидация успешна, композиция продолжится.
2. **Given** в `security`-записи операции встречается имя `admin`, которое НЕ объявлено в `auth.yaml`, **When** B валидирует, **Then** fail-fast ошибка, содержащая имя схемы (`admin`) и маршрут/операцию, где она встретилась.
3. **Given** схема объявлена в `auth.yaml`, но не используется ни в одной `security`-записи, **When** B валидирует, **Then** это НЕ ошибка (объявленная схема может быть предназначена для future/wrapper-использования).
4. **Given** `defaultScheme` объявлен и валиден, но на операциях без явного `@RequireAuth` в извлечённом документе нет записей `security`, **When** B валидирует ссылки, **Then** это не ошибка на уровне 007 (применение `defaultScheme` к «голым» операциям — зона композиции, spec 008).
5. **Given** в `security`-записи появляется значение `public` (A для `('public', null)` не ставит `ApiSecurity`), **When** B валидирует, **Then** fail-fast — признак договорного нарушения цепочки A→OpenAPI (документ либо собран не через A, либо модифицирован вручную).

---

### User Story 3 — Автор использует `function`-authorizer, B проверяет ссылку и не «провижининг» (Priority: P2)

Автор добавляет схему `internal: {type: function, function: functions.internal_authorizer}`. B проверяет, что ссылка на функцию (логический reference) существует/ссылается на объявленную в проекте функцию, принимает документ и генерирует соответствующую API Gateway security-конфигурацию; B НЕ создаёт ключи, не публикует/не управляет JWKS, не ходит в Lockbox/Object Storage и не провижинит authorizer-функцию — это зоны runtime и provisioning (Constitution I).

**Why this priority**: `function` — наиболее свободный механизм авторизации (Bearer/API key/Basic/DB-backed/custom); отличие от `jwt` — необходимость ссылки на внешнюю сущность (функцию). P2: фича работает и с `none`/`jwt` без неё, но это заявленный третий scheme type §12.

**Independent Test**: `function`-схема со ссылкой на объявленную в проекте функцию принята; ссылка на несуществующую/некорректную функцию отклонена; тест проверяет, что выход валидации/композиции не содержит артефактов key/JWKS/provisioning (только конфигурация шлюза).

**Acceptance Scenarios**:

1. **Given** `function: functions.internal_authorizer` и функция `internal_authorizer` объявлена в проекте, **When** B валидирует схему, **Then** ссылка признана валидной (разрешённой) — ошибок нет.
2. **Given** `function` указывает на функцию, отсутствующую среди объявленных в проекте, **When** B валидирует, **Then** fail-fast ошибка с указанием ссылки.
3. **Given** `function` ссылается на функцию, **When** B валидирует и проходит к композиции, **Then** во взаимодействие B с Yandex Cloud/провижинингом не входят: key pairs, rotation, JWKS publishing, Lockbox, Object Storage, provisioning самой authorizer-функции (граница FR-011).

---

### Edge Cases

- **Дубликат имени схемы**: ключи в YAML со дублирующимся именем — коллизия (словари многих парсеров молча «последний побеждает»); B SHALL детектировать дубликат и завершиться fail-fast (Constitution V).
- **Не-мапа `schemes`**: `schemes` существует, но не является отображением (например, список) — fail-fast.
- **`defaultScheme: public`**: допустимо (public-по-умолчанию); проверяется общими правилами (объявлена, ровно одна).
- **Регистр имени схемы**: имена схем сравниваются case-sensitive (точность имён — контракт A→B); схема `Public` — обычная схема, НЕ эквивалент `public`; `public` (нижний регистр) — зарезервированная none-convention.
- **Пустой документ / битый YAML**: отсутствие файла или ссылка на него не прочиталась — fail-fast ошибка с путём; пустой документ — та же ошибка (нет `version`, нет `schemes`).
- **Операция без `security`**: на уровне 007 это не ошибка; применение `defaultScheme` — зона 008 (US2/AC4).
- **Использованная, но не объявленная схема**: всегда fail-fast (US2/AC2) — независимо от того, есть ли `defaultScheme`.
- **`function`-ссылка как placeholder до модели identity**: точный синтаксис идентичности функций и её источник формализует spec 009/011; до этого B валидирует (а) поле присутствует и корректно по формату §12 (`functions.<name>`), (б) целевая функция объявлена в наборе функций, который приходит вместе с composition input (Assumptions).
- **OpenAPI из артефакта vs из entry point**: источник документа (006) не важен — B валидирует `security` в извлечённом документе одинаково.
- **Множественные openapi-приложения**: у каждой composition свой `auth.yaml` (свой namespace схем); ссылки валидируются против auth.yaml СВОЕЙ composition; пересечения имён между composition — разные сущности, не коллизия.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: THE COMPOSER SHALL читать `auth.yaml` из корня openapi-приложения (composition), которому принадлежит композируемый документ, и парсить его как YAML; отсутствие/невалидный YAML — fail-fast с указанием пути. (US1; IDEA §8/§9: `openapi/auth.yaml`; Assumptions.)
- **FR-002**: THE COMPOSER SHALL требовать поле `version` = `1` (единственной поддерживаемой версии формата); отсутствие или иное значение — fail-fast (контракты `.ycsf/*.yaml`-форматов версионируются, Constitution III). (US1/AC2.)
- **FR-003**: THE COMPOSER SHALL требовать ровно один непустой `defaultScheme`, указывающий на объявленную схему; нарушение — fail-fast с именем схемы. (US1/AC3–AC4; §11 project default vs §12.)
- **FR-004**: THE COMPOSER SHALL требовать непустой map `schemes`; каждый элемент объявляет схему с единственным известным `type`. (US1/AC7.)
- **FR-005**: THE COMPOSER SHALL валидировать scheme type против минимального набора `{none, jwt, function}`; неизвестный тип — fail-fast, никогда не игнорируется и не трактуется как «no security». Расширение набора типов — исключительно аддитивное изменение контракта (новая версия/фича), не влияющая на существующую валидацию. (US1/AC5; §12 минимальные типы; Constitution V.)
- **FR-006**: THE COMPOSER SHALL валидировать обязательные поля по типу схемы: `none` — дополнительных полей нет; `jwt` — обязательны `jwksUri`, `issuer`, `audience`; `function` — обязательно поле `function` (ссылка на функцию). Отсутствие обязательного поля — fail-fast с именем схемы и поля. (US1/AC6; §12 пример.)
- **FR-007**: THE COMPOSER SHALL детектировать дублирующиеся имена схем (дубликаты ключей в `schemes`) как коллизию и завершаться fail-fast; тихий «последний победил» (silent merge) недопустим. (Edge cases; Constitution V.)
- **FR-008**: THE COMPOSER SHALL валидировать ссылки: каждый scheme name, встречающийся в `security`-записях извлечённого OpenAPI-документа, обязан быть объявлен в `auth.yaml` своей composition; необъявленная ссылка — fail-fast с именем схемы и маршрутом (route/operation). (US2/AC2; roadmap «валидация ссылок».)
- **FR-009**: THE COMPOSER SHALL трактовать значение `public` в `security`-записи как договорное нарушение (A для `('public', null)` не порождает `ApiSecurity`); появление — fail-fast. Объявление схемы с именем `public` (тип `none`, зарезервированная convention) и `defaultScheme: public` — допустимы. (US2/AC5; Edge cases.)
- **FR-010**: THE COMPOSER SHALL NOT проверять соответствие guard семантике схемы; гарантируется только существование схемы (guard — зона A, spec 003; предотвращение вывода guard из схемы — зона A). (US2; IDEA §11.)
- **FR-011**: THE COMPOSER SHALL NOT генерировать/провижинить key pairs, rotation, JWKS publishing, Lockbox/секретное хранилище, Object Storage или саму authorizer-функцию; вклад B в auth ограничен валидацией `auth.yaml`, валидацией ссылок и последующей генерацией API Gateway security-конфигурации (зона композиции). (US3/AC3; §12 «B не занимается»; Constitution I.)
- **FR-012**: THE COMPOSER SHALL валидировать `function`-ссылку схемы типа `function`: поле обязано присутствовать, быть корректным логическим reference по формату §12 (`functions.<name>`) и разрешаться в функцию, объявленную в наборе функций композиции; не-корректная/необъявленная функция — fail-fast с указанием ссылки. B SHALL NOT интроспектировать внутренности целевой функции. (US3/AC1–AC2; Assumptions о 009/011.)
- **FR-013**: THE COMPOSER SHALL использовать в качестве источника auth-требований ИСКЛЮЧИТЕЛЬНО `security`-метаданные извлечённого OpenAPI-документа (006); metadata `ycsf:auth:*` (spec 003) и user-код B не читает. (US2; IDEA §11: «B читает только OpenAPI metadata».)

### Key Entities *(include if feature involves data)*

- **auth.yaml**: документ композиции с полями `version`, `defaultScheme`, `schemes`; единственный источник схем для composition (независимый namespace на composition).
- **Scheme**: объявленный authentication-контракт (`name → {type, ...type-specific}`); имена уникальны (коллизия при дубликате). Тип задаёт набор обязательных полей (FR-006).
- **defaultScheme**: ровно одно имя схемы — «project default»; для 007 валидна только резолвимость (§11 precedence method > controller > project default — применение в 008).
- **OpenAPI security entry**: результат `ApiSecurity` из `@RequireAuth` (A, spec 003) в извлечённом документе; каждая запись ссылается на имя схемы ровно одного namespace (своя composition).
- **Function reference** (схема `function`): логическая ссылка на функцию‑authorizer (`functions.<name>`), разрешаемая в объявленную функцию проекта; B валидирует resolvability, не содержимое.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Каждый acceptance scenario US1–US3 покрыт минимум одним выполняемым тестом; test-suite `packages/composer` зелёный (traceability, Constitution II).
- **SC-002**: В 100% тестов корректный `auth.yaml` со всеми тремя типами схем (версия, ровно один `defaultScheme`, все поля) проходит самовалидацию без ошибок и предупреждений.
- **SC-003**: В 100% тестов каждый инвалидный вариант из FR-002–FR-007 (нет/чужой `version`, нет `defaultScheme`, необъявленный `defaultScheme`, неизвестный `type`, отсутствие обязательного поля, дубликат имени, пустой `schemes`) отклоняется fail-fast ошибкой, содержащей указание на проблемный аспект (поле/имя/тип).
- **SC-004**: В 100% тестов ссылка на необъявленную схему из `security`-записи отклоняется, а в сообщении ошибки присутствуют имя схемы и маршрут; документы, все ссылки в которых объявлены, всегда проходят (US2/AC1–AC3).
- **SC-005**: Регрессионный тест подтверждает, что аддитивное введение нового scheme type не ломает валидацию существующих `none`/`jwt`/`function`-конфигураций (расширяемость модели §12).
- **SC-006**: Тест границы подтверждает, что B при схеме `function` не производит артефакты/вызовы key-provisioning, JWKS, Lockbox, Object Storage и не создаёт authorizer-функцию — заметен только результат композиции шлюза (FR-011).

## Assumptions

- **Расположение файла**: `auth.yaml` живёт в корне openapi-приложения (composition), рядом с `build_config.yaml` и `overrides.yaml` (`openapi/auth.yaml`), — по дереву IDEA §8/§9; §13: «каждое со своим build_config.yaml/auth.yaml». Не project-root. Поставщик — владелец composition (не C, не A); B — потребитель. Пока spec 011 не формализован, границы (структура openapi-app в `apps.yaml`) считаются теми же, что в §8.
- **`version: 1` обязательна**: `auth.yaml` — контрактный формат (принцип III, AGENTS.md: все `.ycsf/*.yaml`-форматы несут `version: 1`), поэтому документ содержит `version: 1` и попадает под contract versioning (Future/Factories — через pilot contracts). Физически файл лежит вне `.ycsf/` (в app-директории), но версионируется по тем же правилам.
- **`defaultScheme` обязателен**: IDEA §11 заявляет precedence «... > project default», поэтому документ без `defaultScheme` неполон (US1/AC3); допустимо `defaultScheme: public`.
- **jwt требует `jwksUri`, `issuer`, `audience`**: ровно по примеру §12; ослабление/ужесточение — аддитивное изменение контракта.
- **Формат `function`-ссылки**: полное табличное определение IDL/IDR и модель identity — spec 009/011; до их появления B валидирует формат §12 (`functions.<name>`) и разрешимость в набор функций, приходящий вместе с composition input (набор тех же функций, что видны из расположения apps/артефактов 006). Если 009/011 введут иной синтаксис — auth.yaml следует этому синтаксису через контрактное обновление.
- **Граница к 008**: как `defaultScheme` применяется к операциям без `security`, как `schemes` попадают в `components.securitySchemes` и в API Gateway authorizers — зона композиции (008); 007 лишь гарантирует валидность источника и резолвимость имени.
- **Зарезервированное имя `public`**: нижний регистр, тип `none`, no-op в `ApiSecurity` (spec 003). Появление `public` в `security`-записи — договорное нарушение (FR-009).
- **B не читает user-код**: 007 применяется к извлечённому документу (006); изоляция/безопасность извлечения остаются обязанностью 006.
- **YAML-парсер** и детали (утилиты, структуры данных, API) — решение уровня plan.
- Канонический reference-проект в примерах: apps `user_service`, `analytics`, `frontend`, `openapi`; `defaultScheme`/`schemes` в примерах спроектированы с этими именами.

## Точки неоднозначности (для clarify)

| # | Зона | Вопрос | Резолюция |
|---|------|--------|-----------|
| 1 | IDEA §8/§9 vs §12 | Где живёт `auth.yaml` — project root или per-app (per-composition)? | **РЕШЕНО 2026-09-05**: в корне openapi-приложения (composition), рядом с `build_config.yaml`/`overrides.yaml` (Assumptions; §8/§9/§13) |
| 2 | Constitution III vs IDEA §12 | Несёт ли `auth.yaml` `version: 1`? | **РЕШЕНО 2026-09-05**: да, `version: 1` обязательна — контракт формата, contract versioning (Assumptions; FR-002) |
| 3 | IDEA §12 vs spec 009 | Какой формат у `function`-ссылки (`functions.internal_authorizer` vs `${resources...}`/IDL)? | **РЕШЕНО на этапе specify**: формат §12 (`functions.<name>`) до формализации 009/011; разрешимость + синтаксическая валидация (FR-012; Assumptions) |

---

*Зависимости и разумные дефолты зафиксированы в Assumptions; требование-кандидат для /speckit-clarify не осталось — итоговые решения задокументированы выше (таблица «Точки неоднозначности»).*