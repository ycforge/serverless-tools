# Spec 014: materializer-dispatch — collision policy, TerraformResource → `.tf.json`

## Metadata

- **Spec ID**: 014
- **Title**: Materializer Dispatch — collision policy, TerraformResource → `.tf.json` serialization
- **Status**: 🚧 In Progress
- **Dependencies**: 002 (pilot-contracts ✅), 013 (builder-registry ✅)
- **IDEA.md sections**: §22 (Materializer plugins), §23 (Terraform model), §24 (Generated Terraform)
- **Packages**: `packages/pilot` (`@ycforge/pilot`)

---

## Problem Statement

Spec 013 загрузил `PluginRegistry` с записями `kind: 'materializer'` (модули, экспортирующие `supports` + `materialize`). Spec 002 определил контракты `Materializer`, `TerraformResource`, `MaterializationContext`. Spec 011 загрузил `ProjectModel` с графом apps и их builder-идентификаторами. Однако отсутствует механизм, который:

1. **строит** Artifact-дескрипторы из проектной модели (каждый app → один Artifact, ключ — app builder id);
2. **диспатчит** каждый Artifact на materializer: для каждого registered materializer вызвать `supports(artifact, context)` и найти единственный поддерживающий materializer;
3. **выявляет коллизии**: два materializers claim `supports` для одного artifact type → fail-fast error (Constitution V);
4. **обнаруживает unhandled artifacts**: ни один materializer не поддерживает artifact → fail-fast error (Constitution V: нет silent skip);
5. **вызывает** `materialize(artifact, context)` → получает `TerraformResource`;
6. **сериализует** `TerraformResource` в `.tf.json` файлы с детерминированными именами, не затрагивая user-owned `.tf`.

До spec 014 dispatch и serialization отсутствуют: registry загружен, но нет «моста» между loaded plugins и generated infrastructure. Spec 014 заполняет этот пробел, оставаясь внутри границ C (Constitution I: C не вызывает builders, не вызывает Terraform CLI).

---

## Scope (In Scope)

### Artifact-дескрипторы из проектной модели

ProjectModel (spec 011) содержит `apps: ReadonlyMap<string, App>`, где каждый `App` имеет `builder: string` — идентификатор builder plugin из `builders.yaml`. Spec 014 преобразует каждый app в **Artifact descriptor** (плоский объект `{ id: string, name: string, type: string }`), где:

- `id` = `app_id` (уникальный идентификатор app);
- `name` = `app_id` (человекочитаемое имя, для `.tf.json` filename);
- `type` = app builder id (ключ из `builders.yaml`, например `nestjs-function`).

**Граница**: real build output artifacts (содержащие built binaries/outputs) производятся builder-ами (spec 018/021). Spec 014 dispatch operates на artifact TYPE DESCRIPTOR — descriptor с `type: 'nestjs-function'` диспатчится на materializer, который поддерживает этот type. Actual artifact value (canned/test fixtures) — implementation detail тестов; production value будет provided spec 021.

### Materializer selection (dispatch)

Двухфазный dispatch с fail-fast семантикой:

**Фаза 1 — selection (all-or-nothing).** Для каждого Artifact descriptor:

1. Iterate все registered materializers из `PluginRegistry` (spec 013) — фильтровать по `kind: 'materializer'`.
2. Для каждого materializer вызвать `supports(artifact, context)` (spec 002 контракт; синхронный, boolean).
3. Подсчитать количество supporters:
   - **0 supporters** → unhandled artifact error (`MTL_UNHANDLED_ARTIFACT`).
   - **1 supporter** → зафиксировать mapping artifact → materializer.
   - **2+ supporters** → collision error (`MTL_COLLISION`).
4. Selection errors (collision / unhandled) собираются для ВСЕХ artifacts (supports — дешёвый и pure). Если есть хотя бы одна ошибка selection → result.kind === 'invalid', errors = все selection errors, `materialize` НЕ вызывается ни для одного artifact (all-or-nothing).

**Фаза 2 — materialize (abort-on-first).** Для каждого artifact в determinist-порядке (см. ниже), чей supporter выбран в фазе 1:

1. Создать `MaterializationContext` (spec 002 контракт) `{ output: OutputBuilder }`.
2. Вызвать `materializer.materialize(artifact, context)`.
3. Если materializer throw — поймать (`MTL_MATERIALIZE_FAILED`), result.kind === 'invalid', dispatch прекращается (abort-on-first; ни один последующий artifact не материализуется).
4. Успешный `TerraformResource` добавляется в ordered list результатов.

Фаза 1 определяет правила коллизии (FR-003/FR-004), фаза 2 — исполнение (FR-005/FR-006). Гарантия: при наличии ЛЮБОЙ ошибки selection `materialize` не вызывается вообще.

**Deterministic ordering (обе фазы)**: artifacts обрабатываются в topological order apps из `ProjectModel.depends_on_graph.topologicalOrder` (spec 011); связи внутри одного уровня — alphabetical по `app_id`. На один app — ровно один artifact (app → один builder → один artifact descriptor).

### Collision policy (Constitution V)

- **Artifact type collision**: два materializers с `supports === true` для одного artifact type → `MTL_COLLISION`. Diagnostic содержит: artifact type, оба materializer ids. Никакого silent pick; fail-fast.
- **Unhandled artifact**: ни один materializer с `supports === true` → `MTL_UNHANDLED_ARTIFACT`. Diagnostic содержит: artifact type, artifact id, список зарегистрированных materializer ids. Это **error** (fail-fast, не warning), согласно Constitution V (нет silent skip).

### `TerraformResource` → `.tf.json` serialization

Для каждого полученного `TerraformResource`:

1. Вычислить filename по правилу: `<app_id>.ycsf.tf.json`. Недопустимые для filename символы в app_id невозможны по construction (spec 011 валидирует apps.yaml keys как `\w+`); защитная проверка на этапе filename computation → error `MTL_INVALID_TERRAFORM_ADDRESS`.
2. **Collision detection filenames**: два resources (из разных apps) не могут иметь одинаковый filename; но app_id уникален в ProjectModel, поэтому collision невозможен по construction (один app → один resource). Дополнительная проверка: если materializer косвенно генерирует resources с конфликтующими именами — это уже territory spec 019/021 (real materializers); spec 014 dispatch не создаёт дополнительных resources помимо one-per-app.
3. **`.tf.json` content**: валидный Terraform JSON:
   ```json
   {
     "resource": {
       "<type>": {
         "<name>": { ...configuration }
       }
     }
   }
   ```
   где `<type>` и `<name>` — из `TerraformResource.type` и `TerraformResource.name`. `configuration` — opaque JSON value из `TerraformResource.configuration`.
4. **Deterministic JSON**: keys в JSON object отсортированы лексикографически (stable serialization; same input → same bytes).
5. **OutputBuilder outputs**: Если materializer объявил outputs через `context.output.declare(...)`, все declared outputs сериализуются в отдельный файл `00-ycsf-outputs.tf.json`:
   ```json
   {
     "output": {
       "<name>": {
         "value": "${<value>}"
       }
     }
   }
   ```
   Output names уникальны (обнаружение дубликатов → `MTL_OUTPUT_NAME_COLLISION`; Constitution V: collision = error).

### Generated file management (regeneration safety)

- C-owned generated файлы: только `*.ycsf.tf.json` и `00-ycsf-outputs.tf.json` в `infra/` directory.
- User-owned `*.tf` файлы **никогда** не модифицируются и не удаляются.
- Regeneration: перед записью новых файлов определить набор generated filenames; на regenerate удалить/перезаписать **ровно** эти имена. Файлы, не входящие в generated set, не трогаются.

### Dispatch API

```typescript
interface DispatchOptions {
  readonly infraDir?: string; // default: 'infra'
}

interface GeneratedTfFile {
  readonly filename: string;
  readonly content: string; // .tf.json content
}

interface DispatchResultOk {
  readonly kind: 'ok';
  readonly resources: readonly TerraformResource[];
  readonly generatedFiles: readonly GeneratedTfFile[];
}

interface DispatchResultInvalid {
  readonly kind: 'invalid';
  readonly errors: readonly DispatchDiagnostic[];
}

type DispatchResult = DispatchResultOk | DispatchResultInvalid;
```

**Функция**: `dispatch(projectModel, registry, options?): Promise<DispatchResult>`

- `projectModel` — ProjectModel (spec 011).
- `registry` — PluginRegistry (spec 013).
- `options` — опциональные параметры (infra dir path).
- Возвращает `DispatchResult`.

**Дополнительно** (separate pure function, I/O-тестимость):

```typescript
function writeGeneratedTerraform(
  infraDir: string,
  files: readonly GeneratedTfFile[],
): Promise<void>
```

Write-операция отделена от dispatch (C чисто: dispatch = pure+async computation, write = I/O). Это позволяет тестировать dispatch без filesystem.

### Scope boundaries (Out of Scope)

| Что | Почему не в scope | Owner |
|-----|-------------------|-------|
| Builder execution / build artifacts | Spec 021 (`ycsf build`) | Spec 021 |
| Real materializer packages (yandex-function и т.д.) | Spec 019; spec 014 использует fixture materializers | Spec 019 |
| Terraform CLI (plan/apply/destroy) | Spec 021; spec 014 заканчивается на `.tf.json` generation | Spec 021 |
| Extensions / deep merge / overrides | Spec 015 | Spec 015 |
| Output auto-generation (`.ycsf/outputs.yaml`) | Spec 016 | Spec 016 |
| Moved blocks (`.ycsf/moved.yaml`) | Spec 017 | Spec 017 |
| Multi-resource per app (real materializers) | Spec 019; dispatch на spec 014 level — one artifact per app | Spec 019 |
| Artifact value содержимое (built output) | Spec 021; dispatch operates на artifact type descriptor, не built value | Spec 021 |

---

## User Scenarios & Testing

### User Story 1 — DevOps dispatches single app with known materializer (Priority: P1)

DevOps имеет проект с одним app `user_service` (builder: `nestjs-function`), registered materializer `yandex-function` в `builders.yaml`. Materializer `yandex-function` supports artifact type `nestjs-function` (тот же ключ). При dispatch:
- Artifact descriptor `{ id: 'user_service', name: 'user_service', type: 'nestjs-function' }` создаётся.
- Materializer `yandex-function` вызывает `supports` → `true`.
- `materialize` возвращает `TerraformResource({ kind: 'resource', type: 'yandex_function', name: 'user_service', configuration: {...} })`.
- Генерируется `user_service.ycsf.tf.json` в `infra/`.
- User-owned `*.tf` файлы не затронуты.

**Why this priority**: Core happy path; без этого dispatch бесполезен.

**Independent Test**: Создать fixture materializer (supports: always true, materialize: returns canned TerraformResource); вызвать dispatch с одним app; проверить generatedFiles содержит 1 файл с правильным content.

**Acceptance Scenarios**:

1. **Given** проект с 1 app `user_service` (builder: `nestjs-function`), registry с 1 materializer `yandex-function` (supports: `true` для `nestjs-function`), **When** dispatch(projectModel, registry), **Then** result.kind === 'ok', result.resources.length === 1, result.generatedFiles.length === 1, filename === 'user_service.ycsf.tf.json', content contains `"yandex_function"` и `"user_service"`.
2. **Given** то же условие, **When** dispatch завершён, **Then** в `infra/` directory user-owned `.tf` файлы остаются без изменений.

---

### User Story 2 — Collision: two materializers claim the same artifact type (Priority: P1)

DevOps ошибочно registered два materializers с одинаковым supports (оба поддержиают `nestjs-function`). При dispatch — fail-fast error, ни один materializer не вызывается.

**Why this priority**: Constitution V (collision = fail-fast error, не silent pick). Невыполнение = нарушение constitution.

**Independent Test**: Создать два fixture materializers, оба supports возвращают `true` для `nestjs-function`; dispatch возвращает ошибку `MTL_COLLISION`.

**Acceptance Scenarios**:

1. **Given** проект с 1 app `user_service` (builder: `nestjs-function`), registry с 2 materializers (`m1`, `m2`), оба supports: `true` для `nestjs-function`, **When** dispatch(projectModel, registry), **Then** result.kind === 'invalid', errors содержит MTL_COLLISION с указанием artifact type и обоих materializer ids.
2. **Given** то же условие, **When** dispatch завершён, **Then** ни один из materializers НЕ вызывал `materialize` (dispatch aborted до materialize на collision).

---

### User Story 3 — Unhandled artifact: no materializer supports the type (Priority: P1)

App `analytics` имеет builder `docker`, но ни один materializer не поддерживает artifact type `docker`. При dispatch — error.

**Why this priority**: Constitution V (нет silent skip; unhandled artifact = error, не warning). Если нет materializer — это configuration mistake, должен быть обнаружен рано.

**Independent Test**: Создать fixture materializer, supports возвращает `false` для `docker`; dispatch возвращает ошибку `MTL_UNHANDLED_ARTIFACT`.

**Acceptance Scenarios**:

1. **Given** проект с 1 app `analytics` (builder: `docker`), registry с 1 materializer `yandex-function` (supports: `false` для `docker`), **When** dispatch(projectModel, registry), **Then** result.kind === 'invalid', errors содержит MTL_UNHANDLED_ARTIFACT с artifact type `docker` и список registered materializer ids.
2. **Given** проект с 2 apps: `user_service` (builder: `nestjs-function`) и `analytics` (builder: `docker`), registry с 1 materializer `yandex-function` (supports: `true` для `nestjs-function`, `false` для `docker`), **When** dispatch(projectModel, registry), **Then** result.kind === 'invalid', errors содержит MTL_UNHANDLED_ARTIFACT для `analytics`; `materialize` для `user_service` НЕ вызывается (all-or-nothing).

---

### User Story 4 — Multiple apps in dependency order (Priority: P1)

DevOps имеет проект с тремя apps: `frontend` (depends_on: `user_service`), `user_service` (depends_on: `analytics`), `analytics` (no deps). Materializers supports все три types. При dispatch:
- Порядок artifacts: `analytics` → `user_service` → `frontend` (topological order из spec 011).
- Генерируются три `.tf.json` файла: `analytics.ycsf.tf.json`, `user_service.ycsf.tf.json`, `frontend.ycsf.tf.json`.

**Why this priority**: Deterministic ordering — requirement; dependency order влияет на Terraform plan (resources нужно создавать в правильном порядке).

**Independent Test**: Dispatch с 3 apps в known dependency order; проверить порядок в result.resources и result.generatedFiles.

**Acceptance Scenarios**:

1. **Given** проект с apps: `analytics` (no deps), `user_service` (depends_on: `analytics`), `frontend` (depends_on: `user_service`), registry с 3 materializers (supports все types), **When** dispatch(projectModel, registry), **Then** result.kind === 'ok', result.resources[0].name === 'analytics', result.resources[1].name === 'user_service', result.resources[2].name === 'frontend'.
2. **Given** то же условие, **When** dispatch завершён, **Then** result.generatedFiles содержит 3 файла с именами `<app_id>.ycsf.tf.json` в том же порядке.

---

### User Story 5 — Regeneration overwrites only generated files (Priority: P1)

Повторный dispatch + write перезаписывает только `*.ycsf.tf.json` файлы. User-owned `*.tf` файлы в `infra/` не удаляются и не модифицируются.

**Why this priority**: Regeneration safety — прямое требование Constitution IV (C-generated files; user files untouched).

**Independent Test**: Создать user `main.tf` в `infra/`; выполнить dispatch + write; проверить, что `main.tf` не изменился, а `*.ycsf.tf.json` обновились.

**Acceptance Scenarios**:

1. **Given** `infra/main.tf` (user-owned) и dispatch сгенерировал `user_service.ycsf.tf.json`, **When** writeGeneratedTerraform('infra', files) вызван, **Then** `infra/main.tf` остаётся без изменений, `infra/user_service.ycsf.tf.json` создан/перезаписан.
2. **Given** `infra/old.ycsf.tf.json` от предыдущего dispatch (app удалён), **When** dispatch + write для проекта без этого app, **Then** `infra/old.ycsf.tf.json` удаляется (old generated files не в текущем наборе).

---

### User Story 6 — Materializer throws during materialize (Priority: P1)

Fixture materializer.supports возвращает `true`, но materialize бросает ошибку. Dispatch поймает ошибку и вернёт diagnostic `MTL_MATERIALIZE_FAILED` для этого artifact; dispatch aborted (abort-on-first): последующие artifacts не материализуются.

**Why this priority**: Materializer — external plugin; его ошибки не должны crash entire dispatch.

**Independent Test**: Создать fixture materializer с throws в materialize; dispatch с одним app; result.kind === 'invalid', errors содержит MTL_MATERIALIZE_FAILED.

**Acceptance Scenarios**:

1. **Given** проект с 1 app `user_service`, materializer supports: `true`, materialize: throws Error('plugin crashed'), **When** dispatch(projectModel, registry), **Then** result.kind === 'invalid', errors содержит MTL_MATERIALIZE_FAILED с artifact id `user_service` и message содержит 'plugin crashed'.
2. **Given** проект с 2 apps, первый materialize succeeds, второй throws, **When** dispatch(projectModel, registry), **Then** result.kind === 'invalid', errors содержит MTL_MATERIALIZE_FAILED для второго app; первый resource не в result.resources (dispatch aborted на error).

---

### User Story 7 — Empty registry (no materializers) with apps (Priority: P2)

Registry загружена, но нет materializer entries (пустой `materializers:` в builders.yaml). Dispatch с apps → MTL_UNHANDLED_ARTIFACT на каждом app.

**Why this priority**: Граничный случай; registry must be loadable, dispatch must handle empty state gracefully.

**Independent Test**: Создать registry с 0 materializers; dispatch с 1 app; result.kind === 'invalid', errors содержит MTL_UNHANDLED_ARTIFACT.

**Acceptance Scenarios**:

1. **Given** registry с 0 materializers, проект с 1 app `user_service` (builder: `nestjs-function`), **When** dispatch(projectModel, registry), **Then** result.kind === 'invalid', errors содержит MTL_UNHANDLED_ARTIFACT для artifact type `nestjs-function`.
2. **Given** registry с 0 materializers, проект с 0 apps, **When** dispatch(projectModel, registry), **Then** result.kind === 'ok', result.resources.length === 0, result.generatedFiles.length === 0.

---

### User Story 8 — Deterministic output across runs (Priority: P1)

Одинаковый input (ProjectModel + PluginRegistry) → одинаковые bytes в `.tf.json` (stable JSON key ordering). Determinism критичен для diff-базированного workflows (git diff, CI checks).

**Why this priority**: Determinism — requirement spec 014; без него regeneration непредсказуема.

**Independent Test**: Два dispatch вызова с одними и теми же данными → identical generatedFiles content.

**Acceptance Scenarios**:

1. **Given** одинаковые projectModel и registry, **When** dispatch вызван дважды, **Then** result1.generatedFiles и result2.generatedFiles идентичны (по content; filenames идентичны по construction).

---

### Edge Cases

- **Empty registry (0 materializers) + 0 apps**: dispatch возвращает `ok` с пустыми lists (User Story 7 scenario 2).
- **Empty registry (0 materializers) + apps**: `MTL_UNHANDLED_ARTIFACT` на каждом app.
- **App с builder id, совпадающим с materializer key**: возможен (builder и materializer — разные concepts, один ключ может быть в builders и в materializers — spec 013 это допускает). Dispatch: artifact type = builder id; materializer supports = по type, не по id совпадению.
- **Materializer supports много artifact types**: dispatch автоматически найдёт единственный поддерживающий для каждого artifact. Collision detection — per artifact, не per materializer.
- **TerraformResource.type/name содержит invalid chars для tf address**: error `MTL_INVALID_TERRAFORM_ADDRESS` (diagnostic содержит type, name, и invalid char). Validation: type/name matches Terraform identifier grammar (`[a-zA-Z_][a-zA-Z0-9_]*`).
- **Duplicate output name declaration**: `MTL_OUTPUT_NAME_COLLISION` (Constitution V: collision = error, не merge).
- **Materializer supports returns true для artifact type, но type не в registered builder set**: dispatch operates на artifact descriptors из ProjectModel, which validates builders (spec 013). Unhandled scenario impossible for known builders (spec 013 guarantees); but if a materializer's supports is overly broad (claims types not in project) — no issue; dispatch only iterates project's artifacts.

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST строить Artifact descriptors из ProjectModel: каждый app → artifact descriptor `{ id: app.app_id, name: app.app_id, type: app.builder }`.
- **FR-002**: System MUST dispatch каждый artifact на registered materializers: для каждого materializer (kind: 'materializer') из PluginRegistry вызвать `supports(artifact, context)` и подсчитать supporters.
- **FR-003**: System MUST выдавать `MTL_COLLISION` error при 2+ supporters для одного artifact type; selection error (all-or-nothing): при наличии любой selection error `materialize` НЕ вызывается ни для одного artifact.
- **FR-004**: System MUST выдавать `MTL_UNHANDLED_ARTIFACT` error при 0 supporters для artifact type; это error (fail-fast), не warning (Constitution V).
- **FR-005**: System MUST вызывать `materialize(artifact, context)` для supporter, выбранного в фазе 1; результат — TerraformResource.
- **FR-006**: System MUST поймать ошибки materialize и обернуть в `MTL_MATERIALIZE_FAILED` diagnostic (artifactId + materializerId + original message); materializer error НЕ crash dispatch, но dispatch aborted (abort-on-first): последующие artifacts не материализуются.
- **FR-007**: System MUST сериализовать TerraformResource в `.tf.json` валидный Terraform JSON: `{ "resource": { <type>: { <name>: <configuration> } } }`.
- **FR-008**: System MUST использовать filename `<app_id>.ycsf.tf.json` для каждого generated resource; filename вычисляется deterministic из app_id.
- **FR-009**: System MUST генерировать стабильный JSON: keys отсортированы лексикографически; одинаковый input → одинаковые bytes.
- **FR-010**: System MUST обнаруживать filename collision (если два ресурса вычисляются в одинаковый filename) → `MTL_FILENAME_COLLISION` error (unlikely по construction, но defensively required).
- **FR-011**: System MUST валидировать TerraformResource.type и .name на соответствие Terraform identifier grammar (`[a-zA-Z_][a-zA-Z0-9_]*`); нарушение → `MTL_INVALID_TERRAFORM_ADDRESS`.
- **FR-012**: System MUST сериализовать outputs (объявленные через `context.output.declare(...)`) в `00-ycsf-outputs.tf.json`: `{ "output": { <name>: { "value": "${<value>}" } } }`.
- **FR-013**: System MUST обнаруживать duplicate output name declaration → `MTL_OUTPUT_NAME_COLLISION` error (Constitution V).
- **FR-014**: System MUST обрабатывать artifacts в topological order apps из `ProjectModel.depends_on_graph.topologicalOrder`; ties — alphabetical по app_id.
- **FR-015**: `writeGeneratedTerraform(infraDir, files)` MUST записывать/перезаписывать ровно указанные файлы; не удалять/не модифицировать файлы, не входящие в `files` list.
- **FR-016**: System MUST определять generated filenames перед write; на regenerate — удалить/перезаписать ровно эти имена (no orphaned generated files).
- **FR-017**: System MUST НЕ вызывать `materialize`, если в фазе 1 есть хотя бы одна ошибка selection (collision или unhandled); result.kind === 'invalid' с ВСЕМИ selection errors (all-or-nothing).

### Error Codes (MTL_* family)

| Code | Description |
|------|-------------|
| `MTL_COLLISION` | Two materializers claim `supports` for the same artifact type |
| `MTL_UNHANDLED_ARTIFACT` | No materializer supports the artifact type |
| `MTL_MATERIALIZE_FAILED` | Materializer threw during `materialize()` |
| `MTL_FILENAME_COLLISION` | Two resources computed to the same `.tf.json` filename |
| `MTL_INVALID_TERRAFORM_ADDRESS` | TerraformResource.type or .name contains invalid chars |
| `MTL_OUTPUT_NAME_COLLISION` | Duplicate output name declaration via OutputBuilder |

### Key Entities

- **ArtifactDescriptor**: `{ id: string, name: string, type: string }` — плоский дескриптор, создаваемый из App (spec 011). `type` = app builder id (dispatch key для materializer supports). Не путать с `Artifact` (spec 002) — ArtifactDescriptor это входной дескриптор dispatch; Artifact (spec 002) это результат builder execution (spec 021). Spec 014 dispatch работает с ArtifactDescriptor.

- **MaterializationContext**: переиспользуется из spec 002 контракт (`contracts/materializer.ts`): `{ output: OutputBuilder }`. Определяется spec 014 только как consumer; не расширяется.

- **DispatchedResource**: результат materialize: `{ resource: TerraformResource, appId: string }` — internal entity dispatch, не part of public API.

- **GeneratedTfFile**: `{ filename: string, content: string }` — serialized `.tf.json` content. Public result type dispatch API.

- **DispatchResult**: discriminated union `DispatchResultOk | DispatchResultInvalid`. Public API type; содержит `resources`, `generatedFiles` (ok) или `errors` (invalid).

- **DispatchDiagnostic**: `{ code, message, artifactId?, materializerIds?, materializerId?, type?, name?, outputName?, filename? }` — diagnostic для dispatch failures (полный набор optional-полей см. data-model.md / `contracts/materialize.json`). Codes: `MTL_*`.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Materializer collision (2 supporters) обнаруживается при dispatch до любого `materialize` вызова; diagnostic содержит artifact type и оба materializer ids.
- **SC-002**: Unhandled artifact (0 supporters) обнаруживается при dispatch; diagnostic содержит artifact type и список registered materializer ids.
- **SC-003**: Deterministic dispatch: одинаковый input (ProjectModel + PluginRegistry) → одинаковые generatedFiles content (stable JSON serialization).
- **SC-004**: Generated `.tf.json` файлы валидны по Terraform JSON syntax; `terraform validate` проходит (с fixtures, не с real providers — нет provider schema; validation caveat documented).
- **SC-005**: Regeneration: повторный dispatch + write перезаписывает только `*.ycsf.tf.json` файлы; user-owned `*.tf` файлы не модифицируются и не удаляются.
- **SC-006**: Materializer throw during materialize → diagnostic `MTL_MATERIALIZE_FAILED`; dispatch НЕ crash; dispatch aborted (abort-on-first): последующие artifacts не материализуются; ошибка прорепортена, не проглочена.
- **SC-007**: Selection errors (collision / unhandled) → result.kind === 'invalid' с ВСЕМИ selection errors; `materialize` НЕ вызывается ни для одного artifact (all-or-nothing).
- **SC-008**: 100% acceptance criteria spec 014 покрыты тестами (Constitution II); каждый AC → ≥1 тест.

---

## Assumptions

- **One artifact per app**: Spec 014 dispatch создаёт ровно один Artifact descriptor на app. Real materializers (spec 019) могут генерировать больше ресурсов (например, app → function + log group + IAM binding), но это будет обрабатываться в spec 019/021; dispatch на spec 014 level — one artifact descriptor → one TerraformResource.
- **Fixture materializers**: Тесты spec 014 используют fixture materializers (inline objects с `supports: () => true`, `materialize: () => canned TerraformResource`). Real materializer packages — spec 019.
- **JSON serialization**: Keys сортируются лексикографически. Используется stable JSON serializer (например, `JSON.stringify` с replacer с sorted keys; или equivalent). Determinism — requirement; specific library choice — implementation detail.
- **`00-ycsf-outputs.tf.json`**: Outputs (если есть) идут в один файл; filename детерминирован и не конфликтует с app filenames (app_id не может начинаться с `00-` по construction — apps.yaml keys are `\w+`).
- **Terraform JSON syntax**: `.tf.json` формат — валидный JSON, читаемый Terraform как module config. `{ "resource": { <type>: { <name>: <config> } } }` — standard Terraform JSON syntax.
- **Dispatch не вызывает Terraform CLI**: Spec 014 заканчивается на `.tf.json` generation на disk (или in-memory GeneratedTfFile structs). Plan/apply — spec 021.
- **`context.output` — transient per-dispatch-call**: OutputBuilder создаётся на вызов dispatch; outputs accumulated, then serialized. Output names глобально уникальны (collision = error).
- **Cross-spec contract refinement (Constitution III, additive)**: dispatch передаёт materializer-ам `ArtifactDescriptor` (spec 014), а не `Artifact` (spec 002 built value). Контрактный generic в файле spec-002 `packages/pilot/src/contracts/materializer.ts` аддитивно расширяется: `Materializer<A extends Artifact = Artifact>` → `Materializer<A = Artifact>` (default прежний, non-breaking; существующие plugin-ы и `fr-014-dispatch.test-d.ts` остаются green; имплементируется в T050). Это осознанная аддитивная правка контракта 002, а не новый контракт.
- **Regeneration deletes orphaned generated files**: Write operation удаляет generated files, которые были в предыдущем generated set, но отсутствуют в текущем (removed apps). Implementation: maintain manifest of generated filenames; on write, delete orphans.

---

## References

- Spec 002: pilot-contracts — `Materializer`, `TerraformResource`, `MaterializationContext`, `OutputBuilder`, `Artifact`, `ContractError`
- Spec 013: builder-registry — `PluginRegistry`, `PluginEntry`, `loadRegistry`, `validateBuilders`
- Spec 011: project-model — `ProjectModel`, `App`, `DependsOnGraph.topologicalOrder`
- IDEA.md §22: Materializer plugins (collision policy, dispatch flow)
- IDEA.md §23: Terraform model (`TerraformResource`, `TerraformBlock`)
- IDEA.md §24: Generated Terraform (`*.tf.json` convention, ownership separation, regeneration safety)
- Constitution I: Separation of responsibilities (C dispatch + serialize; no builder execution, no Terraform CLI)
- Constitution III: Contracts versioned (`version: 1`)
- Constitution IV: Terraform stays real Terraform; generated files minimal
- Constitution V: Explicit over magic (collision = fail-fast error, no silent skip)

---

## Next Steps

1. `/speckit.plan` — technical design: dispatch algorithm, `.tf.json` serialization, filename computation, output serialization, error codes (`MTL_*`), `GeneratedTfFile`, `DispatchResult` types in `src/contracts/`, `writeGeneratedTerraform` pure function.
2. `/speckit.tasks` — breakdown into implementation tasks with test-first approach.
3. `/speckit.implement` — code, tests (RED → GREEN), lint, typecheck.
