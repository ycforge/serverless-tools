# Spec 012: build-env — `{{$ENV}}` интерполяция, `build_env`, ENV validation

## Metadata

- **Spec ID**: 012
- **Title**: Runtime ENV interpolation и `build_env` resolution (Project C)
- **Status**: 🚧 In Progress
- **Dependencies**: 011 (project-model, ✅)
- **IDEA.md sections**: §6 (App-level `build_config.yaml`, ENV interpolation), §19 (Interpolation namespaces)
- **Packages**: `packages/pilot` (`@ycforge/pilot`)

---

## Problem Statement

Spec 011 определил **модель** проекта: `loadProjectModel(rootDir)` загружает и валидирует `.ycsf/*.yaml`, извлекает все `{{$ENV}}` требования из `build_config` / `build_env` и проверяет их **наличие** в `process.env` на этапе загрузки (диагностика `PML_ENV_NOT_SET`). Однако **runtime-интерполяция** — замещение `{{$NAME}}` реальными значениями environment текущего процесса — намеренно отложена (специально deferred в spec 011, см. `env-requirements.ts` header и FR-010).

Между загрузкой проектной модели и вызовом builder-а (spec 002) существует пробел: pilot должен подготовить **реди стейт** для builder-а — разрешённый, интерполированный `build_env` (map `Record<string,string>`) и интерполированный `build_config`. Сейчас нет runtime-механики, которая:

1. заменяет `{{$NAME}}` на реальные значения `process.env.NAME` в `build_config` (строковые листья) и `build_env` (значения);
2. приминяет `null`-семантику `build_env` (не указано → взять из environment);
3. **валидирует** результат до запуска builder-а — ни один неразрешённый/неинтерполированный `{{$...}}` не должен дойти до builder-а; failure — fail-fast с диагностикой, явно идентифицирующей app / поле / переменную;
4. определяет **границу builder-контракта**: что именно pilot передаёт Builder plugin (spec 002) как materialized input для будущего spec 021 (`ycsf build`).

Это — чистый runtime-слой Project C (orchestration), отделённый от модели (011) и от builder execution / CI / Docker / npm credential handling (это ответственность builder-а и CI/runtime environment).

---

## Scope (In Scope)

### `{{$ENV}}` runtime-интерполяция

Заменить в `build_config` (все строковые листья, глубоко рекурсивно — как в `env-requirements.ts` `collectStringLeaves`) и в `build_env` значениях каждое вхождение `{{$NAME}}` на фактическое значение `process.env.NAME` на момент подготовки builder-окружения.

- Синтаксис — **только** `{{$NAME}}`, где `NAME` — `[A-Z0-9_]+` (IDEA §19); namespace не расширяется.
- Значение берётся **из environment текущего процесса** (IDEA §6: «взять значение из environment текущего процесса»).
- Замена — **после** load-time validation (spec 011). Load уже гарантировал наличие всех требований (`PML_ENV_NOT_SET`); runtime-prep дополнительно валидирует, что интерполяция действительно разрешима (например, переменная могла быть установлена пустой строкой — `PML_ENV_NOT_SET` трактует пустую строку как "not set", см. `env-requirements.ts` `isSet`).
- Строка может содержать несколько `{{$NAME}}` внутри одной строки (например, `"https://{{$REGISTRY}}/{{$REPO}}"`); каждый заменяется.
- Строка без `{{$...}}` остаётся как есть (literal).
- **Запрещено**: default values, частичная интерполяция с сохранившимся `{{$...}}`, silent fallback.

### `build_env` resolution

Для каждой записи `build_env` (map `ENV_NAME → string | null`, как в контракте `BuildConfig` spec 011) произвести эффективную env-map, передаваемую builder-у (spec 002 `BuildContext.buildEnv`, тип `Record<string,string>`):

| `build_env` значение | Поведение при resolution |
|----------------------|--------------------------|
| `null` | Взять значение из `process.env` (то же имя). Если отсутствует — fail-fast (это requirement, см. ниже). |
| literal string (без `{{$...}}`) | Передать как есть. |
| string, содержащий `{{$NAME}}` | Интерполировать из `process.env`; `null` не допускается на выходе. |

**Результат** — типизированное resolved build env per app: значения только строковые (без `null`), стабильная структура для передачи builder-у.

### ENV validation перед запуском builder-а

- Load-time (011) уже проверяет **наличие** требований (`PML_ENV_NOT_SET`); runtime-prep НЕ дублирует проверку наличия как таковую, но выполняет **resolved/interpolated** pass: гарантирует, что:
  1. каждая `{{$...}}` интерполируется до полного замещения (нет остаточного `{{$` после resolution);
  2. каждая `null` `build_env` запись разрешается в непустую строку из environment.
- Любая неудача — fail-fast **до** builder-а, с диагностикой, явно идентифицирующей: **app** (app_id), **поле** (build_config / build_env / конкретный `ENV_NAME`), **переменную** (имя `{{$NAME}}`). Формат диагностики согласован с `ProjectModelDiagnostic` (spec 011: файл/app/field/message).

### Builder boundary contract

Определить, что pilot передаёт Builder plugin (spec 002) как вход для build-инвокации spec 021 (`ycsf build`):

- **`buildEnv`** — resolved, интерполированный, `Record<string,string>` (тип уже существует в `BuildContext`, см. `contracts/builder.ts` `BuildContext.buildEnv`). **Не** менять `BuildContext` — маппинг `ResolvedBuildEnv → buildEnv` происходит при подготовке контекста.
- **`buildConfig`** — интерполированная версия `build_config` (все `{{$NAME}}` замещены); остаётся opaque для C (контракт builder-а: C не валидирует внутреннюю структуру, FR-011).

Это — materialized input для spec 021. **Не** изобретать новый builder API: переиспользовать существующие shapes из `contracts/builder.ts`.

### Scope boundaries (Out of Scope)

| What | Why out of scope | Owner |
|------|------------------|-------|
| Builder execution / build orchestration | Spec 021 | `ycsf build` |
| CI / Docker / npm credential handling | Builder's job / CI environment (Constitution I: C не знает внутренние схемы builders) | Builder |
| Default values для `{{$ENV}}` | Constitution V: все `{{$ENV}}` обязательны | — |
| `${resources...}` multi-document / logical template interpolation | B → Materializer territory (spec 009/014) | spec 009/014 |
| `${...}` Terraform interpolation | Terraform namespace (IDEA §19) | Terraform |
| `.env` file loading | Implicit env source forbidden (Constitution V) | — |
| Load-time ENV presence validation (дедупликация `PML_ENV_NOT_SET`) | Уже в 011 | spec 011 |

### Interpolation namespace boundary (обязательно к документированию)

IDEA §19 фиксирует **три разных namespace**:

| Namespace | Синтаксис | Где | Кто интерполирует |
|-----------|-----------|-----|-------------------|
| **serverless-tools build ENV** | `{{$ENV_NAME}}` | `build_config` / `build_env` | **C (этот spec)** |
| Terraform | `${...}` | user `.tf` / generated `.tf.json` | Terraform |
| API Gateway variables | `${var.foo}` | OpenAPI / tftpl | API Gateway / Terraform |
| Logical template (B → Materializer) | `${resources.domain.name.prop}` | B-generated templates | B → Materializer (spec 009/014) |

Этот spec интерполирует **только** `{{$ENV_NAME}}`. `${...}` и `${resources...}` **не являются** этим namespace и не трогаются здесь: предотвращение cross-namespace ошибок (например, C не должен случайно обработать `${resources...}` как env-ссылку, а `terraform validate` / materializer отвечают за свои namespace).

---

## User Scenarios & Testing

### User Story 1 — Interpolate `{{$ENV}}` in build_config (Priority: P1)

Разработчик задал в `build_config.yaml` app `analytics` builder-параметры, использующие environment:

```yaml
build_config:
  image:
    repository: "cr.yandex/ya_mob_ya_lublu_yandex"
    tag: "{{$ANALYTICS_IMAGE_TAG}}"
  dockerfile: "{{$ANALYTICS_DOCKERFILE}}"
```

При подготовке builder-окружения (после загрузки модели) pilot заменяет `{{$ANALYTICS_IMAGE_TAG}}` на `process.env.ANALYTICS_IMAGE_TAG` и `{{$ANALYTICS_DOCKERFILE}}` на `process.env.ANALYTICS_DOCKERFILE`. Builder получает интерполированный `build_config` — без остаточных `{{$...}}`.

**Why this priority**: Это базовая runtime-функциональность; без интерполяции builder получает сырые ссылки и не может собрать app. Наблюдаемый результат: `buildConfig` переданный builder-у содержит фактические значения, а не `{{$...}}`.

**Independent Test**: Вызвать runtime-prep для app `analytics` с заданными env; проверить, что в интерполированном `build_config` значения `image.tag` и `dockerfile` заменены реальными значениями environment.

**Acceptance Scenarios**:

1. **Given** `build_config.yaml` с `build_config: { tag: "{{$ANALYTICS_IMAGE_TAG}}" }` и `process.env.ANALYTICS_IMAGE_TAG = "v2"`, **When** выполняется runtime-интерполяция для app `analytics`, **Then** интерполированный `build_config.tag === "v2"` и не содержит остаточных `{{$ANALYTICS_IMAGE_TAG}}`.
2. **Given** строка с несколькими ссылками `"https://{{$REG}}/{{$REPO}}"` и `REG=foo`, `REPO=bar`, **When** выполняется интерполяция, **Then** результат `"https://foo/bar"` (обе ссылки замещены).
3. **Given** literal строка `"привет, мир!"` без `{{$...}}`, **When** выполняется интерполяция, **Then** результат идентичен исходному (literal не меняется).

---

### User Story 2 — Resolve `build_env` (literal + null + interpolated) (Priority: P1)

Разработчик задал `build_env` с тремя видами записей:

```yaml
build_env:
  NPM_TOKEN:                       # null → взять из process.env.NPM_TOKEN
  HELLO_TEXT: "привет, мир!"       # literal
  REGISTRY: "{{$DOCKER_REGISTRY}}" # interpolation
```

pilot разрешает эти три записи и передаёт builder-у (spec 002) resolved `buildEnv` как `Record<string,string>`: `NPM_TOKEN` ← `process.env.NPM_TOKEN`, `HELLO_TEXT` = `"привет, мир!"`, `REGISTRY` = `process.env.DOCKER_REGISTRY`.

**Why this priority**: `build_env` — основной механизм передачи build-параметров builder-у; все три режима обязаны работать, и результат стабильно типизирован.

**Independent Test**: Вызвать runtime-prep для app с такой `build_env`; проверить эффективную env-map.

**Acceptance Scenarios**:

1. **Given** `build_env: { NPM_TOKEN: null, HELLO_TEXT: "привет, мир!", REGISTRY: "{{$DOCKER_REGISTRY}}" }` и `process.env` содержит `NPM_TOKEN` и `DOCKER_REGISTRY`, **When** выполняется resolution для app, **Then** resolved `buildEnv = { NPM_TOKEN: <value>, HELLO_TEXT: "привет, мир!", REGISTRY: <value> }` — все значения строковые, `null` отсутствует.
2. **Given** `build_env: { NPM_TOKEN: null }` и `process.env.NPM_TOKEN` отсутствует (или пустая строка), **When** выполняется resolution для app, **Then** fail-fast: диагностика идентифицирует app, поле `build_env`, переменную `NPM_TOKEN`; builder не вызывается.
3. **Given** `build_env: { REGISTRY: "{{$UNDEFINED_VAR}}" }` и `process.env.UNDEFINED_VAR` отсутствует, **When** выполняется resolution, **Then** fail-fast: диагностика идентифицирует app, поле, переменную; builder не вызывается.

---

### User Story 3 — Fail-fast на неразрешённой переменной ДО builder-а (Priority: P1)

Разработчик указал `{{$MY_TOKEN}}` в `build_config.yaml`, но переменная не задана в окружении. Модель (011) уже могла бы выдать `PML_ENV_NOT_SET` на load; однако нагрузка могла пройти с `isSet:true` (переменная есть), а runtime-prep должен гарантировать, что неразрешённая/неинтерполированная ссылка **никогда не достигнет builder-а**. Это второй защитный слой (runtime validation belongs to runtime prep).

**Why this priority**: Constitution V (explicit > magic); fail-fast на неразрешённом ENV до builder-а — прямое требование. Отложенные ошибки builder-а сложнее отлаживать.

**Independent Test**: Вызвать runtime-prep с неразрешённой `{{$...}}` в любом окружении; убедиться, что builder НЕ вызывается, и выдана диагностика с app/field/var.

**Acceptance Scenarios**:

1. **Given** `build_config: { dockerfile: "{{$ANALYTICS_DOCKERFILE}}" }` и `process.env.ANALYTICS_DOCKERFILE` отсутствует (пустая строка), **When** выполняется runtime-интерполяция, **Then** fail-fast: диагностика идентифицирует app, поле `build_config`, переменную `ANALYTICS_DOCKERFILE`; остаточный `{{$ANALYTICS_DOCKERFILE}}` никуда не передаётся.
2. **Given** `build_env: { REGISTRY: "{{$UNDEFINED}}" }` и `process.env.UNDEFINED` отсутствует, **When** выполняется resolution, **Then** fail-fast: диагностика идентифицирует app, поле `build_env`, переменную `UNDEFINED`.
3. **Given** `null` `build_env` запись `KEY:` и `process.env.KEY` отсутствует, **When** выполняется resolution, **Then** fail-fast: диагностика идентифицирует app, поле, переменную `KEY`.

---

### User Story 4 — No surprises: `.env` files NOT loaded, no implicit env sources (Priority: P2)

Разработчик использует `{{$ENV}}` и ожидает значения исключительно из environment текущего процесса. Система **не** загружает `.env` файлы и **не** внедряет никаких неявных источников env — values берутся строго из `process.env` на момент runtime-prep (после load-time validation).

**Why this priority**: Constitution V (explicit over magic); предсказуемость источника env критична для воспроизводимости сборок.

**Independent Test**: Вызвать runtime-prep с env, заданным только в `process.env`; убедиться, что результат использует `process.env`, а не `.env`/прочие источники.

**Acceptance Scenarios**:

1. **Given** проект с `.env` файлом, содержащим `FOO=bar`, но `process.env.FOO` не задан, **When** выполняется runtime-prep с `{{$FOO}}`, **Then** fail-fast (значение из `.env` НЕ подставляется, `.env` не читается). *Если `.env` — фиктивный и не является контрактной частью — это assumption, см. Assumptions.*
2. **Given** `{{$FOO}}` и `process.env.FOO` задан, **When** выполняется runtime-prep, **Then** результат использует только `process.env.FOO`.

---

### Edge Cases

- **Строка со смешанным содержимым**: `"prefix-{{$A}}-suffix"` — интерполируется полностью; `A` обязателен.
- **Несколько ссылок в одной строке**: все заменяются (US-1 AC2).
- **`build_env` запись literal string без `{{$...}}`**: остаётся как есть — не трактуется ни как требование, ни как интерполяция.
- **`build_env` запись `null`**: строгое требование — резолвится из `process.env`; отсутствие → fail-fast.
- **Пустой `build_config` / пустой `build_env`**: отсутствие entries → тривиально пустой resolved env; не ошибка.
- **Переменная установлена пустой строкой `""`**: трактуется как «не задана» (согласовано с `env-requirements.ts` `isSet`) → fail-fast.
- **Cross-namespace**: строка, содержащая `${resources...}` или `${...}`, НЕ обрабатывается этим spec (оставляется builder-у/materializer/Terraform). Этот spec интерполирует ТОЛЬКО `{{$NAME}}`.
- **Нет app**: runtime-prep без apps → пустой результат, не ошибка.
- **Duplicate `{{$NAME}}` внутри одной строки**: повторно заменяется одним значением из environment.

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST интерполировать все `{{$NAME}}` в `build_config` (строковые листья, глубоко рекурсивно, как `env-requirements.ts` `collectStringLeaves`) значениями из `process.env` на момент runtime-prep; `NAME` — `[A-Z0-9_]+`.
- **FR-002**: System MUST интерполировать все `{{$NAME}}` в значениях `build_env` значениями из `process.env`.
- **FR-003**: System MUST интерполировать ноль или более вхождений `{{$NAME}}` в пределах одной строки; строка без `{{$...}}` остаётся literal.
- **FR-004**: System MUST резолвить `null` запись `build_env` из `process.env` с тем же именем; результат — строка.
- **FR-005**: System MUST резолвить literal-запись `build_env` (без `{{$...}}`) как есть, без изменений.
- **FR-006**: System MUST возвращать resolved `buildEnv` как `Record<string,string>` (без `null`), согласованный с `BuildContext.buildEnv` (spec 002).
- **FR-007**: System MUST перед запуском builder-а fail-fast при: (а) остаточном `{{$` в интерполированном `build_config` или `build_env`-результате; (б) `null`/пустой-строке `build_env` записи, неразрешённой из `process.env`. Никакое неразрешённое/`null` значение не может быть передано builder-у.
- **FR-008**: System MUST выдавать диагностику fail-fast, явно идентифицирующую: `app` (app_id), `field` (build_config/build_env/конкретный ENV_NAME) и `var` (имя `{{$NAME}}`); диагностика формой согласована с `ProjectModelDiagnostic` и использует machine-readable код **`PML_ENV_UNRESOLVED`** (новый код в каталоге `contracts/project-model.json`, рядом с load-time `PML_ENV_NOT_SET`). Решение принято по clarify: load-фаза (`PML_ENV_NOT_SET`) и runtime-prep фаза (`PML_ENV_UNRESOLVED`) остаются различимы для spec 020/021, изменение аддитивно (semver-compatible, Constitution III).
- **FR-009**: System MUST передавать builder-у (spec 002) интерполированный `build_config` и resolved `buildEnv` без изобретения нового Builder API — переиспользовать `BuildContext` shapes.
- **FR-010**: System MUST интерполировать ТОЛЬКО `{{$NAME}}` namespace; `${...}` (Terraform) и `${resources...}` (B→Materializer) НЕ обрабатываются этим spec и остаются нетронутыми (IDEA §19).
- **FR-011**: System MUST выполнять runtime-interpolation/resolution **после** load-time validation (spec 011); load гарантировал наличие требований (`PML_ENV_NOT_SET`), runtime-prep — resolved pass.
- **FR-012**: System MUST NOT загружать `.env` файлы или использовать иные implicit env источники; значения берутся строго из `process.env` на момент runtime-prep (Constitution V).
- **FR-013**: System MUST NOT подставлять default values для `{{$NAME}}`; каждая ссылка обязательна и должна разрешиться (Constitution V).
- **FR-014**: System MUST поддерживать per-app resolution: resolved build env и интерполированный build_config вычисляются отдельно для каждого app (на основе его `BuildConfig`).
- **FR-015**: System MUST обрабатывать пустые `build_config`/`build_env` как тривиально пустой resolved env (не ошибка).

### Key Entities

- **EnvValue**: стабильная типизированная интерпретация одной записи `build_env`: либо `{kind:'null'}` (взять из `process.env`), либо `{kind:'literal', value:string}` (без `{{$...}}`), либо `{kind:'interpolated', refs:string[], ...}` (содержит `{{$NAME}}`). Производное от контракта `BuildConfig.build_env` (spec 011) на runtime-prep стадии.

- **BuildEnvResolutionResult**: результат resolution `build_env` для одного app. Содержит: `resolvedEnv: Record<string,string>` (строковые значения, без `null`), `buildConfig: unknown` (интерполированный `build_config`, opaque), и при неудаче — `errors: ProjectModelDiagnostic[]`. Инвариант: либо полностью успешный resolved env+config, либо fail-fast ошибки; никогда смешанного состояния.

- **ResolvedBuildEnv**: эффективная env-мапа, фактически передаваемая builder-у (spec 002 `BuildContext.buildEnv`). Согласована с `BuildContext` — новый API не изобретается, это materialized input для spec 021.

- **Interpolation**: операция замещения `{{$NAME}}` → `process.env.NAME` на момент runtime-prep, namespace `{{$NAME}}` только (IDEA §19). Выполняется над `build_config` (строковые листья) и `build_env` (значения) после load-time validation.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% acceptance criteria spec 012 покрыты тестами (Constitution II); каждый AC → ≥1 тест (RED → GREEN).
- **SC-002**: Интерполяция детерминирована: одинаковые inputs (ProjectModel + snapshot `process.env`) → бинарно идентичный resolved env + интерполированный build_config.
- **SC-003**: Неразрешённая `{{$...}}` / `null` / пустая-строка переменная всегда вызывает fail-fast с диагностикой (app/field/var) до builder-а; builder никогда не получает неразрешённую ссылку.
- **SC-004**: Runtime-prep не оставляет ни одного `{{$` в переданном builder-у `build_config` или `buildEnv`.
- **SC-005**: Per-app resolution для типичного проекта (5 apps, ~10 ENV) выполняется за < 50ms (добавка к load, spec 011 SC-001).
- **SC-006**: Нарушение namespace (попытка интерполяции `${...}`/`${resources...}` как env) документировано и не выполняется этим spec (fail-fast в смысле «не мой namespace» не требуется; но никакого пересечения/обработки).

---

## Assumptions

- **Snapshot `process.env`**: значения берутся один раз на момент runtime-prep (после load-time validation). Изменения `process.env` внутри runtime-prep не отслеживаются.
- **`.env` files**: не читаются; значения строго из `process.env` (Constitution V). Если нужна поддержка `.env` — это отдельная фича, не в этом spec.
- **No default values**: каждая `{{$NAME}}` обязательна; default не поддерживается (Constitution V, IDEA §6).
- **Runtime-prep вызывается per app** перед каждой build-инвокацией; результат не кэшируется между инвокациями, но детерминирован для snapshot.
- **`BuildContext` (spec 002)** остаётся стабильным контрактом; этот spec маппит `ResolvedBuildEnv`/интерполированный build_config в него при подготовке, не меняя сам контракт.
- **CX-namespace**: `${...}` (Terraform) и `${resources...}` (B→Materializer, spec 009/014) — не этот namespace; ответственность соответствующих слоёв (IDEA §19).
- **Секреты**: credentials не попадают ни в build_config, ни в репозиторий; runtime handling — Lockbox/extensions-паттерн (Constitution: «Секреты: не в build config»). Этот spec интерполирует только существующие ENV, не вносит секреты в build config.

---

## References

- Spec 011: project-model — модель проекта, `BuildConfig`, `EnvRequirement`, load-time validation (`PML_ENV_NOT_SET`)
- Spec 002: pilot-contracts — `Builder`, `BuildContext` (buildConfig, buildEnv)
- Spec 009: resource-references — `${resources...}` logical template namespace (B → Materializer)
- IDEA.md §6: ENV interpolation (`{{$ENV_NAME}}`, обязательность, отсутствие default, время взятия)
- IDEA.md §19: Interpolation namespaces (boundary документ)
- Constitution I: Separation A/B/C/Terraform (чистый C runtime-prep)
- Constitution III: Контракты версионируются (`version: 1` не меняется; additive runtime API)
- Constitution V: Явное вместо магии (fail-fast, no `.env`, no implicit env, no defaults)

---

## Next Steps

1. `/speckit.plan` — technical design: internal TS interfaces (EnvValue, BuildEnvResolutionResult, ResolvedBuildEnv), interpolation algorithm (recursive `collectStringLeaves` + replace), runtime-prep entry, error codes (согласованы с `project-model.json`), контракт для spec 021.
2. `/speckit.tasks` — breakdown с test-first (RED → GREEN).
3. `/speckit.implement` — код, тесты, lint, typecheck.

---

## Status line (roadmap)

**Dependencies**: 011.
