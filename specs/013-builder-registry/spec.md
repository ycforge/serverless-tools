# Spec 013: builder-registry — explicit mapping `.ycsf/builders.yaml`, загрузка плагинов

## Metadata

- **Spec ID**: 013
- **Title**: Builder Registry — explicit mapping `.ycsf/builders.yaml`, загрузка плагинов builder/materializer
- **Status**: 🚧 In Progress
- **Dependencies**: 002 (pilot-contracts ✅), 011 (project-model ✅)
- **IDEA.md sections**: §21 (Builder registry)
- **Packages**: `packages/pilot` (`@ycforge/pilot`)

---

## Problem Statement

Spec 011 загрузил `.ycsf/apps.yaml`, где каждое приложение указывает `builder: <builder-identifier>` — **строковый идентификатор**, проверка на известность которого намеренно отложена (edge case в spec 011: «неизвестные builders детектируются в spec 013»). Spec 002 определил контракты `Builder` и `Materializer` (shapes в `@ycforge/pilot/contracts`), но нет механизма, который:

1. **регистрирует** mapping builder/materializer идентификаторов → npm-пакеты плагинов;
2. **загружает** модули плагинов и валидирует, что они экспортируют ожидаемый контракт (`Builder` или `Materializer`);
3. **валидирует** проектную модель (spec 011): каждое `App.builder` должно существовать в registry; unknown builder → fail-fast.

Централизованный source of truth для builder/materializer пакетов — `.ycsf/builders.yaml` (Constitution V: explicit mapping, не auto-discovery). Без registry невозможно ни выполнение builders (spec 021), ни dispatch materializers (spec 014).

---

## Scope (In Scope)

### `.ycsf/builders.yaml` формат

**Формат** (`version: 1`):

```yaml
version: 1
builders:
  nestjs-function: "@ycforge/builder-nestjs-function"
  docker: "@ycforge/builder-docker"
  yandex-api-gateway: "@ycforge/ycsf-api"
materializers:
  yandex-function: "@ycforge/materializer-yandex-function"
  yandex-api-gateway: "@ycforge/materializer-yandex-api-gateway"
```

**Свойства**:
- `version: 1` — обязательное поле (Constitution III); отсутствие или неверное значение → error.
- `builders` — map: ключ = builder identifier (строка, `\w+` — letter/digit/underscore/hyphen), значение = npm package specifier (строка).
- `materializers` — map: ключ = materializer identifier (строка, аналогичные правила), значение = npm package specifier (строка).
- Ключи `builders` и `materializers` **не могут пересекаться** — один и тот же identifier в обоих разделах → error (Constitution V: collision = fail-fast).
- Duplicate ключ в пределах одного раздела → error.
- Пустой `builders.yaml` с `version: 1` (без `builders` и `materializers`) — валидно; пустой registry.
- `builders.yaml` — **обязательный** файл; отсутствие → error (registry необходим для загрузки проекта).

### Registry loading

Загрузка registry — синхронный, файловый pass:

1. Прочитать и распарсить `.ycsf/builders.yaml`.
2. Валидировать `version: 1`.
3. Валидировать keys (дубликаты, пересечение builders↔materializers).
4. Валидировать values: каждое значение — непустая строка (npm package specifier).
5. Результат — `PluginRegistry`: `Map<string, PluginEntry>` (key = identifier, entry содержит packageName + kind).

### Plugin module loading (dynamic import)

Загрузка модулей плагинов — **async runtime-операция** (dynamic `import()`; работает с ESM + CJS в Node 22):

1. Для каждой записи в registry — `import(packageName)`.
2. **Успешная загрузка**: модуль экспортирует `Builder` (spec 002: объект с методом `build`) **или** `Materializer` (spec 002: объект с методами `supports` и `materialize`). Распознавание по shape: если модуль экспортирует объект с `build: function` → `kind: 'builder'`; если `supports: function` и `materialize: function` → `kind: 'materializer'`. Неизвестный shape → error (not-a-plugin).
3. **Ошибки загрузки** — три категории, каждая с уникальным диагностическим кодом:
   - **Package not found**: модуль не может быть найден/импортирован → `BRG_PACKAGE_NOT_FOUND`.
   - **Not a plugin**: модуль загружен, но не экспортирует ни `Builder`, ни `Materializer` shape → `BRG_NOT_A_PLUGIN`.
   - **Load error**: другая ошибка `import()` (например, syntax error в модуле) → `BRG_LOAD_ERROR`.
4. Load failures — **errors** (fail-fast), не warnings.uilder вызывается НЕ в этом spec (spec 021); registry предоставляет typed handles (identity + loaded module).

### Project model validation

`validateBuilders(projectModel, registry)`: для каждого `App.builder` в проектной модели (spec 011) — проверить наличие в registry:

- Unknown builder → error (`BRG_UNKNOWN_BUILDER`), содержащий: `app_id`, неизвестный `builder` id, список доступных builders из registry.
- Валидация выполняется **после** загрузки registry и **после** загрузки проектной модели.
- Если registry пуст (0 builders), а в проекте есть apps → error на каждом app с unknown builder.

### yandex-api-gateway = Project B как builder plugin (boundary constraint)

`yandex-api-gateway` — это Project B, подключённый в C как builder plugin. Для C B — просто builder, который возвращает `Artifact`. C **не** разбирает внутренний OpenAPI IR B. Это **boundary constraint**, документируемая как часть spec 013; конкретная реализация packaging B как plugin — spec 018/future.

### Scope boundaries (Out of Scope)

| What | Why out of scope | Owner |
|------|------------------|-------|
| Builder execution / build orchestration | Spec 021 | `ycsf build` |
| Materializer dispatch → TerraformResource | Spec 014 | materializer-dispatch |
| Создание builder-пакетов (nestjs-function, docker, vite) | Spec 018 | builders-core |
| Packaging `@ycforge/ycsf-api` как plugin | Spec 018/future | builders-core |
| `package.json`-based registration | Constitution V: один source of truth, builders.yaml | — |
| Auto-discovery по имени в `node_modules` | Constitution V: explicit over magic | — |
| CLI-команды `ycsf check` / `ycsf build` | Specs 020/021 | CLI |
| Runtime-интерполяция `{{$ENV}}` | Spec 012 (merged) | build-env |

---

## User Scenarios & Testing

### User Story 1 — DevOps declares builders/materializers (Priority: P1)

DevOps создаёт `.ycsf/builders.yaml` в проекте, указывая builder и materializer пакеты. При загрузке registry (перед загрузкой проектной модели или параллельно) — mapping корректно прочитан и валиден.

**Why this priority**: Без registry невозможно загрузить модули плагинов и валидировать проектную модель. Это фундамент для всего пайплайна C.

**Independent Test**: Создать `builders.yaml` с 2 builders + 1 materializer; вызвать загрузку registry; проверить, что registry содержит записи с правильными package specifiers и kind.

**Acceptance Scenarios**:

1. **Given** `.ycsf/builders.yaml` с `version: 1`, `builders: { nestjs-function: "@ycforge/builder-nestjs" }`, `materializers: { yandex-function: "@ycforge/materializer-yf" }`, **When** registry загружается, **Then** registry содержит 2 записи: `nestjs-function` (kind: builder) и `yandex-function` (kind: materializer).
2. **Given** `.ycsf/builders.yaml` без поля `version`, **When** registry загружается, **Then** ошибка: missing or invalid version field.
3. **Given** `.ycsf/builders.yaml` с `version: 2`, **When** registry загружается, **Then** ошибка: unsupported version '2' (supported: 1).

---

### User Story 2 — Fail-fast on registry key collision (Priority: P1)

DevOps допустил ошибку: один и тот же идентификатор указан и в `builders`, и в `materializers`. Система должна отказать в загрузке registry до任何 попытки загрузки модулей.

**Why this priority**: Constitution V требует fail-fast для коллизий; невыполнение = нарушение constitution.

**Independent Test**: Создать `builders.yaml` с одинаковым ключом в builders и materials; загрузка registry завершается ошибкой.

**Acceptance Scenarios**:

1. **Given** `builders.yaml` с `builders: { my-plugin: "pkg-a" }` и `materializers: { my-plugin: "pkg-b" }`, **When** registry загружается, **Then** ошибка: duplicate key 'my-plugin' in builders and materializers.
2. **Given** `builders.yaml` с `builders: { a: "pkg-1", a: "pkg-2" }`, **When** YAML парсится, **Then** ошибка: duplicate builder key 'a'.

---

### User Story 3 — Plugin package not found (Priority: P1)

DevOps указал корректный mapping, но npm-пакет плагина не установлен в `node_modules`. При dynamic import — ошибка загрузки.

**Why this priority**: Отложенные ошибки на этапе сборки (spec 021) сложнее отлаживать; fail-fast при загрузке registry экономит время.

**Independent Test**: Создать `builders.yaml` с несуществующим package name; попытка загрузки модуля завершается ошибкой `BRG_PACKAGE_NOT_FOUND`.

**Acceptance Scenarios**:

1. **Given** `builders.yaml` с `builders: { nestjs: "@nonexistent/fake-builder" }`, **When** выполняется dynamic import пакета, **Then** ошибка: package '@nonexistent/fake-builder' not found (BRG_PACKAGE_NOT_FOUND), registry не создан.
2. **Given** `builders.yaml` с валидным пакетом, который установлен, **When** выполняется import, **Then** модуль успешно загружен (нет ошибки).

---

### User Story 4 — Plugin module not a plugin (Priority: P1)

DevOps указал пакет, который установлен, но не экспортирует ни `Builder`, ни `Materializer` shape. При загрузке — ошибка `BRG_NOT_A_PLUGIN`.

**Why this priority**: Гарантия контракта: только modules с ожидаемым shape попадают в registry; невалидный модуль — fail-fast.

**Independent Test**: Создать `builders.yaml` с пакетом, который экспортирует plain object без `build`/`supports`/`materialize`; загрузка registry завершается ошибкой.

**Acceptance Scenarios**:

1. **Given** пакет экспортирует `{ foo: () => {} }` (нет ни `build`, ни `supports`/`materialize`), **When** выполняется загрузка plugin-модуля, **Then** ошибка: module '@scope/pkg' does not export a Builder or Materializer (BRG_NOT_A_PLUGIN).
2. **Given** пакет экспортирует `{ build: async () => {}, supports: () => false, materialize: async () => {} }` (оба shape present), **When** выполняется загрузка, **Then** распознаётся как builder (shape `build` present — приоритет; или: ошибка, так как ambiguous — TBD, см. Assumptions).

---

### User Story 5 — Validate app builders against registry (Priority: P1)

DevOps указал `builder: unknown-builder` в `.ycsf/apps.yaml`. Система должна выдать error с указанием app и доступных builders.

**Why this priority**: Это прямое выполнение spec 011 edge case (deferred unknown-builder detection). Без валидации — невалидный builder попадёт в spec 021, где ошибка будет сложнее.

**Independent Test**: Создать проект с 2 apps, где один app указывает未知 builder; вызвать `validateBuilders`; проверить, что ошибка содержит app_id и список доступных.

**Acceptance Scenarios**:

1. **Given** проект с app `analytics` (builder: `nest-function`, registry содержит `nestjs-function`, `docker`), **When** выполняется `validateBuilders`, **Then** ошибка: app 'analytics' uses unknown builder 'nest-function'; available builders: nestjs-function, docker.
2. **Given** проект с app `frontend` (builder: `nestjs-function`, registry содержит `nestjs-function`), **When** выполняется `validateBuilders`, **Then** ошибки нет (builder найден).
3. **Given** проект с 2 apps: `a` (builder: `unknown`) и `b` (builder: `unknown2`), registry содержит `docker`, **When** выполняется `validateBuilders`, **Then** выданы обе ошибки (одна на каждый app).

---

### User Story 6 — Empty builders.yaml (Priority: P2)

Разработчик имеет проект с пустым `.ycsf/builders.yaml` (только `version: 1`, без `builders`/`materializers`). Registry загружается пустым. Если в проекте есть apps → ошибки на каждом app (unknown builder).

**Why this priority**: Граничный случай;.registry must load without crashing; subsequent validation catches empty-state mismatches.

**Independent Test**: Создать `builders.yaml` с `version: 1` (без ключей) и проект с 1 app; registry пуст, validateBuilders выдаёт ошибку.

**Acceptance Scenarios**:

1. **Given** `builders.yaml` с `version: 1` (без `builders`/`materializers`), **When** загружается registry, **Then** registry пуст (0 записей).
2. **Given** пустой registry и проект с app (builder: `nestjs-function`), **When** выполняется `validateBuilders`, **Then** ошибка: app uses unknown builder; available builders: (пусто).

---

### User Story 7 — yandex-api-gateway as B-plugin conceptual (Priority: P3)

DevOps видит `yandex-api-gateway: "@ycforge/ycsf-api"` в builders.yaml и понимает, что это Project B, подключённая как builder plugin. C загружает её модуль и получает `Builder` interface; внутри модуль B компилирует OpenAPI и возвращает `Artifact`. C не знает внутренний OpenAPI IR.

**Why this priority**: Документирование boundary constraint; конкретная реализация B-as-plugin — spec 018/future.

**Independent Test**: Итеративно: загрузить registry с `yandex-api-gateway` entry; модуль B (в будущем) экспортирует `Builder`; registry содержит запись `kind: 'builder'`.

**Acceptance Scenarios**:

1. **Given** `builders.yaml` с `builders: { yandex-api-gateway: "@ycforge/ycsf-api" }`, **When** загружается registry, **Then** запись `yandex-api-gateway` имеет `kind: 'builder'` и packageName `@ycforge/ycsf-api` (типизация, не выполнение).
2. **Given**未来的 B-plugin модуль экспортирует `{ build: async () => Artifact }`, **When** загружается модуль, **Then** registry распознаёт как builder (shape validation).

---

### Edge Cases

- **`builders.yaml` отсутствует**: ошибка загрузки (registry обязателен; без него невозможно валидировать app builders).
- **Пустой `builders` (0 builders) + 0 apps**: валидно; registry пуст, проект пуст.
- **Пустой `builders` (0 builders) + apps**: ошибка на каждом app (unknown builder).
- **Duplicate package name в разных ключах**: допустимо (один пакет может содержать несколько exports); uniqueness проверяется по ключу, а не по packageName.
- **Package name содержит подпуть** (`@scope/pkg/sub`): допустимо (npm subpath exports, `import()` работает).
- **`version` field отсутствует**: error (аналогично spec 011).
- **Non-string value в builders/materializers**: error (ожидается строка — package specifier).
- **Empty string key в builders**: error (ключ должен быть непустой строкой `\w+`).

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST загружать `.ycsf/builders.yaml` из корня проекта и парсить его как YAML.
- **FR-002**: System MUST валидировать `version: 1` в `builders.yaml`; отсутствие или неверное значение → error.
- **FR-003**: System MUST валидировать keys в `builders` и `materializers`: дубликат ключа в пределах одного раздела → error; пересечение ключей между `builders` и `materializers` → error (Constitution V: collision = fail-fast).
- **FR-004**: System MUST валидировать values: каждое значение — непустая строка; пустая строка или non-string → error.
- **FR-005**: System MUST загружать `.ycsf/builders.yaml` как обязательный файл; отсутствие → error (registry необходим для валидации проекта).
- **FR-006**: System MUST для каждой записи registry выполнять dynamic `import(packageName)` и возвращать loaded module handle (async operation).
- **FR-007**: System MUST распознавать `Builder` shape: модуль экспортирует объект с методом `build: Function`. Распознавание: если экспорт имеет `build` function property → `kind: 'builder'`.
- **FR-008**: System MUST распознавать `Materializer` shape: модуль экспортирует объект с методами `supports: Function` и `materialize: Function`. Распознавание: если экспорт имеет оба `supports` и `materialize` → `kind: 'materializer'`.
- **FR-009**: System MUST выдавать `BRG_PACKAGE_NOT_FOUND` error при неудачном import (модуль не найден/не может быть импортирован).
- **FR-010**: System MUST выдавать `BRG_NOT_A_PLUGIN` error при загруженном модуле без `Builder`/`Materializer` shape.
- **FR-011**: System MUST выдавать `BRG_LOAD_ERROR` error при другой ошибке import (syntax error, runtime error в модуле при загрузке).
- **FR-012**: System MUST загружать плагины ТОЛЬКО через explicit mapping в `builders.yaml`; auto-discovery по имени в `node_modules` запрещен (Constitution V).
- **FR-013**: System MUST валидировать проектную модель (spec 011): каждое `App.builder` должно существовать в registry; unknown builder → error (`BRG_UNKNOWN_BUILDER`) с указанием app_id, неизвестного builder id и списка доступных builders.
- **FR-014**: System MUST выдавать все ошибки загрузки registry (FR-002..FR-005) как fail-fast: ни одна ошибка не становится warning; registry не создан при наличии ошибок.
- **FR-015**: System MUST возвращать `PluginRegistry` со всеми успешно загруженными plugin handles (identity + loaded module + kind); загрузка плагинов — async; неудачная загрузка одного plugin НЕ предотвращает загрузку других (partial load: collect errors, report all; abort с ошибками).

### Key Entities

- **BuildersYaml**: содержимое `.ycsf/builders.yaml` после парсинга. Содержит `version`, `builders` (map key → packageName), `materializers` (map key → packageName).

- **PluginRegistry**: результат загрузки registry + загрузки модулей. Содержит `entries: Map<string, PluginEntry>` (key = identifier из builders.yaml), и при неудаче — `errors: PluginLoadError[]`. Registry результат различает: загружен OK / package-not-found / not-a-plugin — каждая диагностика уникальна.

- **PluginEntry**: одна запись в registry. Атрибуты: `id` (identifier из builders.yaml key), `packageName` (npm specifier), `kind: 'builder' | 'materializer'` (распознано по shape), `module` (loaded module — объект, экспортирующий `Builder` или `Materializer`).

- **PluginKind**: литеральный тип `'builder' | 'materializer'` — результат распознавания shape модуля.

- **PluginLoadError**: ошибка загрузки одной plugin-записи. Содержит: `id` (identifier), `packageName`, `code: 'BRG_PACKAGE_NOT_FOUND' | 'BRG_NOT_A_PLUGIN' | 'BRG_LOAD_ERROR'`, `message`.

- **BuilderRegistryValidationResult**: результат `validateBuilders(projectModel, registry)`. Содержит: `kind: 'ok'` (все appsHave known builders) или `kind: 'invalid'` с `errors: ProjectModelDiagnostic[]` (одна ошибка на каждый unknown builder).

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Загрузка registry + plugins для типичного проекта (3 builders + 2 materializers, все пакеты установлены) выполняется за < 2s (dynamic import в Node 22).
- **SC-002**: Unknown builder в `apps.yaml` обнаруживается при валидации registry (до запуска任何 builders); diagnostic содержит app_id, unknown id и список доступных.
- **SC-003**: Plugin package-not-found, not-a-plugin и load error возвращают уникальные diagnostic codes; ни одна ошибка не становится warning (fail-fast).
- **SC-004**: Duplicate key (builders↔materializers collision) обнаруживается при загрузке registry до任何 dynamic import.
- **SC-005**: Auto-discovery по имени в `node_modules` гарантированно НЕ происходит (только explicit mapping через `builders.yaml`).
- **SC-006**: 100% acceptance criteria spec 013 покрыты тестами (Constitution II); каждый AC → ≥1 тест.

---

## Assumptions

- **Node 22 + ESM**: dynamic `import()` поддерживает и ESM, и CJS (Node 22 с `--experimental-require-module` или нативный ESM). Пакеты-плагины могут быть ESM или CJS; loading mechanism единообразен.
- **Shape распознавание по exports.default или named exports**: модуль плагина экспортирует `Builder`/`Materializer` как default export **или** named export. shape detection проверяет (после import): `module.default?.build ?? module.build` (builder) или `module.default?.supports ?? module.supports` + `module.default?.materialize ?? module.materialize` (materializer). Это — reasonable default; приclare если нужно иначе.
- **Плагин загружается один раз**: registry загружает модуль один раз и кэширует handle. Повторный вызов для того же package specifier возвращает тот же module (ESM module caching semantics).
- **Одна ошибка загрузки одного plugin НЕ останавливает загрузку других**: registry собирает все ошибки и возвращает их вместе с успешными entries (см. FR-015). Если есть ошибки → registry считается невалидным (ошибки fail-fast, не warnings).
- **`version: 1` в `builders.yaml`**: единственный поддерживаемый формат (Constitution III). Расширения через semver — будущее.
- **Plugin module contract**: shape detection определяет `Builder`/`Materializer` по presence функций `build` (для builder) и `supports` + `materialize` (для materializer). Контракты shapes — spec 002; этот spec НЕ переопределяет их, только определяет mechanism распознавания.
- **`yandex-api-gateway`**: conceptual note для boundary; конкретная реализация B-as-plugin — spec 018/future. registry загружает `@ycforge/ycsf-api` как builder plugin; B возвращает `Artifact` для C.

---

## References

- Spec 002: pilot-contracts — `Builder`, `BuildContext`, `Materializer`, `Artifact`, `MaterializationContext`, `ContractError`, `Diagnostics` (shapes)
- Spec 011: project-model — `App.builder` field (deferred validation to this spec), `ProjectModel`, `ProjectModelDiagnostic`
- Spec 012: build-env — runtime ENV interpolation (merged, context for `BuildContext.buildEnv`)
- IDEA.md §21: Builder registry (explicit mapping, `builders.yaml` format, yandex-api-gateway as B-plugin)
- Constitution I: Separation of responsibilities A/B/C/Terraform (C не знает internal builder schemes)
- Constitution III: Contracts versioned (`version: 1`)
- Constitution V: Explicit over magic (explicit mapping, no auto-discovery, fail-fast collisions)

---

## Next Steps

1. `/speckit.plan` — technical design: `BuildersYaml` parser, `PluginRegistry` loading algorithm, shape detection (`isBuilder`/`isMaterializer`), error codes (`BRG_*`), `validateBuilders` implementation, contracts (`PluginEntry`, `PluginLoadError`, `BuilderRegistryValidationResult`) in `src/contracts/`.
2. `/speckit.tasks` — breakdown into implementation tasks with test-first approach.
3. `/speckit.implement` — code, tests (RED → GREEN), lint, typecheck.
