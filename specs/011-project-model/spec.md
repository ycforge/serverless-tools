# Spec 011: project-model — `.ycsf/*.yaml` Project Model

## Metadata

- **Spec ID**: 011
- **Title**: Project Model — форматы `.ycsf/*.yaml`, ownership, `depends_on` граф
- **Status**: 🚧 In Progress
- **Dependencies**: 002 (pilot-contracts)
- **IDEA.md sections**: §4 (Организация проекта), §5 (`.ycsf/apps.yaml`), §6 (App-level `build_config.yaml`), §17 (`.ycsf/resources.yaml`)
- **Packages**: `packages/pilot` (`@ycforge/pilot`)

---

## Problem Statement

Project C (`@ycforge/pilot`) — Build/Deployment Orchestrator — должен загружать и валидировать структуру проекта из набора YAML-файлов (`.ycsf/apps.yaml`, `.ycsf/resources.yaml`, `<app>/build_config.yaml`). Эти файлы задают:

- **какие приложения существуют** и как их собирать (apps);
- **какие внешние ресурсы существуют** и на них можно ссылаться (resources);
- **зависимости между приложениями** (порядок сборки);
- **конфигурацию сборки** каждого приложения (build_config, build_env).

Текущая проблема: нет формализованной модели и валидатора, который garantiría fail-fast при коллизиях, циклах, несуществующих ссылках. Это ключевой фундамент для всех последующих specs волны 3 (012–022).

---

## Scope (In Scope)

### Project Layout

Структура проекта (относительно корня репозитория):

```text
repo/
├── .ycsf/
│   ├── apps.yaml
│   ├── resources.yaml
│   ├── extensions.yaml         # (spec 015 — out of scope)
│   ├── outputs.yaml            # (spec 016 — out of scope)
│   ├── env.yaml                # (spec 012 — out of scope)
│   ├── builders.yaml           # (spec 013 — out of scope)
│   └── moved.yaml              # (spec 017 — out of scope)
│
├── <app>/                      # каталоги приложений
│   ├── src/
│   └── build_config.yaml
│
├── openapi/                    # openapi-app
│   ├── build_config.yaml
│   ├── auth.yaml               # (spec 007)
│   └── overrides.yaml          # (spec 014)
│
└── infra/                      # user-owned .tf + C-generated .tf.json
```

`deploy.yaml` **не существует и никогда не вводится**.

### `.ycsf/apps.yaml`

**Формат**:

```yaml
version: 1

apps:
  <app_id>:
    source_path: <relative-path>
    builder: <builder-identifier>
    depends_on:                  # optional
      - <other_app_id>
```

**Свойства**:
- `app_id` — стабильный logical identity приложения; меняется только через `.ycsf/moved.yaml`.
- `source_path` — относительный путь к каталогу приложения (от корня репозитория).
- `builder` — идентификатор builder-а (строка; конкретные значения определяются specs 013, 018).
- `depends_on` — список app_id зависимостей; задает **порядок сборки** (topological sort).

**Запрещено**:
- Builder-specific конфигурация внутри `apps.yaml` (конфиг живёт в `<app>/build_config.yaml`).
- Дублирование одного `app_id` в двух записях (fail-fast).

**Валидация depends_on**:
- Циклы → error на загрузке project model.
- Самоссылки → error.
- Ссылки на несуществующий app_id → error.

### `<app>/build_config.yaml`

Каждое приложение может иметь файл `<app>/build_config.yaml` (C загружает автоматически).

**Формат**:

```yaml
build_config:
  <builder-specific-fields>      # content зависит от builder-а

build_env:
  <ENV_NAME>:                     # null → взять из ENV текущего процесса
  <ENV_NAME>: "literal value"     # или literal value
  <ENV_NAME>: "{{$ANOTHER_ENV}}"  # или interpolation
```

**Свойства**:
- `build_config` — конфигурация builder-а; формат зависит от конкретного builder-а (C не валидирует внутреннюю структуру; это делает builder).
- `build_env` — переменные окружения, передаваемые builder-у.

**ENV interpolation** (`{{$ENV}}`):
- Синтаксис `{{$ENV_NAME}}` означает «взять значение из ENV текущего процесса».
- **Все** переменные, обозначенные через `{{$...}}`, обязательны. Default values не поддерживаются.
- **Валидация наличия ENV** происходит **до** запуска builder-а (spec 012 определяет runtime-механику; этот spec определяет **модель**).

**openapi_entry**:
- `openapi_entry` — поле `build_config` приложения с NestJS-функцией (чтение builder-ом B).
- Это **не** конфигурация openapi-приложения; openapi-app в `build_config` имеет поле `apps`.
- Если не указан — C/B использует fallback chain (spec 006).

**Креденшалы**:
- Credentials **не** должны попадать в build config. CI/runtime environment отвечает за Docker/npm/cloud credentials (Constitution: «Секреты: не в build config»).

### `.ycsf/resources.yaml`

**Формат**:

```yaml
version: 1

queues:
  <resource_id>: {}

buckets:
  <resource_id>: {}

functions:
  <resource_id>: {}
```

**Ownership semantics** (Constitution VI):
- `apps` → **managed**: C генерирует Terraform resource через materializer.
- `resources` → **всегда external**: C **не генерирует** Terraform; только создаёт reference для использования другими ресурсами.

**Валидация**:
- Одна и та же logical identity не может быть одновременно в `apps.yaml` и `resources.yaml` → error на загрузке project model.
- `resources.yaml` **никогда** не является входом для materializer-ов.

### `version: 1`

Все `.ycsf/*.yaml` файлы **обязаны** иметь поле `version: 1`. Отсутствие или неверное значение → error на загрузке. Форматы версионируются по semver через контракты `@ycforge/pilot/contracts` (Constitution III).

---

## Scope Boundaries (Out of Scope)

| What | Why out of scope | Spec |
|------|------------------|------|
| Runtime `{{$ENV}}` interpolation | Spec 012 | build-env |
| Builders registry / loading | Spec 013 | builder-registry |
| Materializer dispatch / Terraform generation | Spec 014 | materializer-dispatch |
| Extensions, outputs, moved | Specs 015–017 | extensions/outputs/moved |
| Plugin contracts (Builder, Materializer, Artifact, etc.) | Already defined | Spec 002 (✅) |
| Terraform provisioning / deployment | Terraform's responsibility | Constitution I, IV |
| `ycsf check` validation layer | Depends on full model | Spec 020 |
| `ycsf build` / CLI commands | Orchestration layer | Spec 021 |

---

## User Scenarios & Testing

### User Story 1 — Load valid project model (Priority: P1)

Разработчик имеет проект с `apps.yaml`, несколькими приложениями и `resources.yaml`. При запуске `ycsf` (или любого инструмента, использующего Project C), модель загружается, валидируется и готова к использованию.

**Why this priority**: Это базовая функциональность; без неё невозможно ничего построить.

**Independent Test**: Создать минимальный проект с 2 apps + resources.yaml; загрузка проходит без ошибок; модель содержит корректные данные.

**Acceptance Scenarios**:

1. **Given** проект с корректным `.ycsf/apps.yaml` (3 apps, один с `depends_on`), **When** project model загружается, **Then** модель содержит 3 app-записи с правильными source_path, builder и dependencies.
2. **Given** проект с корректным `.ycsf/resources.yaml` (queues + buckets), **When** project model загружается, **Then** модель содержит ресурсы с правильными domain и name.
3. **Given** проект с `build_config.yaml` у одного из apps, **When** project model загружается, **Then** build_config и build_env корректно прочитаны.

---

### User Story 2 — Detect depends_on cycles (Priority: P1)

Разработчик ошибся в `depends_on` и создал цикл (A → B → C → A). Система должна сообщить об ошибке при загрузке модели, а не при попытке сборки.

**Why this priority**: Fail-fast критичен; невалидная модель не должна проходить дальше.

**Independent Test**: Создать apps.yaml с циклом; загрузка модели должна завершиться ошибкой с указанием involved apps.

**Acceptance Scenarios**:

1. **Given** `apps.yaml` с `A.depends_on: [B]`, `B.depends_on: [C]`, `C.depends_on: [A]`, **When** project model загружается, **Then** ошибка: cycle detected (A → B → C → A).
2. **Given** `apps.yaml` с `A.depends_on: [A]` (самоссылка), **When** project model загружается, **Then** ошибка: self-reference in depends_on for app A.
3. **Given** `apps.yaml` с `A.depends_on: [nonexistent]`, **When** project model загружается, **Then** ошибка: depends_on references unknown app 'nonexistent'.

---

### User Story 3 — Reject identity collision (Priority: P1)

Разработчик случайно указал один и тот же ID и в `apps.yaml`, и в `resources.yaml`. Система должна отказать в загрузке с чёткой диагностикой.

**Why this priority**: Constitution V требует fail-fast для коллизий; невыполнение = нарушение constitution.

**Independent Test**: Создать apps.yaml с `functions.my_func` и resources.yaml с `functions.my_func`; загрузка модели завершается ошибкой.

**Acceptance Scenarios**:

1. **Given** `apps.yaml` содержит app `my_func` (builder: nestjs-function) и `resources.yaml` содержит `functions.my_func`, **When** project model загружается, **Then** ошибка: identity 'functions.my_func' exists in both apps.yaml and resources.yaml.
2. **Given** `apps.yaml` содержит два apps с одинаковым app_id (дублирование ключа YAML), **When** YAML парсится, **Then** ошибка: duplicate app_id или последнее значение переопределяет (behavior зависит от YAML-парсера; spec требует.fail-fast при осознанном обнаружении).

---

### User Story 4 — Validate missing ENV variables (Priority: P2)

Разработчик указал `{{$MY_TOKEN}}` в `build_config.yaml`, но переменная не задана в окружении. Система должна сообщить об ошибке до запуска builder-а.

**Why this priority**: Отложенные ошибки builder-а сложнее отлаживать; проверка ENV — часть проектной модели.

**Independent Test**: Создать `build_config.yaml` с `{{$MISSING_VAR}}`, не задав переменную; загрузка модели завершается ошибкой с указанием имени переменной.

**Acceptance Scenarios**:

1. **Given** `build_config.yaml` с `build_config: { dockerfile: "{{$ANALYTICS_DOCKERFILE}}" }`, переменная не задана, **When** project model загружается, **Then** ошибка: required ENV 'ANALYTICS_DOCKERFILE' is not set.
2. **Given** `build_config.yaml` с `build_env: { NPM_TOKEN: "{{$NPM_TOKEN}}" }`, переменная задана, **When** project model загружается, **Then** ошибки нет; значение будет интерполировано позже (spec 012).

---

### User Story 5 — Load project without build_config (Priority: P2)

Разработчик имеет простой проект без `build_config.yaml` у некоторых apps. Система должна загрузить модель (app запись из `apps.yaml` достаточна); отсутствие `build_config.yaml` — не ошибка.

**Why this priority**: Не все apps требуют build_config (минимальный NestJS app может обойтись дефолтами builder-а).

**Independent Test**: Создать проект с одним app без `build_config.yaml`; загрузка модели успешна.

**Acceptance Scenarios**:

1. **Given** app `simple_app` в `apps.yaml` без соответствующего `build_config.yaml`, **When** project model загружается, **Then** модель загружена; build_config для этого app = пустой объект (или null).

---

### User Story 6 — Validate version field (Priority: P3)

Разработчик забыл `version: 1` в `apps.yaml` или указал неверную версию. Система должна сообщить об ошибке.

**Why this priority**: Version field — контрактная гарантия (Constitution III); его отсутствие нарушает версионирование.

**Independent Test**: Создать `apps.yaml` без `version`; загрузка завершается ошибкой.

**Acceptance Scenarios**:

1. **Given** `apps.yaml` без поля `version`, **When** project model загружается, **Then** ошибка: missing or invalid version field.
2. **Given** `apps.yaml` с `version: 2`, **When** project model загружается, **Then** ошибка: unsupported version '2' (supported: 1).

---

### Edge Cases

- Что происходит при пустом `apps.yaml` (0 apps)? → Загрузка успешна (пустая модель).
- Что если `depends_on` не указан ни у одного app? → Валидно; все apps независимы.
- Что если `source_path` указывает на несуществующий каталог? → Это проверяется позже (spec 020 `ycsf check`), не на этапе загрузки модели — модель описывает **желаемую** структуру.
- Что если `builder` содержит неизвестный идентификатор? → Допустимо на этапе загрузки модели; неизвестные builders детектируются в spec 013 (builder-registry).
- Что если `build_config.yaml` существует, но содержит только `build_env` без `build_config`? → Валидно; `build_config` = пустой объект.
- Что если `resources.yaml` пуст (без ресурсов)? → Валидно; модель загружена.

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST load `.ycsf/apps.yaml` и вернуть structured model с записями для каждого app (app_id, source_path, builder, depends_on).
- **FR-002**: System MUST load `.ycsf/resources.yaml` и вернуть structured model, сгруппированный по domain (queues, buckets, functions).
- **FR-003**: System MUST загружать `<app>/build_config.yaml` для каждого app; отсутствие файла — не ошибка (build_config = пустой объект).
- **FR-004**: System MUST валидировать `version: 1` во всех `.ycsf/*.yaml` файлах; неверная версия — error.
- **FR-005**: System MUST обнаруживать циклы в `depends_on` графе и выдавать error с указанием involved apps.
- **FR-006**: System MUST обнаруживать самоссылки в `depends_on` и выдавать error.
- **FR-007**: System MUST обнаруживать references на несуществующие apps в `depends_on` и выдавать error с именем отсутствующего app.
- **FR-008**: System MUST обнаруживать identity collision: один app_id в `apps.yaml` и одна logical identity в `resources.yaml` → error при загрузке модели.
- **FR-009**: System MUST извлекать все `{{$ENV}}` переменные из `build_config` и `build_env` в `build_config.yaml` и проверять их наличие в текущем окружении; отсутствующие обязательные переменные → error до запуска builder.
- **FR-010**: System MUST разрешать literal values и `{{$...}}` interpolation в `build_env` (spec 012 определяет runtime-механику; этот spec определяет **модель и валидацию**).
- **FR-011**: System MUST игнорировать builder-specific структуру `build_config` (C не валидирует внутренние поля; это ответственность builder-а, spec 018).
- **FR-012**: System MUST garantiría, что `apps.yaml` содержит только app id, source_path, builder и depends_on — никаких builder-specific полей в apps.yaml.
- **FR-013**: System MUST загружать `resources.yaml` как read-only reference list; `resources.yaml` никогда не является входом для materializer-ов (Constitution VI).
- **FR-014**: System MUST требовать поле `version` во всех `.ycsf/*.yaml` файлах; его отсутствие или неверное значение — error.
- **FR-015**: System MUST генерировать diagnostics с указанием: файл, app_id (или logical identity), конкретное поле, ошибка.

### Key Entities

- **App** (приложение): buildable source unit. Атрибуты: `app_id` (logical identity, стабильный), `source_path` (относительный путь), `builder` (identификатор), `depends_on` (список app_id). App может иметь `build_config.yaml` (опционально). App ≠ Resource.

- **Resource** (ресурс): logical external/infrastructure resource. Атрибуты: `domain` (queues/buckets/functions), `resource_id`, properties (пока пустые `{}`). Resource — всегда external, reference only (Constitution VI). Resource ≠ App.

- **ProjectModel** (проектная модель): результат загрузки и валидации всех `.ycsf/*.yaml` файлов. Содержит: `apps` (map app_id → App), `resources` (map domain → map resource_id → Resource), `build_configs` (map app_id → BuildConfig), `env_requirements` (set of required ENV names), `depends_on_graph` (validated directed graph).

- **BuildConfig** (конфигурация сборки): содержимое `<app>/build_config.yaml`. `build_config` (opaque object для builder-а) + `build_env` (map ENV_NAME → string|null). Нормализованная модель без interpolated values.

- **DependsOnGraph** (граф зависимостей): directed graph по `depends_on` полям apps. Должен быть acyclic (DAG). Валидация на cycles, self-references, dangling references.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Загрузка валидного проекта (5 apps, 3 resources, 10 ENV vars) завершается за < 500ms.
- **SC-002**: Цикл в `depends_on` обнаруживается при загрузке модели, а не при попытке сборки; diagnostic содержит имена всех involved apps.
- **SC-003**: Identity collision (app + resource с одинаковым ID) обнаруживается при загрузке модели с указанием конкретного ID.
- **SC-004**: Отсутствие обязательной ENV-переменной обнаруживается при загрузке модели; builder не запускается.
- **SC-005**: Проект с некорректным `version` (или отсутствующим) отклоняется на этапе загрузки модели.
- **SC-006**: 100% acceptance criteria spec 011 покрыты тестами (Constitution II).

---

## Assumptions

- YAML-парсер корректно обрабатывает `apps.yaml` с дублирующимися ключами (последнее значение переопределяет; spec рекомендует детектировать это как warning или error —取决于 implementation).
- `source_path` проверяется на существование каталога на более позднем этапе (spec 020 `ycsf check`), не при загрузке модели.
- `builder` value проверяется на известность в builder registry (spec 013), не при загрузке модели (layout-level validation).
- `build_config` content валидируется builder-ом, а не C (Constitution I: C не знает внутренних схем builder-ов).
- `resources.yaml` domains: минимальный набор `queues`, `buckets`, `functions` (расширение — spec 019).
- `version: 1` — единственный поддерживаемый на данный момент формат (Constitution III).

---

## References

- Spec 002: pilot-contracts — Builder/Materializer/Artifact/TerraformResource/ResourceReference/OutputBuilder
- IDEA.md §4: Организация проекта (repo layout)
- IDEA.md §5: `.ycsf/apps.yaml` (format, depends_on)
- IDEA.md §6: App-level `build_config.yaml` (build_config, build_env, ENV interpolation, openapi_entry)
- IDEA.md §17: `.ycsf/resources.yaml` (ownership semantics)
- Constitution I: Разделение ответственности A/B/C/Terraform
- Constitution III: Контракты версионируются (`version: 1`)
- Constitution V: Явное вместо магии (fail-fast)
- Constitution VI: Ownership: apps = managed, resources = external

---

## Next Steps

1. `/speckit.plan` — technical design: internal TypeScript interfaces, YAML schema definitions, depends_on graph algorithm (topological sort), diagnostic codes.
2. `/speckit.tasks` — breakdown into implementation tasks with test-first approach.
3. `/speckit.implement` — code, tests (RED → GREEN), lint, typecheck.
