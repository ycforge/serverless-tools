# Spec 026: composer-builder — `@ycforge/composer/builder`, Builder-модуль Project B для конвейера `ycsf build` (`ycforge:api-gateway`)

| | |
|---|---|
| Spec ID | 026 |
| Название | composer-builder |
| Feature branch | `026-composer-builder` (от `dev`) |
| Status | 🚧 In progress |
| Created | 2026-09-12 |
| Inputs | roadmap row (Волна 5) + BIG-3..BIG-4 из `specs/024-e2e-reference/plan.md` |
| Dependencies | 025 (🚧, контракт C готов: builders-реестр принимает artifact-типы, materialize пробрасывает `value`), 006 (`openapi_entry`, fallback chain, safe mode), 007 (`auth.yaml`), 008 (api-composition, fail-fast), 009 (`${resources...}` refs, ENV-only), 010 (`ycsf-api` CLI входы/семантика) |
| IDEA.md | §3 (ycsf-api CLI), §10 (OpenAPI-извлечение, safe mode), §13–14 (композиция), §15–19 (resource references, IDL/IDT/IDR) |
| Packages | `packages/composer` (Project B) |
| Owns contract | `@ycforge/composer/builder` (новый subpath export, additive); потребляет `@ycforge/pilot/contracts` (Builder/Artifact — type-only + `parseResourceReference`) |

## 1. Проблема и цель

Reference-проект (spec 024) не может пройти полный конвейер `ycsf build` → materialize → `terraform plan` по двум разрывам, лежащим на стороне Project B:

**BIG-3 — `@ycforge/composer` не экспортирует Builder-модуль.** Пакет композиции умеет компилировать OpenAPI (`packages/composer/src/cli/compile.ts`, safe-mode env `SERVERLESS_TOOLS_OPENAPI_BUILD=1`, `openapi_entry` из `build_config.yaml`), но только как CLI-сабпроцесс `ycsf-api`. В `packages/composer/package.json` есть только export `"."` и bin `ycsf-api`; subpath `./builder` отсутствует. Project C после 025 загружает builder-плагины через `await import(packageName)` (`packages/pilot/src/registry/load.ts`) и вызывает `build()` (`packages/pilot/src/build/index.ts:258-296`) — но загрузить нечего: композицию невозможно выполнить in-process в `ycsf build`.

**BIG-4 — конфликт диалектов `.ycsf/apps.yaml` (C map-form vs B array-form).** Project C читает map-form: `apps: { user_service: { source_path, builder } }` (`packages/pilot/src/model/apps.ts:22-151`, fixture `packages/pilot/test/check/fixtures/canonical/.ycsf/apps.yaml`). Project B (CLI) парсит array-form: `apps: [{ id, name, builder: 'yandex-api-gateway', path }]` (`packages/composer/src/cli/load-config.ts:18-60`, fixture `packages/composer/test/fixtures/cli-pass/.ycsf/apps.yaml`). Один файл не может быть валиден для обоих одновременно. Пока Builder-модуль композиции сам парсит свой диалект `.ycsf/apps.yaml` — единого источника истины по проектной модели нет.

**Цель.** Project B получает аддитивный публичный **Builder-модуль** `@ycforge/composer/builder`, потребляемый Project C в конвейере `ycsf build` как замену субпроцессного пути. Модуль: (1) совместим с контрактом Builder из `@ycforge/pilot/contracts` (`build()` → один `Artifact` типа `ycforge:api-gateway`), компилирует OpenAPI в safe mode (путь 006, `SERVERLESS_TOOLS_OPENAPI_BUILD=1`); (2) НЕ парсит свой диалект `.ycsf/apps.yaml` — получает составленную C-модель через `BuildContext` при dispatch и использует `openapi_entry` из per-app `build_config.yaml` (в формате, который читает C); (3) возвращает артефакт-значение `{ type: 'ycforge:api-gateway', value: { specPath, resourceReferences } }`, где `specPath` — скомпилированный OpenAPI в `context.outputDir` (в конвейере — `.ycsf/artifacts/<appId>/`), а `resourceReferences` — hand-off для materializer'а по IDL→IDT.

## 2. Метрика успеха (measurable)

- SC-001. On reference-проекте 024 (`openapi` app c `builder: ycforge:api-gateway`) `ycsf plan` выполняет композицию in-process через Builder-контракт (без субпроцесса `ycsf-api`); сгенерированные `.tf.json` пригодны для `terraform plan`.
- SC-002. Artifact после успешного build: `{ type: 'ycforge:api-gateway', value: { specPath, resourceReferences } }`; `specPath` — absolute путь к существующему файлу, парсящемуся как OpenAPI; каждый `${resources.<domain>.<name>.<property>}` из скомпилированного документа ровно один раз представлен записью `{ logical: '<domain>.<name>', terraformType: <IDT-префикс> }`.
- SC-003. Safe mode: композиция исполняется при выставленном `SERVERLESS_TOOLS_OPENAPI_BUILD=1`; user-код приложения выполняется ТОЛЬКО в изолированном runner-сабпроцессе (паттерн 006 `spawn-runner`), никогда в процессе builder'а; логи приложения не появляются в stdout/stderr процесса builder'а.
- SC-004. Единый источник истины: builder не открывает `.ycsf/apps.yaml` (никакого чтения/парсинга); проект с map-form `apps.yaml` от C билдится без участия B-парсера; при этом `apps.yaml` не обязан быть валидным для `ycsf-api`.
- SC-005. Семантика композиции 0 регрессий: на одном и том же app-каталоге и входных данных скомпилированный документ бит-в-бит совпадает с выводом `ycsf-api compile` (детерминированная сериализация, ключи отсортированы).
- SC-006. Все legacy-тесты composer (CLI fixtures, array-form apps.yaml, формат `build_config.yaml` с корневым `openapi_entry`) зелёные без изменений (0 регрессий).
- SC-007. Каждый FR закрыт тестом RED→GREEN; контракт аддитивен: нет изменений существующих публичных типов/диагностик (тип-тесты test-d).

## 3. Исследование (проверено по коду на 2026-09-12)

Правдивость BIG-3/BIG-4 подтверждена чтением кода (см. ниже). `specs/024-e2e-reference/plan.md` не существует на диске (024 только запланирован, как и в 025 §3); определения взяты из roadmap + 025 + исходников.

- Публичный API composer — `packages/composer/src/index.ts` (композиция, auth, refs, типы) + `packages/composer/package.json`: exports only `"."`, bin `ycsf-api`, `"files": ["dist", "runner"]`. Subpath `./builder` отсутствует (BIG-3).
- CLI compile — `src/cli/compile.ts:25-109`: `loadAppsYaml` (array-form) → `filterGatewayApps`/`selectGatewayApp` → `buildResourceIndex(projectRoot)` (resources.yaml + env.yaml) → `loadOpenApiSource` (`openapi_entry` из `build_config.yaml` корня файла, 006 fallback) → `loadAuthConfig` → `mergeDocuments` (single-app) → `applyAuth` → `applyOverrides` → sort → `resolveReferences(document, envMapping, REFERENCE_BEARER_FIELDS, index)` → write file/stdout. Строка 18: `process.env.SERVERLESS_TOOLS_OPENAPI_BUILD = '1'` — safe-mode ставится сайд-эффектом модуля CLI.
- Извлечение — `src/extract.ts` + `src/runner/spawn-runner.ts`: user-код выполняется в субпроцессе `runner.mjs` (fd 3 — канал результата, маркеры `SERVERLESS_TOOLS_RUNNER:*`, timeout, byte-caps); spawn-shadow env включает `SERVERLESS_TOOLS_OPENAPI_BUILD: '1'` (`spawn-runner.ts:121`). Тот же механизм должен использоваться Builder-модулем.
- References — `src/resource/`: `ResourceDomain = functions|queues|buckets|containers|gateways`, per-domain `DOMAIN_PROPERTIES`; `resolveReferences` валидирует `${resources...}` (fail-fast `RESOURCE_REF_*`) и либо подставляет `env:`-значение, либо сохраняет каноническую форму `${resources.<d>.<n>.<p>}` (`reference-resolver.ts:107-156`). Парсер грамматики делегирован в `@ycforge/pilot/contracts` (`parseResourceReference`; `reference-resolver.ts:1-3`, `resource/refs/parser.ts`).
- Контракт Builder — `packages/pilot/src/contracts/builder.ts`: `BuildContext { projectRoot, sourcePath?, buildConfig, buildEnv, outputDir }`, `Artifact { type, value }`, `Builder.build(context): Promise<Artifact>`. Принцип B: buildConfig opaque, C не интерпретирует value.
- C dispatch — `packages/pilot/src/build/index.ts:258-296`: `getBuilder(entry.module)` → `builder.build(context)`; `buildConfig = projectModel.build_configs.get(appId)?.build_config ?? {}`; `outputDir = '<rootDir>/.ycsf/artifacts/<appId>'`; `sourcePath = app.source_path`. Успешный artifact сохраняется blob'ом (`cache/blobs.ts` — `mkdir recursive`, `artifact.json` = `{ type, value }`), затем пробрасывается в materialize (025, FR-002/FR-003).
- Потребитель value (019) — `packages/materializers-core/src/yandex-api-gateway/index.ts`: `value.specPath` (требуется), `value.resourceReferences` (default `[]`); `replaceResourceRefs` заменяет `${resources.<domain>.<name>.id}` → `${<terraformType>.<name>.id}` (`yandex-api-gateway/ref-resolver.ts:3-13`, `ref.logical` = `domain.name`, `ref.terraformType` = IDT-префикс). Terraform-типы 019: functions→`yandex_function`, queues→`yandex_message_queue`, buckets→`yandex_storage_bucket`, containers→`yandex_serverless_container`, gateways→`yandex_api_gateway` (подтверждено `materializers-core/src/yandex-*/index.ts`).
- IDL/IDT — `IDEA.md §15-16`: B работает с logical references; «Terraform materializer знает, как превратить logical resource references в Terraform expressions»; mapping domain→IDT — известный контракт. `packages/pilot/src/extensions/idl.ts` содержит замороженный фрагмент (functions/gateways).
- Дата-модель C — `packages/pilot/src/model/build-config.ts`: per-app `build_config.yaml` ожидает `{ version, build_config: { openapi_entry?, ... }, build_env }`; root-`openapi_entry` (CLI-формат) не читается, но и не является ошибкой (просто пустой build_config). «Один файл не может быть валиден для обоих диалектов» справедливо и для `build_config.yaml` — поэтому Builder берёт `openapi_entry` из переданного C `context.buildConfig`, а не перечитывает файл.

## 4. Non-goals (что НЕ делаем в 026)

| # | Тема | Почему не здесь | Куда |
|---|---|---|---|
| NG-1 | Изменение CLI-пути `ycsf-api`/`ycsf-api compile/check` | CLI остаётся и продолжает работать (backcompat) по своему диалекту; Builder — аддитивный слой, не замена CLI | — |
| NG-2 | Правка array-form диалекта в fixtures composer (`.ycsf/apps.yaml`, корневой `openapi_entry` в `build_config.yaml`) | legacy поддерживается как есть; единый источник истины — через BuildContext, а не через переформатирование fixtures | — |
| NG-3 | Правки packages/pilot (C-side) | контракт C готов после 025; 026 — потребитель, а не соавтор контракта | — |
| NG-4 | Доступ Builder'а к user-коду in-process | B-принцип: извлечение OpenAPI — только через изолированный runner (006); никакого `import()` user-кода в процессе builder'а | — |
| NG-5 | Правки packages/materializers-core (cwd-зависимость companion-файла, обработка non-`.id` свойств refs) | дефекты пакета materializers-core (019) — B-слой отдельной правкой (аналогично NG-3 в 025) | coordination note |
| NG-6 | Мульти-app build одним вызовом | Builder возвращает ОДИН artifact на один `build()` (контракт 002); селекция gateway-app — зона C (per-app dispatch) | — |
| NG-7 | Новые версии `.ycsf/*.yaml` форматов, bonus-функции композиции | весь input — `version: 1`; выхода за существующую семантику 006–010 нет | — |
| NG-8 | Terraform provisioning/деплой, `ycsf apply` | за пределами e2e enablement | — |

## 5. Домен и ключевые сущности

- **Builder-модуль** `@ycforge/composer/builder` — новый subpath export пакета composer: default-экспорт объекта вида `{ build(context): Promise<Artifact> }`, распознаваемого `detectPluginKind`/`getBuilder` в C (`packages/pilot/src/registry/shape.ts` — default-объект с `build`).
- **Artifact** `{ type: 'ycforge:api-gateway', value: {...} }` — результат одного `build()`; `value` соответствует контракту потребителя (019 `ApiGatewayArtifactValue`): `{ specPath: string, resourceReferences: readonly ResourceReferenceValue[] }`.
- **ResourceReferenceValue** `{ logical: '<domain>.<name>', terraformType: '<IDT-префикс>' }` — hand-off IDL→IDT для materializer'а; уникален по `logical`; `terraformType` — единственное Terraform-знание Builder'а (замороженная IDT-таблица, см. D-4).
- **CompileSource** — внутренняя параметризация: вместо `GatewayApp` из array-form apps.yaml Builder собирает `{ appId, appDir, openapiEntry?, appName }` из `BuildContext` (projectRoot/sourcePath/buildConfig) — единый входной контракт композиции.
- **Проектная модель** — остаётся за C: `.ycsf/apps.yaml` (map-form), per-app `build_config.yaml` (`build_config:`-обёртка), `resources.yaml`, `env.yaml`; Builder их не переоткрывает, кроме app-локальных артефактов источника (`auth.yaml`, `overrides.yaml`, файлы `openapi_entry`), которые адресуются от `sourcePath`.

## 6. User stories

### US-1 (P1) — `ycsf build` запускает композицию OpenAPI in-process как Builder

Как разработчик reference-проекта 024, я хочу, чтобы приложение `openapi` c `builder: ycforge:api-gateway` собиралось самим `ycsf build` через Builder-контракт, чтобы не запускать `ycsf-api` вручную как субпроцесс.

Когда в `.ycsf/builders.yaml` объявлено `builders: { ycforge:api-gateway: '@ycforge/composer/builder' }`, а `apps.yaml` (map-form) задаёт `openapi.builder: ycforge:api-gateway` и `openapi.source_path: apps/openapi`:
- C загружает модуль по subpath и распознаёт в нём Builder (`build`-функцию) без доп. настроек;
- `ycsf build` вызывает `build(context)`; композиция исполняется in-process; результат — `Artifact { type: 'ycforge:api-gateway', value: { specPath, resourceReferences } }`;
- artifact поступает в materialize-фазу (025) и на выходе даёт `yandex_api_gateway` Terraform-ресурс для `terraform plan`.
→ {US-1} AC: FR-001, FR-002, FR-003, FR-004, FR-007, FR-008, FR-010, FR-015.

**Why this priority**: закрывает BIG-3 — без Builder-модуля C физически не может выполнить композицию в конвейере.
**Independent Test**: fixture-проект (map-form apps.yaml + builders.yaml с subpath) → `buildApps(rootDir)` (API C) → assert artifact-тип/`value` + записанный файл `specPath`.

**Acceptance Scenarios**:

1. **Given** builders.yaml объявляет `ycforge:api-gateway: '@ycforge/composer/builder'`, **When** `buildApps` выполнен, **Then** registry загружает модуль и распознаёт Builder (0 ошибок `BRG_*`), `build()` исполнен единожды, artifact.type === `ycforge:api-gateway`.
2. **Given** успешный build, **When** результат инспектируется, **Then** `value.specPath` — absolute путь в `context.outputDir`, файл существует и парсится как OpenAPI (`openapi`/`paths`), а сам `value` JSON-сериализуем (валиден для blob-кэша 022).
3. **Given** проект с одним gateway-app, **When** `ycsf plan` (полный build, 025), **Then** materialize-фаза получает descriptor с `value` и генерирует `.tf.json` для `yandex_api_gateway`; никакой субпроцесс `ycsf-api` не запускается (observability-проба в тесте).

### US-2 (P1) — единый источник истины по проектной модели: Builder не читает `.ycsf/apps.yaml`

Как разработчик, я хочу, чтобы мой проект мог использовать map-form apps.yaml от C без «второго диалекта» для composer, чтобы один файл снова был единственным source of truth по приложениям.

Когда `ycsf build` диспатчит openapi-app:
- Builder формирует модель из `BuildContext` (`projectRoot`, `sourcePath`, `buildConfig`) и НЕ обращается к файлу `.ycsf/apps.yaml`);
- `openapi_entry` берётся из `context.buildConfig.openapi_entry` (значение, которое C вычитал из per-app `build_config.yaml`), а не из повторного парсинга B;
- app-локальные конфиги композиции (`auth.yaml`, `overrides.yaml`) адресуются от `sourcePath`.
→ {US-2} AC: FR-005, FR-006, FR-008, FR-012, FR-013.

**Why this priority**: закрывает BIG-4 — устраняет второй парсер проектной модели, гарантирует fail-fast без «тихого расхождения».
**Independent Test**: шпион на чтение файлов (mock fs) доказывает, что `.ycsf/apps.yaml` не открывался; map-form project от C билдится.

**Acceptance Scenarios**:

1. **Given** map-form `apps.yaml` (только C-диалект, невалидный для `ycsf-api compile`), **When** `buildApps`, **Then** build успешен; fs-шпион фиксирует отсутствие операций чтения `.ycsf/apps.yaml`.
2. **Given** `build_config.yaml` в C-формате (`build_config.openapi_entry: ./openapi.yaml`), **When** `build()`, **Then** источник загружается по этому пути (fallback chain 006 НЕ срабатывает).
3. **Given** `build_config.yaml` без `openapi_entry` в buildConfig, **When** `build()`, **Then** применяется документированный fallback (auto-detect `openapi.json`/`swagger.json` в app-каталоге, семантика 006) — ни silent-skip, ни исключение без причины.

### US-3 (P1) — артефакт-значение `{ specPath, resourceReferences }` консистентно с потребителем

Как материализатор `ycforge:api-gateway` (019), я хочу получить от Builder'а совместимое `value`, чтобы корректно превратить logical references в Terraform-выражения.

Когда Builder компилирует документ, содержащий `${resources.*}`:
- ссылки валидируются против `resources.yaml` (fail-fast семантика 009);
- для каждой уникальной `domain.name` формируется `{ logical, terraformType }`, где `terraformType` выводится по замороженной IDT-таблице (D-4);
- запись пишется в `value.resourceReferences` ровно один раз, порядок детерминирован;
- `specPath`-документ сохраняет каноническую форму `${resources.<domain>.<name>.<property>}` (логические ссылки, не IDT) — замену выполняет материализатор (IDEA §16).
→ {US-3} AC: FR-003, FR-009, FR-011, FR-014.

**Why this priority**: без точного hand-off материализатор не сможет выполнить IDL→IDT в конвейере; контракт не должен «плыть» между пакетами.
**Independent Test**: интеграционный тест «builder → материализатор»: реальный ref-resolver 019 применяет `resourceReferences` к `specPath`, в результате `${resources.functions.user_service.id}` становится `${yandex_function.user_service.id}`.

**Acceptance Scenarios**:

1. **Given** OpenAPI с `${resources.functions.user_service.id}` и `resources.yaml`, объявляющим `functions.user_service`, **When** build, **Then** `resourceReferences` содержит `{ logical: 'functions.user_service', terraformType: 'yandex_function' }` ровно один раз; дубликаты `logical` отсутствуют.
2. **Given** материализатор 019, **When** применяет refs к `specPath`-документу, **Then** `${resources.functions.user_service.id}` заменён на `${yandex_function.user_service.id}`, прочий текст не изменён.
3. **Given** ссылка на необъявленный ресурс (`${resources.functions.ghost.id}`), **When** build, **Then** build отклонён с включением диагностики `RESOURCE_REF_NOT_DECLARED` (fail-fast, не «пропустить»).
4. **Given** ссылка в не-bearer поле (например `${resources.buckets.frontend.name}` в произвольном text/description), **When** build, **Then** ссылка не трогается и не попадает в `resourceReferences` (семантика 009 FR-014/FR-019).

### US-4 (P2) — Safe mode: user-код исполняется только в изолированном runner

Как B-модуль, я хочу исполнять extraction user-кода только в изолированном сабпроцессе со safe-mode env, чтобы ни при каких обстоятельствах не импортировать user-приложение в собственный процесс (Constitution I: B не импортирует user-код; 006 semantics).

Когда `build()` загружает OpenAPI-источник через `extractOpenApi`:
- env `SERVERLESS_TOOLS_OPENAPI_BUILD=1` выставлен на время композиции;
- user entry (`buildYcsfOpenApi`) выполняется единственным способом — через runner-сабпроцесс 006 (`spawn-runner`), не через `import()` в процессе builder'а;
- ошибки извлечения (таймаут, invalid result, entry load/exec) транслируются в ошибку build.
→ {US-4} AC: FR-007, FR-013.

**Why this priority**: жёсткая граница безопасности; нарушение = нарушение constitution, а не вопрос UX.
**Independent Test**: entry, печатающий маркер в stdout/stderr и завершающийся только при отсутствии env — assert: маркер отсутствует в выводе builder'а; timeout/invalid кейсы 006 воспроизводятся через build API.

**Acceptance Scenarios**:

1. **Given** user entry читает `process.env.SERVERLESS_TOOLS_OPENAPI_BUILD` и ведёт себя по-разному, **When** build, **Then** entry выполнен в процессе с env-значением `'1'` (проба в тесте).
2. **Given** entry, логирующий в stdout/stderr, **When** build, **Then** stdout/stderr процесса builder'а не содержат этих строк (изоляция потока fd 3).
3. **Given** entry, висящий дольше таймаута, **When** build, **Then** build отклоняется с диагностикой времени извлечения (семантика `ENTRY_TIMEOUT`-семейства), процесс не утекает.

### US-5 (P2) — CLI-путь `ycsf-api` остался как есть

Как пользователь legacy-сценариев композиции, я хочу, чтобы `ycsf-api compile`/`check` продолжали работать против array-form apps.yaml и legacy `build_config.yaml` без изменений, чтобы не ломать существующие пайплайны.

Когда `ycsf-api compile` запущен на legacy-проекте:
- parse-семантика array-form не тронута;
- root-`openapi_entry` в `build_config.yaml` читается как раньше;
- сид-эффект модуля CLI (`SERVERLESS_TOOLS_OPENAPI_BUILD=1`) сохраняется.
→ {US-5} AC: FR-012, FR-016.

**Why this priority**: аддитивность (Constitution III) — новый Builder не вправе трогать существующий вход.
**Independent Test**: существующий *integration-тест CLI (`cli-pass` fixture) остаётся зелёным без правок.

**Acceptance Scenarios**:

1. **Given** очередь существующих composer-тестов, **When** после добавления `./builder`, **Then** все тесты зелёные (0 изменений файлов).
2. **Given** `ycsf-api compile` на `cli-pass`, **When** запуск, **Then** stdout-OpenAPI совпадает с ожиданием до 026 (детерминизм сохранён).

## 7. Точные требования (Functional Requirements)

В скобках — привязка к теме и источникам.

**Пакет и экспозиция**

- **FR-001**. Пакет `@ycforge/composer` получает аддитивный subpath export `"./builder"` (types + import), не меняя `"."` и bin `ycsf-api`. Модуль default-экспортирует объект с функцией `build`, распознаваемый по контракту Builder-плагина C (`detectPluginKind`/`getBuilder`). (BIG-3, D-1)
- **FR-002**. Экспортируемый `build(context)` сигнатурно совместим с `Builder` из `@ycforge/pilot/contracts`: `(context: BuildContext) => Promise<Artifact>`; типы импортируются из контракта, без повторного объявления. (D-1, D-3)
- **FR-003**. Один вызов `build()` возвращает ровно один `Artifact { type: 'ycforge:api-gateway', value: { specPath, resourceReferences } }`. (BIG-3, 002 контракт, 019 value)
- **FR-004**. `value.specPath` — absolute путь к файлу скомпилированного OpenAPI-документа (парсится по `openapi`/`paths`), записанному в `context.outputDir` (в конвейере — `.ycsf/artifacts/<appId>/`); файл создаётся builder'ом (mkdir recursive — defensive). (SC-002, A-2)
- **FR-005**. Builder НЕ читает и НЕ парсит `.ycsf/apps.yaml` ни при каких обстоятельствах; модель приложения приходит целиком через `BuildContext` (`projectRoot`/`sourcePath`/`buildConfig`/`buildEnv`/`outputDir`). (BIG-4, D-2)
- **FR-006**. App-каталог композиции выводится из `context.sourcePath` (директория); app-локальные конфиги (`auth.yaml`, `overrides.yaml`) и относительный `openapi_entry` адресуются от него; absolute-пути принимаются as-is. (D-2, A-1)

**Композиция и safe mode**

- **FR-007**. Композиция выполняется в safe mode: env `SERVERLESS_TOOLS_OPENAPI_BUILD=1` выставлен на время build; извлечение OpenAPI-источника из user entry происходит ЕДИНСТВЕННЫМ способом — через изолированный runner-субпроцесс (паттерн 006 `spawn-runner`), без `import()` user-кода в процессе builder'а. (006, D-5, B-принцип)
- **FR-008**. `openapi_entry` берётся из `context.buildConfig.openapi_entry` (C-композированный per-app `build_config`); при отсутствии значения применяется документированный fallback chain 006 (auto-detect `openapi.json`/`swagger.json` в app-каталоге); отсутствие источника и не~OpenAPI-файл — fail-fast диагностика семейства `OPENAPI_*`. (006, BIG-4, D-2)
- **FR-009**. В `value.resourceReferences` попадает ровно одна запись на каждую уникальную `domain.name` валидной ссылки `${resources.<domain>.<name>.<property>}` из контрактных bearer-полей композиции (`REFERENCE_BEARER_FIELDS`, семантика 009): `{ logical: '<domain>.<name>', terraformType: <IDT-префикс по D-4> }`. Ссылки вне bearer-полей в список не попадают. (009, 019, D-4, D-6)
- **FR-010**. Ошибки композиции (инвалидная/необъявленная ссылка `RESOURCE_REF_*`, невалидный auth/overrides, недоступный источник, ошибка извлечения) приводят к отклонению `Promise` из `build()` с диагностикой, включающей контекст artifact/appId; fail-fast, никаких тихих деградаций. (Constitution V, 006–009)
- **FR-011**. Выход детерминирован: идентичные входы → бит-в-бит идентичный `specPath`-документ (сортировка ключей pipeline 008 сохранена) и детерминированный порядок `resourceReferences` (порядок доменов из `RESOURCE_DOMAINS`, затем алфавит по `name`; дубликаты схлопываются). (D-7, A-6)
- **FR-012**. CLI-путь `ycsf-api compile`/`check` не изменяется: сохраняется array-form apps.yaml, корневой `openapi_entry`, поведение stdout/`--output`, exit-коды; 0 регрессий на существующих fixtures. (NG-1, NG-2, SC-006)

**Артефакт, контрактность, кэш**

- **FR-013**. Builder не предоставляет доступа к user-коду: в его процесс не исполняется (не импортируется) пользовательский entry/модуль приложения; единственная граница исполнения user-кода — runner-субпроцесс (006). (Constitution I; дублирует FR-007 под углом безопасности)
- **FR-014**. `value` структурно совместим с контрактом потребителя `ycforge:api-gateway` (019 `ApiGatewayArtifactValue` `{ specPath, resourceReferences }`): тип-тест легитимирует соответствие; никаких T-расхождений между пакетами. (019, III)
- **FR-015**. `value` JSON-сериализуем (plain string + массивы объектов), валиден для сохранения/восстановления blob-кэшем 022 без трансформаций, и после restore остаётся работоспособным для materialize-фазы (025) при неизменном корне проекта. (022, A-7)
- **FR-016**. Публичный API пакета аддитивен: ни один существующий тип/константа/диагностика `@ycforge/composer` не изменяются; добавление `./builder` не трогает `"."`-экспорт. (Constitution III, SC-007)

## 8. Edge cases

- **`buildConfig` пустой (нет per-app `build_config.yaml` или нет `build_config:`-секции)** — fallback auto-detect (`openapi.json`/`swagger.json` в app-каталоге) по семантике 006; при отсутствии источника — `NO_SOURCE_MESSAGE`/`OPENAPI_*` диагностика failure.
- **`openapi_entry` задан, но файл отсутствует/не OpenAPI** — ошибка load (диагностика семейства `OPENAPI_*`/`IOError`-семейства) -> отклонённый `build()`, C показывает `CLI_BUILD_FAILED` с контекстом app.
- **`sourcePath` не существует / не каталог** — fail-fast с явной диагностикой (нет тихого fallback-пути).
- **`auth.yaml`/`overrides.yaml` отсутствуют** — семантика 007/008 defaults (нет правила — нет изменений), не ошибка.
- **Некорректная ссылка `${resources.bad .name.id}` / неизвестный домен / некорректное свойство** — fail-fast (`RESOURCE_REF_SYNTAX_INVALID` / `RESOURCE_REF_DOMAIN_UNKNOWN` / `RESOURCE_REF_PROPERTY_INVALID`).
- **ENV-only режим (env.yaml с `env:` и mode env-only)** — сохранение семантики 009/010: ссылка заменяется значением из окружения; сборку это не ломает.
- **Пустой `paths: {}`** — валидный artifact (пустой gateway), `specPath` пишется детерминированно.
- **Несколько gateway-apps в проекте** — вне Builder'а: C диспатчит per-app; Builder обрабатывает ровно один app на один вызов.
- **restored из кэша (022)** — value сохраняется как `{ type, value }`, `specPath` absolute-path остаётся валидным при неизменном корне проекта; перемещение корня — та же граница, что и у остальных builders (документировано).
- **Ссылки в не-bearer полях** — игнорируются для `resourceReferences` (009 FR-014/FR-019): сборка только по контрактным полям `REFERENCE_BEARER_FIELDS`.
- **Не-`.id` свойства (qurl/name)** — Builder собирает `domain.name` независимо от свойства (логическая идентичность по IDEA §15); замена конкретного свойства — зона materializer'а (coordination note, NG-5).

## 9. Decisions (D)

- **D-1 (новый subpath export `@ycforge/composer/builder`, default-export совместимого плагина).** В `packages/composer/package.json` добавляется аддитивный export `"./builder"` (types+import), bin/`"."` не меняются. Модуль default-экспортирует объект с `build`-функцией, распознаваемый `getBuilder` в C (паттерн default-object, как у плагинов repo).
  *Рациональность*: единственная точка экспозиции Builder-контракта без новой публичной библиотеки; subpath-импорт устойчив к CJS/ESM интероп-нюансам bin; аддитивность (III) — не трогаем `"."`.
- **D-2 (Builder потребляет C-модель через BuildContext и НЕ парсит `.ycsf/apps.yaml`).** Модель (appId/sourcePath/buildConfig) приходит из C; `openapi_entry` берётся из `context.buildConfig`; app-каталог выводится из `context.sourcePath` (директория). Никакого `loadAppsYaml`/`selectGatewayApp` в библиотечном пути.
  *Рациональность*: закрывает BIG-4 без конфликта диалектов — B перестаёт быть конкурирующим парсером проектной модели; единый источник истины = C loader (Constitution V: явное, не двойная правда). CLI остаётся legacy-парсером 010, но это не «второй источник» для builder-пути.
- **D-3 (переиспользование существующего pipeline композиции, параметризованного CompileSource).** Builder выполняет тот же конвейер, что `compile.ts` (merge single-app → applyAuth → applyOverrides → sort → resolveReferences), но входные `GatewayApp`/`app.path` заменяются параметром `{ appId, appDir, openapiEntry?, appName }`, выведенным из `BuildContext`; запись — в `context.outputDir` вместо stdout/`--output`.
  *Рациональность*: 0 регрессий семантики (SC-005), одна реализация композиции в пакете, а не копия; различие только в источнике вывода и источнике модели.
- **D-4 (замороженная IDT-таблица `domain → terraformType` как единственное Terraform-знание B).** таблица `functions → yandex_function`, `queues → yandex_message_queue`, `buckets → yandex_storage_bucket`, `containers → yandex_serverless_container`, `gateways → yandex_api_gateway` (сверено с materializers-core 019) фиксируется в модуле и наполняет `resourceReferences[].terraformType`.
  *Рациональность*: IDL→IDT-prefix — контракт hand-off к материализатору (III); это адресная таблица, а не знание Terraform-семантики — B по-прежнему не компилирует Terraform, не знает provider-схемы, не импортирует user-код (I). Отсутствие таблицы вынудило бы материализатор угадывать, что сломало бы `replaceResourceRefs` (019).
- **D-5 (safe mode — непрерывно в композиции, extraction — только runner).** Модуль Builder выставляет safe-mode env как часть композиции (семантика 006); `extractOpenApi` загружает user-код исключительно через `spawn-runner` сабпроцесс.
  *Рациональность*: единственная безопасная точка исполнения user-кода; соблюдение constitution I без дублирования логики изоляции.
- **D-6 (каноническая форма ссылок в выходном документе + `resourceReferences` как отдельный hand-off).** `specPath` содержит `${resources.<domain>.<name>.<property>}` (логические ссылки), а не IDT; IDL→IDT выполняет материализатор по `resourceReferences`. 
  *Рациональность*: IDEA §16 «B работает с logical resource references; materializer знает, как превращать». Это же делает Builder-вывод совместимым с существующим `replaceResourceRefs` (019) и не дублирует TF-замену в B.
- **D-7 (детерминированный порядок `resourceReferences`).** порядок — по порядку появления домена в `RESOURCE_DOMAINS`, затем алфавитно по `name` (не порядок листов документа); дубликаты `logical` схлопываются.
  *Рациональность*: бит-в-бит детерминизм между запусками и между builder/CLI-путями (SC-005); стабильный порядок для кэш-фingerprint'ов (022).

## 10. Что CAN'T быть сделано (кваб-категория)

- Не вводится новый формат `.ycsf/*.yaml`; все входы — `version: 1`.
- Не меняется существующий вход CLI 010 (array-form, корневой `openapi_entry`) и его fixtures.
- Не изменяются публичные типы `@ycforge/pilot/contracts` и materializers-core: Builder их потребляет, но не редактирует (тип-тесты test-d это проверяют).
- Не импортируется user-код в процесс builder'а; extraction всегда через runner (не нарушение safe-mode даже в тестах).
- Не создаётся «второй loader» проектной модели и не валидируется map-form apps.yaml внутри composer.
- Не исполняется ничего Terraform-специфичного в B: только IDT-таблица для hand-off, никакой генерации `.tf`/`.tf.json`/provider-полей.

## 11. Assumptions

- A-1. В reference-проекте 024 поле `source_path` у openapi-app указывает на каталог приложения (`apps/openapi`), где лежат `build_config.yaml`, `auth.yaml`, `overrides.yaml` и источники OpenAPI; Builder трактует `sourcePath` как app-каталог.
- A-2. C передаёт `BuildContext` с уже разрешённым per-app `build_config` (025 + data-model 011) и создаёт `outputDir` с правами на запись; Builder гарантирует существование каталога сам (mkdir recursive — defensive).
- A-3. Маппинг `ycforge:api-gateway: '@ycforge/composer/builder'` в builders.yaml разрешим из проекта (workspace/published); никакого субпроцессного запуска не требуется — `await import` по subpath, как любой plugin (013).
- A-4. IDT-таблица D-4 консистентна с materializers-core 019 (проверено на дату 2026-09-12); любое изменение типов ресурсов — будущая правка таблицы с миграцией контракта, не данная фича.
- A-5. Legacy fixtures и CLI остаются на array-form и корневом `openapi_entry`; 026 их не трогает (NG-2), в том числе для того, чтобы не разворачивать reference-проект на них.
- A-6. Детерминизм вывода сохраняется при сортировке ключей (уже в pipeline 008) и детерминированном порядке реfs (D-7); «разные выводы на одинаковом входе» = баг.
- A-7. Materializе-фаза (025) выполняется полным build'ом (без `--target`), что гарантирует `value` для openapi-app (семантика 025 A-2).
- A-8. `@ycforge/pilot/contracts` уже доступен composer'у как runtime-зависимость (`parseResourceReference` импортируется в `resource/reference-resolver.ts`); новых типов/констант не требуется.

## 12. Risks

- **Диалектное расхождение `build_config.yaml`** — legacy-файл (корневой `openapi_entry`) под C даёт пустой `build_config`, Builder молча уйдёт в fallback auto-detect. Мит.: openapi-источник из `context.buildConfig` — авторитетен при наличии; отсутствие + отсутствие auto-detect-файла → явная ошибка (нет тишины); документируется (Edge cases, FR-008).
- **Дрейф IDT-таблицы** — при смене типов ресурсов в materializers-core. Мит.: D-4/assumption A-4 фиксируют таблицу и требуют миграции контракта; сверка с 019 в 024 (coordination note).
- **Поломка legacy CLI при рефакторинге в общий pipeline** — мит.: reuse (D-3) + сохранение CLI-интеграционных тестов (SC-006) как guard.
- **Absolute `specPath` в кэше** — stale после перемещения корня проекта. Мит.: документированная граница, единообразная с остальными builders (022 A-7); тест на restored-cache путь не ломается при неизменном корне.
- **Импорт subpath из не-shippable dist** — мит.: `files: ["dist", "runner"]` уже включает `dist`; тип-тест publish-контракта (существующий механизм).

## 13. Тестовая стратегия

- RED→GREEN по каждому FR (за исключениями конституции для thin orchestration). Тесты — рядом с существующими в `packages/composer/test/` (новый fixture-проект map-form + builders.yaml).
- **Изоляция**: для доказательства того, что `.ycsf/apps.yaml` не открывался, используются assert-проверки после build (например файл, гарантированно невалидный для B-парсера, билдится успешно) + чтение pipeline-инструментов перед вызовом; blanket-mock не применяется.
- **Hand-off 019**: интеграционный тест «builder → реальный `yandex-api-gateway` materializer» (без внешних вызовов — только чтение specPath и replaceResourceRefs; cwd-комpanion создаётся в temp).
- **CLI guard**: полный CLI suite 010/006–009 остаётся зелёным без изменений; бит-в-бит сравнение вывода builder vs CLI на одном app-каталоге (SC-005).
- **Safe-mode**: пробы env и изоляции потока через риск-тест (runner отдельного процесса).
- **Кэш**: artifact value JSON-serializable тест + restore-полка из blob (022) с expectation валидного specPath.
- **Контрактная замёрзка**: тип-тест, что `Artifact`/`BuildContext` импортируются из `@ycforge/pilot/contracts`-типов (additive, без локального ре-объявления).

## 14. Приемка (acceptance)

US-1..US-5 считаются приемлемыми, когда каждая When-последовательность даёт описанный результат; метрики SC-001..SC-007 измерены и равны заданным; каждый FR-0xx закрыт тестом RED→GREEN; legacy suite composer'а зелёный без изменений (SC-006); контракт аддитивен (SC-007). Никаких [NEEDS CLARIFICATION].