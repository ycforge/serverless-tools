# Feature Specification: OpenAPI extraction — `openapi_entry`, fallback chain, safe build mode (Project B)

**Feature Branch**: `006-openapi-extraction`

**Created**: 2026-09-04

**Status**: Draft — greenfield; описывает ЧТО, а не КАК

**Input**: Roadmap row 006 — «openapi-extraction — `openapi_entry`, fallback chain, `SERVERLESS_TOOLS_OPENAPI_BUILD=1`, metadata-only». Источник требований: `IDEA.md` §10 (OpenAPI generation и safe build mode); принципы: `.specify/memory/constitution.md` (особенно I — границы B, V — явное вместо магии, и пункт про safe-режим OpenAPI build).

> B получает готовый OpenAPI-документ приложения. B не загружает и не исполняет user-код в основном процессе composer: вызов объявленного contract-экспорта `buildYcsfOpenApi(): Promise<OpenAPIObject>` (IDEA §10) происходит в изолированном runner-процессе, который возвращает B готовый документ; либо B читает уже собранные артефакты. Reflection над user-кодом и моделирование internals исключены — единственные интерфейсы это contract-экспорт и артефакты (Constitution I). Извлечение — это получение документа; композиция/merge нескольких документов — отдельная спецификация (008).

## Clarifications

### Session 2026-09-04

- Q1 (граница Constitution I vs IDEA §10): кто исполняет `buildYcsfOpenApi`? → **A: вариант B** — исполнение user-кода происходит в изолированном runner-процессе, порождаемом B; основной процесс composer не импортирует и не исполняет user-код. Следствия: (a) падение/зависание entry point не ломает основной процесс B (timeout + fail-fast, FR-011); (b) env `SERVERLESS_TOOLS_OPENAPI_BUILD=1` выставляется в окружении runner-процесса до загрузки entry (FR-002); (c) фактическая защита от side effects остаётся контрактной (safe `openapi_entry` + env), изоляция процесса не запрещает сети — это documented limitation (US1, assumptions); (d) Constitution I удовлетворена в буквальном прочтении (главный процесс B не импортирует user-код); IDEA §10 синхронно уточнена (см. примечание в разделе 10 IDEA.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Разработчик указывает явный `openapi_entry` и получает OpenAPI без side effects (Priority: P1)

Разработчик NestJS-приложения хочет, чтобы toolchain получил OpenAPI-документ его API безопасно: без подключения к БД, запуска миграций, обращений во внешние сервисы и прочих side effects, которые может выполнить обычный bootstrap. Он указывает в конфигурации приложения `openapi_entry` — путь к файлу, который экспортирует `buildYcsfOpenApi(): Promise<OpenAPIObject>`, использующую metadata-only генерацию (`SwaggerModule.createDocument` без `app.init()`/`app.listen()`). B вызывает эту функцию и получает готовый документ, где `security` уже проставлен стандартным `SwaggerModule`/`@RequireAuth`.

**Why this priority**: primary path IDEA §10; безопасная генерация OpenAPI — главная ценность фичи: без неё обычный bootstrap может ронять сборку (БД недоступна) или выполнять необратимые действия (миграции).

**Independent Test**: тестовое приложение с `openapi_entry`, где метаданные провайдеров/модулей устроены так, что полная инициализация «упала бы громко» (например, провайдер бросает в `onModuleInit` обращение к несуществующей БД); извлечение через `openapi_entry` завершается успешно и возвращает документ, идентичный выводу `SwaggerModule.createDocument` для того же приложения.

**Acceptance Scenarios**:

1. **Given** приложение с явным `openapi_entry`, экспортирующим `buildYcsfOpenApi(): Promise<OpenAPIObject>`, **When** B извлекает документ, **Then** результат — валидный OpenAPI-документ, идентичный тому, что вернул бы `SwaggerModule.createDocument` для этого приложения (включая проставленный `security`).
2. **Given** `buildYcsfOpenApi` асинхронная, **When** B вызывает её, **Then** B дожидается результата (await) и работает именно с ним, а не с Promise-объектом.
3. **Given** внутри `buildYcsfOpenApi` считывается переменная окружения, **When** B выполняет извлечение, **Then** значение `SERVERLESS_TOOLS_OPENAPI_BUILD` равно `1` (явный safe-режим виден приложению).
4. **Given** файл `openapi_entry` существует, но не экспортирует функцию с именем `buildYcsfOpenApi` (либо экспортирует не-функцию), **When** B извлекает документ, **Then** B завершается fail-fast ошибкой, в которой указан путь к источнику.

---

### User Story 2 — Разработчик не указывает `openapi_entry`, B использует собранный артефакт (Priority: P1)

Разработчик не хочет, чтобы toolchain вообще исполнял код своего приложения (например, build-окружение не содержит рантайма/зависимостей приложения). Он кладёт рядом с приложением уже собранный OpenAPI-артефакт `<app>/swagger.json` (или `<app>/openapi.json`). B при отсутствии `openapi_entry` находит и использует этот артефакт — без импорта/исполнения user-кода.

**Why this priority**: самый безопасный источник документа (артефакт уже собран, user-код не исполняется); fallback chain IDEA §10 шаг 1.

**Independent Test**: фикстурный `<app>/swagger.json` (валидный OpenAPI); извлечение без `openapi_entry` возвращает содержимое файла; факт неисполнения user-кода проверяется отсутствием любых загрузок модулей приложения.

**Acceptance Scenarios**:

1. **Given** `openapi_entry` не указан, а `<app>/swagger.json` существует и является валидным JSON-объектом OpenAPI, **When** B извлекает документ, **Then** используется содержимое артефакта, и user-код приложения не исполняется.
2. **Given** `openapi_entry` не указан и оба артефакта присутствуют (`<app>/swagger.json` и `<app>/openapi.json`), **When** B извлекает документ, **Then** выбор детерминирован: приоритет у `swagger.json`.
3. **Given** `openapi_entry` не указан, а `<app>/swagger.json` существует, но это не валидный OpenAPI-документ (битый JSON или не объект вида `{openapi, paths}`), **When** B извлекает документ, **Then** B завершается fail-fast ошибкой с указанием пути к файлу — тихий переход к следующему источнику недопустим (битый артефакт — состояние, требующее внимания, Constitution V).

---

### User Story 3 — B использует convention-экспорт `buildYcsfOpenApi` из собранного `dist/main` (Priority: P2)

Разработчик не указал `openapi_entry` и не собрал артефакт, но приложение собрано стандартно — `dist/main` существует. B пробует загрузить `dist/main` и вызвать convention-экспорт `buildYcsfOpenApi` (fallback chain IDEA §10 шаг 2).

**Why this priority**: соглашение по умолчанию; менее явно, чем `openapi_entry`, поэтому P2, но покрывает сборки без явной конфигурации.

**Independent Test**: фикстурный `dist/main`, экспортирующий `buildYcsfOpenApi`; извлечение без `openapi_entry` и без артефактов вызывает функцию и возвращает её результат.

**Acceptance Scenarios**:

1. **Given** `openapi_entry` не указан, артефактов нет, а `<app>/dist/main` экспортирует `buildYcsfOpenApi(): Promise<OpenAPIObject>`, **When** B извлекает документ, **Then** функция вызывается с тем же контрактом, что и для `openapi_entry` (включая `SERVERLESS_TOOLS_OPENAPI_BUILD=1`), и результат используется как документ.
2. **Given** `dist/main` существует, но загрузить его нельзя (синтаксическая ошибка, отсутствует экспорт `buildYcsfOpenApi`, require бросает), **When** B пробует этот источник, **Then** B завершается fail-fast ошибкой, отличающей причину (нет файла / нет экспорта / ошибка загрузки), без маскировки.

---

### User Story 4 — Ни один источник не сработал: детерминированная ошибка (Priority: P2)

Разработчик не указал `openapi_entry`, артефактов нет и `dist/main` недоступен. B не может получить документ и должен сообщить об этом понятно (fallback chain IDEA §10 шаг 3 — terminal error).

**Why this priority**: терминальный шаг цепочки; без него отсутствие источника превратилось бы в молчаливую поломку или недетерминированное поведение.

**Independent Test**: запрос извлечения без `openapi_entry`, без артефактов и без `dist/main`; assert — выброшена ошибка с фиксированным сообщением.

**Acceptance Scenarios**:

1. **Given** нет ни `openapi_entry`, ни артефактов, ни доступного `dist/main`, **When** B извлекает документ, **Then** B завершается ошибкой с сообщением: «Specify openapi_entry in build_config.yaml or export buildYcsfOpenApi from your entry point.»

---

### Edge Cases

- **Приоритет источников**: явный `openapi_entry` всегда главенствует; fallback-цепочка включается только при его **отсутствии** (не при «битости» — битый `openapi_entry` это ошибка, см. US1/AC4). Порядок: `openapi_entry` → `<app>/swagger.json` → `<app>/openapi.json` → `dist/main` convention → terminal error. Детерминирован и фиксируется тестами (SC-003).
- **Битый артефакт**: артефакт существует, но невалиден — fail-fast с указанием пути; НЕ переход к следующему источнику и НЕ переиспользование частичных данных (Constitution V — fail-fast over magic).
- **`buildYcsfOpenApi` бросает**: ошибка из user-функции пробрасывается наружу как ошибка извлечения с указанием источника (entry path / `dist/main`), без маскировки и без частичного результата.
- **Runner падает/зависает**: entry point исполняется в изолированном runner-процессе; не-нулевой exit code, таймаут или невозможность запустить runner — fail-fast ошибка извлечения, основной процесс B остаётся жизнеспособным (Q1/вариант B, FR-011).
- **`buildYcsfOpenApi` возвращает не-объект**: результат не является валидным OpenAPI-документом (не объект, не `Promise<OpenAPIObject>`) — fail-fast с указанием источника.
- **env виден только в runner**: `SERVERLESS_TOOLS_OPENAPI_BUILD=1` устанавливается в окружении runner-процесса до загрузки/вызова entry point; приложение может условно отключать side effects, читая её. Установка env не должна быть единственной защитой — primary защита это отдельный `openapi_entry` (IDEA §10).
- **Извлечённый документ не модифицируется**: на этапе извлечения документ передаётся дальше без изменений (нормализации/композиции нет — это зона 008).
- **Пустой проект / нет `dist/`**: корректный terminal error (US4), не «unhandled exception» с нечитаемым стеком.
- **Артефакт с корректным JSON, но не OpenAPI-объект** (нет `openapi`/`paths` полей у объекта): трактуется как невалидный (US2/AC3 fail-fast).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: THE CONNECTOR SHALL [извлекать OpenAPI-документ из явного `openapi_entry`]: когда `openapi_entry` указан, B через изолированный runner-процесс загружает указанный файл и вызывает экспортируемую им `buildYcsfOpenApi()`; результат (await) используется как OpenAPI-документ. (US1/AC1–AC2.)
- **FR-002**: THE CONNECTOR SHALL [устанавливать safe-режим env]: B устанавливает `SERVERLESS_TOOLS_OPENAPI_BUILD=1` в окружении runner-процесса ПЕРЕД загрузкой/вызовом entry point (`openapi_entry` и `dist/main`). (US1/AC3, US3/AC1; constitution: «B всегда ставит `SERVERLESS_TOOLS_OPENAPI_BUILD=1`».)
- **FR-003**: THE CONNECTOR SHALL NOT [использовать reflection над user-кодом и загружать его в основной процесс]: единственные интерфейсы для получения документа — contract `buildYcsfOpenApi`, исполняемый в изолированном runner-процессе, и готовые артефакты; основной процесс composer не импортирует user-модули и не интроспектирует их. (US1/AC1, IDEA §10; Constitution I — вариант B.)
- **FR-004**: THE CONNECTOR SHALL [поддерживать артефактный fallback]: при отсутствии `openapi_entry` B проверяет `<app>/swagger.json`, затем `<app>/openapi.json` (порядок фиксирован) и использует содержимое первого найденного валидного артефакта как OpenAPI-документ, не исполняя user-код. (US2/AC1–AC2.)
- **FR-005**: THE CONNECTOR SHALL [поддерживать convention-fallback]: при отсутствии `openapi_entry` и артефактов B через изолированный runner-процесс загружает `<app>/dist/main` и вызывает convention-экспорт `buildYcsfOpenApi()`, с теми же контрактами, что FR-001/FR-002. (US3/AC1.)
- **FR-006**: THE CONNECTOR SHALL [завершаться детерминированной ошибкой] при отсутствии всех источников с сообщением «Specify openapi_entry in build_config.yaml or export buildYcsfOpenApi from your entry point.». (US4/AC1; IDEA §10 шаг 3.)
- **FR-007**: THE CONNECTOR SHALL [fail-fast на битом артефакте]: существующий, но невалидный артефакт (`swagger.json`/`openapi.json`) — ошибка с указанием пути, без перехода к следующему источнику и без частичного результата. (US2/AC3, edge cases.)
- **FR-008**: THE CONNECTOR SHALL [fail-fast на ошибках entry point]: исключение из `buildYcsfOpenApi`, не-функция/отсутствие экспорта, результат-не-документ — ошибка извлечения с указанием источника (entry path / `dist/main`), причины различимы. (US1/AC4, US3/AC2, edge cases.)
- **FR-009**: THE CONNECTOR SHALL NOT [изменять извлечённый документ]: извлечённый OpenAPI-документ передаётся дальше как есть (parity с источником); нормализация, merge и overrides — вне зоны 006. (US1/AC1, edge cases; граница к 008.)
- **FR-010**: THE CONNECTOR SHALL [принимать явную конфигурацию извлечения]: запрос на извлечение содержит `appRoot` (корень приложения) и опциональный `openapi_entry` (путь к файлу); авто-discovery user-кода отсутствует, кроме фиксированных fallback FR-004/FR-005. (Constitution V; граница к 010/011 — формат `build_config.yaml`/CLI здесь не определяется.)
- **FR-011**: THE CONNECTOR SHALL [изолировать исполнение user-кода]: `buildYcsfOpenApi` исполняется в отдельном от основного процесса composer runner-процессе; падение runner (exit code != 0), незавершение по таймауту или отказ запуска — fail-fast ошибка извлечения с указанием источника; основной процесс B остаётся жизнеспособным. (Q1/вариант B; US1/AC4, edge cases.)

### Key Entities *(include if feature involves data)*

- **OpenAPI-документ**: целевой артефакт извлечения; значение вида `{openapi, info, paths, components?}`; проходит через фазу извлечения без изменений (FR-009). Для одного приложения ровно один результирующий документ.
- **Источник документа**: одно из — `openapi_entry`-файл, артефакт `<app>/swagger.json`, артефакт `<app>/openapi.json`, `dist/main` convention-экспорт. Источники упорядочены (edge cases; FR-001/FR-004/FR-005/FR-006).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Каждый acceptance scenario US1–US4 покрыт минимум одним выполняемым тестом; test-suite `packages/composer` зелёный (traceability, Constitution II).
- **SC-002**: При указанном `openapi_entry` извлечение успешно в 100% тестов даже когда полная инициализация приложения гарантированно упала бы (fixture с громко падающим провайдером) — safe mode работает без потери конфигурации документа.
- **SC-003**: Приоритет источников детерминирован: `openapi_entry` → `swagger.json` → `openapi.json` → `dist/main` → terminal error; в 100% тестов выбранный источник совпадает с конфигурацией.
- **SC-004**: `SERVERLESS_TOOLS_OPENAPI_BUILD=1` доступен внутри `buildYcsfOpenApi` в 100% тестов, где вызывается entry point.
- **SC-005**: Извлечённый документ byte-идентичен источнику (артефакту или результату `buildYcsfOpenApi`) в 100% тестов --- извлечение не мутирует документ.

## Assumptions

- Функция entry имеет фиксированное имя `buildYcsfOpenApi`, сигнатуру без параметров и возвращает `Promise<OpenAPIObject>` (IDEA §10). Поддержка иных имён/параметров в v1 отсутствует.
- Metadata-only генерация (`SwaggerModule.createDocument` без `app.init()`/`app.listen()`) — рекомендация app-автору (IDEA §10). B не принуждает и не проверяет это технически; безопасность достигается контрактом `openapi_entry` + env safe-режим (FR-002), а проверка «инициализация не выполнена» — через SC-002 fixture: приложение, собранное через `openapi_entry`, не выполняет side effects.
- Извлечение реализуется в `packages/composer` (`@ycforge/composer`, Project B). Формат `build_config.yaml` и CLI-фронтенд (`ycsf-api`) — в спецификациях 010/011; настоящая спецификация определяет программный контракт извлечения (FR-010) и используемый в сообщении FR-006 текст про `build_config.yaml`.
- Исполнение user-кода допускается ТОЛЬКО через объявленные источники FR-001/FR-005 в защищённом safe-режиме (FR-002) и ТОЛЬКО в изолированном runner-процессе (Q1/вариант B, FR-011, FR-003); B не запускает произвольные скрипты приложения в основном процессе.
- Изоляция runner-процесса не запрещает сети: runner теоретически может подключиться к БД или внешним сервисам, если developer нарушит контракт safe entry. Защита — контракт `openapi_entry` (metadata-only) + env safe-режим + возможность убить runner по таймауту; это документированное ограничение (boundary), а не обещание sandbox-безопасности.
- Node 18+; детали загрузки entry point (`require`/import и формат `dist/main`) — решение уровня plan.
- Канонический reference-проект в примерах: приложения `user_service`, `analytics`, `frontend`, `openapi`.

## Точки неоднозначности (для clarify)

| # | Зона | Вопрос | Резолюция |
|---|------|--------|-----------|
| 1 | Грань конституции | Кто исполняет `buildYcsfOpenApi` — B напрямую или изолированно? Constitution I: «B ... не импортирует user-код» vs IDEA §10: B вызывает entry point | **РЕШЕНО 2026-09-04**: вариант B — исполнение в изолированном runner-процессе, порождаемом B; основной процесс B не импортирует user-код (FR-003, FR-011) |