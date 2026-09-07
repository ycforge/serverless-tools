# Spec 016: outputs — `.ycsf/outputs.yaml`, auto-generated outputs

## Metadata

- **Spec ID**: 016
- **Title**: Outputs — `.ycsf/outputs.yaml`, auto-generated outputs (`ycsf_` prefix, `99-ycsf-outputs.tf.json`)
- **Status**: 🚧 In Progress
- **Dependencies**: 014 (materializer-dispatch ✅) [IDL-механизм resolution переиспользуется из 015; project model — из 011]
- **IDEA.md sections**: §26 (`.ycsf/outputs.yaml` — user outputs + auto-generated outputs), §16 (IDL / IDT / IDR — resolution grammar), §15 (Resource model — TerraformResource)
- **Packages**: `packages/pilot` (`@ycforge/pilot`)
- **Branch**: `016-outputs`

---

## Problem Statement

Spec 014 диспатчит apps на materializers, получает `TerraformResource` и сериализует declarations outputs (объявленные через `OutputBuilder` в `MaterializationContext`) в `00-ycsf-outputs.tf.json` без префикса `ycsf_`. Однако:

1. **Нет user-facing декларации** `.ycsf/outputs.yaml` — пользователь не может декларировать outputs, ссылаясь на IDL (§26: `value: "gateways.openapi.domain"` → `${yandex_api_gateway.openapi.domain}`). Spec 014 генерирует только auto-generated outputs из materializers.
2. **Расхождение с §26**: файл `00-ycsf-outputs.tf.json` из 014 против `99-ycsf-outputs.tf.json` из §26; отсутствует префикс `ycsf_` для auto-generated outputs. Spec 014 вводит `MTL_OUTPUT_NAME_COLLISION` для дубликатов auto-generated output names — но смешение user- и auto-generated outputs в одном файле не регламентировано.
3. **Нет резолва IDL → Terraform expression для user outputs**: `gateways.openapi.domain` должен быть транслирован в `${yandex_api_gateway.openapi.domain}` через ту же side-table `IDL_DOMAIN_BY_TF_TYPE` (spec 015), но с расширением грамматики на 3 сегмента (`domain.name.property`).

Spec 016 заполняет этот пробел: вводит формат `.ycsf/outputs.yaml` (user outputs), обеспечивает резолв IDL-ссылок, определяет единую нормативную модель для merged файла `99-ycsf-outputs.tf.json` (user + auto-generated outputs), и разрешает расхождение `00-` → `99-` и отсутствие `ycsf_`-префикса.

---

## Scope (In Scope)

### 1. Формат `.ycsf/outputs.yaml` (`version: 1`)

Нормативный формат:

```yaml
version: 1
outputs:
  frontend_api_url:
    value: "gateways.openapi.domain"
    description: "Public API endpoint"
  user_service_function_id:
    value: "functions.user_service.id"
    description: "Cloud function ID"
```

Структурные требования:

- `version` обязателен и равен `1` (Constitution III: каждый `.ycsf/*.yaml` несёт `version: 1`); иначе `OUT_VERSION`.
- `outputs` обязателен и является mapping (YAML-table); отсутствие/иной тип → `OUT_INVALID`.
- Каждое имя ключа в `outputs` — уникальный string, `[a-z][a-z0-9_]*` (lowercase + underscore; грамматика `[a-z][a-z0-9_]*`); нарушение → `OUT_INVALID`.
- Имя НЕ должно начинаться с `ycsf_` — этот префикс зарезервирован для auto-generated outputs (§26); `OUT_RESERVED_PREFIX`.
- Дубликаты YAML-ключей в `outputs` → `OUT_INVALID` (parse-gate `uniqueKeys`, паттерн spec 011/015).
- Значение `value` — строка, содержащая IDL-ссылку 3 сегмента (`domain.name.property`, по грамматике `ResourceReference` из spec 002: `[a-z][a-z0-9_]*`); нарушение → `OUT_INVALID_VALUE`.
- `description` — опциональная строка; отсутствие допустимо и означает omit (§26: `description` optional, omitted → не записывается в `.tf.json`).

### 2. IDL-адресация для user outputs (решение spec 016)

§26 требует резолва `value` как IDL-ссылки (`domain.name.property`) → Terraform expression (`${<terraform_type>.<name>.<property>}`). Механизм — расширение side-table `IDL_DOMAIN_BY_TF_TYPE` из spec 015:

| Terraform resource type | IDL domain |
|-------------------------|------------|
| `yandex_function`       | `functions` |
| `yandex_api_gateway`    | `gateways` |

**Resolution rule (user output `value`)**:

1. Разбить `value` на 3 сегмента `domain.name.property` по грамматике `ResourceReference` (contract 002, `parseResourceReference`).
2. Найти `terraform_type` по обратной таблице `IDL_DOMAIN_BY_TF_TYPE`: если ни один домен не совпадает → `OUT_UNRESOLVED_IDL` (доступные домены перечислены в message).
3. Результат: `${<terraform_type>.<name>.<property>}` — Terraform expression-строка.

**Важно**: name-сегмент должен совпадать с `resource.name` generated resources. Если IDL `domain.name` не разрешается ни к одному generated resource — `OUT_UNRESOLVED_IDL` (message содержит недоступный IDL + список доступных IDL из IDL-индекса, алфавитный порядок; паттерн `EXT_UNRESOLVED_TARGET` из spec 015).

**Расширяемость**: spec 019 добавит домены в таблицу аддитивно; текущие `functions`/`gateways` — минимальный набор.

### 3. Auto-generated outputs из materializers

Spec 014 уже реализовал `OutputBuilder.declare(name, {value, description?})` и сериализует declarations в `00-ycsf-outputs.tf.json`. Spec 016 **вводит normative-правило**:

- **Auto-generated output names MUST начинаться с префикса `ycsf_`** (§26). Если materializer объявляет output без `ycsf_`-префикса → это нарушение контракта materializer; C фиксирует его как `OUT_INVALID_AUTO_PREFIX` (Constitution V: explicit, не silent fix).
- Auto-generated outputs записываются в merged файл `99-ycsf-outputs.tf.json`.
- `value` передаётся как Terraform expression-строка БЕЗ `${...}` (контракт 002, `OutputBuilder`); C оборачивает в `${...}` при сериализации (§26: «C при сериализации в `.tf.json` оборачивает её в `${...}`»).
- Файловое имя `00-ycsf-outputs.tf.json` из spec 014 **заменяется** на `99-ycsf-outputs.tf.json` (§26 нормативное). Это **spec-vs-code divergence**: spec побеждает; в коде 014 будет исправлено в рамках этого spec (migration: файл `00-ycsf-outputs.tf.json` перестаёт генерироваться, на его место приходит `99-ycsf-outputs.tf.json`).

### 4. Merged output file: `99-ycsf-outputs.tf.json`

Объединённый файл для user outputs И auto-generated outputs:

```json
{
  "output": {
    "frontend_api_url": {
      "value": "${yandex_api_gateway.openapi.domain}",
      "description": "Public API endpoint"
    },
    "ycsf_function_user_service_id": {
      "value": "${yandex_function.user_service.id}",
      "description": "serverless-tools generated: functions.user_service.id"
    }
  }
}
```

Свойства merged файла:

- **Filename**: `99-ycsf-outputs.tf.json` (§26 нормативное; `99-` = high-priority suffix, не конфликтует с app filenames `*.ycsf.tf.json`).
- **Content structure**: `{ "output": { [name]: { "value": "...", "description?" } } }` — standard Terraform JSON output block.
- **Keys sorted лексикографически** на каждом уровне (детерминизм, паттерн 014).
- **`description` omitted** когда отсутствует (не записывается в JSON; §26: optional, omitted).
- **`${...}` wrapping**: значение `value` для user outputs оборачивается в `${...}` при резолве IDL; для auto-generated outputs — при сериализации; в обоих случаях в `.tf.json` значение всегда в `${...}`.
- **Collision detection** (Constitution V): имя output должно быть уникально ВНУТРИ merged файла; user output name конфликтует с auto-generated → `OUT_DUPLICATE_NAME` (collect-all). Auto-generated names содержат `ycsf_`-префикс по construction, поэтому коллизия возможна только если user декларирует имя, совпадающее с auto-generated (запрещено `ycsf_`-правилом → fault на этапе validation).

### 5. `loadOutputs(rootDir)` — loader

Паттерн `loadExtensions` (spec 015) / `loadProjectModel` (spec 011):

```typescript
type OutputsLoadResult =
  | { readonly kind: 'ok'; readonly data: OutputsYaml }
  | { readonly kind: 'invalid'; readonly errors: readonly OutputsDiagnostic[] };
```

`loadOutputs(rootDir: string): OutputsLoadResult`

- Файла нет → **throw** `Error('missing .ycsf/outputs.yaml (OUT_MISSING_FILE)')` — симметрично `loadExtensions` (`EXT_MISSING_FILE`), `loadProjectModel` (missing apps.yaml → throw), `loadRegistry` (`BRG_MISSING_FILE` → throw). Наличие файла решает оркестратор 021: проект без outputs не вызывает loader.
- Структурные ошибки (версия, форма, YAML-синтаксис, duplicate YAML-keys) → `kind:'invalid'` со **всеми** собранными diagnostics (collect-all), тип — `OutputsDiagnostic` (file/line/column/field/code; паттерн 011/015).
- Валидация IDL-грамматики `value` — выполняется НЕ в loader, а в `buildOutputs` (разделение phases: loader = structural; resolver = semantic, как в 015: `loadExtensions` ≠ `applyExtensions`).

### 6. `buildOutputs(...)` — pure assembly function

Чистая функция (no I/O, readble/testable для `ycsf check` spec 020):

```typescript
interface BuildOutputsInput {
  readonly outputsYaml: OutputsYaml;
  readonly materializerOutputs: ReadonlyMap<string, OutputValue>;
  readonly resources: readonly TerraformResource[];
}

type BuildOutputsResult =
  | { readonly kind: 'ok'; readonly file: GeneratedTfFile }
  | { readonly kind: 'invalid'; readonly errors: readonly OutputsDiagnostic[] };
```

`buildOutputs(input: BuildOutputsInput): BuildOutputsResult`

Двухфазная семантика (паттерн spec 015 `applyExtensions`):

- **Фаза validation (collect-all, all-or-nothing)**:
  1. Валидация user outputs: каждое имя `[a-z][a-z0-9_]*` и НЕ начинается с `ycsf_` (OUT_RESERVED_PREFIX); дубликаты user output names → `OUT_DUPLICATE_NAME`.
  2. Резолв IDL для каждого `value`: `parseResourceReference` (contract 002) → lookup `IDL_DOMAIN_BY_TF_TYPE` → проверка existence в IDL-индексе из generated resources; неразрешённый IDL → `OUT_UNRESOLVED_IDL`.
  3. Валидация auto-generated outputs: каждое имя начинается с `ycsf_` (`OUT_INVALID_AUTO_PREFIX`); дубликаты auto-generated names → `OUT_DUPLICATE_NAME`; дубликат между user и auto → `OUT_DUPLICATE_NAME`.
  - При наличии ЛЮБОЙ ошибки → `kind:'invalid'` со ВСЕМИ собранными ошибками; ни один output не сериализуется (all-or-nothing).
- **Фаза assembly (детерминированная)**:
  1. Объединить resolved user outputs + valid auto-generated outputs в единый `Record<string, {value: string, description?: string}>`.
  2. Keys отсортированы лексикографически (детерминизм).
  3. Сериализовать через `serializeJson({ output: merged })` (переиспользование `serializeJson` из spec 014).
  4. Filename: `99-ycsf-outputs.tf.json`.
  5. Возвращается `GeneratedTfFile` — один файл (или empty outputs → `kind:'ok'` с пустым content? Нет: если нет ни user, ни auto-generated outputs → `file` всё равно содержит пустой `{ "output": {} }` для стабильного поведения).

### 7. Интеграция с 014 dispatch pipeline

- Dispatch 014 (spec 014) продолжает сериализовать resource files (`*.ycsf.tf.json`) и выдавать `MaterializationContext` для materializers.
- `buildOutputs` — чистая функция, вызываемая **после** dispatch: входы — `OutputsYaml` (загруженный loader) + `materializerOutputs` (из `OutputBuilder.declared`) + `resources` (generated resources для IDL-индекса).
- Точка врезки в dispatch/CLI pipeline (кто вызывает `loadOutputs` и `buildOutputs`) — **оркестрация CLI 021** (вне scope 015/014/016). Spec 016 spec-т чистую функцию `buildOutputs` и loader `loadOutputs`; проводка — 021.
- **Spec 014 изменяется**: `serialize.ts:serializeOutputs` и dispatch:70–75 (`00-ycsf-outputs.tf.json`) — заменяются вызовом `buildOutputs` из 016. Это миграция spec-vs-code (§26 побеждает); имя файла `00-` → `99-`; prefix `ycsf_` для auto-generated enforcement.
- Auto-generated output collision detection (`MTL_OUTPUT_NAME_COLLISION` в 014) **подчиняется** unified `OUT_DUPLICATE_NAME` из 016; `MTL_OUTPUT_NAME_COLLISION` **superseded** для контекста merged output файла ( materializer-level collision detection остаётся в 014 для отлова до merge; в 016 — единая точка для всей картины user + auto).

### Scope boundaries (Out of Scope)

| Что | Почему не в scope | Owner |
|-----|-------------------|-------|
| CLI-оркестрация (`ycsf build`/`ycsf plan`) | 021 | 021 |
| `ycsf check` validation-команда | 020 (buildOutputs доступен как validation API) | 020 |
| Чтение/анализ user `*.tf` | Constitution IV: C никогда не читает и не анализирует `*.tf` | — |
| Moved blocks (`.ycsf/moved.yaml`) | Spec 017 | 017 |
| Real materializer-пакеты (019) | Fixture materializers в тестах; реальные — 019 | 019 |
| Построение IDL-индекса из resources | `createIdlIndex` из 015 переиспользуется; не расширяется | 015 |
| multi-env / staging/prod различия | `.ycsf/*.yaml` едины для всех сред; ENV — Terraform workspaces/tfvars | — |
| Валидация `${...}` выражений | Terraform owns expression validation; C не моделирует provider schema | Terraform |

---

## User Scenarios & Testing

### User Story 1 — DevOps декларирует outputs в `.ycsf/outputs.yaml`, ссылаясь на generated resources (Priority: P1)

DevOps хочет вынести URL API Gateway, ID функции и URL Frontend в outputs Terraform-модуля. Он создаёт `.ycsf/outputs.yaml`:

```yaml
version: 1
outputs:
  frontend_api_url:
    value: "gateways.openapi.domain"
    description: "Public API endpoint"
  user_service_function_id:
    value: "functions.user_service.id"
    description: "Cloud function ID"
```

При assembly `buildOutputs` резолвит IDL-ссылки через `IDL_DOMAIN_BY_TF_TYPE` и генерирует `99-ycsf-outputs.tf.json` с Terraform expression `${yandex_api_gateway.openapi.domain}` и `${yandex_function.user_service.id}`.

**Why this priority**: Core happy path §26. Без user-facing outputs пользователь ограничен auto-generated outputs materializers; декларативный output — основной use case фичи.

**Independent Test**: loader + `buildOutputs` с валидным `OutputsYaml` + fixture resources (yandex_api_gateway.openapi, yandex_function.user_service) + пустые auto-generated outputs → `99-ycsf-outputs.tf.json` с двумя output entries.

**Acceptance Scenarios**:

1. **Given** `OutputsYaml` с двумя outputs (`frontend_api_url` → `gateways.openapi.domain`, `user_service_function_id` → `functions.user_service.id`), generated resources содержат `yandex_api_gateway.openapi` и `yandex_function.user_service`, **When** `buildOutputs(input)`, **Then** `result.kind === 'ok'`; `result.file.filename === '99-ycsf-outputs.tf.json'`; content JSON содержит `"frontend_api_url": {"value": "${yandex_api_gateway.openapi.domain}", "description": "Public API endpoint"}` и `"user_service_function_id": {"value": "${yandex_function.user_service.id}", ...}`.
2. **Given** тот же файл, **When** content сериализован через `serializeJson`, **Then** JSON keys отсортированы лексикографически (детерминизм).
3. **Given** файл с одним output и без `description`, **When** `buildOutputs`, **Then** JSON-объект output содержит только `"value"`, без ключа `"description"` (omit, §26).

---

### User Story 2 — Auto-generated outputs получают префикс `ycsf_` и объединяются с user outputs (Priority: P1)

Materializer объявил через `OutputBuilder`: `context.output.declare('ycsf_function_user_service_id', { value: 'yandex_function.user_service.id', description: '...' })`. DevOps также имеет user output с другим именем. При assembly оба попадают в один merged файл `99-ycsf-outputs.tf.json`.

**Why this priority**: Автоматическая интеграция materializer-generated outputs с user outputs — основная ценность §26; префикс `ycsf_` — required rule.

**Independent Test**: `buildOutputs` с OutputsYaml (1 user output) + materializerOutputs (1 output с `ycsf_`-префиксом) + resources → merged файл с двумя entries, keys sorted.

**Acceptance Scenarios**:

1. **Given** `materializerOutputs: Map { 'ycsf_function_user_service_id' => { value: 'yandex_function.user_service.id', description: '...' } }`, `outputsYaml` содержит `frontend_api_url` → `gateways.openapi.domain`, resources содержат `yandex_function.user_service` и `yandex_api_gateway.openapi`, **When** `buildOutputs(input)`, **Then** merged file содержит оба entries; `ycsf_function_user_service_id` value === `"${yandex_function.user_service.id}"` (wrapped); `frontend_api_url` value === `"${yandex_api_gateway.openapi.domain}"`.
2. **Given** materializer output name без `ycsf_`-префикса (`function_user_service_id`), **When** `buildOutputs`, **Then** `result.kind === 'invalid'`; `OUT_INVALID_AUTO_PREFIX` в errors (Constitution V: нарушение контракта, не silent fix).
3. **Given** пустые `materializerOutputs` и пустые `outputsYaml.outputs`, **When** `buildOutputs`, **Then** `result.kind === 'ok'`; file content = `{ "output": {} }` (стабильный пустой output block; не `undefined`/отсутствие файла).

---

### User Story 3 — Ошибки fail-fast: дубликаты, reserved prefix, unresolved IDL, bad version/structure (Priority: P1)

DevOps допустил ошибки: два outputs с одним именем; output name начинается с `ycsf_`; value ссылается на несуществующий IDL; version файла = 2. Все ошибки собираются и отдаются за один вызов (collect-all).

**Why this priority**: Fail-fast (Constitution V) и collect-all — ключевые для user experience: все ошибки сразу, а не по одной.

**Independent Test**: отдельные фикстуры для каждой ошибки; `buildOutputs` / `loadOutputs` возвращает diagnostics с нужными кодами.

**Acceptance Scenarios**:

1. **Given** `OutputsYaml` с двумя outputs: оба `name: 'api_url'`, **When** `buildOutputs`, **Then** `OUT_DUPLICATE_NAME` в errors (collect-all; все ошибки в одном вызове).
2. **Given** output name `ycsf_function_id` (начинается с `ycsf_`), **When** `buildOutputs`, **Then** `OUT_RESERVED_PREFIX` в errors.
3. **Given** value `databases.postgres.id` (домен `databases` отсутствует в `IDL_DOMAIN_BY_TF_TYPE`), **When** `buildOutputs`, **Then** `OUT_UNRESOLVED_IDL` в errors; message содержит `databases.postgres.id` и список доступных IDL из generated resources (алфавитный).
4. **Given** `.ycsf/outputs.yaml` с `version: 2`, **When** `loadOutputs`, **Then** `kind: 'invalid'`, `OUT_VERSION` в errors.

---

### User Story 4 — Детерминизм повторных запусков (Priority: P2)

Одинаковые входные данные (OutputsYaml + materializerOutputs + resources) → идентичные байты `99-ycsf-outputs.tf.json`. Diff-based workflows (git, CI) зависят от стабильности байт.

**Why this priority**: Детерминизм — базовое требование (как SC-003 в 014, SC-001 в 015).

**Independent Test**: два вызова `buildOutputs` с одинаковыми входными → identical `file.content`.

**Acceptance Scenarios**:

1. **Given** одинаковые входные данные, **When** `buildOutputs` вызван дважды, **Then** `result1.file.content === result2.file.content` (байт-в-байт).

---

### User Story 5 — Граничные случаи: пустой outputs, пустой файл, отсутствующий файл, IDL для external resources (Priority: P2)

Пустой `outputs: {}`; файла `.ycsf/outputs.yaml` нет; value ссылается на external resource из `resources.yaml` (не generated).

**Why this priority**: Границы формата; детерминированное поведение без сюрпризов.

**Independent Test**: 4 отдельных сценария: (a) пустой outputs mapping, (b) отсутствие файла, (c) IDL на external resource, (d) IDL-ссылка с нарушением грамматики.

**Acceptance Scenarios**:

1. **Given** `OutputsYaml` с `outputs: {}`, **When** `buildOutputs`, **Then** `result.kind === 'ok'`; `file.content` = `{ "output": {} }` (пустой output block, стабильный; не omit файла).
2. **Given** в проекте нет `.ycsf/outputs.yaml`, **When** `loadOutputs(rootDir)`, **Then** брошено `Error` с кодом `OUT_MISSING_FILE` (наличие файла решает оркестратор 021; проект без outputs не вызывает loader).
3. **Given** value `queues.events.qurl` (external resource из `resources.yaml`, не generated), **When** `buildOutputs` с resources (содержащими только generated), **Then** `OUT_UNRESOLVED_IDL`; message содержит `queues.events.qurl` и доступные IDL generated resources (external resources не в IDL-индексе).
4. **Given** value `Functions.User_Service.Id` (uppercase сегменты), **When** `loadOutputs` + `buildOutputs`, **Then** loader structural validation не проверяет грамматику value; `buildOutputs` возвращает `OUT_INVALID_VALUE` (3-segment lowercase grammar violation).

---

### Edge Cases

- **Пустой outputs (`outputs: {}`)**: no-op; файл `99-ycsf-outputs.tf.json` содержит `{ "output": {} }` (US5 AC1).
- **Пустой outputs + нет auto-generated**: тот же `{ "output": {} }`; детерминированный; не отсутствие файла (US2 AC3).
- **Output name начинается с `ycsf_`**: `OUT_RESERVED_PREFIX` (US3 AC2); Constitution V: reserved prefix = error, не silent swap.
- **Дубликат user-output-name с auto-generated name**: `OUT_DUPLICATE_NAME` (если auto-generated с `ycsf_` + user с тем же именем без `ycsf_` — impossible по construction; если auto-generated без `ycsf_` — `OUT_INVALID_AUTO_PREFIX` сначала).
- **`value` уже содержит `${...}`**: passthrough (если `value: "${yandex_function.foo.id}"` — это не IDL-ссылка; `parseResourceReference` бросит `ContractError`; → `OUT_INVALID_VALUE`; пользователь должен передать голый IDL без `${...}`).
- **`value` — не строка** (например, число, объект): `OUT_INVALID_VALUE` (TypeScript type ensures string, defensive: structural validation в loader).
- **`description` — не строка**: `OUT_INVALID` (structural).
- **Duplicate YAML-key в outputs**: ловится parse-gate `uniqueKeys` → `OUT_INVALID` (структурная, паттерн 015).
- **Property в IDL не существует в generated resource**: `OUT_UNRESOLVED_IDL` (resolution-level; message содержит IDL + доступные).
- **Auto-generated output name не содержит `ycsf_`-префикс**: `OUT_INVALID_AUTO_PREFIX`; Constitution V: нарушение контракта, не silent fix.
- **Файл outputs.yaml есть, но `outputs:` — не mapping** (scalar/list/null): `OUT_INVALID` (структурная).
- **Ресурс не IDL-addressable** (тип вне таблицы): IDL-ссылка на него → `OUT_UNRESOLVED_IDL` (как в 015: не ошибка сам по себе, но ссылка на него — resolution-level ошибка).

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST поддерживать файл `.ycsf/outputs.yaml` формата `version: 1` с обязательным ключом `outputs` — mapping (YAML-table) из string-имён в `{ value: string, description?: string }` (US1; §26).
- **FR-002**: `loadOutputs(rootDir)` MUST выбрасывать `Error` с кодом `OUT_MISSING_FILE`, если `.ycsf/outputs.yaml` отсутствует; наличие файла решает оркестратор 021 (паттерн `EXT_MISSING_FILE` / `BRG_MISSING_FILE` / spec 011).
- **FR-003**: System MUST отклонять отсутствующий или отличный от `1` `version` → diagnostic `OUT_VERSION` (Constitution III).
- **FR-004**: System MUST отклонять структурно невалидные файлы → diagnostics `OUT_INVALID` для ВСЕХ ошибок (collect-all): YAML-синтаксис, duplicate YAML-keys (parse-gate `uniqueKeys`), отсутствие/не-mapping `outputs`, `value` не строка, `description` не строка и не absent, имя ключа нарушает грамматику `[a-z][a-z0-9_]*` (US3/US5).
- **FR-005**: System MUST отклонять output name, начинающийся с `ycsf_` → `OUT_RESERVED_PREFIX` (§26: префикс зарезервирован для auto-generated outputs; Constitution V).
- **FR-006**: System MUST резолвить каждую IDL-ссылку `value` (3 сегмента `domain.name.property`, грамматика `ResourceReference` 002) → Terraform expression `${<terraform_type>.<name>.<property>}`, используя `IDL_DOMAIN_BY_TF_TYPE` (spec 015) и `createIdlIndex` (spec 015) для проверки existence generated resource; неизвестный домен или IDL → `OUT_UNRESOLVED_IDL` с message (IDL + доступные IDL, алфавитный порядок) (US1/US3).
- **FR-007**: System MUST проверять грамматику `value` (3 сегмента `[a-z][a-z0-9_]*` через `parseResourceReference` contract 002) и отклонять violations → `OUT_INVALID_VALUE` (US5 AC4).
- **FR-008**: System MUST проверять, что auto-generated output names (все, кроме user) начинаются с `ycsf_` → `OUT_INVALID_AUTO_PREFIX` если нарушено (§26; Constitution V: explicit contract enforcement) (US2).
- **FR-009**: System MUST обнаруживать дубликаты имён outputs ВНУТРИ merged файла (user+auto) → `OUT_DUPLICATE_NAME` (Constitution V: collision = error, never silent merge; collect-all) (US3).
- **FR-010**: System MUST генерировать merged output файл `99-ycsf-outputs.tf.json` со структурой `{ "output": { [name]: { "value": "${...}", "description?" } } }` (§26).
- **FR-011**: System MUST оборачивать каждое `value` в `${...}` при сериализации (user outputs: `${resolved_idl}`; auto-generated outputs: `${raw_tf_expr}`) (§26: «C при сериализации оборачивает в `${...}`»).
- **FR-012**: System MUST сортировать JSON keys лексикографически на каждом уровне файла (детерминизм; паттерн 014) (US4).
- **FR-013**: System MUST OMIT `description` из JSON-объекта, когда он отсутствует в декларации (§26: optional, omitted) (US1 AC3).
- **FR-014**: System MUST генерировать `{ "output": {} }` (пустой output block) когда нет ни user, ни auto-generated outputs — стабильный пустой файл, не отсутствие файла (US2 AC3/US5 AC1).
- **FR-015**: System MUST собирать ВСЕ ошибки validation (structural + resolution + collision) В ОДНОМ вызове (collect-all, all-or-nothing) и не применять никаких трансформаций при наличии ошибок (US3).
- **FR-016**: System MUST НЕ обрабатывать и НЕ валидировать `${...}` в user `value` — если `value` содержит `${`, это не IDL-ссылка; `parseResourceReference` отклонит её → `OUT_INVALID_VALUE` (Constitution IV: Terraform owns expression semantics) (US5).
- **FR-017**: System MUST использовать `createIdlIndex` из spec 015 для построения IDL-индекса из generated resources при резолве user outputs; external resources (из `resources.yaml`) не в IDL-индексе → ссылки на них → `OUT_UNRESOLVED_IDL` (Constitution VI: apps = managed, resources = external; IDL-индекс только для generated) (US5 AC3).
- **FR-018**: System НЕ должен читать/анализировать user `*.tf` при разрешении outputs (Constitution IV: C никогда не читает `*.tf`) (Edge cases; §25.6).
- **FR-019**: System MUST детерминировать порядок entries в merged файле: лексикографический по имени output (sorted keys; US4).
- **FR-020**: System MUST определять `99-ycsf-outputs.tf.json` как C-owned generated filename и управлять его жизненным циклом (overwrite/remove) наравне с `*.ycsf.tf.json` файлами; orphaned `99-ycsf-outputs.tf.json` от предыдущего запуска — перезаписывается (паттерн regeneration 014).

### Error Codes (OUT_* family)

| Code | Condition | Phase |
|------|-----------|-------|
| `OUT_MISSING_FILE` | `.ycsf/outputs.yaml` отсутствует при вызове `loadOutputs` (throw; паттерн `EXT_MISSING_FILE`) | Load |
| `OUT_VERSION` | `version` отсутствует или не равен `1` (Constitution III) | Load |
| `OUT_INVALID` | Структура: YAML-синтаксис / duplicate YAML-keys / нет-или-не-mapping `outputs` / `value` не строка / `description` не строка и не absent / имя ключа нарушает грамматику `[a-z][a-z0-9_]*` / `outputs` не mapping; defensive: ключ — пустая строка | Load + Build |
| `OUT_RESERVED_PREFIX` | Output name начинается с `ycsf_` (зарезервировано для auto-generated; §26) | Build |
| `OUT_INVALID_VALUE` | `value` не является валидной 3-сегментной IDL-ссылкой `[a-z][a-z0-9_]*` по грамматике `ResourceReference` 002 (например, uppercase, 2 сегмента, 4 сегмента, дефис/слеш) | Build |
| `OUT_UNRESOLVED_IDL` | IDL-ссылка (`domain.name.property`) не разрешается: домен не в `IDL_DOMAIN_BY_TF_TYPE` ИЛИ `domain.name` не найден в IDL-индексе generated resources; message содержит недоступный IDL + доступные IDL (алфавитный порядок) | Build |
| `OUT_DUPLICATE_NAME` | Имя output встречается более одного раза в merged файле (user-user, user-auto, auto-auto); collect-all | Build |
| `OUT_INVALID_AUTO_PREFIX` | Auto-generated output name НЕ начинается с `ycsf_` (нарушение контракта materializer; §26; Constitution V) | Build |

Связь с кодами spec 014: `MTL_OUTPUT_NAME_COLLISION` остаётся для отлова дубликатов на уровне materializer dispatch (до merge); в context merged output файла (spec 016) используется `OUT_DUPLICATE_NAME`. Оба кода допустимы в одном проекте: `MTL_OUTPUT_NAME_COLLISION` — dispatch-level (materializer declares same name twice), `OUT_DUPLICATE_NAME` — merge-level (user + auto или другой auto в merged file).

### Key Entities

- **OutputsYaml**: `{ version: 1, outputs: Record<string, { value: string, description?: string }> }` — содержимое `.ycsf/outputs.yaml` (formatted contract, Constitution III).
- **UserOutput**: `{ name: string, value: string, description?: string }` — один user output после загрузки; `name` — `[a-z][a-z0-9_]*` без `ycsf_`-префикса; `value` — IDL-ссылка 3 сегмента.
- **AutoGeneratedOutput**: `{ name: string, value: string, description?: string }` — один auto-generated output из `OutputBuilder.declared`; `name` обязан начинаться с `ycsf_`; `value` — raw Terraform expression-строка (без `${...}`).
- **IDL-ссылка (user output value)**: строка `domain.name.property` по грамматике `ResourceReference` 002 (3 сегмента `[a-z][a-z0-9_]*`); разрешается через `IDL_DOMAIN_BY_TF_TYPE` (spec 015) → `${<terraform_type>.<name>.<property>}`.
- **OutputsDiagnostic**: `{ code: string, message: string, name?: string, file?: string, field?: string, line?: number, column?: number, availableIdls?: readonly string[] }` — диагностика для loader/build errors (`OUT_*`). Структурные diagnostics loader-а переиспользуют паттерн `ProjectModelDiagnostic` из 011.
- **OutputsLoadResult**: `{ kind: 'ok', data: OutputsYaml } | { kind: 'invalid', errors: readonly OutputsDiagnostic[] }` — результат `loadOutputs` (не бросает validation, бросает только `OUT_MISSING_FILE`).
- **BuildOutputsInput**: входные данные для `buildOutputs` — `OutputsYaml` + `materializerOutputs` (из `OutputBuilder.declared`) + `resources` (generated resources для IDL-индекса).
- **BuildOutputsResult**: `{ kind: 'ok', file: GeneratedTfFile } | { kind: 'invalid', errors: readonly OutputsDiagnostic[] }` — результат `buildOutputs`; ok = merged `99-ycsf-outputs.tf.json` (всегда, даже при пустых outputs: `{ "output": {} }`).
- **`99-ycsf-outputs.tf.json`**: merged output file; `{ "output": { [name]: { "value": "${...}", "description?" } } }`; C-owned generated file; filename `99-` suffix (§26 нормативное).

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Детерминизм: одинаковые входные `buildOutputs` → идентичные байты `99-ycsf-outputs.tf.json` при повторном вызове (US4; FR-012/FR-019).
- **SC-002**: Каждый acceptance scenario US1–US5 покрыт тестами (Constitution II); каждый AC → ≥1 тест; тесты подтверждают RED → GREEN.
- **SC-003**: User `*.tf` не затрагивается: `buildOutputs` не читает и не модифицирует `.tf` файлы; результат определяется только входными данными (Constitution IV).
- **SC-004**: Коллизии имён обнаруживаются fail-fast: `OUT_DUPLICATE_NAME` при дубликате; ни один output не сериализуется при ошибке (all-or-nothing) (US3; FR-009/FR-015; Constitution V).
- **SC-005**: `ycsf_`-префикс для auto-generated outputs enforcement: `OUT_INVALID_AUTO_PREFIX` при нарушении; user output name с `ycsf_` → `OUT_RESERVED_PREFIX` (US2/US3; FR-005/FR-008).
- **SC-006**: IDL resolution: каждая валидная IDL-ссылка разрешается в `${<terraform_type>.<name>.<property>}`; невалидная/unknown → `OUT_INVALID_VALUE`/`OUT_UNRESOLVED_IDL` с helpful message (US1/US3/US5; FR-006/FR-007).
- **SC-007**: Filename `99-ycsf-outputs.tf.json` (§26) генерируется вместо `00-ycsf-outputs.tf.json` из 014; `00-` не генерируется; migration от 014 — spec-vs-code divergence resolution.
- **SC-008**: Структурные ошибки `.ycsf/outputs.yaml` (версия, форма, грамматика имён) обнаруживаются в `loadOutputs` / `buildOutputs` с diagnostic codes `OUT_*`; все ошибки собираются за один вызов (collect-all).
- **SC-009**: 100% acceptance criteria spec 016 покрыты тестами (Constitution II); каждый AC → ≥1 тест.

---

## Assumptions

- **Один `.ycsf/outputs.yaml` на проект**: файл опционален (проект без outputs не заводит его); presence решает оркестратор 021 (как extensions 015).
- **`ycsf_`-префикс strict**: auto-generated output name без `ycsf_` — ошибка (`OUT_INVALID_AUTO_PREFIX`), не silent добавление префикса; Constitution V (explicit > magic).
- **`MTL_OUTPUT_NAME_COLLISION` superseded не полностью**: код остаётся для отлова на уровне materializer dispatch (spec 014 context: materializer declares same name twice → MTL_OUTPUT_NAME_COLLISION, до merge). `OUT_DUPLICATE_NAME` — merge-level (user + auto, another auto); оба кода допустимы в одном pipeline.
- **Passthrough для `${...}` в user value**: если `value` содержит `${...}`, это не IDL-ссылка и будет отклонена `OUT_INVALID_VALUE` (grammatically invalid for ResourceReference). Пользователь не должен оборачивать value в `${...}` — это делает C при резолве (§26).
- **External resources не резолвятся**: IDL-ссылки в user outputs разрешаются ТОЛЬКО для generated resources (IDL-индекс 015). Ссылки на external resources из `resources.yaml` → `OUT_UNRESOLVED_IDL` (Constitution VI: apps = managed, resources = external; IDL-индекс только для managed). Пользователь может получить Terraform expression на external resource через extensions (spec 015), не через outputs.
- **`buildOutputs` без `resources`**: если generated resources пусты (нет apps) — нет IDL-индекса; любая IDL-ссылка → `OUT_UNRESOLVED_IDL` (кроме trivially empty `outputs: {}` → ok).
- **Filename `99-` не конфликтует с app filenames**: app filenames — `<app_id>.ycsf.tf.json`; app_id по construction `\w+` (spec 011) и не может начинаться с `99-ycsf` (слово). Collision detection defensive (FR-020).
- **`description` omit rule**: если `description: undefined` (не указано в YAML) — ключ не записывается в JSON; если `description: ""` (пустая строка) — записывается как `""` (это осознанный выбор пользователя).
- **Fixture materializers в тестах** (как 014/015); real materializers — 019. Fixture возвращает outputs с `ycsf_`-префиксом для корректного сценария.
- **`parseResourceReference` (contract 002) переиспользуется** для валидации IDL-грамматики в user output `value` — единый парсер, паттерн 009/015.

---

## References

- Spec 002: pilot-contracts — `OutputBuilder`, `MaterializationContext`, `ResourceReference` (IDL grammar `domain.name.property`)
- Spec 014: materializer-dispatch — `serializeOutputs`, `MTL_OUTPUT_NAME_COLLISION`, `OutputBuilder.declare`, dispatch pipeline, regeneration safety
- Spec 015: extensions — `IDL_DOMAIN_BY_TF_TYPE`, `idlFor`, `createIdlIndex`, `EXT_UNRESOLVED_TARGET` (пользователь diagnostics pattern)
- Spec 011: project-model — `ProjectModel`, loader patterns, `ProjectModelDiagnostic`
- IDEA.md §26: `.ycsf/outputs.yaml` — формат, `ycsf_` prefix, `99-ycsf-outputs.tf.json`, `value` wrapping in `${...}`
- IDEA.md §16: IDL / IDT / IDR — `domain.name.property` = ResourceReference grammar
- IDEA.md §15: Resource model — `TerraformResource`, ownership semantics
- Constitution I: C владеет orchestration/build (не вызывает builders/Terraform)
- Constitution III: contracts versioned (`version: 1`); Constitution IV: user `.tf` не читается; Constitution V: collision = error (fail-fast, collect-all)

---

## Next Steps

1. `/speckit.plan` — технический дизайн: `src/contracts/outputs.ts` (type-only + `OUT_*`), `src/outputs/` (loader, resolver, buildOutputs), IDL resolution extension, integration point with dispatch 014.
2. `/speckit.tasks` — задачи test-first: контракты → loader (RED→GREEN) → IDL resolution (RED→GREEN) → buildOutputs (RED→GREEN) → edge cases → migration 014 filename.
3. `/speckit.implement` — код и тесты по acceptance criteria; lint, typecheck.
