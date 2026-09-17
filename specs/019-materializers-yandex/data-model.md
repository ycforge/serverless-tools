# Data Model: materializers-yandex

**Spec**: [specs/019-materializers-yandex/spec.md](./spec.md) | **Branch**: `019-materializers-yandex` | **Date**: 2026-09-10

Сущности публичного контракта пакета `@ycforge/materializers-core`, standalone structural types, каталог артефактных типов (включая два новых), формы `Artifact.value` для новых типов, пять materializer модулей, каталог диагностик `YMT_*`, карта subpath exports и формы `package.json`.

---

## 1. Публичная поверхность пакета (subpath exports map)

```text
@ycforge/materializers-core
├── .                                → каталог (FR-003) + общие типы (types.ts)
├── /yandex-function                 → default export Materializer (FR-001)
├── /yandex-serverless-container     → default export Materializer (FR-001)
├── /yandex-api-gateway              → default export Materializer (FR-001)
├── /yandex-message-queue            → default export Materializer (FR-001)
└── /yandex-storage-bucket           → default export Materializer (FR-001, multi-resource)
```

`package.json` форма:

```jsonc
{
  "name": "@ycforge/materializers-core",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "sideEffects": false,
  "files": ["dist"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "require": "./dist/index.cjs" },
    "./yandex-function": { "types": "./dist/yandex-function/index.d.ts", "import": "./dist/yandex-function/index.js", "require": "./dist/yandex-function/index.cjs" },
    "./yandex-serverless-container": { "types": "./dist/yandex-serverless-container/index.d.ts", "import": "./dist/yandex-serverless-container/index.js", "require": "./dist/yandex-serverless-container/index.cjs" },
    "./yandex-api-gateway": { "types": "./dist/yandex-api-gateway/index.d.ts", "import": "./dist/yandex-api-gateway/index.js", "require": "./dist/yandex-api-gateway/index.cjs" },
    "./yandex-message-queue": { "types": "./dist/yandex-message-queue/index.d.ts", "import": "./dist/yandex-message-queue/index.js", "require": "./dist/yandex-message-queue/index.cjs" },
    "./yandex-storage-bucket": { "types": "./dist/yandex-storage-bucket/index.d.ts", "import": "./dist/yandex-storage-bucket/index.js", "require": "./dist/yandex-storage-bucket/index.cjs" }
  },
  "scripts": { "build": "tsup", "test": "tsup && vitest run", "typecheck": "tsc --noEmit" },
  "devDependencies": { "@types/node": "^22.15.0", "tsup": "^8.5.0", "typescript": "^5.9.0", "vitest": "^3.2.0" }
}
```

- **Ноль runtime зависимостей** (pure functions, no I/O, no bundling, no child_process).
- `publishConfig.access: public` (как у builders-core).
- Peer/dev `@ycforge/pilot` **отсутствует** (D-2, standalone types, research D-RE-2).

## 2. Структура модулей `packages/materializers-core/src`

```text
src/
├── index.ts                          # root: реэкспорт catalog + types (FR-003)
├── types.ts                          # standalone structural: Materializer/MaterializationContext/OutputBuilder/TerraformResource/Artifact
├── catalog.ts                        # MATERIALIZER_IDS / ARTIFACT_CATALOG / ArtifactType (FR-003)
├── diagnostics.ts                    # YMT_* константы + MaterializerError extends Error { code }
├── helpers/
│   ├── output-builder.ts             # OutputBuilder implementation (stateful collector for output declarations)
│   └── filename.ts                   # TF address sanitization (bucket objects: [a-zA-Z0-9_]+)
├── yandex-function/
│   ├── index.ts                      # default export Materializer: supports(ycforge:function) → materialize(yandex_function)
│   └── hash.ts                       # SHA-256 archive content → user_hash
├── yandex-serverless-container/
│   └── index.ts                      # default export Materializer: supports(ycforge:docker-image) → materialize(yandex_serverless_container)
├── yandex-api-gateway/
│   ├── index.ts                      # default export Materializer: supports(ycforge:api-gateway) → materialize(yandex_api_gateway)
│   └── ref-resolver.ts               # ResourceReference[] → logical→TF expression replacement in spec
├── yandex-message-queue/
│   └── index.ts                      # default export Materializer: supports(ycforge:queue) → materialize(yandex_message_queue)
└── yandex-storage-bucket/
    └── index.ts                      # default export Materializer: supports(ycforge:frontend) → materialize(yandex_storage_bucket + N×yandex_storage_object)
```

Исполняемый пакет — только пункты 1–4 (public API); внутренние модули (5–7) — приватные.

## 3. Standalone structural types (src/types.ts) — контракт spec 002, без импортов pilot

### 3.1 Core contract replicas

```ts
export interface OutputBuilder {
  declare(name: string, output: { value: string; description?: string }): void;
}

export interface MaterializationContext {
  readonly output: OutputBuilder;
}

export interface TerraformResource<T = unknown> {
  readonly kind: 'resource';
  readonly type: string;
  readonly name: string;
  readonly configuration: T;
}

export interface Artifact<T = unknown> {
  readonly type: string;
  readonly value: T;
}

export interface Materializer<A = Artifact> {
  supports(artifact: A, context: MaterializationContext): boolean;
  materialize(artifact: A, context: MaterializationContext): Promise<TerraformResource | readonly TerraformResource[]>;
}
```

Структурно совместимы с `@ycforge/pilot/contracts/materializer.ts`, `@ycforge/pilot/contracts/terraform.ts`, `@ycforge/pilot/contracts/builder.ts`.

**Multi-resource return type**: `Promise<TerraformResource | readonly TerraformResource[]>` — расширение добавочное (additive, non-breaking): существующие materializers с single TerraformResource return совместимы. Dispatch (014/021) обрабатывает оба случая.

### 3.2 Artifact value shapes (включая forward contract для новых типов)

```ts
// Из spec 018 (builders-core) — переопределены для полноты
export interface FunctionArtifactValue {
  readonly archivePath: string;  // infra-relative path to .zip (DQ-2; never absolute)
  readonly entryPoint: string;   // "<basename>.handler"
}

export interface DockerArtifactValue {
  readonly image: string;        // immutable digest: "cr.yandex/...@sha256:..." (или plain image; без mutable tags)
}

export interface FrontendArtifactValue {
  readonly directory: string;    // infra-relative path to static build output (never absolute)
}

// NEW — forward contract (spec 019)
export interface ApiGatewayArtifactValue {
  readonly specPath: string;     // path to B-generated OpenAPI spec
  readonly resourceReferences: readonly ResourceReference[];
}

export interface QueueArtifactValue {
  readonly queueUrl: string;     // full Yandex Message Queue URL
}

export interface ResourceReference {
  readonly logical: string;      // e.g. "functions.user_service"
  readonly terraformType: string; // e.g. "yandex_function"
}
```

## 4. Каталог артефактных типов (FR-003, D-3)

```ts
export const MATERIALIZER_IDS = [
  'yandex-function',
  'yandex-serverless-container',
  'yandex-api-gateway',
  'yandex-message-queue',
  'yandex-storage-bucket',
] as const;
export type MaterializerId = (typeof MATERIALIZER_IDS)[number];

export const ARTIFACT_CATALOG = {
  'yandex-function':                { artifactType: 'ycforge:function' },
  'yandex-serverless-container':    { artifactType: 'ycforge:docker-image' },
  'yandex-api-gateway':             { artifactType: 'ycforge:api-gateway' },
  'yandex-message-queue':           { artifactType: 'ycforge:queue' },
  'yandex-storage-bucket':          { artifactType: 'ycforge:frontend' },
} as const;
export type ArtifactType = (typeof ARTIFACT_CATALOG)[MaterializerId]['artifactType'];
// = 'ycforge:function' | 'ycforge:docker-image' | 'ycforge:api-gateway' | 'ycforge:queue' | 'ycforge:frontend'

export const ARTIFACT_TYPES: readonly ArtifactType[] = Object.freeze([
  'ycforge:function',
  'ycforge:docker-image',
  'ycforge:api-gateway',
  'ycforge:queue',
  'ycforge:frontend',
]);
```

| Materializer id (`materializers.yaml`) | `Artifact.type` | `Artifact.value` | Terraform resource type(s) |
|---------------------------------------|-----------------|------------------|---------------------------|
| `yandex-function`                     | `ycforge:function` | `{ archivePath, entryPoint }` | `yandex_function` |
| `yandex-serverless-container`         | `ycforge:docker-image` | `{ image }` — immutable digest | `yandex_serverless_container` |
| `yandex-api-gateway`                  | `ycforge:api-gateway` | `{ specPath, resourceReferences }` | `yandex_api_gateway` |
| `yandex-message-queue`                | `ycforge:queue` | `{ queueUrl }` | `yandex_message_queue` |
| `yandex-storage-bucket`               | `ycforge:frontend` | `{ directory }` | `yandex_storage_bucket` + `yandex_storage_object`(s) |

Все пять строк валидны по предикату pilot `ARTIFACT_TYPE_PATTERN` (research D-RE-3).

## 5. Materializer implementations

### 5.1 yandex-function

**supports**: `artifact.type === 'ycforge:function'`

**materialize**: `Artifact<{ archivePath, entryPoint }>` → single `TerraformResource`

```ts
{
  kind: 'resource',
  type: 'yandex_function',
  name: '<app_id>',
  configuration: {
    runtime: 'nodejs22',
    entrypoint: value.entryPoint,
    user_hash: sha256hex(readFileSync(value.archivePath)),
    content: {
      zip_filename: relativeFromInfra(value.archivePath),
    },
  },
}
```

**Output**: `context.output.declare('<name>_function_id', { value: 'yandex_function.<name>.id' })`

- `runtime`: default `nodejs22`; перезаписывается extensions (spec 015), materializer генерирует default (FR-008).
- `user_hash`: SHA-256 hex of archive bytes; deterministic (FR-009, research D-RE-6).
- `content.zip_filename`: relative path from `infra/` to the archive (FR-010).
- minimal resources (IDEA §27): only `runtime`, `entrypoint`, `user_hash`, `content`; service account, env, secrets, mounts — extensions/user `.tf`.

### 5.2 yandex-serverless-container

**supports**: `artifact.type === 'ycforge:docker-image'`

**materialize**: `Artifact<{ image }>` → single `TerraformResource`

```ts
{
  kind: 'resource',
  type: 'yandex_serverless_container',
  name: '<app_id>',
  configuration: {
    image: value.image,  // as-is: "cr.yandex/...@sha256:..."
    name: '<app_id>',
  },
}
```

**Output**: `context.output.declare('<name>_container_id', { value: 'yandex_serverless_container.<name>.id' })`

- `image`: passed as-is (immutable digest form, FR-013).
- Memory, concurrency, service account — extensions (spec 015).

### 5.3 yandex-api-gateway

**supports**: `artifact.type === 'ycforge:api-gateway'`

**materialize**: `Artifact<{ specPath, resourceReferences }>` → single `TerraformResource`

Steps:
1. Read spec file from `value.specPath`.
2. For each `ResourceReference` in `value.resourceReferences`:
   - Parse `logical` string: `functions.user_service` → type segment `functions`, name segment `user_service`.
   - Map type segment to Terraform resource type via convention: `functions` → `yandex_function`, `containers` → `yandex_serverless_container`, etc.
   - Replace `${resources.<logical>.id}` → `${<terraformType>.<name>.id}` in spec content.
3. Write transformed spec as companion file: `<infraDir>/generated/<app_id>-openapi.yaml`.
4. Return TerraformResource:

```ts
{
  kind: 'resource',
  type: 'yandex_api_gateway',
  name: '<app_id>',
  configuration: {
    spec: `file("\${path.module}/generated/<app_id>-openapi.yaml")`,
  },
}
```

**Output**: `context.output.declare('<name>_gateway_id', { value: 'yandex_api_gateway.<name>.id' })`

- If `value.resourceReferences` is empty → companion spec copied as-is (FR-017).
- Logical→TF mapping is in `ref-resolver.ts`; simple convention, not magic (Constitution V).

### 5.4 yandex-message-queue

**supports**: `artifact.type === 'ycforge:queue'`

**materialize**: `Artifact<{ queueUrl }>` → single `TerraformResource`

Steps:
1. Parse `value.queueUrl` via `new URL()`.
2. Extract queue name: last path segment after `/queues/`.
3. Extract region: default `ru-central1` (research D-RE-7).
4. If parsing fails → throw `MaterializerError` with `YMT_INVALID_QUEUE_URL`.

```ts
{
  kind: 'resource',
  type: 'yandex_message_queue',
  name: '<app_id>',
  configuration: {
    queue_name: extractedQueueName,
    region: extractedRegion,
  },
}
```

**Output**: `context.output.declare('<name>_queue_id', { value: 'yandex_message_queue.<name>.id' })`

- Security/visibility timeout — extensions (spec 015).

### 5.5 yandex-storage-bucket

**supports**: `artifact.type === 'ycforge:frontend'`

**materialize**: `Artifact<{ directory }>` → `readonly TerraformResource[]` (multi-resource)

Steps:
1. List files in `value.directory` (recursive, sorted alphabetically for determinism).
2. Create `yandex_storage_bucket` resource:

```ts
{
  kind: 'resource',
  type: 'yandex_storage_bucket',
  name: '<app_id>',
  configuration: {
    bucket: '<app_id>',
    acl: 'public-read',
  },
}
```

3. For each file: create `yandex_storage_object` resource:

```ts
{
  kind: 'resource',
  type: 'yandex_storage_object',
  name: '<app_id>_<sanitized_filename>',   // TF address: [a-zA-Z0-9_] only (FR-025)
  configuration: {
    bucket: `yandex_storage_bucket.<app_id>.id`,
    key: originalFilename,
    source: absoluteFilePath,
  },
}
```

- If 0 files → return only the bucket resource (FR-024, empty bucket).
- Sanitization: replace `[^\w]` → `_`, dedup `__`, trim leading/trailing `_` (research D-RE-8).
- Nested files (T116): `key` = POSIX relative path as listed (with `/`, e.g. `assets/logo.png`); TF `name` = `<app_id>_<sanitizeFilename(relativePath)>` (e.g. `frontend_assets_logo_png`) — санитизация по ВСЕМУ относительному пути исключает коллизии TF-имён между same-named файлами в разных директориях; `source` = `resolve(dir, relativePath)`.
- `acl: "public-read"`: default for frontend (IDEA §36); extensions override.

> **DQ-5 warning channel (T121)**: при 0 файлов materializer НЕ бросает — warning `YMT_EMPTY_DIRECTORY`
> (константа `src/diagnostics.ts`) ретранслируется через
> `context.output.declare('<name>_bucket_id', { value: '...', description: YMT_EMPTY_DIRECTORY })` —
> `description` выходного output'а = код warning'а. Контракт на 021: outputs c
> `description`, равным YMT-коду, считать warning-каналом — strip/route их ПЕРЕД
> записью `outputs.yaml` (diagnostic-код не попадает в итоговое описание output'а).

**Output**: `context.output.declare('<name>_bucket_id', { value: 'yandex_storage_bucket.<name>.id' })`

## 6. Каталог диагностик `YMT_*` (machine-readable; сравниваются через константы — Constitution V)

```ts
export interface MaterializerError extends Error {
  code: string;
  materializer?: string;
}

export const YMT_INVALID_QUEUE_URL = 'YMT_INVALID_QUEUE_URL';
export const YMT_INVALID_ARTIFACT_VALUE = 'YMT_INVALID_ARTIFACT_VALUE';
export const YMT_EMPTY_DIRECTORY = 'YMT_EMPTY_DIRECTORY';

export function materializerError(code: string, message: string, options?: { materializer?: string }): MaterializerError {
  const err = new Error(message) as MaterializerError;
  err.name = 'MaterializerError';
  err.code = code;
  if (options?.materializer !== undefined) err.materializer = options.materializer;
  return err;
}
```

| Code | Message-шаблон | Module origin | Триггер (FR) |
|------|----------------|---------------|--------------|
| `YMT_INVALID_QUEUE_URL` | `invalid queueUrl format: <url>` | `yandex-message-queue/index.ts` | Failed to parse queueUrl (FR-020/026) |
| `YMT_INVALID_ARTIFACT_VALUE` | `artifact value missing required field: <field>` | per-materializer | Missing required fields (e.g., no `archivePath`, no `specPath`) |
| `YMT_EMPTY_DIRECTORY` | `frontend directory is empty: <directory>; bucket created without objects` | `yandex-storage-bucket/index.ts` | Warning: 0 files in directory (FR-024) |

## 7. Инварианты исполнения

```text
validate supports(artifact, context): boolean (pure, sync)
  → if false: skip (dispatch handles this)
  → if true:
    validate artifact.value fields (YMT_INVALID_ARTIFACT_VALUE)
    → materializer-specific pipeline:
        yandex-function:         read archive → SHA-256 → compute config
        yandex-serverless-container: extract image → pass through
        yandex-api-gateway:      read spec → replace refs → write companion → compute config
        yandex-message-queue:    parse URL → extract queue_name/region (YMT_INVALID_QUEUE_URL on failure)
        yandex-storage-bucket:   list directory → bucket + N×objects → sanitize names
    → TerraformResource | TerraformResource[]
    → declare output via context.output
```

- Один вызов `materialize()` = один `Artifact` (spec 002).
- Materializer не читает файловую систему except: `yandex-function` (`readFileSync` для hash), `yandex-api-gateway` (read/write spec file), `yandex-storage-bucket` (list directory). Остальные — pure computation.
- Детерминизм: одинаковый артефакт → бинарно идентичный `TerraformResource` configuration (кроме companion file path; identical content).

## 8. Pilot test-infra delta (аналог spec 018)

- `packages/pilot/package.json`: `devDependencies += { "@ycforge/materializers-core": "workspace:*" }`; `scripts += { "pretest": "pnpm --filter @ycforge/materializers-core build" }`.
- Новые тест-файлы pilot:
  - `test/materializers-core/dispatch-loading.spec.ts` — загрузка пяти модулей по subpath specifiers (аналог US4 spec 018).
  - `test/types/materializers-core-contract.test-d.ts` — structural conformance: pilot contracts ↔ materializers-core types.
- Никаких изменений production-кода pilot; контракты `@ycforge/pilot/contracts` не меняются (multi-resource return type additive).
