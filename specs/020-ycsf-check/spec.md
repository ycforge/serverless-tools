# Spec 020: ycsf-check — ycsf check validation layer

## Metadata

- **Spec ID**: 020
- **Title**: ycsf-check — ycsf check validation layer
- **Status**: 🚧 In Progress
- **Dependencies**: 011 (project-model ✅), 014 (materializer-dispatch ✅), 015 (extensions ✅), 016 (outputs ✅), 017 (moved ✅)
- **IDEA.md sections**: §28 (`ycsf check`)
- **Packages**: `packages/pilot` (`@ycforge/pilot`)

---

## Problem Statement

Спецификации 011–017 реализовали validations по модулям: project model (011), ENV requirements (011/012), builder registry (013), materializer dispatch (014), extensions (015), outputs (016), moves (017). Каждый модуль проверяет собственные контракты, но **нет единой точки входа**, которая выполняет **все** проверки консистентности проекта C перед запуском Terraform.

§28 IDEA.md определяет `ycsf check` — lightweight validation layer, который:

1. Проверяет override targets из `extensions.yaml` на существование в generated model (новая проверка).
2. Проверяет template variables — все `{{$ENV}}` в build_config/build_env имеют разрешение (переиспользует 011/012).
3. Проверяет build ENV — все обязательные `{{$ENV}}` установлены (переиспользует 011/012).
4. Проверяет resource consistency — логические ссылки из `resources.yaml` согласованы с generated Terraform addresses (новая проверка).
5. Проверяет extensions — target существует, нет дублей, patch не содержит `{{$ENV}}` (переиспользует 015 + новая проверка ENV в patch).
6. Может вызывать `terraform validate` как финальный шаг (Constitution IV,§28).

Spec 020 определяет consolidated `ycsf check` layer, который **_REUSE_** существующие валидации и **добавляет** недостающие проверки.

---

## Scope (In Scope)

### Категории проверок (check categories)

| # | Category | Новая / Reuse | Источник |
|---|----------|---------------|----------|
| C1 | Override targets (extensions target → generated resource existence) | Новая | IDEA §28 |
| C2 | Template variables (`{{$ENV}}` в build_config/build_env разрешены) | Reuse | 011/012 |
| C3 | Build ENV (все обязательные `{{$ENV}}` установлены) | Reuse | 011/012 |
| C4 | Resource consistency (resources.yaml refs → generated TF addresses) | Новая | IDEA §28 |
| C5 | Extensions: target exists in generated model (IDL) | Reuse | 015 |
| C6 | Extensions: no duplicate targets | Reuse | 015 |
| C7 | Extensions: `{{$ENV}}` не допускается в patch | Новая | IDEA §28 |
| C8 | Extensions: patch is a plain object | Reuse | 015 |
| C9 | Outputs: name/idl validation | Reuse | 016 |
| C10 | Moves: structural validation | Reuse | 017 |
| C11 | Builder registry: all builders known | Reuse | 013 |
| C12 | Project model structural validation | Reuse | 011 |
| C13 | `terraform validate` (optional final step) | Новая | IDEA §28, Constitution IV |

### Зафиксированные решения (spec decisions)

**D-1 — Diagnostic family: `YCK_*`.** Все diagnostics, специфичные для `ycsf check`, используют префикс `YCK_` (Yandex Check). Это единый family для diagnostics, генерируемых check-слоем. diagnostics, переиспользуемые из других модулей (PML_*, EXT_*, OUT_*, MOV_*, MTL_*, BRG_*), сохраняют свои исходные коды — `ycsf check` агрегирует, не переименовывает.

Рациональность:
- Другие модули имеют свои family: `PML_*` (project model), `EXT_*` (extensions), `OUT_*` (outputs), `MOV_*` (moves), `MTL_*` (materializers), `BRG_*` (builder registry).
- `ycsf check` — это aggregation point. Диагностики, специфичные для check (ENV в patch, ref→TF address), получают собственный префикс.
- Переиспользуемые diagnostics сохраняют оригинальные коды для совместимости с consumers (CLI выводит код, не переключает family).

**D-2 — Pipeline position: после materialization, до terraform.** `ycsf check` требует generated Terraform resources (`.ycsf.tf.json`), поэтому выполняется **после** dispatch/materialization (spec 014) и **перед** `terraform plan/validate/apply` (spec 021). Это minimum viable context: check имеет и project model, и generated resources, но не требует deployed infrastructure.

Рациональность:
- Override targets и resource consistency требуют generated resources → check НЕ может работать на этапе model load (до materialization).
- `ycsf check` — lightweight, не требует полного terraform state.
- CLI: `ycsf check` вызывается отдельно или как step в pipeline (spec 021).

**D-3 — Exit code semantics: 0 = clean, 1 = any diagnostics.** `ycsf check` возвращает exit code 0 только при полном отсутствии diagnostics (включая reuse-диагностики из других модулей). Exit code 1 при наличии хотя бы одной ошибки. Нет разделения warnings/errors — все diagnostics are errors (как в существующих модулях, Constitution V: fail-fast).

Рациональность:
- Существующие модули (011–017) не имеют концепции warnings. Консистентность: check тоже не вводит.
- CLI consumers (CI, pipelines) получают binary pass/fail.
- Подробности — в structured output (JSON diagnostics).

**D-4 — Check aggregation: collect-all, не abort-on-first.** `ycsf check` проходит **все** категории проверок и собирает **все** diagnostics (как в applyExtensions spec 015, collect-all pattern). Отсутствие ошибок в одной категории не останавливает проверку другой. Это maximum information для разработчика за один запуск.

Рациональность:
- User benefit: один запуск показывает все проблемы, не только первую.
- Performance: overhead минимальный (check — lightweight, parsers не выполняются повторно).
- Аналогия: `applyExtensions` (015) и `buildOutputs` (016) используют collect-all.

**D-5 — «Generated resource» определение.** Generated resource — это `TerraformResource` в списке, полученном из dispatch (spec 014), или прочитанный из serialized `.ycsf.tf.json` файла. «Existence» означает presence в этом списке/файле по `type.name` (TF address) или по IDL (`domain.name`, через `idlFor()` spec 015).这两种 representation are equivalent for IDL-addressable resources.

Рациональность:
- IDL (`domain.name`) используется extensions (015) и outputs (016).
- TF address (`type.name`) используется moves (017) и Terraform.
- Check operating on the same abstraction as each consumer ensures no false positives.

**D-6 — CLI surface: `ycsf check [rootDir]`.** `ycsf check` принимает опциональный `rootDir` (default: cwd). Параметр `--validate-tf` (boolean, default: false) — запуск `terraform validate` как финальный шаг. Это отдельная опция, не часть базовых проверок, чтобы check оставался lightweight (terraform validate требует `terraform init`).

Рациональность:
- Constitution IV: Terraform остаётся настоящим Terraform; `ycsf check` не моделирует provider schema.
- `terraform validate` — optional enhancement, не requirement для check.
- `rootDir` defaulting to cwd — конвенция CLI tools; не требует явного указания для типичного usage.

### Scope boundaries (Out of Scope)

| Что | Почему не в scope | Owner |
|-----|-------------------|-------|
| Terraform provider schema validation | Constitution IV: C не моделирует provider schema. Глубокая валидация — `terraform validate`. | Terraform |
| Terraform state validation | State — deployed infrastructure, не generated contracts. | Spec 029 |
| Yandex API validation | C не знает Yandex API напрямую (Constitution I). | Terraform / Provider |
| Builder logic validation | Builder валидирует свой `build_config` internals (spec 018). Check не дублирует. | Builders (spec 018) |
| Builder artifact content validation | Artifact content validated by materializer (spec 014). Check validates project contracts, not artifact bytes. | Spec 014/019 |
| Auto-discovery of builders/materializers | Explicit mapping (Constitution V, spec 013). No discovery validation needed. | Spec 013 |
| Auth configuration validation | Project B scope (spec 007). Check validates C contracts only. | Spec 007 |
| OpenAPI spec validation | Project B scope (spec 006/008). | Spec 008 |

---

## User Scenarios & Testing

### User Story 1 — DevOps проверяет override targets extensions (Priority: P1)

DevOps добавляет extension для override сгенерированного ресурса: `functions.user_service` с patch `{ runtime: "python312" }`. `ycsf check` проверяет, что ресурс `functions.user_service` (IDL) существует в generated model. Если ресурс не найден — ошибка `YCK_MISSING_TARGET`.

**Why this priority**: Прямая из IDEA §28, первая listed check. Pre-specified extensions на несуществующий ресурс — silent failure при `terraform apply`; check обнаруживает до deploy.

**Independent Test**: Создать fixture: generated resources = `[yandex_function { name: 'analytics' }]`, extensions = `[{ target: 'functions.user_service', patch: {} }]`. Запустить check. Ожидать `YCK_MISSING_TARGET` с availableIdls = `['functions.analytics']`.

**Acceptance Scenarios**:

1. **Given** generated resources содержат `yandex_function.user_service` и `yandex_api_gateway.main`, **When** extensions.yaml содержит rule `{ target: 'functions.user_service', patch: { runtime: 'python312' } }`, **Then** check проходит без `YCK_MISSING_TARGET` для этого target.
2. **Given** generated resources содержат только `yandex_function.analytics`, **When** extensions.yaml содержит rule `{ target: 'functions.user_service', patch: {} }`, **Then** check возвращает `YCK_MISSING_TARGET` с target `functions.user_service` и available IDLs: `['functions.analytics']`.
3. **Given** extensions.yaml содержит rule с target `functions.user_service` и rule с `gateways.main`, **When** оба resources присутствуют в generated model, **Then** check проходит без ошибок target для обоих rules.

---

### User Story 2 — DevOps проверяет ENV в extensions patch (Priority: P1)

DevOps добавляет extension, который случайно использует `{{$API_KEY}}` в patch. `ycsf check` обнаруживает, что patch содержит `{{$ENV}}` reference, и возвращает ошибку `YCK_ENV_IN_PATCH`. Extensions должны содержать Terraform expressions, не build env variables.

**Why this priority**: Common mistake с real consequences — build env variable попадает в Terraform config и ломает plan/apply. IDEA §28 explicitly requires this check.

**Independent Test**: Создать fixture: extensions = `[{ target: 'functions.user_service', patch: { environment: { API_KEY: '{{$API_KEY}}' } }] }`. Запустить check. Ожидать `YCK_ENV_IN_PATCH` с target `functions.user_service`.

**Acceptance Scenarios**:

1. **Given** extensions.yaml rule `{ target: 'functions.user_service', patch: { environment: { API_KEY: '{{$API_KEY}}' } } }`, **When** check выполняется, **Then** возвращается `YCK_ENV_IN_PATCH` для target `functions.user_service`.
2. **Given** extensions.yaml rule `{ target: 'functions.user_service', patch: { runtime: 'python312', memory: 128 } }` (plain Terraform values, без `{{$...}}`), **When** check выполняется, **Then** нет `YCK_ENV_IN_PATCH` для этого target.
3. **Given** extensions.yaml содержит 3 rules, 1 из которых имеет `{{$ENV}}` в patch (nested depth 2), **When** check выполняется, **Then** возвращается ровно 1 `YCK_ENV_IN_PATCH` (collect-all для других categories, но только 1 для ENV).

---

### User Story 3 — DevOps проверяет template variables (Priority: P1)

DevOps запускает `ycsf check` и видит, что все `{{$ENV}}` references в build_config и build_env разрешены. Если какой-либо `{{$NAME}}` не установлен в process.env — ошибка `PML_ENV_NOT_SET` (переиспользуется из 011).

**Why this priority**: §28 explicitly requires build ENV check. Reuse существующей логики (011/012) через check layer.

**Independent Test**: Создать fixture: app `user_service` с build_env `{ API_KEY: null }`, `process.env` не содержит `API_KEY`. Запустить check. Ожидать `PML_ENV_NOT_SET` для `API_KEY`.

**Acceptance Scenarios**:

1. **Given** app `user_service` с `build_env: { API_KEY: null }` и `process.env.API_KEY` установлен, **When** check выполняется, **Then** нет `PML_ENV_NOT_SET` для `API_KEY`.
2. **Given** app `user_service` с `build_env: { API_KEY: null }` и `process.env.API_KEY` НЕ установлен, **When** check выполняется, **Then** возвращается `PML_ENV_NOT_SET` с app `user_service` и field `API_KEY`.
3. **Given** app `analytics` с `build_config: { entry: '{{$ENTRY_POINT}}' }` и `process.env.ENTRY_POINT` не установлен, **When** check выполняется, **Then** возвращается `PML_ENV_NOT_SET` для `ENTRY_POINT`.

---

### User Story 4 — DevOps проверяет resource consistency (Priority: P2)

DevOps добавляет в `resources.yaml` external resource `functions.external_svc`, который используется в outputs.yaml. `ycsf check` проверяет, что generated model содержит corresponding Terraform resource. Если external resource не имеет generated TF counterpart — ошибка `YCK_REF_UNRESOLVED`.

**Why this priority**: §28 requires resource consistency. Disagreement between resources.yaml and generated TF resources indicates misconfiguration.

**Independent Test**: Создать fixture: resources = `{ functions: { external_svc: {} } }`, generated resources = `[yandex_function { name: 'user_service' }]` (no `external_svc`). Запустить check. Ожидать `YCK_REF_UNRESOLVED`.

**Acceptance Scenarios**:

1. **Given** resources.yaml содержит `functions.external_svc` и generated resources содержит `yandex_function.external_svc`, **When** check выполняется, **Then** нет `YCK_REF_UNRESOLVED` для `functions.external_svc`.
2. **Given** resources.yaml содержит `functions.external_svc` и generated resources НЕ содержит `yandex_function.external_svc`, **When** check выполняется, **Then** возвращается `YCK_REF_UNRESOLVED` для `functions.external_svc`.
3. **Given** resources.yaml пуст (нет entries), **When** check выполняется, **Then** нет `YCK_REF_UNRESOLVED` (nothing to check).

---

### User Story 5 — DevOps запускает полный check (Priority: P1)

DevOps запускает `ycsf check` и получает unified diagnostics report со всеми ошибками из всех categories. Если все checks прошли — exit code 0. Если есть хотя бы одна ошибка — exit code 1 + полный список diagnostics.

**Why this priority**: Primary user-facing scenario. Aggregation is the core value proposition of `ycsf check`.

**Independent Test**: Создать fixture: project model с 2 apps, extensions с 1 error, outputs с 1 error. Запустить check. Ожидать exit code 1 + 2 diagnostics (один EXT_*, один OUT_*).

**Acceptance Scenarios**:

1. **Given** project без errors (all contracts valid), **When** `ycsf check` выполняется, **Then** exit code = 0, diagnostics list пуст.
2. **Given** project с extensions error (`EXT_UNRESOLVED_TARGET`) и model error (`PML_ENV_NOT_SET`), **When** `ycsf check` выполняется, **Then** exit code = 1, diagnostics содержит оба errors.
3. **Given** project с extensions rule, target которой не существует, **When** `ycsf check` выполняется, **Then** diagnostics содержит и `YCK_MISSING_TARGET` (check-specific), и `EXT_UNRESOLVED_TARGET` (reuse из 015) — оба описывают одну проблему, но с разных abstraction levels.

---

### User Story 6 — DevOps опционально запускает terraform validate (Priority: P3)

DevOps запускает `ycsf check --validate-tf` для comprehensive validation. После базовых проверок check вызывает `terraform validate`. Если `terraform validate` завершается с ошибкой — diagnostics содержит `YCK_TERRAFORM_INVALID`.

**Why this priority**: IDEA §28: C может вызвать `terraform validate` как финальную проверку. Optional, не lightweight — требует `terraform init`.

**Independent Test**: Создать fixture с project без errors + mock `terraform validate` fail. Запустить check с `--validate-tf`. Ожидать `YCK_TERRAFORM_INVALID`.

**Acceptance Scenarios**:

1. **Given** project без errors, **When** `ycsf check --validate-tf` выполняется и `terraform validate` завершается успешно, **Then** exit code = 0, diagnostics пуст.
2. **Given** project с ошибкой в extensions, **When** `ycsf check --validate-tf` выполняется, **Then** check завершается на базовых проверках (exit code 1), `terraform validate` НЕ вызывается (fail-fast: сначала fix project contracts).
3. **Given** project без errors, **When** `ycsf check --validate-tf` выполняется и `terraform validate` возвращает ошибку, **Then** diagnostics содержит `YCK_TERRAFORM_INVALID` с текстом ошибки terraform.

---

### Edge Cases

- **Нет extensions.yaml**: extensions checks (C5–C8) пропускаются, не génèrent ошибок. Project model checks (C2, C3) и resource consistency (C4) выполняются.
- **Нет generated resources** (dispatch не выполнялся): override targets (C1) и resource consistency (C4) — все targets被认为是 unresolved (empty generated model → availableIdls пуст).
- **Нет apps**: build ENV checks (C2, C3) пропускаются (нечего проверять).
- **Нет resources.yaml**: resource consistency (C4) пропускается.
- **`terraform` не установлен** + `--validate-tf`: `ycsf check` возвращает `YCK_TERRAFORM_UNAVAILABLE` (и НЕ падает; base checks выполняются normally).
- **Пустой `{{$NAME}}` ref** в build_config: `PML_ENV_NOT_SET` (现有的检查; check reuses 011).

---

## Requirements

### Functional Requirements

**Оркестрация check**

- **FR-001**: `ycsf check` MUST быть pure function `(rootDir, options?) → CheckResult`, без side effects (аналог `applyExtensions`, `buildOutputs`). CLI layer обрабатывает exit code и I/O.
- **FR-002**: `ycsf check` MUST загружать generated Terraform resources из `.ycsf/*.ycsf.tf.json` файлов (после dispatch/spec 014). Если generated files отсутствуют — check выполняет только model-level checks (C2, C3, C11, C12) с пустым generated model.
- **FR-003**: `ycsf check` MUST использовать collect-all pattern: все categories проверяются, все diagnostics собираются. Отсутствие ошибок в одной категории не останавливает проверку другой.
- **FR-004**: `ycsf check` MUST возвращать `CheckResult { diagnostics: readonly Diagnostic[] }`, где `Diagnostic` — объединение типов всех diagnostic families (PML_*, EXT_*, OUT_*, MOV_*, YCK_*).
- **FR-005**: `ycsf check` MUST выполняться за O(N + M + E) где N = number of apps, M = number of generated resources, E = number of extension rules (linear, не quadratic).
- **FR-006**: CLI `ycsf check [rootDir]` MUST возвращать exit code 0 при пустом diagnostics, exit code 1 при наличии хотя бы одной ошибки. `--validate-tf` flag добавляет terraform validate step.
- **FR-007**: `ycsf check` MUST НЕ требовать `terraform init` для базовых проверок (C1–C12). `--validate-tf` может потребовать init (user responsibility).

**C1 — Override targets (extension target → generated resource)**

- **FR-008**: Для каждого extension rule, `ycsf check` MUST проверять, что IDL target (`domain.name`) присутствует в generated model (через `createIdlIndex` spec 015). Отсутствие → `YCK_MISSING_TARGET`.
- **FR-009**: `YCK_MISSING_TARGET` diagnostics MUST содержать `target` (IDL string) и `availableIdls` (sorted list of available IDLs в generated model), аналогично `EXT_UNRESOLVED_TARGET`.
- **FR-010**: Если generated model пуст (0 generated resources) — все extension targets считаются missing.

**C7 — Extensions: `{{$ENV}}` в patch запрещён**

- **FR-011**: Для каждого extension rule, `ycsf check` MUST deep-сканировать `patch` object на наличие `{{$NAME}}` patterns (regex `/\{\{\$[A-Z0-9_]+\}\}/`). Любое вхождение → `YCK_ENV_IN_PATCH`.
- **FR-012**: `YCK_ENV_IN_PATCH` MUST содержать `target` (IDL string) и `field` (путь к полю в patch, где найден `{{$ENV}}`). Scan — recursive по всем string values patch tree.
- **FR-013**: `ycsf check` MUST использовать regex `ENV_REF_RE` (spec 011: `/\{\{\$([A-Z0-9_]+)\}\}/g`) для обнаружения ENV refs в patch — consistency с existing ENV detection.

**C4 — Resource consistency (resources.yaml → generated TF)**

- **FR-014**: Для каждого resource в `resources.yaml`, `ycsf check` MUST проверять, что в generated model существует TerraformResource с matching `type` (по IDL domain → TF type mapping spec 015) и `name` (resource_id). Отсутствие → `YCK_REF_UNRESOLVED`.
- **FR-015**: `YCK_REF_UNRESOLVED` MUST содержать `resourceRef` (IDL string `domain.resource_id`) и `file` (`.ycsf/resources.yaml`).
- **FR-016**: Если `resources.yaml` отсутствует или пуст — check пропускает эту category (no error, no diagnostics).

**C13 — terraform validate (optional)**

- **FR-017**: Если `--validate-tf` flag установлен, `ycsf check` MUST вызывать `terraform validate -no-color` в `rootDir/infra/` после successful base checks (C1–C12). Non-zero exit code → `YCK_TERRAFORM_INVALID`.
- **FR-018**: Если base checks (C1–C12) обнаружили errors — `--validate-tf` НЕ выполняется (fail-fast: исправить project contracts first, затем validate terraform).
- **FR-019**: Если `terraform` binary не найден в PATH — `YCK_TERRAFORM_UNAVAILABLE` diagnostic. Base checks продолжаются.

**Reuse checks ( делегируются existing modules)**

- **FR-020**: `ycsf check` MUST вызывать `applyExtensions` (spec 015) для extensions validation (C5–C8): `EXT_UNRESOLVED_TARGET`, `EXT_DUPLICATE_TARGET`, `EXT_INVALID`. Результаты включаются в `CheckResult.diagnostics` as-is (оригинальные EXT_* codes).
- **FR-021**: `ycsf check` MUST вызывать `checkEnvRequirements` (spec 011) для build ENV validation (C2–C3). Результаты — `PML_ENV_NOT_SET` diagnostics.
- **FR-022**: `ycsf check` MUST вызывать `validateBuilders` (spec 013) для builder registry validation (C11). Результаты — `BRG_UNKNOWN_BUILDER` diagnostics.
- **FR-023**: `ycsf check` MUST вызывать `buildOutputs` (spec 016) для outputs validation (C9). Результаты — `OUT_*` diagnostics.
- **FR-024**: `ycsf check` MUST вызывать `validateMoves` (spec 017) для moves validation (C10). Результаты — `MOV_*` diagnostics.

### Error Codes (YCK_* family)

| Code | Description | Category | Fields |
|------|-------------|----------|--------|
| `YCK_MISSING_TARGET` | Extension target IDL does not exist in generated model | C1 | target, availableIdls |
| `YCK_ENV_IN_PATCH` | Extension patch contains `{{$ENV}}` reference (extensions use Terraform expressions, not build env) | C7 | target, field |
| `YCK_REF_UNRESOLVED` | Resource reference from `resources.yaml` has no matching generated Terraform resource | C4 | resourceRef, file |
| `YCK_TERRAFORM_INVALID` | `terraform validate` reported errors | C13 | message (terraform output) |
| `YCK_TERRAFORM_UNAVAILABLE` | `terraform` binary not found in PATH | C13 | — |

### Key Entities

- **CheckResult**: `{ diagnostics: readonly Diagnostic[] }` — aggregated result of all check categories. `Diagnostic` is union of `ProjectModelDiagnostic`, `ExtensionsDiagnostic`, `OutputsDiagnostic`, `MovesDiagnostic`, and `YckDiagnostic`.

- **YckDiagnostic**: `{ code: string; message: string; target?: string; resourceRef?: string; field?: string; file?: string; availableIdls?: readonly string[] }` — check-specific diagnostic shape.

- **CheckOptions**: `{ validateTf?: boolean; generatedDir?: string }` — options for `ycsf check`. `validateTf` enables `terraform validate` step (default: false). `generatedDir` overrides path to generated `.ycsf.tf.json` files (default: `<rootDir>/.ycsf/`).

- **Generated model**: `readonly TerraformResource[]` — list of generated TF resources (from dispatch/spec 014, serialized in `.ycsf/*.ycsf.tf.json` files). Loaded by check from filesystem, NOT by materialization pipeline.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: `ycsf check` на каноническом reference-проекте (`user_service` + `analytics` + `frontend` + `openapi`, extensions на `functions.user_service`, outputs, moves) завершается с exit code 0 и 0 diagnostics (все contracts valid).
- **SC-002**: Extension target на несуществующий resource генерирует `YCK_MISSING_TARGET` с корректным `availableIdls`. Проверяется fixture-тестом.
- **SC-003**: `{{$API_KEY}}` в extension patch генерирует `YCK_ENV_IN_PATCH` с correct `target` и `field` (recursive scan depth ≥2). Проверяется fixture-тестом.
- **SC-004**: Resource reference из `resources.yaml` без matching generated resource генерирует `YCK_REF_UNRESOLVED`. Проверяется fixture-тестом.
- **SC-005**: `ycsf check` собирает diagnostics из всех модулей (PML_*, EXT_*, OUT_*, MOV_*, YCK_*) в одном `CheckResult`. Mixed-diagnostics fixture (EXT error + model error) возвращает оба.
- **SC-006**: `ycsf check` с `--validate-tf` (terraform fail) генерирует `YCK_TERRAFORM_INVALID` только после successful base checks. Fixture: base errors present → terraform validate не вызывается.
- **SC-007**: 100% acceptance criteria US1–US6 покрыты тестами (Constitution II: каждый AC → ≥1 тест, RED → GREEN). `typecheck`/`lint` пакета — чисто.
- **SC-008**: Performance: `ycsf check` на project с 20 apps + 30 generated resources + 10 extension rules завершается < 100ms (pure validation, no network, no Terraform init).

---

## Assumptions

- **Generated resources loading**: `ycsf check` загружает `.ycsf/*.ycsf.tf.json` файлы через simple JSON parse (not through full materialization pipeline). Это implementation detail; spec фиксирует behavior: check requires generated resources to be present (on disk) after dispatch.
- **IDL domain → TF type mapping**: extensions `idl.ts` (spec 015) фиксирует `IDL_DOMAIN_BY_TF_TYPE` = `{ yandex_function: 'functions', yandex_api_gateway: 'gateways' }`. Resource consistency check (C4) использует этот же mapping. New TF types добавляются расширением mapping (non-breaking).
- **Output validation (C9)**: `buildOutputs` (spec 016) выполняется как часть check, но генерирует output file (serialization). Check вызывает его для validation side-effect, НЕ для file generation. Result file discarded; только diagnostics collected.
- **Moves validation (C10)**: `validateMoves` (spec 017) — pure validation, perfect fit for check aggregation. Moves reference TF addresses; check не проверяет existence of referenced addresses (that is terraform validate scope).
- **ENV ref in patch scan**: Scan uses `ENV_REF_RE` from spec 011 (`/\{\{\$([A-Z0-9_]+)\}\}/`). Pattern is stable across specs 011/012; no false positives from Terraform `${...}` or B→Materializer `${resources...}` (different syntax).
- **No `terraform init` for base checks**: Base checks (C1–C12) are pure contract validation; they do not read terraform state, provider cache, or module sources. `--validate-tf` requires init as prerequisite (user's responsibility).
- **`ycsf check` vs `ycsf-api check`**: `ycsf-api check` (spec 010) validates Project B contracts (API composition, OpenAPI, resource references in API specs). `ycsf check` (spec 020) validates Project C contracts (orchestration/build, generated TF resources, extensions). Different scopes, different owners. No overlap.
- **Reuse is not re-validation**: FR-020–FR-024 delegate to existing modules. These modules may have been called during the build pipeline. `ycsf check` calls them again as a standalone verification — this is intentional (user may want to run check without full build). Performance overhead is minimal (pure validation, <100ms).

---

## References

- IDEA.md §28: `ycsf check` — override targets, template variables, build ENV, resource consistency, extensions validation, `terraform validate` optional
- Constitution I: A/B/C/Terraform separation (C validates its own contracts, not Terraform provider schema)
- Constitution II: Spec-first, Test-first (RED → GREEN)
- Constitution III: Contract versioning
- Constitution IV: Terraform stays real Terraform; minimal generated resources
- Constitution V: Explicit over magic; fail-fast; diagnostic codes as identifiers
- Constitution VI: Ownership model (apps = managed, resources = external)
- Spec 011: project-model — apps.yaml, resources.yaml, build_config, `{{$ENV}}` extraction, `PML_*` codes
- Spec 012: build-env — `{{$ENV}}` interpolation, `PML_ENV_UNRESOLVED`
- Spec 013: builder-registry — `BRG_UNKNOWN_BUILDER`, `validateBuilders`
- Spec 014: materializer-dispatch — dispatch flow, `MTL_*` codes, generated `.ycsf.tf.json` files
- Spec 015: extensions — IDL (`idlFor`, `createIdlIndex`), deep merge, `EXT_*` codes, `applyExtensions`, `loadExtensions`
- Spec 016: outputs — `buildOutputs`, `OUT_*` codes, IDL reference resolution
- Spec 017: moves — `validateMoves`, `MOV_*` codes, IDL/IDT grammar
- Spec 019: materializers-yandex — `yandex-function`, `yandex-serverless-container`, etc., catalog
- Spec 010: ycsf-api-cli — `ycsf-api check` (Project B, different scope)
- `packages/pilot/src/extensions/idl.ts`: `IDL_DOMAIN_BY_TF_TYPE`, `idlFor`, `createIdlIndex`
- `packages/pilot/src/model/env-requirements.ts`: `extractEnvRequirements`, `checkEnvRequirements`, `ENV_REF_RE`
- `packages/pilot/src/extensions/apply.ts`: `applyExtensions` — collect-all pattern
- `packages/pilot/src/outputs/build.ts`: `buildOutputs` — validate-first
- `packages/pilot/src/moves/validate.ts`: `validateMoves` — pure validation
- `packages/pilot/src/registry/validate.ts`: `validateBuilders`

---

## Next Steps

1. `/speckit.plan` — technical design: `src/check/` module structure, `CheckResult` type, loading generated resources, reusing existing validators, `YCK_*` codes in contracts, `--validate-tf` spawn logic.
2. `/speckit.tasks` — разбивка на задачи с test-first (RED → GREEN) по acceptance criteria US1–US6.
3. `/speckit.analyze` — консистентность spec/plan/tasks.
4. `/speckit.implement` — код, тесты, typecheck/lint.
5. Интеграция с spec 021 (ycsf-cli: `ycsf check` command invocation).
