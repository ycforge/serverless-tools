# Feature Specification: `@ycforge/ycsf-sdk` — контракты экосистемы YCSF

**Feature Branch**: `002-sdk-contracts`

**Created**: 2026-09-03

**Status**: Draft — greenfield; описывает ЧТО должен предоставлять пакет, а не как он реализован

**Input**: Greenfield-spec для пакета `@ycforge/ycsf-sdk` (Plugin SDK) — публичных контрактов между независимыми npm-пакетами экосистемы YCSF: Builder API, Generic Artifact, Materializer API, Terraform model, ResourceReference, versioning. Источник требований: `IDEA.md` §7, §8, §15, §16, §19, §22, §23, §26 (auto-generated outputs), §42, §43; принципы: `.specify/memory/constitution.md`.

> SDK — единственная точка входа для сторонних разработчиков builders/materializers. C реализует orchestration/runtime для этих контрактов; контракты не должны требовать знания C internals (Constitution I, IDEA §7).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Сторонний разработчик пишет собственный Builder, импортируя только SDK (Priority: P1)

Разработчик создаёт npm-пакет с builder-ом для нового типа приложения. Он устанавливает `@ycforge/ycsf-sdk` как peer/dev-зависимость, импортирует `Builder`, `BuildContext`, `Artifact` и реализует `build(context): Promise<Artifact>` — без каких-либо импортов из C и без знания внутренней архитектуры оркестратора. Один вызов `build` возвращает ровно один `Artifact` с типом в формате `<package-scope>:<kind>`.

**Why this priority**: расширяемость builders — главная цель SDK (IDEA §42); без контракта Builder экосистема не существует.

**Independent Test**: type-test/example-пакет, реализующий `Builder` и импортирующий только `@ycforge/ycsf-sdk`, компилируется `tsc --noEmit`; при запуске с тестовым `BuildContext` возвращает валидный `Artifact`.

**Acceptance Scenarios**:

1. **Given** сторонний пакет с `import type { Builder, BuildContext, Artifact } from '@ycforge/ycsf-sdk'`, **When** пакет компилируется, **Then** компиляция успешна без установки какого-либо другого пакета YCSF (C, A, B).
2. **Given** реализация `Builder`, **When** вызывается `build(context)` с полным `BuildContext` (`projectRoot`, `buildConfig`, `buildEnv`, `outputDir`, опциональный `sourcePath`), **Then** результат — ровно один `Promise<Artifact>`; контракт не предусматривает возврата массива artifacts из одного invocation.
3. **Given** builder не получает `sourcePath` (поле опционально), **When** вызывается `build`, **Then** контракт допускает корректную работу builder-а, читающего конфигурацию из `projectRoot` (модель IDEA §9: builder сам читает `.ycsf/apps.yaml`).

---

### User Story 2 — Сторонний разработчик пишет Materializer и декларирует outputs (Priority: P1)

Разработчик реализует `Materializer`: `supports(artifact, context)` решает по `artifact.type`, берёт ли плагин artifact; `materialize(artifact, context)` возвращает `Promise<TerraformResource>` — минимальное generic representation `{type, name, configuration}`. Через `context.output.declare(name, {value, description})` materializer декларирует auto-generated output, передавая `value` как Terraform expression-строку без `${...}`.

**Why this priority**: вторая половина plugin-модели; без Materializer artifacts не превращаются в Terraform (IDEA §22).

**Independent Test**: type-test/example materializer, импортирующий только SDK, компилируется; unit-тест вызывает `supports`/`materialize` с mock-контекстом и проверяет форму возвращаемого `TerraformResource` и захваченные `output.declare`-вызовы.

**Acceptance Scenarios**:

1. **Given** materializer для artifact type `ycforge:function`, **When** C вызывает `supports(artifact, context)` с artifact этого типа, **Then** `supports` возвращает `true`; для чужого типа — `false`. Сигнатура не требует от materializer-а знания о других materializer-ах.
2. **Given** `supports` вернул `true`, **When** вызывается `materialize`, **Then** результат резолвится в `TerraformResource` с непустыми строковыми `type` и `name`; `configuration` несёт provider-specific schema, которую знает только materializer (IDEA §23).
3. **Given** materializer хочет опубликовать значение (например, function id), **When** он вызывает `context.output.declare('ycsf_function_user_service_id', { value: 'yandex_function.user_service.id', description: '...' })`, **Then** `value` передаётся без обёртки `${...}`; обёртывание при сериализации в `.tf.json` — зона C, контракт фиксирует строку-expression как есть (IDEA §26).
4. **Given** materializer хочет сгенерировать не-resource блок, **When** контракт допускает расширенную модель, **Then** SDK предоставляет тип `TerraformBlock = TerraformResource | TerraformMoved | TerraformVariable | TerraformData | TerraformOutput` (IDEA §23).

---

### User Story 3 — C диспетчеризует Artifact к ровно одному Materializer (Priority: P2)

C получает artifact от builder-а и ищет materializer по `artifact.type`. Контракт SDK гарантирует, что диспетчеризация по `type` однозначна: один artifact type — один materializer; коллизия (два materializer заявляют `supports` для одного типа) — error. Сама диспетчеризация и обнаружение коллизий — зона C; SDK обязан лишь предоставлять контракты, которые это допускают (строковый `type`, синхронный boolean `supports`).

**Why this priority**: правило «один type — один materializer» — fail-fast инвариант (Constitution V, IDEA §8/§22), но реализуется в C, не в SDK.

**Independent Test**: type-level проверка, что `Artifact.type` — `string`, а `Materializer.supports` — чистая синхронная функция `(artifact, context) => boolean`, достаточная для pairwise-детекции коллизий со стороны C.

**Acceptance Scenarios**:

1. **Given** два materializer-а, реализующих контракт SDK, оба возвращают `supports === true` для одного `artifact.type`, **When** C диспетчеризует artifact, **Then** контракт позволяет C обнаружить коллизию до вызова `materialize` (по `supports`), и C выдаёт error — SDK не запрещает и не скрывает такую ситуацию.
2. **Given** artifact с типом `ycforge:api-gateway`, **When** C сопоставляет его materializer-у, **Then** тип соответствует конвенции `<package-scope>:<kind>`, что исключает конфликты сторонних плагинов по глобальным строкам.

---

### User Story 4 — Парсинг и валидация ResourceReference (Priority: P2)

Builder (например, B при composition) формирует `ResourceReference` — единственный canonical representation logical reference: `{ ref: string }` в формате `domain.name.property` (например, `functions.user_service.id`). SDK предоставляет тип и парсер, разбирающий canonical-строку на `domain` / `name` / `property`, чтобы B работал только с logical references (IDL), а трансляция IDL → Terraform expression (IDT) оставалась зоной materializer-а.

**Why this priority**: сквозной контракт связности между builders (B), materializer-ами и outputs (IDEA §15, §16); ошибки в формате ref должны ловиться одним каноническим парсером, а не ad-hoc в каждом плагине.

**Independent Test**: unit-тесты парсера: валидные canonical refs разбираются на тройку и сериализуются обратно без потерь (round-trip); невалидные отклоняются с диагностикой.

**Acceptance Scenarios**:

1. **Given** строка `functions.user_service.id`, **When** она парсится SDK, **Then** результат — `{ domain: 'functions', name: 'user_service', property: 'id' }`, а round-trip обратно в строку даёт исходное значение.
2. **Given** reference без property (`functions.user_service` — чистый IDL), **When** выполняется парсинг, **Then** контракт допускает IDL-форму (domain.name) — IDEA §16 определяет IDL как `domain.name` без property. [ТРЕБУЕТ УТОЧНЕНИЯ: IDEA §15 фиксирует canonical representation только для полной формы `domain.name.property`; допустимость двухсегментной формы в `ResourceReference.ref` явно не регламентирована]
3. **Given** произвольная строка, не соответствующая формату (пустые сегменты, недопустимые символы), **When** выполняется парсинг, **Then** SDK отклоняет её с типизированной diagnostic, а не молчаливым `undefined`.

---

### User Story 5 — Совместимость версий контракта (Priority: P3)

Плагин объявляет peer-зависимость на диапазон major-версий SDK. SDK экспортирует тип/константу текущей contract version, соответствующей полю `version: 1` файлов `.ycsf/*.yaml`; C проверяет совместимость при загрузке плагина и отклоняет несовместимые версии до запуска builders. Любой breaking change контракта — новая major-версия SDK + migration guide.

**Why this priority**: версионирование обязательно (Constitution III, IDEA §43), но механика проверки — на стороне C; SDK предоставляет лишь носитель версии.

**Independent Test**: тест, что SDK экспортирует contract version, значение которой совпадает с major-линией пакета; тест, что migration guide существует для каждой major-версии > 1 (process check).

**Acceptance Scenarios**:

1. **Given** плагин, собранный против SDK major N, **When** C загружает его в окружении SDK major N, **Then** контракт версии читается из SDK и совпадает с объявленным диапазоном плагина.
2. **Given** ломающее изменение любого контракта (Builder, Materializer, Artifact, форматы `.ycsf/*.yaml`), **When** готовится релиз, **Then** major-версия SDK увеличивается и публикуется migration guide — без исключений (IDEA §43).

---

### Edge Cases

- Builder возвращает artifact с `type`, не следующим конвенции `<package-scope>:<kind>` — конвенция документирована в SDK, но enforcement (error на `ycsf check`/при диспетчеризации) — зона C; SDK предоставляет predicate для проверки формата. [ТРЕБУЕТ УТОЧНЕНИЯ: IDEA §8 называет это «конвенцией», не уточняя, является ли нарушение hard error]
- `BuildContext.sourcePath` отсутствует (опциональное поле) — builder обязан корректно обрабатывать оба случая; пример: B читает конфигурацию из `projectRoot` сам (IDEA §9).
- Materializer вызывает `output.declare` дважды с одним именем — семантика (error/override) — зона C. [ТРЕБУЕТ УТОЧНЕНИЯ: IDEA §26 не регламентирует]
- `TerraformResource.configuration` содержит provider-specific поля — SDK сознательно типизирует его как `unknown`/generic и не моделирует Terraform provider schema (IDEA §23, Constitution IV).
- `ResourceReference` на external-ресурс из `resources.yaml` (reference-only) — парсер не различает managed/external; ownership-семантика — зона C (Constitution VI).

## Requirements *(mandatory)*

### Functional Requirements

Экспортируемые контракты (поверхность пакета):

- **FR-001**: THE SDK SHALL экспортировать тип `Builder` с единственным методом `build(context: BuildContext): Promise<Artifact>`; один builder invocation SHALL возвращать ровно один `Artifact` (IDEA §7).
- **FR-002**: THE SDK SHALL экспортировать тип `BuildContext` с полями `projectRoot: string`, `sourcePath?: string`, `buildConfig: unknown`, `buildEnv: Record<string, string>`, `outputDir: string`; иных C-specific namespace contracts в контексте SHALL NOT быть (IDEA §7).
- **FR-003**: THE SDK SHALL экспортировать generic-тип `Artifact<T = unknown>` с полями `type: string` и `value: T`; контракт SHALL NOT предполагать, что потребитель (C) анализирует `value` по конкретным типам (IDEA §8).
- **FR-004**: THE SDK SHALL документировать и предоставлять predicate валидации формата `Artifact.type` как `<package-scope>:<kind>` (пример: `ycforge:function`, `ycforge:api-gateway`) (IDEA §8).
- **FR-005**: THE SDK SHALL экспортировать тип `Materializer<A extends Artifact = Artifact>` с методами `supports(artifact: A, context: MaterializationContext): boolean` и `materialize(artifact: A, context: MaterializationContext): Promise<TerraformResource>`; materializer SHALL возвращать `TerraformResource` напрямую, без промежуточного abstraction layer (IDEA §22).
- **FR-006**: THE SDK SHALL экспортировать тип `MaterializationContext`, включающий `output: OutputBuilder`; полный набор полей контекста сверх `output` [ТРЕБУЕТ УТОНЕНИЯ: IDEA.md не перечисляет состав `MaterializationContext`, кроме `output.declare` (§26) и использования в `supports`/`materialize` (§22)].
- **FR-007**: THE SDK SHALL экспортировать тип `OutputBuilder` с методом `declare(name: string, output: { value: string; description?: string }): void`; `value` SHALL быть Terraform expression-строкой БЕЗ обёртки `${...}`; обёртывание при сериализации в `.tf.json` — ответственность C (IDEA §26).
- **FR-008**: THE SDK SHALL экспортировать generic-тип `TerraformResource<T = unknown>` с полями `type: string`, `name: string`, `configuration: T` (IDEA §23).
- **FR-009**: THE SDK SHALL экспортировать union-тип `TerraformBlock = TerraformResource | TerraformMoved | TerraformVariable | TerraformData | TerraformOutput` как допустимый набор генерируемых блоков; SDK SHALL NOT моделировать Terraform provider schema (IDEA §23, Constitution IV).
- **FR-010**: THE SDK SHALL экспортировать тип `ResourceReference` с единственным полем `ref: string` — единственным canonical representation logical reference (IDEA §15).

Правила и границы:

- **FR-011**: THE SDK SHALL предоставлять парсер canonical resource reference, разбирающий `ref` на `domain`, `name`, `property`; canonical contract SHALL оставаться одной строкой, парсер — вспомогательная утилита, не заменяющая representation (IDEA §15).
- **FR-012**: WHEN парсер получает строку, не соответствующую формату canonical reference, THE SDK SHALL отклонять её с типизированной diagnostic, содержащей причину; молчаливая деградация SHALL NOT допускаться (Constitution V).
- **FR-013**: THE SDK SHALL фиксировать модель IDL/IDT/IDR в типах и документации: builders и B работают только с logical references (IDL через `ResourceReference`); трансляция IDL → Terraform expression (IDT) — ответственность materializer-а; реальные IDR появляются только после `terraform apply` и в контрактах SDK SHALL NOT фигурировать (IDEA §16).
- **FR-014**: THE SDK SHALL допускать однозначную диспетчеризацию artifact → materializer по `type` со стороны C: один artifact type — один materializer, коллизия двух `supports` — error; обнаружение коллизий SHALL быть возможно до вызова `materialize` (по синхронному `supports`); сама диспетчеризация SHALL NOT входить в зону SDK (IDEA §8, §22).
- **FR-015**: Контракты SDK SHALL NOT требовать от builder/materializer знания C internals: никакие типы C (project model, build graph, YAML-форматы) SHALL NOT протекать в сигнатуры `Builder`/`Materializer` (IDEA §7, §42; Constitution I).
- **FR-016**: THE SDK SHALL экспортировать типы diagnostics, используемые контрактами для отказов границы [ТРЕБУЕТ УТОЧНЕНИЯ: IDEA §42 упоминает «diagnostics/contracts» в списке экспортов без определения формы — поля, коды, severity не специфицированы].

Версионирование и зависимости:

- **FR-017**: THE SDK SHALL версионироваться по semver; любой breaking change любого контракта (Builder/Materializer API, Artifact, форматы `.ycsf/*.yaml`) SHALL выпускаться как major-версия с migration guide (IDEA §43, Constitution III).
- **FR-018**: THE SDK SHALL экспортировать тип/константу текущей contract version, соответствующую обязательному полю `version: 1` файлов `.ycsf/*.yaml`; C SHALL иметь возможность проверить совместимость plugin ↔ SDK по major-версии при загрузке (IDEA §43). [ТРЕБУЕТ УТОЧНЕНИЯ: связь contract version файлов конфигурации с semver major пакета в IDEA не зафиксирована — отдельный ли это номер или алиас major]
- **FR-019**: THE SDK SHALL NOT иметь runtime-зависимостей (zero-dependency): пакет состоит из type-level контрактов и pure-функций (парсер, predicates); внешние пакеты допускаются только как peer/dev dependencies (Constitution, дополнительные ограничения; IDEA §42 «небольшой public SDK»).
- **FR-020**: THE SDK SHALL экспортировать весь публичный API через единую корневую точку входа пакета; внутренние модули SHALL NOT быть частью публичного контракта (по аналогии с FR-030 spec 001 — единый barrel).

### Key Entities

- **Builder**: контракт сборки; `build(context) → Promise<Artifact>`; один invocation = один artifact.
- **BuildContext**: вход builder-а (`projectRoot`, опциональный `sourcePath`, непрозрачный `buildConfig`, `buildEnv`, `outputDir`).
- **Artifact\<T\>**: типизированный результат сборки; `type` в формате `<package-scope>:<kind>` — ключ диспетчеризации; `value` непрозрачен для C.
- **Materializer\<A\>**: контракт трансляции artifact → Terraform; `supports` (синхронный отбор) + `materialize` (async, → `TerraformResource`).
- **MaterializationContext / OutputBuilder**: контекст материализации; `output.declare(name, {value, description})` — auto-generated outputs, `value` без `${...}`.
- **TerraformResource / TerraformBlock**: минимальное generic representation Terraform (`type`, `name`, `configuration`) и допустимые блоки (`moved`, `variable`, `data`, `output`).
- **ResourceReference**: canonical logical reference `{ref: string}` формата `domain.name.property` (IDL); парсится в тройку `domain`/`name`/`property`.
- **Diagnostics**: типизированные отказы границы контрактов (форма — требует уточнения, FR-016).
- **Contract version**: версия контрактов `.ycsf/*.yaml` (`version: 1`), экспортируемая SDK и связанная с semver-линией пакета.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Пакет компилируется и проходит все тесты с пустым списком `dependencies` в `package.json` (проверяется: `dependencies` отсутствует или пуст; `npm ls --omit=dev --omit=peer` не содержит production-пакетов).
- **SC-002**: Каждый экспортируемый контракт (FR-001…FR-010, FR-016) покрыт минимум одним compile-time type test, который ломается при изменении сигнатуры (traceability acceptance criteria → тесты, Constitution II).
- **SC-003**: Пример стороннего пакета (reference builder + reference materializer), импортирующий ТОЛЬКО `@ycforge/ycsf-sdk`, компилируется `tsc --noEmit` без установки других пакетов монорепо — 100% типов, нужных для User Stories 1–2, доступны из корневого entry point.
- **SC-004**: Парсер `ResourceReference` проходит 100% канонических примеров из IDEA.md §15 (`functions.user_service.id`, `containers.analytics.id`, `queues.events.qurl`, `buckets.frontend.name`) с round-trip без потерь; 100% невалидных входов из тестового набора отклоняются типизированной diagnostic.
- **SC-005**: Для каждой major-версии SDK > 1 в репозитории существует migration guide; contract version, экспортируемая SDK, проверяется тестом на соответствие major-линии пакета.

## Assumptions

- SDK — пакет `packages/sdk` в монорепо npm/pnpm (Constitution, дополнительные ограничения); публикация под именем `@ycforge/ycsf-sdk`.
- SDK — преимущественно type-only пакет; runtime-код ограничивается pure-функциями (парсер canonical ref, predicate формата artifact type, константа contract version).
- Диспетчеризация artifact → materializer, обнаружение коллизий, сериализация `TerraformResource` в `.tf.json`, обёртывание output-значений в `${...}`, проверка версий при загрузке плагинов — зона ответственности C и НЕ входят в scope этого spec (SDK лишь предоставляет контракты, которые это допускают).
- Форматы `.ycsf/*.yaml` сами по себе (схемы apps.yaml, resources.yaml и т.д.) — предмет отдельных specs; здесь фиксируется только носитель их contract version.
- Состав `MaterializationContext` сверх `output: OutputBuilder` и форма типов diagnostics будут уточнены (см. FR-006, FR-016) до фазы plan; до уточнения реализация ограничивается явно подтверждёнными IDEA.md членами.

---

## Точки неоднозначности IDEA.md (для clarify)

| # | Место | Проблема | Влияние на SDK |
|---|---|---|---|
| 1 | §22, §26 | Состав `MaterializationContext` не перечислен; известен только `output: OutputBuilder` (§26) и сам факт передачи в `supports`/`materialize` (§22) | FR-006: нельзя зафиксировать полный тип контекста |
| 2 | §42 | «diagnostics/contracts» упомянуты в списке экспортов без определения формы (коды? severity? класс ошибки?) | FR-016: тип diagnostics не специфицируем по IDEA |
| 3 | §43 | Связь `version: 1` в `.ycsf/*.yaml` с semver major пакета SDK не зафиксирована (один номер или два независимых) | FR-018: форма экспортируемой contract version |
| 4 | §8 | «Конвенция именования artifact type» — не сказано, hard error ли нарушение формата `<scope>:<kind>` и кто его валидирует | FR-004: enforcement остаётся на C, SDK даёт лишь predicate |
| 5 | §26 | Повторный `output.declare` с тем же именем — семантика не регламентирована | Edge case; зона C, но SDK-документация должна оговорить |
| 6 | §15 vs §16 | §15 показывает canonical ref только как `domain.name.property`; §16 определяет IDL как `domain.name` — допустимость двухсегментной формы в `ResourceReference.ref` не оговорена | FR-011: грамматика парсера |
