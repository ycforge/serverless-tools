# Feature Specification: `@ycforge/pilot/contracts` — контракты экосистемы serverless-tools

**Feature Branch**: `002-pilot-contracts`

**Created**: 2026-09-03

**Status**: Draft — greenfield; описывает ЧТО должен предоставлять пакет, а не как он реализован

**Input**: Greenfield-spec для subpath export `@ycforge/pilot/contracts` пакета `@ycforge/pilot` (Project C) — публичных контрактов между независимыми npm-пакетами экосистемы serverless-tools: Builder API, Generic Artifact, Materializer API, Terraform model, ResourceReference, versioning. Отдельного SDK-пакета нет: контракты — часть публичного API pilot. Источник требований: `IDEA.md` §7, §8, §15, §16, §19, §22, §23, §26 (auto-generated outputs), §42, §43; принципы: `.specify/memory/constitution.md`.

> contracts-модуль — единственная точка входа для сторонних разработчиков builders/materializers. C реализует orchestration/runtime для этих контрактов; контракты не должны требовать знания C internals (Constitution I, IDEA §7).

## Clarifications

### Session 2026-09-03

- Q: Какие поля должен содержать `MaterializationContext` помимо `output: OutputBuilder`? → A: только `output: OutputBuilder`; минимальный контракт, расширение — через major-версию (FR-017).
- Q: Какой формы должны быть типы diagnostics для отказов границы контрактов (FR-016)? → A: `Diagnostic = { code, message }` + `ContractError extends Error`; отказы бросают `ContractError`.
- Q: Ломаем только plugin API (yaml-форматы прежние): что делаем с номерами версий? → A (вариант B): plugin API (contracts, `CONTRACT_VERSION` = semver major пакета) и версия форматов `.ycsf/*.yaml` — две независимые линии; ломка формата не требует major-бампа plugin API. IDEA.md §43 синхронно обновлён (specs первичны).
- Q: `ResourceReference.ref`: строго `domain.name.property`, а двухсегментный IDL — отдельный тип позже? → A (вариант B): строго `domain.name.property`; `domain.name` отклоняется `ContractError`; двухсегментная identity — отдельный тип в specs 009/015/017 при необходимости.
- Q: Какую семантику duplicate `output.declare` фиксирует документация contracts-модуля? → A: error; одно имя декларируется ровно один раз; проверка — зона C (FR-007).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Сторонний разработчик пишет собственный Builder, импортируя только contracts-модуль (Priority: P1)

Разработчик создаёт npm-пакет с builder-ом для нового типа приложения. Он устанавливает `@ycforge/pilot` как peer/dev-зависимость, импортирует `Builder`, `BuildContext`, `Artifact` из `@ycforge/pilot/contracts` (type-only) и реализует `build(context): Promise<Artifact>` — без каких-либо импортов из внутренних модулей C и без знания внутренней архитектуры оркестратора. Один вызов `build` возвращает ровно один `Artifact` с типом в формате `<package-scope>:<kind>`.

**Why this priority**: расширяемость builders — главная цель contracts-модуль (IDEA §42); без контракта Builder экосистема не существует.

**Independent Test**: type-test/example-пакет, реализующий `Builder` и импортирующий только `@ycforge/pilot/contracts`, компилируется `tsc --noEmit`; при запуске с тестовым `BuildContext` возвращает валидный `Artifact`.

**Acceptance Scenarios**:

1. **Given** сторонний пакет с `import type { Builder, BuildContext, Artifact } from '@ycforge/pilot/contracts'`, **When** пакет компилируется, **Then** компиляция успешна без установки какого-либо другого пакета serverless-tools (C, A, B).
2. **Given** реализация `Builder`, **When** вызывается `build(context)` с полным `BuildContext` (`projectRoot`, `buildConfig`, `buildEnv`, `outputDir`, опциональный `sourcePath`), **Then** результат — ровно один `Promise<Artifact>`; контракт не предусматривает возврата массива artifacts из одного invocation.
3. **Given** builder не получает `sourcePath` (поле опционально), **When** вызывается `build`, **Then** контракт допускает корректную работу builder-а, читающего конфигурацию из `projectRoot` (модель IDEA §9: builder сам читает `.ycsf/apps.yaml`).

---

### User Story 2 — Сторонний разработчик пишет Materializer и декларирует outputs (Priority: P1)

Разработчик реализует `Materializer`: `supports(artifact, context)` решает по `artifact.type`, берёт ли плагин artifact; `materialize(artifact, context)` возвращает `Promise<TerraformResource>` — минимальное generic representation `{type, name, configuration}`. Через `context.output.declare(name, {value, description})` materializer декларирует auto-generated output, передавая `value` как Terraform expression-строку без `${...}`.

**Why this priority**: вторая половина plugin-модели; без Materializer artifacts не превращаются в Terraform (IDEA §22).

**Independent Test**: type-test/example materializer, импортирующий только contracts-модуль, компилируется; unit-тест вызывает `supports`/`materialize` с mock-контекстом и проверяет форму возвращаемого `TerraformResource` и захваченные `output.declare`-вызовы.

**Acceptance Scenarios**:

1. **Given** materializer для artifact type `ycforge:function`, **When** C вызывает `supports(artifact, context)` с artifact этого типа, **Then** `supports` возвращает `true`; для чужого типа — `false`. Сигнатура не требует от materializer-а знания о других materializer-ах.
2. **Given** `supports` вернул `true`, **When** вызывается `materialize`, **Then** результат резолвится в `TerraformResource` с непустыми строковыми `type` и `name`; `configuration` несёт provider-specific schema, которую знает только materializer (IDEA §23).
3. **Given** materializer хочет опубликовать значение (например, function id), **When** он вызывает `context.output.declare('ycsf_function_user_service_id', { value: 'yandex_function.user_service.id', description: '...' })`, **Then** `value` передаётся без обёртки `${...}`; обёртывание при сериализации в `.tf.json` — зона C, контракт фиксирует строку-expression как есть (IDEA §26).
4. **Given** materializer хочет сгенерировать не-resource блок, **When** контракт допускает расширенную модель, **Then** contracts-модуль предоставляет тип `TerraformBlock = TerraformResource | TerraformMoved | TerraformVariable | TerraformData | TerraformOutput` (IDEA §23).

---

### User Story 3 — C диспетчеризует Artifact к ровно одному Materializer (Priority: P2)

C получает artifact от builder-а и ищет materializer по `artifact.type`. Контракт contracts-модуль гарантирует, что диспетчеризация по `type` однозначна: один artifact type — один materializer; коллизия (два materializer заявляют `supports` для одного типа) — error. Сама диспетчеризация и обнаружение коллизий — зона C; contracts-модуль обязан лишь предоставлять контракты, которые это допускают (строковый `type`, синхронный boolean `supports`).

**Why this priority**: правило «один type — один materializer» — fail-fast инвариант (Constitution V, IDEA §8/§22), но реализуется в C, не в contracts-модуль.

**Independent Test**: type-level проверка, что `Artifact.type` — `string`, а `Materializer.supports` — чистая синхронная функция `(artifact, context) => boolean`, достаточная для pairwise-детекции коллизий со стороны C.

**Acceptance Scenarios**:

1. **Given** два materializer-а, реализующих контракт contracts-модуль, оба возвращают `supports === true` для одного `artifact.type`, **When** C диспетчеризует artifact, **Then** контракт позволяет C обнаружить коллизию до вызова `materialize` (по `supports`), и C выдаёт error — contracts-модуль не запрещает и не скрывает такую ситуацию.
2. **Given** artifact с типом `ycforge:api-gateway`, **When** C сопоставляет его materializer-у, **Then** тип соответствует конвенции `<package-scope>:<kind>`, что исключает конфликты сторонних плагинов по глобальным строкам.

---

### User Story 4 — Парсинг и валидация ResourceReference (Priority: P2)

Builder (например, B при composition) формирует `ResourceReference` — единственный canonical representation logical reference: `{ ref: string }` в формате `domain.name.property` (например, `functions.user_service.id`). contracts-модуль предоставляет тип и парсер, разбирающий canonical-строку на `domain` / `name` / `property`, чтобы B работал только с logical references (IDL), а трансляция IDL → Terraform expression (IDT) оставалась зоной materializer-а.

**Why this priority**: сквозной контракт связности между builders (B), materializer-ами и outputs (IDEA §15, §16); ошибки в формате ref должны ловиться одним каноническим парсером, а не ad-hoc в каждом плагине.

**Independent Test**: unit-тесты парсера: валидные canonical refs разбираются на тройку и сериализуются обратно без потерь (round-trip); невалидные отклоняются с диагностикой.

**Acceptance Scenarios**:

1. **Given** строка `functions.user_service.id`, **When** она парсится contracts-модуль, **Then** результат — `{ domain: 'functions', name: 'user_service', property: 'id' }`, а round-trip обратно в строку даёт исходное значение.
2. **Given** строка `functions.user_service` (двухсегментная IDL-форма без property), **When** выполняется парсинг как `ResourceReference.ref`, **Then** парсер отклоняет её `ContractError` (уточнение 2026-09-03: `ResourceReference` — строго `domain.name.property`; двухсегментная logical identity — предмет отдельного типа в specs 009/015/017 при необходимости).
3. **Given** произвольная строка, не соответствующая формату (пустые сегменты, недопустимые символы), **When** выполняется парсинг, **Then** contracts-модуль отклоняет её с типизированной diagnostic, а не молчаливым `undefined`.

---

### User Story 5 — Совместимость версий контракта (Priority: P3)

Плагин объявляет peer-зависимость на диапазон major-версий contracts-модуль. contracts-модуль экспортирует тип/константу текущей contract version, соответствующей полю `version: 1` файлов `.ycsf/*.yaml`; C проверяет совместимость при загрузке плагина и отклоняет несовместимые версии до запуска builders. Любой breaking change контракта — новая major-версия contracts-модуль + migration guide.

**Why this priority**: версионирование обязательно (Constitution III, IDEA §43), но механика проверки — на стороне C; contracts-модуль предоставляет лишь носитель версии.

**Independent Test**: тест, что contracts-модуль экспортирует contract version, значение которой совпадает с major-линией пакета; тест, что migration guide существует для каждой major-версии > 1 (process check).

**Acceptance Scenarios**:

1. **Given** плагин, собранный против contracts-модуль major N, **When** C загружает его в окружении contracts-модуль major N, **Then** контракт версии читается из contracts-модуль и совпадает с объявленным диапазоном плагина.
2. **Given** ломающее изменение plugin API (Builder, Materializer, Artifact), **When** готовится релиз, **Then** major-версия contracts-модуль (пакета pilot) увеличивается и публикуется migration guide — без исключений (IDEA §43). Ломающее изменение формата `.ycsf/*.yaml` без ломки plugin API поднимает только `version` форматной линии (независимая линия, уточнение 2026-09-03).

---

### Edge Cases

- Builder возвращает artifact с `type`, не следующим конвенции `<package-scope>:<kind>` — конвенция документирована в contracts-модуль; enforcement (error на `ycsf check`/при диспетчеризации) — зона C (specs 014/020); contracts-модуль предоставляет predicate для проверки формата (решение 2026-09-03 без отдельного вопроса: hard/soft — зона C, в IDEA §8 не регламентировано).
- `BuildContext.sourcePath` отсутствует (опциональное поле) — builder обязан корректно обрабатывать оба случая; пример: B читает конфигурацию из `projectRoot` сам (IDEA §9).
- Materializer вызывает `output.declare` дважды с одним именем — семантика зафиксирована уточнением 2026-09-03: error (одно имя — один declare); реализация проверки — зона C (см. FR-007).
- `TerraformResource.configuration` содержит provider-specific поля — contracts-модуль сознательно типизирует его как `unknown`/generic и не моделирует Terraform provider schema (IDEA §23, Constitution IV).
- `ResourceReference` на external-ресурс из `resources.yaml` (reference-only) — парсер не различает managed/external; ownership-семантика — зона C (Constitution VI).

## Requirements *(mandatory)*

### Functional Requirements

Экспортируемые контракты (поверхность пакета):

- **FR-001**: THE CONTRACTS MODULE SHALL экспортировать тип `Builder` с единственным методом `build(context: BuildContext): Promise<Artifact>`; один builder invocation SHALL возвращать ровно один `Artifact` (IDEA §7).
- **FR-002**: THE CONTRACTS MODULE SHALL экспортировать тип `BuildContext` с полями `projectRoot: string`, `sourcePath?: string`, `buildConfig: unknown`, `buildEnv: Record<string, string>`, `outputDir: string`; иных C-specific namespace contracts в контексте SHALL NOT быть (IDEA §7).
- **FR-003**: THE CONTRACTS MODULE SHALL экспортировать generic-тип `Artifact<T = unknown>` с полями `type: string` и `value: T`; контракт SHALL NOT предполагать, что потребитель (C) анализирует `value` по конкретным типам (IDEA §8).
- **FR-004**: THE CONTRACTS MODULE SHALL документировать и предоставлять predicate валидации формата `Artifact.type` как `<package-scope>:<kind>` (пример: `ycforge:function`, `ycforge:api-gateway`) (IDEA §8).
- **FR-005**: THE CONTRACTS MODULE SHALL экспортировать тип `Materializer<A extends Artifact = Artifact>` с методами `supports(artifact: A, context: MaterializationContext): boolean` и `materialize(artifact: A, context: MaterializationContext): Promise<TerraformResource>`; materializer SHALL возвращать `TerraformResource` напрямую, без промежуточного abstraction layer (IDEA §22).
- **FR-006**: THE CONTRACTS MODULE SHALL экспортировать тип `MaterializationContext` с единственным полем `output: OutputBuilder`; иных полей контекст SHALL NOT содержать (уточнение 2026-09-03: materializer — чистая трансляция artifact → TerraformResource; расширение контекста — только через major-версию).
- **FR-007**: THE CONTRACTS MODULE SHALL экспортировать тип `OutputBuilder` с методом `declare(name: string, output: { value: string; description?: string }): void`; `value` SHALL быть Terraform expression-строкой БЕЗ обёртки `${...}`; обёртывание при сериализации в `.tf.json` — ответственность C (IDEA §26). Документация SHALL фиксировать семантику коллизий: повторный `declare` с тем же `name` — error (одно имя декларируется ровно один раз); проверка реализуется C (уточнение 2026-09-03).
- **FR-008**: THE CONTRACTS MODULE SHALL экспортировать generic-тип `TerraformResource<T = unknown>` с полями `type: string`, `name: string`, `configuration: T` (IDEA §23).
- **FR-009**: THE CONTRACTS MODULE SHALL экспортировать union-тип `TerraformBlock = TerraformResource | TerraformMoved | TerraformVariable | TerraformData | TerraformOutput` как допустимый набор генерируемых блоков; CONTRACTS MODULE SHALL NOT моделировать Terraform provider schema (IDEA §23, Constitution IV).
- **FR-010**: THE CONTRACTS MODULE SHALL экспортировать тип `ResourceReference` с единственным полем `ref: string` — единственным canonical representation logical reference (IDEA §15).

Правила и границы:

- **FR-011**: THE CONTRACTS MODULE SHALL предоставлять парсер canonical resource reference, разбирающий `ref` строго в формате `domain.name.property` (три непустых сегмента) на `domain`, `name`, `property`; двухсегментная форма `domain.name` SHALL отклоняться `ContractError` (уточнение 2026-09-03); canonical contract SHALL оставаться одной строкой, парсер — вспомогательная утилита, не заменяющая representation (IDEA §15).
- **FR-012**: WHEN парсер получает строку, не соответствующую формату canonical reference, THE CONTRACTS MODULE SHALL отклонять её с типизированной diagnostic, содержащей причину; молчаливая деградация SHALL NOT допускаться (Constitution V).
- **FR-013**: THE CONTRACTS MODULE SHALL фиксировать модель IDL/IDT/IDR в типах и документации: builders и B работают только с logical references (IDL через `ResourceReference`); трансляция IDL → Terraform expression (IDT) — ответственность materializer-а; реальные IDR появляются только после `terraform apply` и в контрактах CONTRACTS MODULE SHALL NOT фигурировать (IDEA §16).
- **FR-014**: THE CONTRACTS MODULE SHALL допускать однозначную диспетчеризацию artifact → materializer по `type` со стороны C: один artifact type — один materializer, коллизия двух `supports` — error; обнаружение коллизий SHALL быть возможно до вызова `materialize` (по синхронному `supports`); сама диспетчеризация SHALL NOT входить в зону contracts-модуль (IDEA §8, §22).
- **FR-015**: Контракты CONTRACTS MODULE SHALL NOT требовать от builder/materializer знания C internals: никакие типы C (project model, build graph, YAML-форматы) SHALL NOT протекать в сигнатуры `Builder`/`Materializer` (IDEA §7, §42; Constitution I).
- **FR-016**: THE CONTRACTS MODULE SHALL экспортировать тип diagnostics для отказов границы: type `Diagnostic = { code: string; message: string }` и класс `ContractError extends Error`, реализующий `Diagnostic`; отказы контрактов (парсер, predicates) SHALL бросать `ContractError` с типизированным `code`, молчаливые возвраты SHALL NOT допускаться (уточнение 2026-09-03; IDEA §42).

Версионирование и зависимости:

- **FR-017**: THE CONTRACTS MODULE SHALL версионироваться по semver; любой breaking change любого контракта (Builder/Materializer API, Artifact, форматы `.ycsf/*.yaml`) SHALL выпускаться как major-версия с migration guide (IDEA §43, Constitution III).
- **FR-018**: THE CONTRACTS MODULE SHALL экспортировать константу версии plugin API (`CONTRACT_VERSION`), соответствующую semver major-линии пакета; ломка plugin API SHALL выпускаться как major-версия пакета + migration guide. Версия форматов `.ycsf/*.yaml` (`version: 1`) — отдельная независимая линия: breaking change формата SHALL NOT требовать major-бампа plugin API (уточнение 2026-09-03; IDEA §43 обновлён). C SHALL иметь возможность проверить совместимость plugin ↔ contracts по major-версии при загрузке (IDEA §43).
- **FR-019**: THE CONTRACTS MODULE SHALL NOT добавлять runtime-зависимости пакету pilot (zero-dependency на уровне модуля): contracts состоят из type-level контрактов и pure-функций (парсер, predicates); внешние пакеты допускаются только как peer/dev dependencies (Constitution, дополнительные ограничения; IDEA §42).
- **FR-020**: THE CONTRACTS MODULE SHALL экспортировать весь публичный контрактный API через единый subpath export `@ycforge/pilot/contracts`; внутренние модули пакета pilot SHALL NOT быть частью публичного контракта (по аналогии с FR-030 spec 001 — единый barrel).

### Key Entities

- **Builder**: контракт сборки; `build(context) → Promise<Artifact>`; один invocation = один artifact.
- **BuildContext**: вход builder-а (`projectRoot`, опциональный `sourcePath`, непрозрачный `buildConfig`, `buildEnv`, `outputDir`).
- **Artifact\<T\>**: типизированный результат сборки; `type` в формате `<package-scope>:<kind>` — ключ диспетчеризации; `value` непрозрачен для C.
- **Materializer\<A\>**: контракт трансляции artifact → Terraform; `supports` (синхронный отбор) + `materialize` (async, → `TerraformResource`).
- **MaterializationContext / OutputBuilder**: контекст материализации; `output.declare(name, {value, description})` — auto-generated outputs, `value` без `${...}`.
- **TerraformResource / TerraformBlock**: минимальное generic representation Terraform (`type`, `name`, `configuration`) и допустимые блоки (`moved`, `variable`, `data`, `output`).
- **ResourceReference**: canonical logical reference `{ref: string}` строго формата `domain.name.property` (IDL+property); парсится в тройку `domain`/`name`/`property`; двухсегментная identity (`domain.name`) — не `ResourceReference`, а предмет отдельного типа в последующих specs.
- **Diagnostics**: типизированные отказы границы контрактов; `Diagnostic = { code: string; message: string }`, `ContractError extends Error` — бросается парсером и predicates.
- **Contract version**: версия plugin API, экспортируемая contracts-модулем как `CONTRACT_VERSION` (= semver major пакета); версия форматов `.ycsf/*.yaml` (`version: 1`) — отдельная независимая линия.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Contracts-модуль не вводит production-зависимостей: код, экспортируемый из `@ycforge/pilot/contracts`, не импортирует ни одного runtime-пакета (проверяется статически: import-граф contracts-модуля содержит только type-only импорты и pure-функции).
- **SC-002**: Каждый экспортируемый контракт (FR-001…FR-010, FR-016) покрыт минимум одним compile-time type test, который ломается при изменении сигнатуры (traceability acceptance criteria → тесты, Constitution II).
- **SC-003**: Пример стороннего пакета (reference builder + reference materializer), импортирующий ТОЛЬКО `@ycforge/pilot/contracts` (пакет `@ycforge/pilot` как dev/peer-зависимость), компилируется `tsc --noEmit` без импортов из других пакетов монорепо — 100% типов, нужных для User Stories 1–2, доступны из subpath entry point.
- **SC-004**: Парсер `ResourceReference` проходит 100% канонических примеров из IDEA.md §15 (`functions.user_service.id`, `containers.analytics.id`, `queues.events.qurl`, `buckets.frontend.name`) с round-trip без потерь; 100% невалидных входов из тестового набора отклоняются типизированной diagnostic.
- **SC-005**: Для каждой major-версии contracts-модуль > 1 в репозитории существует migration guide; contract version, экспортируемая contracts-модуль, проверяется тестом на соответствие major-линии пакета.

## Assumptions

- contracts-модуль — subpath export `@ycforge/pilot/contracts` пакета `packages/pilot` (`@ycforge/pilot`) в монорепо npm/pnpm (Constitution, дополнительные ограничения); отдельный SDK-пакет не существует и не планируется.
- contracts-модуль — преимущественно type-only; runtime-код ограничивается pure-функциями (парсер canonical ref, predicate формата artifact type, константа contract version).
- Диспетчеризация artifact → materializer, обнаружение коллизий, сериализация `TerraformResource` в `.tf.json`, обёртывание output-значений в `${...}`, проверка версий при загрузке плагинов — зона ответственности C и НЕ входят в scope этого spec (contracts-модуль лишь предоставляет контракты, которые это допускают).
- Форматы `.ycsf/*.yaml` сами по себе (схемы apps.yaml, resources.yaml и т.д.) — предмет отдельных specs; здесь фиксируется только носитель их contract version.
- Форма типов diagnostics зафиксирована уточнением 2026-09-03 (`Diagnostic` + `ContractError`, см. FR-016); состав `MaterializationContext` зафиксирован уточнением 2026-09-03 (только `output: OutputBuilder`, см. FR-006).

---

## Точки неоднозначности IDEA.md (для clarify)

| # | Место | Проблема | Влияние на contracts-модуль |
|---|---|---|---|
| 1 | §22, §26 | Состав `MaterializationContext` не перечислен; известен только `output: OutputBuilder` (§26) и сам факт передачи в `supports`/`materialize` (§22) | РЕШЕНО 2026-09-03: контекст содержит только `output: OutputBuilder` (FR-006) |
| 2 | §42 | «diagnostics/contracts» упомянуты в списке экспортов без определения формы (коды? severity? класс ошибки?) | РЕШЕНО 2026-09-03: `Diagnostic = { code, message }` + `ContractError extends Error` (FR-016) |
| 3 | §43 | Связь `version: 1` в `.ycsf/*.yaml` с semver major пакета contracts-модуль не зафиксирована (один номер или два независимых) | РЕШЕНО 2026-09-03: две независимые линии — `CONTRACT_VERSION` = semver major пакета; `version` yaml-форматов — своя линия (FR-018; IDEA §43 обновлён) |
| 4 | §8 | «Конвенция именования artifact type» — не сказано, hard error ли нарушение формата `<scope>:<kind>` и кто его валидирует | FR-004: enforcement остаётся на C, contracts-модуль даёт лишь predicate |
| 5 | §26 | Повторный `output.declare` с тем же именем — семантика не регламентирована | РЕШЕНО 2026-09-03: error (одно имя — один declare); реализация проверки — зона C (FR-007) |
| 6 | §15 vs §16 | §15 показывает canonical ref только как `domain.name.property`; §16 определяет IDL как `domain.name` — допустимость двухсегментной формы в `ResourceReference.ref` не оговорена | РЕШЕНО 2026-09-03: строго `domain.name.property`; `domain.name` — `ContractError`, отдельный тип позже (FR-011) |
