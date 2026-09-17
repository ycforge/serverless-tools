# Spec 019: materializers-yandex — function/container/api-gateway/queue/bucket TF materializers

## Metadata

- **Spec ID**: 019
- **Title**: materializers-yandex — function/container/api-gateway/queue/bucket TF materializers
- **Status**: 🚧 In Progress
- **Dependencies**: 002 (pilot-contracts ✅), 014 (materializer-dispatch ✅)
- **IDEA.md sections**: §22 (Materializer plugins), §23 (Terraform model), §27 (Minimal generated resources), §32 (API Gateway template materialization), §33 (Resource reference lifecycle), §37 (Serverless Containers)
- **Packages**: `packages/materializers-core` (`@ycforge/materializers-core`)

---

## Problem Statement

Spec 014 реализовал dispatch materializers: `supports`/`materialize`, collision policy, `TerraformResource` → `.tf.json` serialization. Spec 018 зафиксировал артефактные типы и формы `Artifact.value` (`ycforge:function`, `ycforge:docker-image`, `ycforge:frontend`). Однако ни одного конкретного materializer-пакета не существует: dispatch оперирует fixture-materializers, и канонический проект (`user_service` → функция, `analytics` → контейнер, `frontend` →.bucket, `openapi` → API gateway) не генерирует реального Terraform.

Spec 019 закрывает этот пробел: реализует **пять core materializer-плагинов** — реализаций контракта `Materializer` (spec 002), потребляющих артефактные типы spec 018 и генерирующих минимальные `TerraformResource` (IDEA §27) для Yandex Cloud:

1. **`yandex-function`** — материализует `ycforge:function` → `yandex_function`
2. **`yandex-serverless-container`** — материализует `ycforge:docker-image` → `yandex_serverless_container`
3. **`yandex-api-gateway`** — материализует `ycforge:api-gateway` → `yandex_api_gateway`
4. **`yandex-message-queue`** — материализует `ycforge:queue` → `yandex_message_queue`
5. **`yandex-storage-bucket`** — материализует `ycforge:frontend` → `yandex_storage_bucket` + `yandex_storage_object`

Дополнительно spec 019 фиксирует **каталог materializer-плагинов** (аналог каталога builders-core spec 018): mapping «artifact type → materializer module» для dispatch (spec 014) и C (spec 021).

Два новых артефактных типа (`ycforge:api-gateway`, `ycforge:queue`) не имеют соответствующего builder в spec 018 — их артефакты поступают из Project B (composer) и из explicit configuration соответственно. Spec 019 фиксирует их shapes как forward contract.

---

## Scope (In Scope)

### Зафиксированные решения (spec decisions)

**D-1 — Packaging: один пакет `packages/materializers-core` с subpath exports.** Все пять materializer-ов живут в одном npm-пакете `@ycforge/materializers-core` и экспортируются через subpath exports:

```text
@ycforge/materializers-core/yandex-function
@ycforge/materializers-core/yandex-serverless-container
@ycforge/materializers-core/yandex-api-gateway
@ycforge/materializers-core/yandex-message-queue
@ycforge/materializers-core/yandex-storage-bucket
```

Рациональность (зеркало D-1 spec 018):
- Монорепа: один пакет = один `package.json`, один `tsup`-config, общие diagnostic-хелперы `YMT_*`, общие standalone-типы (zero pilot imports).
- Конвенция subpath exports уже принята в репо: `@ycforge/builders-core/*`, `@ycforge/pilot/contracts`.
- Materializer-ы ни от чего не зависят (zero runtime dependencies), поэтому ставить один — не бремя.
- Диспатч (014/021) загружает materializer по подпути из `materializers.yaml` mapping (аналог `builders.yaml`).

**D-2 — Standalone-типы (zero pilot imports).** Пакет определяет собственные structural-реплики контрактов `Materializer`, `TerraformResource`, `MaterializationContext`, `OutputBuilder`, `Artifact` — точно как `builders-core` (spec 018, research D-RE-4 / Constitution I). Импорт из `@ycforge/pilot/contracts` запрещён (Constitution I: runtime isolation). Structural conformance проверяется compile-time conformance-тестом.

**D-3 — Новые артефактные типы: `ycforge:api-gateway`, `ycforge:queue`.** Spec 018 зафиксировал три типа (`ycforge:function`, `ycforge:docker-image`, `ycforge:frontend`). Spec 019 добавляет два:

| Artifact.type | Artifact.value shape | Источник | Materializer | TF resource |
|---|---|---|---|---|
| `ycforge:api-gateway` | `{ specPath: string; resourceReferences: ResourceReference[] }` | Project B (composer, spec 008/009) | `yandex-api-gateway` | `yandex_api_gateway` |
| `ycforge:queue` | `{ queueUrl: string }` | Explicit configuration | `yandex-message-queue` | `yandex_message_queue` |

Эти два типа добавляются в общий каталог пакета `@ycforge/materializers-core` и в `ArtifactType` union пакета. Формы `value` фиксируются как forward contract.

**D-4 — API Gateway materialization через `templatefile()`.** API Gateway materializer получает артефакт `{ specPath, resourceReferences }` от Project B. Materializer генерирует `yandex_api_gateway` Terraform resource, который использует `templatefile()` для подстановки Terraform expressions из resource references (IDEA §32–33). Логический ref `resources.functions.user_service.id` → Terraform expression `${yandex_function.user_service.id}` (IDEA §33 chain).

**D-5 — Bucket materializer генерирует два Terraform resources.** `yandex_storage_bucket` + `yandex_storage_object` (один файл на каждый файл в `value.directory`). Это唯一的 materializer, генерирующий >1 TerraformResource. Каждый `storage_object` получает имя `<app_id>_<sanitized_filename>` (алиас для стабильного TF address).

### Маппинг артефактных типов (полный каталог)

| Artifact.type | Artifact.value shape | Materializer subpath | Terraform resource type(s) |
|---|---|---|---|
| `ycforge:function` | `{ archivePath: string; entryPoint: string }` | `/yandex-function` | `yandex_function` |
| `ycforge:docker-image` | `{ image: string }` — digest form | `/yandex-serverless-container` | `yandex_serverless_container` |
| `ycforge:api-gateway` | `{ specPath: string; resourceReferences: ResourceReference[] }` | `/yandex-api-gateway` | `yandex_api_gateway` |
| `ycforge:queue` | `{ queueUrl: string }` | `/yandex-message-queue` | `yandex_message_queue` |
| `ycforge:frontend` | `{ directory: string }` | `/yandex-storage-bucket` | `yandex_storage_bucket` + `yandex_storage_object` |

### Materializer `yandex-function`

Вход: `Artifact<{ archivePath: string; entryPoint: string }>` (spec 018, `ycforge:function`).

```hcl
resource "yandex_function" "<name>" {
  runtime    = "nodejs22"
  entrypoint = "<entryPoint>"
  user_hash  = "<deterministic hash of archive>"

  content {
    zip_filename = "<archivePath>"
  }
}
```

- **supports**: `artifact.type === 'ycforge:function'`.
- **configuration**: заполняет только `runtime` (default `nodejs22`, перезаписываемый через extensions spec 015), `entrypoint` (из `value.entryPoint`), `user_hash` (хеш содержимого архива для deterministic TF state), `content.zip_filename` (относительный путь к архиву от infra/).
- **Minimal resources** (IDEA §27): только необходимые поля. Service account, environment, secrets, mounts — через extensions (spec 015) или user-owned `.tf`.
- **Output**: `context.output.declare('<name>_function_id', { value: 'yandex_function.<name>.id' })`.

### Materializer `yandex-serverless-container`

Вход: `Artifact<{ image: string }>` (spec 018, `ycforge:docker-image`).

```hcl
resource "yandex_serverless_container" "<name>" {
  image      = "<image>"
  name       = "<name>"
}
```

- **supports**: `artifact.type === 'ycforge:docker-image'`.
- **configuration**: `image` (из `value.image`, digest-form), `name` (app id). Memory, concurrency, service account — через extensions/spec 015.
- **Output**: `context.output.declare('<name>_container_id', { value: 'yandex_serverless_container.<name>.id' })`.

### Materializer `yandex-api-gateway`

Вход: `Artifact<{ specPath: string; resourceReferences: ResourceReference[] }>` (Project B, spec 008/009).

```hcl
resource "yandex_api_gateway" "<name>" {
  spec = file("${path.module}/generated/<name>-openapi.yaml")
}
```

- **supports**: `artifact.type === 'ycforge:api-gateway'`.
- Генерирует пере- materialized OpenAPI YAML (с подставленными resource references из `value.resourceReferences` — логические `${resources.functions.user_service.id}` → Terraform `${yandex_function.user_service.id}` через mapping IDEA §33) и записывает его как companion-файл. Тогда `spec` использует `file()` для чтения.
- Connections, variables — через extensions/spec 015.
- **Output**: `context.output.declare('<name>_gateway_id', { value: 'yandex_api_gateway.<name>.id' })`.

### Materializer `yandex-message-queue`

Вход: `Artifact<{ queueUrl: string }>`.

```hcl
resource "yandex_message_queue" "<name>" {
  queue_name = "<queue name from URL>"
  region     = "<region from URL>"
}
```

- **supports**: `artifact.type === 'ycforge:queue'`.
- Парсит `value.queueUrl` для извлечения queue name и region. Security/visibility timeout — через extensions/spec 015.
- **Output**: `context.output.declare('<name>_queue_id', { value: 'yandex_message_queue.<name>.id' })`.

### Materializer `yandex-storage-bucket`

Вход: `Artifact<{ directory: string }>` (spec 018, `ycforge:frontend`).

Генерирует **два** типа resources:

```hcl
resource "yandex_storage_bucket" "<name>" {
  bucket = "<name>"
  acl    = "public-read"
}

resource "yandex_storage_object" "<name>_<filename>" {
  bucket = yandex_storage_bucket.<name>.id
  key    = "<filename>"
  source = "<directory>/<filename>"
}
```

- **supports**: `artifact.type === 'ycforge:frontend'`.
- `yandex_storage_bucket`: создаёт bucket с `acl: "public-read"` (default для frontend; расширяемый через extensions).
- `yandex_storage_object`: один resource на каждый файл в `value.directory`. Имя object: `<app_id>_<sanitized_filename>` (алиас TF address стабилен). Если файлов нет — только bucket (empty bucket).
- ACL, CDN, website, lifecycle — через extensions/spec 015.
- **Output**: `context.output.declare('<name>_bucket_id', { value: 'yandex_storage_bucket.<name>.id' })`.

### Каталог materializer-плагинов

Аналог catalogs builders-core (spec 018):

```typescript
export interface MaterializerCatalogEntry {
  readonly id: 'yandex-function' | 'yandex-serverless-container' | 'yandex-api-gateway' | 'yandex-message-queue' | 'yandex-storage-bucket';
  readonly package: '@ycforge/materializers-core';
  readonly modulePath: string;
  readonly artifactType: ArtifactType;
}

export const ARTIFACT_TYPES: readonly ArtifactType[] = Object.freeze([
  'ycforge:function',
  'ycforge:docker-image',
  'ycforge:api-gateway',
  'ycforge:queue',
  'ycforge:frontend',
]);
```

### Scope boundaries (Out of Scope)

| Что | Почему не в scope | Owner |
|-----|-------------------|-------|
| Builder execution / orchestration | Spec 018 (builders), spec 021 (ycsf build) | Spec 021 |
| Terraform CLI (plan/apply/destroy) | Spec 021 | Spec 021 |
| Extensions / deep merge / overrides | Spec 015; materializer генерирует base TF resource, extensions добавляют | Spec 015 |
| Dispatch mechanism | Spec 014 (уже реализован) | Spec 014 |
| CLI commands | Spec 021 (ycsf build/materialize) | Spec 021 |
| Output auto-generation (`.ycsf/outputs.yaml`) | Spec 016 | Spec 016 |
| Moved blocks | Spec 017 | Spec 017 |
| Builder-плагины для api-gateway/queue артефактов | api-gateway — Project B (composer, spec 008); queue — explicit config; builders spec 018 охватывают function/docker/frontend | Spec 008 |
| Дополнительные Yandex-ресурсы (IAM, VPC, Lockbox) | Extensions (spec 015) и user-owned `.tf` | User / spec 015 |

---

## User Scenarios & Testing

### User Story 1 — DevOps материализует функцию (Priority: P1)

DevOps с app `user_service` (артефакт `ycforge:function: { archivePath, entryPoint }`) вызывает materializer `yandex-function`. Materializer проверяет `supports` → `true`, генерирует `TerraformResource` с `yandex_function`, и dispatch (spec 014) сериализует его в `user_service.ycsf.tf.json`.

**Why this priority**: function — базовый деплой-таргет serverless-tools;materializer function является самым частым usage scenario.

**Independent Test**: Вызвать `materialize()` на fixture artifact `ycforge:function`; проверить возвращённый `TerraformResource { kind: 'resource', type: 'yandex_function', name: ..., configuration: { runtime, entrypoint, content } }`.

**Acceptance Scenarios**:

1. **Given** artifact `{ type: 'ycforge:function', value: { archivePath: '/abs/path/function.zip', entryPoint: 'index.handler' } }`, **When** вызывается `materialize()`, **Then** `TerraformResource.type === 'yandex_function'`; `configuration.entrypoint === 'index.handler'`; `configuration.content.zip_filename` существует.
2. **Given** тот же артефакт, **When** `supports()` вызван с артефактом `{ type: 'ycforge:docker-image' }`, **Then** возвращает `false` (не поддерживает другие типы).
3. **Given** артефакт с `type: 'ycforge:function'`, **When** `materialize()` завершён, **Then** `context.output` содержит `declare` для `function_id` с Terraform expression `yandex_function.<name>.id`.

---

### User Story 2 — DevOps материализует контейнер и frontend (Priority: P1)

DevOps с apps `analytics` (`ycforge:docker-image: { image: "cr.yandex/...@sha256:..." }`) и `frontend` (`ycforge:frontend: { directory: "/abs/dist" }`) материализует оба через materializers `yandex-serverless-container` и `yandex-storage-bucket`.

**Why this priority**: контейнер и frontend — полные деплой-таргеты; bucket- materializer единственный, генерирующий >1 TF resource.

**Independent Test**: Вызвать `materialize()` на каждом fixture artifact; проверить shapes возвращённых `TerraformResource`.

**Acceptance Scenarios**:

1. **Given** artifact `ycforge:docker-image: { image: "cr.yandex/app@sha256:abc123" }`, **When** `yandex-serverless-container` `materialize()`, **Then** `TerraformResource.type === 'yandex_serverless_container'`; `configuration.image === "cr.yandex/app@sha256:abc123"`.
2. **Given** artifact `ycforge:frontend: { directory: "/tmp/dist" }` с тремя файлами (`index.html`, `style.css`, `app.js`), **When** `yandex-storage-bucket` `materialize()`, **Then** возвращается массив из 3 ресурсов: 1× `yandex_storage_bucket` + 3× `yandex_storage_object` (один на файл).
3. **Given** artifact `ycforge:frontend: { directory: "/tmp/empty-dist" }` с 0 файлами, **When** `yandex-storage-bucket` `materialize()`, **Then** возвращается 1 ресурс: `yandex_storage_bucket` (пустой bucket).

---

### User Story 3 — DevOps материализует API Gateway с resource references (Priority: P1)

DevOps с app `openapi` (артефакт `ycforge:api-gateway: { specPath, resourceReferences }` от Project B) материализует через `yandex-api-gateway`. Materializer подставляет логические resource references в OpenAPI spec через `templatefile()`, генерирует companion-файл, и создаёт `yandex_api_gateway` TF resource.

**Why this priority**: API Gateway — ключевой связующий элемент между apps; materializer должен правильно разрезолвить логические refs в TF expressions (IDEA §32–33).

**Independent Test**: Вызвать `materialize()` на fixture artifact с одним resource reference (`functions.user_service.id`); проверить, что companion spec содержит `${yandex_function.user_service.id}` и что TF resource ссылается на companion file.

**Acceptance Scenarios**:

1. **Given** artifact `ycforge:api-gateway: { specPath: '/generated/openapi.yaml', resourceReferences: [{ logical: 'functions.user_service', terraformType: 'yandex_function' }] }`, **When** `yandex-api-gateway` `materialize()`, **Then** `TerraformResource.type === 'yandex_api_gateway'`; `configuration.spec` содержит `file(...)` expression; companion файл содержит `${yandex_function.user_service.id}` вместо `${resources.functions.user_service.id}`.
2. **Given** артефакт с 0 resource references (plain OpenAPI), **When** `materialize()`, **Then** companion spec копируется as-is; `yandex_api_gateway` resource создан.

---

### Edge Cases

- **`archivePath` не существует** (yandex-function): materializer trust'ит builder output (spec 018), но `user_hash` требует прочитать архив, поэтому отсутствующий файл на момент `materialize()` даёт **raw fs-ошибку (ENOENT)**, НЕ `MaterializerError`/YMT-диагностику; dispatch (014) обернёт её в `MTL_MATERIALIZE_FAILED`.
- **Пустой `directory`** (yandex-storage-bucket): создаётся только `yandex_storage_bucket` без `storage_object` resources.
- **Имя файла содержит unsafe chars** (yandex-storage-bucket): sanitized для TF address (`[a-z0-9_]`), оригинальное имя сохраняется в `key` TF config.
- **Resource reference не найден в TF state** (yandex-api-gateway): materializer заменяет логический ref на TF expression; actual resolution — на этапе `terraform apply`. Материализатор не проверяет существование.
- **`queueUrl` с некорректным форматом** (yandex-message-queue): fail-fast `YMT_INVALID_QUEUE_URL` (base URL не парсится).
- **Materializer для неизвестного artifact type**: dispatch (014) обнаруживает `MTL_UNHANDLED_ARTIFACT`; materializer无关.

---

## Requirements

### Functional Requirements

**Пакет и регистрация**

- **FR-001**: Пакет `@ycforge/materializers-core` MUST экспортировать пять materializer-модулей через subpath exports `/yandex-function`, `/yandex-serverless-container`, `/yandex-api-gateway`, `/yandex-message-queue`, `/yandex-storage-bucket`; каждый модуль default-экспортирует объект с `supports: Function` и `materialize: AsyncFunction` (spec 002 Materializer shape), так что registry (013) распознаёт его как `kind: 'materializer'`.
- **FR-002**: Каждый materializer MUST работать от одного только `Artifact` + `MaterializationContext` (spec 002) без знания pilot internals (Constitution I); пакет не содержит импортов из `@ycforge/pilot` (standalone-типы, D-2).
- **FR-003**: Пакет MUST экспортировать machine-readable catalog mapping «materializer id → Artifact.type» (аналог FR-003 spec 018) для dispatch (014) и C (021).
- **FR-004**: Каждый materializer MUST возвращать `TerraformResource { kind: 'resource', type, name, configuration }` (spec 002 контракт); type/name соответствуют Terraform identifier grammar (`[a-zA-Z_][a-zA-Z0-9_]*`).
- **FR-005**: Каждый materializer MUST declare output через `context.output.declare(...)` для primary resource id (Function ID, Container ID, Gateway ID, Queue ID, Bucket ID).

**yandex-function**

- **FR-006**: `supports()` MUST возвращать `true` только для `artifact.type === 'ycforge:function'`.
- **FR-007**: `materialize()` MUST генерировать `TerraformResource { type: 'yandex_function', name: <app_id>, configuration: { runtime, entrypoint, user_hash, content: { zip_filename } } }`.
- **FR-008**: `runtime` MUST default `nodejs22`; значение может быть перезаписано extensions (spec 015), но materializer не читает extensions — генерирует default.
- **FR-009**: `user_hash` MUST быть детерминированным хешем содержимого архива (для стабильного Terraform state при неизменном контенте).
- **FR-010**: `content.zip_filename` MUST быть относительным путём к архиву (относительно `infra/`), не абсолютным.

**yandex-serverless-container**

- **FR-011**: `supports()` MUST возвращать `true` только для `artifact.type === 'ycforge:docker-image'`.
- **FR-012**: `materialize()` MUST генерировать `TerraformResource { type: 'yandex_serverless_container', name: <app_id>, configuration: { image, name } }`.
- **FR-013**: `image` MUST быть передан as-is из `value.image` (digest-form `cr.yandex/...@sha256:...`; immutable).

**yandex-api-gateway**

- **FR-014**: `supports()` MUST возвращать `true` только для `artifact.type === 'ycforge:api-gateway'`.
- **FR-015**: `materialize()` MUST подменять логические resource references (`${resources.<type>.<name>.id}`) в `value.specPath` на Terraform expressions (`${<terraformType>.<name>.id}`) и записать результат как companion-файл.
- **FR-016**: `TerraformResource` MUST содержать `configuration.spec` с `file()` expression, ссылающийся на companion-файл.
- **FR-017**: Если `value.resourceReferences` пуст — companion spec копируется as-is.

**yandex-message-queue**

- **FR-018**: `supports()` MUST возвращать `true` только для `artifact.type === 'ycforge:queue'`.
- **FR-019**: `materialize()` MUST генерировать `TerraformResource { type: 'yandex_message_queue', name: <app_id>, configuration: { queue_name, region } }`.
- **FR-020**: `queue_name` и `region` MUST быть извлечены из `value.queueUrl`; некорректный URL → `YMT_INVALID_QUEUE_URL`.

**yandex-storage-bucket**

- **FR-021**: `supports()` MUST возвращать `true` только для `artifact.type === 'ycforge:frontend'`.
- **FR-022**: `materialize()` MUST генерировать 1 `yandex_storage_bucket` resource (name: <app_id>, bucket: <app_id>, acl: "public-read").
- **FR-023**: `materialize()` MUST генерировать по 1 `yandex_storage_object` resource на каждый файл в `value.directory`: name `<app_id>_<sanitized_filename>`, bucket reference `yandex_storage_bucket.<app_id>.id`, key = original filename, source = absolute file path.
- **FR-024**: Если `value.directory` пуст (0 файлов) — генерируется только `yandex_storage_bucket`.
- **FR-025**: Имя файла для TF address MUST быть sanitized: `[a-zA-Z0-9_]` только; оригинальное имя сохраняется в `key`.

**Диагностики**

- **FR-026**: Materializer-ы MUST fail-fast с diagnostic `YMT_INVALID_QUEUE_URL` при некорректном `queueUrl` (FR-020).
- **FR-027**: Diagnostic codes MUST использоваться как константы (identifiers), не как string literals (Constitution V).

### Error Codes (YMT_* family)

| Code | Description |
|------|-------------|
| `YMT_INVALID_QUEUE_URL` | Invalid queueUrl format; cannot extract queue_name or region |
| `YMT_INVALID_ARTIFACT_VALUE` | Artifact value missing required fields (e.g., no `archivePath`) |
| `YMT_EMPTY_DIRECTORY` | No files in frontend directory (warning; bucket created without objects) |

### Key Entities

- **ArtifactType** (расширение catalog spec 018): `'ycforge:function' | 'ycforge:docker-image' | 'ycforge:api-gateway' | 'ycforge:queue' | 'ycforge:frontend'` — union типов, поддерживаемых materializers-core.

- **MaterializerCatalogEntry**: `{ id, package, modulePath, artifactType }` — mapping materializer id → artifact type для dispatch.

- **Standalone-типы** (zero pilot imports): `Materializer`, `MaterializationContext`, `OutputBuilder`, `TerraformResource`, `Artifact<T>` — structural replicas spec 002 contracts. Compile-time conformance test в `packages/pilot/test/types/`.

- **ApiGatewayArtifactValue**: `{ specPath: string; resourceReferences: ResourceReference[] }` — где `ResourceReference: { logical: string; terraformType: string }` (IDEA §33).

- **QueueArtifactValue**: `{ queueUrl: string }` — полный URL очереди.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Для канонического reference-проекта каждый из пяти materializers поддерживает ровно один `Artifact.type` и генерирует корректный `TerraformResource`: `yandex_function`, `yandex_serverless_container`, `yandex_api_gateway`, `yandex_message_queue`, `yandex_storage_bucket` + `yandex_storage_object`s.
- **SC-002**: Dispatch (spec 014) с catalog из `@ycforge/materializers-core` загружает все пять модулей по subpath-спецификаторам; `MTL_COLLISION` и `MTL_UNHANDLED_ARTIFACT` — 0 для канонического проекта.
- **SC-003**: Каждый materializer работает только от `Artifact` + `MaterializationContext` (standalone-вызов вне pilot подтверждён тестом). Импорт `@ycforge/pilot` в пакете отсутствует.
- **SC-004**: API Gateway materializer корректно заменяет логические resource references на Terraform expressions в companion spec; проверяется assertion-тестом.
- **SC-005**: Bucket materializer генерирует ровно N `storage_object` resources для директории из N файлов; пустая директория → только bucket.
- **SC-006**: Детерминизм: одинаковый артефакт → бинарно идентичный `TerraformResource` configuration (кроме companion file path;相同的 content).
- **SC-007**: 100% acceptance criteria spec 019 покрыты тестами (Constitution II: каждый AC → ≥1 тест, RED → GREEN); `typecheck`/`lint` пакета — чисто.

---

## Assumptions

- **D-1 (packaging)**: единый пакет `@ycforge/materializers-core` с subpath exports. Зеркало D-1 spec 018.
- **D-2 (standalone types)**: structural-реплики контрактов 002 без импортов pilot (Constitution I). Compile-time conformance test.
- **D-3 (new artifact types)**: `ycforge:api-gateway` и `ycforge:queue` добавляются как forward contract; Project B (composer) и explicit config будут генерировать эти артефакты в spec 021.
- **D-4 (templatefile)**: API Gateway materializer использует `templatefile()` Terraform mechanism (IDEA §32) для подстановки resource references. Это solution choice; plan-фаза может предложить альтернативу (прямая замена строк).
- **D-5 (multi-resource)**: bucket- materializer генерирует >1 TerraformResource. Dispatch spec 014 currently limits to one resource per app. Implementation detail: materializer возвращает массив, C (021) сериализует все. Spec 014 fixture-тесты остаются single-resource; real dispatch (021) обрабатывает multi-resource.
- **Architecture artifact (B-composer)**: API Gateway артефакт поступает от Project B (composer, spec 008). Spec 019 фиксирует shape; реальный producer — spec 008/021.
- **Queue артефакт**: `ycforge:queue` не имеет builder в spec 018; артефакт создаётся из explicit configuration (`.ycsf/apps.yaml` с builder: `"queue"`) или фабричного метода C (spec 021). Spec 019 фиксирует shape; mechanism генерации — spec 021.
- **`user_hash` детерминирован**: SHA-256 содержимого архива (или эквивалент). Конкретный хеш-алгоритм — implementation detail; stability — requirement.
- **`acl: "public-read"` для bucket**: default для frontend. Расширяемый через extensions (spec 015). Plan-фаза может предложить configurable default.
- **Materializer не валидирует existence files/archive**: trust builder output (spec 018 guarantees). Исключение — `user_hash` обязан прочитать архив: отсутствующий файл пробрасывается как raw fs-ошибка на `materialize()` (не `MaterializerError`/YMT-код, Т119); dispatch 014 оборачивает её в `MTL_MATERIALIZE_FAILED` (abort-on-first).
- **Dispatch multi-resource**: spec 014 ограничивает one-resource-per-app на fixture-level; real dispatch (021) будет materialize all resources из materializer result. Spec 019 не меняет dispatch semantics.

---

## References

- Spec 002: pilot-contracts — `Materializer`, `TerraformResource`, `MaterializationContext`, `OutputBuilder`, `Artifact`, `ContractError`
- Spec 014: materializer-dispatch — dispatch algorithm, collision policy, `.tf.json` serialization, `MTL_*` codes
- Spec 018: builders-core — artifact type catalog (`ycforge:function`, `ycforge:docker-image`, `ycforge:frontend`), `Artifact.value` shapes
- Spec 008: api-composition — API Gateway composition (Project B)
- Spec 009: resource-references — `${resources...}` template syntax, `ResourceReference`
- Spec 015: extensions — `.ycsf/extensions.yaml`, deep merge (additional TF config)
- IDEA.md §22: Materializer plugins (plugin API, collision policy)
- IDEA.md §23: Terraform model (`TerraformResource`)
- IDEA.md §27: Minimal generated resources (only minimal TF resource; extensions fill rest)
- IDEA.md §32: API Gateway template materialization (`templatefile()`)
- IDEA.md §33: Resource reference lifecycle (logical → Terraform expression → actual ID)
- IDEA.md §37: Serverless Containers (docker builder → immutable image ref → `yandex_serverless_container`)
- Constitution I: Separation of A/B/C/Terraform (materializer = standalone, no pilot imports)
- Constitution II: Test-first (RED → GREEN); exception for thin CLI wrappers
- Constitution III: Contracts versioning
- Constitution IV: Terraform stays real Terraform; minimal generated resources
- Constitution V: Explicit over magic (collision = fail-fast error, diagnostic codes as identifiers)

---

## Next Steps

1. `/speckit.plan` — technical design: пакет structure (subpath exports, tsup), standalone-типы, catalog, 5 materializer implementations, `YMT_*` diagnostics, API Gateway templatefile, bucket multi-resource, conformance test.
2. `/speckit.tasks` — разбивка на задачи с test-first (RED → GREEN) по acceptance criteria US1–US3.
3. `/speckit.analyze` — консистентность spec/plan/tasks.
4. `/speckit.implement` — код, тесты, typecheck/lint.
5. Согласование с spec 021 (ycsf build: materializer dispatch с реальными артефактами).
