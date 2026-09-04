# Feature Specification: API composition — единая API Gateway specification из нескольких извлечённых OpenAPI-документов (Project B)

**Feature Branch**: `008-api-composition`

**Created**: 2026-09-05

**Status**: Draft — greenfield; описывает ЧТО и ЗАЧЕМ, а не КАК

**Input**: Roadmap row 008 — «api-composition — merge specs, fail-fast конфликты, provenance (internal), overrides global/local». Источник требований: `IDEA.md` §13 (API composition) и §14 (Overrides); принципы: `.specify/memory/constitution.md` (особенно I — границы B, III — версионирование контрактов, V — явное вместо магии). Зависимости: spec 006 (извлечение per-app OpenAPI-документов), spec 007 (auth-config: `auth.yaml`, валидация ссылок).

> B — составной слой API composition (§13), а не «сливатель» Swagger-документов. На вход — несколько извлечённых per-app OpenAPI-документов (006), прошедших auth-валидацию (007); на выход — одна скомпилированная спецификация API Gateway для каждого openapi-приложения. В MVP входят: merge operations/paths/компонентов с fail-fast на конфликтах, внутренний provenance route→app, application defaultScheme к «голым» операциям с эмиссией `components.securitySchemes` и API Gateway authorizers (шов 007), global/local overrides с приоритетом local > global и явной адресацией. API Gateway integrations, resource references (`${resources...}`, spec 009) и вручную объявленные gateway-маршруты — явно вне MVP.
>
> B не является Terraform-компилятором и не провижининг (Constitution I): эмитируемые authorizer-ссылки на функции — логические references (форма §12/007), становящиеся реальными IDR только после `terraform apply`. C в диагностику конфликтов не вмешивается: композиция и fail-fast — зона B и в standalone-режиме, и в pipeline C (§14).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Автор композиции указывает несколько приложений, B собирает из них один API Gateway (Priority: P1)

Владелец API composition (openapi-приложение `openapi`) перечисляет приложения-участники (`user_service`, `analytics`). B для каждого участника извлекает OpenAPI-документ по цепочке 006, валидирует auth-ссылки по `auth.yaml` композиции (007) и формирует единый gateway-документ: все операции (method+path) и компоненты всех участников, без пересечений. Внутри B фиксирует provenance route→app (какая операция какому приложению принадлежит) — это нужно только для диагностики конфликтов (§14) и адресации per-app overrides; в скомпилированный артефакт provenance не попадает (§13). Одна композиция = один API Gateway (`gateways.openapi`).

**Why this priority**: spine фичи — без merge нескольких документов в один gateway нет никакой композиции; всё остальное (overrides, auth-применение) работает поверх собранного документа. Без provenance (US2/US3) невозможны ни fail-fast диагностика, ни per-app overrides.

**Independent Test**: фикстура с двумя приложениями без пересечений (по путям, operationId и именам компонентов); компиляция возвращает один gateway-документ со всеми операциями обоих; артефакт не содержит сведений о том, какое приложение какой маршрут объявило.

**Acceptance Scenarios**:

1. **Given** композиция с `user_service` (пути `/users`/`/users/{id}`) и `analytics` (путь `/analytics/{id}`), оба документа прошли 006/007 без ошибок, **When** B выполняет компиляцию, **Then** возвращается ОДИН документ API Gateway, содержащий каждую операцию и каждый компонент каждого приложения; входные per-app документы не изменены (byte-идентичны входу).
2. **Given** одна и та же композиция, участники переданы в разном порядке, **When** B компилирует дважды, **Then** результат детерминирован — скомпилированные документы идентичны.
3. **Given** успешно скомпилированный документ, **When** проверяется его содержимое, **Then** в нём отсутствует любой след принадлежности операций приложениям (нет ключей app-провенанса) — только OpenAPI-структура и auth-эмиссия.
4. **Given** композиция из одного приложения (например, только `user_service`), **When** B компилирует, **Then** получается корректный gateway-документ (тривиальный merge), к которому применяются те же правила overrides и auth, что и к многоприложной композиции.

---

### User Story 2 — Два приложения конфликтуют, B завершается fail-fast с понятной диагностикой (Priority: P1)

Разработчик добавил в композицию второе приложение, которое пересекается с первым: оба объявляют одинаковый `operationId` или один и тот же path. B обнаруживает конфликт и завершается ошибкой, в которой указано значение-причина (path / operationId / имя компонента) и оба приложения. Конфликты композиции — зона B: один и тот же механизм работает и в standalone-режиме, и когда B вызывается из pipeline C; C диагностику не дублирует (Constitution I).

**Why this priority**: fail-fast — конституционный принцип (Constitution V): коллизии (один path/operationId — два app) — ошибка, никогда не silent merge. Без понятной диагностики конфликт превратился бы в недетерминированный «кто победил» или падение на `terraform plan` в рантайме.

**Independent Test**: фикстура с парой приложений, конфликтующих по path; фикстура с парой, конфликтующих по operationId; фикстура с коллизией имени компонента — каждая отклоняется ошибкой с указанием значения и обоих приложений.

**Acceptance Scenarios**:

1. **Given** `user_service` и `analytics` объявляют одну и ту же строку пути `GET /users`, **When** B выполняет merge, **Then** fail-fast ошибка, в которой присутствуют `GET /users` (или `/users`) и оба appId (`user_service`, `analytics`).
2. **Given** оба приложения объявляют одинаковый `operationId` (`getUsers`) на РАЗНЫХ путях, **When** B выполняет merge, **Then** fail-fast ошибка, в которой присутствуют `getUsers`, пути обеих операций и оба appId.
3. **Given** оба приложения объявляют компонент с одинаковым именем (`UserDto`), **When** B выполняет merge, **Then** fail-fast ошибка, в которой присутствуют имя компонента и оба appId.
4. **Given** B вызван любым способом (standalone или из pipeline C), **When** возникает один и тот же конфликт, **Then** диагностика идентична — один механизм композиции, владеющий fail-fast (C не имеет собственной логики конфликтов).

---

### User Story 3 — Автор применяет global и per-app overrides, B применяет их с приоритетом local > global (Priority: P2)

Владелец композиции кладёт `openapi/overrides.yaml` (global override, применяется к общему документу) и/или `<app>/overrides.yaml` (local override, применяется к subtree своего приложения). Каждый override — явно адресованное правило (path, `METHOD /path`, `operationId`, `info`, `components.<name>`) с атомарной операцией replace/add/remove; generic deep YAML merge не используется (Constitution V, §14). При пересечении (global и local адресуют одну операцию) выигрывает локальный override — это приоритет, а не конфликт.

**Why this priority**: §14 — вторая половина roadmap-строки; overrides закрывают реальные потребности (задать `info` шлюза, поправить ответ, добавить `/_health`, скрыть операцию) без пересборки приложений. P2 по сравнению с merge/conflicts, но без них override не к чему применять.

**Independent Test**: фикстуры на каждую атомарную операцию и оба уровня; фикстура с пересечением глобального и локального правила; фикстура с нарушением границ (local адресует чужой путь) — отклоняется fail-fast.

**Acceptance Scenarios**:

1. **Given** `openapi/overrides.yaml` заменяет `info` шлюза (title/description), **When** B компилирует, **Then** `info` в gateway-документе ровно то, что задано override (не из per-app документов).
2. **Given** глобальный override добавляет операцию `GET /_health` (add), которой нет ни у одного приложения, **When** B компилирует, **Then** операция присутствует в gateway-документе; принадлежность ни к одному приложению происхождению не присваивается (провенанс «global», приватно).
3. **Given** `user_service/overrides.yaml` адресует собственную операцию `GET /users` с заменой значения поля ответа (replace), **When** B компилирует, **Then** элемент заменён атомарно (целиком), без глубокого слияния с исходным определением.
4. **Given** глобальный и локальный overrides адресуют одну и ту же операцию с разными значениями, **When** B компилирует, **Then** применяется ЛОКАЛЬНОЕ значение (приоритет local > global, ошибка не возникает).
5. **Given** `user_service/overrides.yaml` адресует операцию, принадлежащую другому приложению (например, analytics), **When** B компилирует, **Then** fail-fast ошибка, указывающая адресованную цель и приложение-владельца.
6. **Given** правило-операция указывает на несуществующую цель (`replace`/`remove` отсутствующего), **When** B компилирует, **Then** fail-fast ошибка (явное правило не игнорируется молча как no-op).

---

### User Story 4 — B применяет auth-конфигурацию (007): defaultScheme, securitySchemes, API Gateway authorizers (Priority: P2)

`auth.yaml` композиции уже провалидирован (007): `defaultScheme`, набор `schemes`. B завершает auth-шов композиции: операции без явного `security` («голые») получают defaultScheme через корневой `security`-декларацию; каждый scheme (кроме `none`) получает `components.securitySchemes`-запись; для схемы `jwt` и `function` эмитится API Gateway authorizer-конфигурация. B ничего не провижининг (Constitution I): authorizer ссылается на функцию логическим reference по форме §12/007 (`functions.<name>`), реальный IDR появится только после `terraform apply` (009/019).

**Why this priority**: шов явно зарезервирован за 008 в spec 007; без применения defaultScheme «голые» операции уехали бы в шлюз без auth — дыра безопасности при `defaultScheme: user`.

**Independent Test**: фикстура с defaultScheme=user (jwt) и голыми операциями; фикстура с defaultScheme=public (`none`); фикстура со схемой `function` — проверяется эмиссия securitySchemes, authorizers и отсутствие артефактов key-provisioning/`${resources...}`.

**Acceptance Scenarios**:

1. **Given** `defaultScheme: user` (jwt) и в извлечённых документах есть операции без `security`, **When** B компилирует, **Then** gateway-документ получает корневую декларацию `security: [{user: []}]`: операции без явного `security` наследуют `user`, операции с явным `security` сохраняют собственное требование.
2. **Given** `defaultScheme: public` (тип `none`), **When** B компилирует, **Then** корневой `security` в gateway-документ НЕ эмитится; «голые» операции остаются без auth.
3. **Given** `schemes`: `user` (jwt с `jwksUri`/`issuer`/`audience`) и `internal` (function, `functions.internal_authorizer`), **When** B компилирует, **Then** `components.securitySchemes` содержит записи для обеих схем; authorizer-конфигурация для `user` содержит параметры §12, для `internal` — ссылку на функцию как логический reference `functions.internal_authorizer`; никаких key-provisioning, JWKS/Lockbox/Object Storage-артефактов и синтаксиса `${resources...}` в выводе нет.
4. **Given** схема типа `none`, **When** B компилирует, **Then** для неё не создаётся ни записи в `securitySchemes`, ни authorizer-конфигурации.

---

### Edge Cases

- **Дубликат `operationId` внутри ОДНОГО приложения**: тоже конфликт (FR-005) — self-collision не допустима; ошибка с operationId и обоими путями одного app.
- **Пустое приложение (нет paths или пустой документ)**: вклад приложения в merge пуст, но не является ошибкой; остальные участники и правила применяются как обычно.
- **Композиция из одного приложения**: допустима (US1/AC4), является «полноценным» gateway с обычным применением overrides/auth.
- **Строгое совпадение путей**: в MVP «пересекающийся path» трактуется как совпадение СТРОКИ пути; `/users` и `/users/{id}` в разных приложениях — разные строки, НЕ конфликт. Пути-шаблоны с разной параметризацией (`/users/{id}` и `/users/{name}`) в MVP не детектируются как пересечение (семантическое пересечение URL-space — post-MVP вместе с semantic merge, documented limitation).
- **Адресация override по `operationId`**: однозначна, потому что глобальная уникальность operationId гарантирована FR-005; если override адресует по `operationId`, а правила FR-005 конфликт не пропустили — цели нет, fail-fast (US3/AC6).
- **`info` шлюза не задан**: если ни глобальный override, ни конфигурация композиции не определяют `info` — fail-fast ошибка с инструкцией задать через global override (явное правило, Constitution V; без `info` документ невалиден).
- **Разные версии OpenAPI у приложений** (например, `3.0.0` и `3.1.0`): fail-fast при несовпадении значений поля `openapi` — согласованность выносится в одно место (явное правило для MVP).
- **Коллизия имени компонента между приложением и auth-эмиссией**: если в `components.securitySchemes` из приложений уже есть имя, которое B должен эмитить из `auth.yaml` — конфликт по общим правилам FR-006 (fail-fast, не тихий приоритет).
- **Global и local override адресуют одну операцию**: это приоритет (local выигрывает), НЕ конфликт (US3/AC4).
- **Недетерминизм порядка приложений**: результат компиляции инвариантен к порядку участников (US1/AC2); гонки и «случайный победитель» исключены.
- **Схема `function`-authorizer до 009**: логическая ссылка `functions.<name>` не интерполируется и не заменяется в MVP; превращение в `${resources...}`/IDR — зона 009/019, документируемый шов (не «забытая» ссылка).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: THE COMPOSER SHALL принимать composition input — корень композиции и множество приложений (каждое с `appRoot`) — и для каждого приложения извлекать OpenAPI-документ по цепочке 006 и валидировать auth-конфигурацию по 007 (общий `auth.yaml` композиции) ПЕРЕД любым merge. Ошибка извлечения или auth-валидации любого приложения прерывает композицию fail-fast. (US1/AC1; зависимости 006/007.)
- **FR-002**: THE COMPOSER SHALL формировать единый gateway-документ, включая `paths` и `components` всех приложений; приложение без операций вносит пустое множество и не является ошибкой. (US1/AC1, AC4; edge cases.)
- **FR-003**: THE COMPOSER SHALL отслеживать provenance route→app ВНУТРЕННЕ во время композиции: для каждой операции (method+path) известно владеющее приложение; provenance НЕ включается в скомпилированный артефакт. (US1/AC3; §13.)
- **FR-004**: THE COMPOSER SHALL fail-fast на совпадении строки пути: одна и та же строка `path` у двух приложений (независимо от методов) — ошибка композиции с путём и обоими приложениями. Пока один path принадлежит ровно одному приложению, per-app override адресован однозначно. (US2/AC1; §14; edge cases о шаблонных путях.)
- **FR-005**: THE COMPOSER SHALL fail-fast на коллизии `operationId`: любой дубликат в объединённом документе — и между приложениями, и внутри одного приложения — ошибка с operationId, путями обеих операций и приложениями. (US2/AC2; edge cases; §14.)
- **FR-006**: THE COMPOSER SHALL fail-fast на коллизии имён `components` (одинаковое имя компонента из разных приложений, включая пересечение готового `components.securitySchemes` с auth-эмиссией FR-012): ошибка с именем компонента и обоими приложениями. (US2/AC3; edge cases.)
- **FR-007**: THE COMPOSER SHALL применять global override (`openapi/overrides.yaml`) к общему gateway-документу: правила адресуются явно (`path`, `METHOD /path`, `operationId`, `info`, `components.<name>`) и выполняют атомарную операцию replace/add/remove; операция несовместима с целью (`replace`/`remove` несуществующего, `add` существующего) — fail-fast. Generic deep merge недопустим. (US3/AC1–AC2, AC6; §14; Constitution V.)
- **FR-008**: THE COMPOSER SHALL применять local override (`<app>/overrides.yaml`) к subtree приложения-хозяина по provenance: адресовать разрешается только пути/операции, принадлежащие этому приложению, либо добавлять новые операции/пути в его path-space; адресация чужого пути или корневых полей — fail-fast. (US3/AC5; §14.)
- **FR-009**: THE COMPOSER SHALL применять приоритет local > global: если одна цель адресована глобальным и локальным правилом, применяется локальное; это приоритет, а не конфликт. (US3/AC4; §14.)
- **FR-010**: THE COMPOSER SHALL NOT использовать generic deep YAML merge для overrides: каждое правило — явная адресация + атомарная операция; поведение replace/remove/add детерминировано. (US3/AC3; §14 «deep merge нежелателен»; Constitution V.)
- **FR-011**: THE COMPOSER SHALL применить `defaultScheme` (007) к «голым» операциям: при типе схемы не-`none` — корневая декларация `security: [{<defaultScheme>: []}]` (операции без явного `security` наследуют её, операции с `security` сохраняют своё); при схеме типа `none` — корневой `security` не эмитится. (US4/AC1–AC2; §11 precedence; шов 007.)
- **FR-012**: THE COMPOSER SHALL эмитить `components.securitySchemes` из каждой схемы `auth.yaml`, кроме типа `none`: `jwt` — JWT/HTTP-bearer дескриптор; `function` — HTTP-bearer placeholder (семантика авторизации живёт в authorizer, FR-013); коллизия имени с существующим — fail-fast по FR-006. (US4/AC3–AC4; шов 007.)
- **FR-013**: THE COMPOSER SHALL эмитить API Gateway authorizer-конфигурацию для каждой схемы не-`none`: для `jwt` — с параметрами §12 (`jwksUri`/`issuer`/`audience`); для `function` — с логической ссылкой `functions.<name>`; authorizer-эмиссия не производит и не предполагает key-provisioning, JWKS publishing, Lockbox/Object Storage и не содержит синтаксиса `${resources...}` (интерполяция в реальный IDR — зона 009/019). (US4/AC3–AC4; Constitution I; §13 IDL.)
- **FR-014**: THE COMPOSER SHALL NOT мутировать входные per-app документы и не менять контракты 006 (неприкосновенность извлечённого документа) и 007 (auth-валидация по `security`-метаданным): merge и overrides выполняются над копиями/производными структурами. (US1/AC1; seam 006/FR-009.)
- **FR-015**: THE COMPOSER SHALL обеспечивать одну и ту же конфликт-диагностику (тип конфликта, значение-причина, оба приложения, путь/операция) в standalone-режиме и при вызове из pipeline C; ошибка не маскирует частичные результаты. (US2/AC4; §14.)
- **FR-016**: THE COMPOSER SHALL требовать согласованности поля `openapi` (версия) у всех приложений композиции; несовпадение — fail-fast. (Edge cases; Constitution V.)
- **FR-017**: THE COMPOSER SHALL гарантировать отсутствие в артефакте provenance и детерминизм результата относительно порядка приложений и повторов компиляции. (US1/AC2–AC3; §13.)
- **FR-018**: THE COMPOSER SHALL NOT поддерживать в рамках данной спецификации API Gateway integrations (включая HTTP→MQ, static из Object Storage), resource references (`${resources...}`), вручную объявленные gateway-маршруты и API Gateway extensions, кроме auth-эмиссии FR-012/FR-013; это зоны следующих спецификаций (контуры — Assumptions). (US1; §13; граница MVP.)

### Key Entities *(include if feature involves data)*

- **Композиция (composition / openapi-приложение)**: единица компиляции; одна композиция = один API Gateway (`gateways.<app>`); владеет общими `auth.yaml` (007) и `overrides.yaml` (global); несколько композиций в проекте — независимые namespace (свои схемы auth, свои overrides, изолированные конфликты).
- **Per-app OpenAPI-документ (вклад 006)**: извлечённый и неизменный документ одного приложения; источник операций/paths, компонентов и `security`-метаданных (007).
- **Provenance (route→app)**: внутреннее отображение «операция → приложение-источник»; существует только во время композиции, в артефакт не попадает (FR-003, FR-017); источник диагностики конфликтов и адресации local overrides.
- **Override rule**: адресованное правило (`path` / `METHOD /path` / `operationId` / `info` / `components.<name>`) с атомарной операцией replace/add/remove; уровень — global (композиция) или local (приложение).
- **Auth scheme (из 007)**: декларация `auth.yaml`; в композиции порождает (не-`none`) securitySchemes-запись и authorizer-конфигурацию; `defaultScheme` — корневой `security` для «голых» операций.
- **Скомпилированная спецификация API Gateway**: выходной артефакт композиции (одна на композицию); содержит объединённые paths/components, применённый auth-слой и overrides; тип артефакта — по контрактам 002/019.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Каждый acceptance scenario US1–US4 покрыт минимум одним выполняемым тестом; test-suite `packages/composer` зелёный (traceability, Constitution II).
- **SC-002**: В 100% валидных многоприложных фикстур (без пересечений) скомпилированный документ содержит каждую операцию и каждый компонент каждого приложения, а входные per-app документы byte-идентичны входу; повторные компиляции и перестановка порядка участников дают идентичный результат.
- **SC-003**: В 100% конфликтных фикстур (совпадение пути, коллизия `operationId`, коллизия имени компонента) компиляция завершается fail-fast ошибкой, в которой присутствуют тип конфликта, значение-причина и оба приложения (а для `operationId` — пути); ни в одном случае не происходит silent merge или «последний победил».
- **SC-004**: В 100% тестов скомпилированный артефакт не содержит данных provenance (никаких ключей/метаданных, раскрывающих принадлежность операций приложениям).
- **SC-005**: В 100% тестов overrides применяются атомарно и детерминированно: глобальные правила видны в документе, локальные ограничены subtree своего приложения (нарушение границ — fail-fast), при пересечении действует приоритет local > global.
- **SC-006**: В 100% тестов auth-слой корректен: при `defaultScheme` не-`none` «голые» операции получают его через корневой `security`, при `defaultScheme` типа `none` корневой `security` отсутствует; для каждой схемы не-`none` присутствуют securitySchemes-запись и authorizer-конфигурация; в выводе нет артефактов provisioning и синтаксиса `${resources...}`.
- **SC-007**: В 100% тестов входные per-app документы не мутированы (byte-parity, как в 006/FR-009), а поведение извлечения и auth-валидации идентично таковому в 006/007 (регрессий нет).

## Assumptions

- **Расположение файлов**: global override — `openapi/overrides.yaml` (корень композиции, рядом с `auth.yaml` по §8/§9/§13); local override — `<app>/overrides.yaml` (корень приложения-участника); точная структура openapi-приложения в `apps.yaml` — как в §8 до формализации spec 011.
- **Состав MVP**: merge + fail-fast + provenance (внутренний) + auth-применение шва 007 + overrides global/local. API Gateway extensions (кроме auth-эмиссии), integrations, resource references и вручную объявленные gateway-маршруты — вне MVP (FR-018). Причина исключения: они зависят от модели ресурсов 009 (`${resources...}`, IDL/IDR) и материализаторов 019 — включение их сейчас заставило бы B интерполировать реальные идентификаторы (которых до `terraform apply` не существует), т.е. нарушило бы Constitution I/IV (B — не Terraform compiler) и привязало бы 008 к ещё не определённому resource-формализму.
- **Строгий path-partition MVP**: каждый path принадлежит ровно одному приложению; операция-уровневый merge общих путей (разные методы от разных приложений) и семантические пересечения путей-шаблонов — post-MVP, вместе с semantic merge/IR (§14): тогда же пересматривается и модель коллизий.
- **`info` шлюза**: задаётся исключительно глобальным override/конфигурацией композиции; per-app `info`, `tags`, `servers` и корневой per-app `security` в gateway-документ не переносятся (являются приватными для приложений), иначе появился бы неявный «чей-то победитель»; корневой `security` шлюза выводится ТОЛЬКО из `defaultScheme` по FR-011. Отсутствие `info` — fail-fast.
- **Согласованность версии OpenAPI**: поля `openapi` всех приложений обязаны совпадать (FR-016); значение выбирает не B — оно принадлежит композиции (задаётся конфигурацией/global override наравне с `info`).
- **Форма authorizer-ссылки**: до формализации 009/019 — логическая ссылка `functions.<name>` (форма §12/007, уже согласованная в 007); если 009 введёт иной синтаксис (например, `${resources...}`), артефакт композиции следует ему через контрактное обновление, не ломая 008.
- **Эмиссия authorizers для всех schemes**: authorizer-конфигурация и securitySchemes эмитятся для КАЖДОЙ заявленной Non-none схемы (независимо от того, используется ли она операциями) — детерминированно и просто; focus-эмиссия «только используемых» — опционален/пост-MVP.
- **Пайплайн в B**: извлечение (006) → auth-валидация (007) → merge+conflict detection → auth-применение → overrides (global, затем local с приоритетом) → скомпилированный документ; порядок фиксирован и покрывается тестами (SC-001/SC-005).
- **Публичный контракт композиции** (composition input/output, типы ошибок) и место входа в `packages/composer` — решение уровня plan (аналогично 006/007); CLI-фронтенд `ycsf-api compile` — spec 010.
- **Reference-проект в примерах**: композиция `openapi` с приложениями-участниками `user_service`, `analytics`; точечное использование `frontend` в описании границы (static-интеграции — вне MVP).
- **YAML-структура override-файлов** (точная форма записи адресов и операций) — решение уровня plan; семантика адресации и операций зафиксирована FR-007/FR-008/FR-010.

## Точки неоднозначности (для clarify)

| # | Зона | Вопрос | Резолюция |
|---|------|--------|-----------|
| 1 | §14 «пересекающийся path» | Одинаковый path с РАЗНЫМИ методами от разных приложений — конфликт или merge? | **РЕШЕНО на этапе specify**: конфликт (FR-004) — строгий path-partition MVP: один path = одно приложение; operation-level merge общих путей вместе с semantic merge — post-MVP (Assumptions) |
| 2 | §13/§15 vs 009 | Как authorizer схемы `function` ссылается на функцию до формализации `${resources...}`? | **РЕШЕНО на этапе specify**: логическая ссылка `functions.<name>` (форма §12/007), без `${resources...}` и провижининга; интерполяция в IDR — 009/019 (FR-013, Assumptions) |
| 3 | §14 «deep merge нежелателен» | Какова семантика overrides без generic deep merge? | **РЕШЕНО на этапе specify**: explicit-адресация (path / `METHOD /path` / operationId / `info` / `components.<name>`) + атомарные replace/add/remove (FR-007/FR-008/FR-010); partial deep merge целей — пост-MVP |
| 4 | §13 composition layers | Откуда берутся `info`/`tags`/`servers` шлюза и версия OpenAPI | **РЕШЕНО на этапе specify**: `info` и версия — из конфигурации композиции/global override (отсутствие `info` — fail-fast); per-app `info`/`tags`/`servers` не переносятся (Assumptions; FR-016) |
| 5 | §14 vs Constitution V | Пересечение global и local override на одну цель — конфликт или приоритет? | **РЕШЕНО на этапе specify**: приоритет local > global, не конфликт — попытка «решать» приоритет могла бы привести к silent выбору, но здесь порядок задан явно правилом §14 (FR-009, US3/AC4) |
| 6 | Env/provisioning-грань | Относится ли эмиссия API Gateway authorizers к 008 или к integrations-спецификации? | **РЕШЕНО на этапе specify**: относится к 008 — шов явно зарезервирован в 007 («authorizers — зона композиции 008»); интеграции ↔ targets (HTTP→MQ, Object Storage и т.п.) — вне MVP (FR-013, FR-018) |

---

*Зависимости и разумные дефолты зафиксированы в Assumptions; требование-кандидат для /speckit-clarify не осталось — итоговые решения задокументированы выше (таблица «Точки неоднозначности»).*