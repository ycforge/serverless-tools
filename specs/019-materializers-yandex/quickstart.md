# Quickstart: materializers-yandex — runnable validation guide

**Spec**: [specs/019-materializers-yandex/spec.md](./spec.md) | **Branch**: `019-materializers-yandex` | **Date**: 2026-09-10

Валидационные сценарии Sc1..Sc6 доказывают фичу end-to-end (acceptance criteria US1–US3, SC-001..SC-007). Сценарии на каноническом проекте (`user_service`, `analytics`, `frontend`, `openapi`) и артефактных типах. Детали форм — в `data-model.md` и `contracts/materializers-core.json`.

*Преамбула пакета*: `packages/materializers-core` ("проверка сборки вручную"): `pnpm --filter @ycforge/materializers-core build` → `dist/` с `index`, `yandex-function/`, `yandex-serverless-container/`, `yandex-api-gateway/`, `yandex-message-queue/`, `yandex-storage-bucket/`. Все пять materializer-ов default-экспортируют `Materializer` (поля `supports` + `materialize`), dispatch (014) распознаёт `kind: 'materializer'`.

---

## Sc1 — Materializes a Yandex Cloud Function (US1, P1)

**Given**: fixture artifact `{ type: 'ycforge:function', value: { archivePath: '/abs/path/function.zip', entryPoint: 'index.handler' } }`.

**When**: `materialize()` вызывается на `@ycforge/materializers-core/yandex-function` с `context = { output: new OutputBuilder() }`.

**Then**:
- `TerraformResource.type === 'yandex_function'`;
- `configuration.entrypoint === 'index.handler'`;
- `configuration.runtime === 'nodejs22'` (default, FR-008);
- `configuration.content.zip_filename` — относительный путь от `infra/` (FR-010);
- `configuration.user_hash` — SHA-256 hex содержимого архива (детерминированный, FR-009);
- `output` содержит `declare('<name>_function_id', { value: 'yandex_function.<name>.id' })` (US1-AC3).
- `supports({ type: 'ycforge:docker-image', value: {...} }, context) === false` (US1-AC2).

**Как проверить автоматикой**: `test/unit/yandex-function.spec.ts` — fixture artifact в памяти + временный zip-файл в `mkdtemp`; структурные assertions на конфигурации и output.

## Sc2 — Materializes a Serverless Container (US2-AC1, P1)

**Given**: fixture artifact `{ type: 'ycforge:docker-image', value: { image: 'cr.yandex/app@sha256:abc123' } }`.

**When**: `materialize()` вызывается на `@ycforge/materializers-core/yandex-serverless-container`.

**Then**:
- `TerraformResource.type === 'yandex_serverless_container'`;
- `configuration.image === 'cr.yandex/app@sha256:abc123'` (as-is, FR-013);
- `configuration.name === '<app_id>'`;
- `output` содержит `declare('<name>_container_id', ...)`.

**Как проверить автоматикой**: `test/unit/yandex-serverless-container.spec.ts` — fixture artifact, структурные assertions.

## Sc3 — Materializes a Static Frontend to a Bucket (US2-AC2/AC3, P1)

**Given**: fixture artifact `{ type: 'ycforge:frontend', value: { directory: '/tmp/dist' } }` с тремя файлами (`index.html`, `style.css`, `app.js`).

**When**: `materialize()` вызывается на `@ycforge/materializers-core/yandex-storage-bucket`.

**Then**:
- Возвращается `readonly TerraformResource[]` из 4 ресурсов: 1× `yandex_storage_bucket` + 3× `yandex_storage_object` (AC2; multi-resource, research D-RE-5);
- bucket resource: `{ type: 'yandex_storage_bucket', name: '<app_id>', configuration: { bucket: '<app_id>', acl: 'public-read' } }` (FR-022);
- object resources: имена `<app_id>_<sanitized_filename>` (`index_html`, `style_css`, `app_js` — точки заменены на `_`, FR-025); `configuration.key` = оригинальное имя файла (FR-023).
- Пустой каталог `/tmp/empty-dist` (0 файлов) → возвращается 1 ресурс: `yandex_storage_bucket` (AC3, FR-024).
- `output` содержит `declare('<name>_bucket_id', ...)`.

**Как проверить автоматикой**: `test/unit/yandex-storage-bucket.spec.ts` — fixture directory в `mkdtemp`; assertions на количестве ресурсов, имена + key, sanitization, empty-dir case.

## Sc4 — Materializes an API Gateway with Resource References (US3, P1)

**Given**: fixture artifact `{ type: 'ycforge:api-gateway', value: { specPath: '/generated/openapi.yaml', resourceReferences: [{ logical: 'functions.user_service', terraformType: 'yandex_function' }] } }` и spec-файл, содержащий `${resources.functions.user_service.id}`.

**When**: `materialize()` вызывается на `@ycforge/materializers-core/yandex-api-gateway`.

**Then**:
- Companion-файл записан: содержит `${yandex_function.user_service.id}` вместо `${resources.functions.user_service.id}` (US3-AC1, FR-015; research D-RE-4 — прямая замена, не `templatefile()`);
- `TerraformResource.type === 'yandex_api_gateway'`;
- `configuration.spec` — `file("${path.module}/generated/<app_id>-openapi.yaml")` (FR-016);
- Артефакт с пустым `resourceReferences` → companion spec копируется as-is (US3-AC2, FR-017).
- `output` содержит `declare('<name>_gateway_id', ...)`.

**Как проверить автоматикой**: `test/unit/yandex-api-gateway.spec.ts` — fixture spec-файл в `mkdtemp`, assertions на companion-файл + TerraformResource.

## Sc5 — Materializes a Message Queue (FR-018/019/020)

**Given**: fixture artifact `{ type: 'ycforge:queue', value: { queueUrl: 'https://message-queue.api.cloud.yandex.net/b1g1/queues/my-queue' } }`.

**When**: `materialize()` вызывается на `@ycforge/materializers-core/yandex-message-queue`.

**Then**:
- `TerraformResource.type === 'yandex_message_queue'`;
- `configuration.queue_name === 'my-queue'` (последний path segment);
- `configuration.region === 'ru-central1'` (default, research D-RE-7);
- Некорректный URL (например `https://message-queue.api.cloud.yandex.net/just-path` без `/queues/`) → fail-fast `MaterializerError` с кодом `YMT_INVALID_QUEUE_URL` (FR-020/026).
- `supports({ type: 'ycforge:function', ... }) === false` (FR-018).
- `output` содержит `declare('<name>_queue_id', ...)`.

**Как проверить автоматикой**: `test/unit/yandex-message-queue.spec.ts` — fixture artifacts (валидный + невалидный URL); assertions на configuration + fail-fast.

## Sc6 — Dispatch loads all five materializers by subpath (SC-002, pilot test)

**Given**: `packages/pilot` devDep-ит `@ycforge/materializers-core` (workspace symlink), `pretest` построил dist. Fixture-проект с `.ycsf/materializers.yaml`:

```yaml
version: 1
materializers:
  yandex-function: "@ycforge/materializers-core/yandex-function"
  yandex-serverless-container: "@ycforge/materializers-core/yandex-serverless-container"
  yandex-api-gateway: "@ycforge/materializers-core/yandex-api-gateway"
  yandex-message-queue: "@ycforge/materializers-core/yandex-message-queue"
  yandex-storage-bucket: "@ycforge/materializers-core/yandex-storage-bucket"
```

...и каноническими apps (`user_service` → `ycforge:function`, `analytics` → `ycforge:docker-image`, `frontend` → `ycforge:frontend`, `openapi` → `ycforge:api-gateway`).

**When**: `loadRegistry(root)` загружает пять модулей по subpath specifiers → `dispatch(projectModel, registry)`.

**Then**: `MTL_COLLISION` и `MTL_UNHANDLED_ARTIFACT` — 0 для канонического проекта (SC-002); каждый модуль распознаётся как `kind: 'materializer'`; root exports `ARTIFACT_TYPES` содержит пять типов (FR-003).

**Как проверить автоматикой**: `packages/pilot/test/materializers-core/dispatch-loading.spec.ts`; conformance типов — `packages/pilot/test/types/materializers-core-contract.test-d.ts` (обязательная проверка: standalone types ↔ pilot contracts).

---

## Покрытие Success Criteria

| SC | Сценарий(и) quickstart | Место теста |
|----|------------------------|-------------|
| SC-001 | Sc1, Sc2, Sc3, Sc5 | materializers-core `test/unit/*.spec.ts` |
| SC-002 | Sc6 | pilot `test/materializers-core/dispatch-loading.spec.ts` |
| SC-003 | Sc6 (root exports `ARTIFACT_TYPES`), структура пакета | `test/unit/catalog.test.ts` (FR-003), pilot conformance test-d.ts |
| SC-004 | Sc4 | materializers-core `test/unit/yandex-api-gateway.spec.ts` |
| SC-005 | Sc3 (3 файла → 3 objects; пустой каталог → только bucket) | materializers-core `test/unit/yandex-storage-bucket.spec.ts` |
| SC-006 | Sc1 (детерминизм): повторный вызов с идентичным артефактом → бинарно идентичный configuration | materializers-core `test/unit/yandex-function.spec.ts` (детерминизм) |
| SC-007 | все сценарии | Red→Green по AC (Constitution II); `typecheck`/`lint` чистые |