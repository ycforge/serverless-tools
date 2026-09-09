# Research: materializers-yandex — function/container/api-gateway/queue/bucket TF materializers

**Spec**: [specs/019-materializers-yandex/spec.md](./spec.md) | **Branch**: `019-materializers-yandex` | **Date**: 2026-09-10

Резолюция всех unknown-вопросов плановой фазы. Каждое решение: Decision / Rationale / Alternatives considered. Факты проверены по репозиторию (package.json, pnpm-lock.yaml, packages/builders-core, packages/pilot, IDEA.md, спецификации 002/014/018).

---

## D-RE-1 — Повторная валидация D-1: единый пакет `@ycforge/materializers-core` с subpath exports

**Decision**: **KEEP** — один пакет `packages/materializers-core` (`@ycforge/materializers-core`), пять подпути: `./yandex-function`, `./yandex-serverless-container`, `./yandex-api-gateway`, `./yandex-message-queue`, `./yandex-storage-bucket`.

**Rationale**:
- Зеркало D-1 spec 018 (builders-core): конвенция subpath exports уже принята в репозитории (`@ycforge/builders-core/*`, `@ycforge/pilot/contracts`, `@ycforge/nestjs-connector/*`).
- Один пакет = один `package.json`, один `tsup.config.ts` (multi-entry), один набор dev-зависимостей (только tsup/typescript/vitest — **ноль runtime зависимостей**, в отличие от builders-core с esbuild).
- Общие standalone-типы (zero pilot imports), общий каталог `YMT_*` diagnostics — приватные модули пакета.
- Монорепа: materializer-ы — core plugins, поставляемые и версионируемые вместе.
- Dispatch (spec 014) загружает materializer по подпути из `materializers.yaml` mapping.

**Alternatives considered**:
- 5 отдельных пакетов `@ycforge/materializer-yandex-function` и т.п.: 5 `package.json`, 5 build configs, дублирование types/diagnostics. Отклонено: никаких преимуществ; dispatch-контракт (строка specifier в `materializers.yaml`) одинаков.

## D-RE-2 — Повторная валидация D-2: standalone structural types (zero pilot imports)

**Decision**: **KEEP** — пакет определяет собственные structural-реплики контрактов `Materializer`, `TerraformResource`, `MaterializationContext`, `OutputBuilder`, `Artifact<T>` — без импортов из `@ycforge/pilot`.

**Rationale**:
- Прямое зеркало D-RE-4/D-RE-5 spec 018 (builders-core): `src/types.ts` содержит standalone structural replicas, `test/types/materializers-core-contract.test-d.ts` в **pilot** проверяет conformance.
- Pilot уже devDep-ит builders-core; materializers-core добавится аналогично (workplace:*) — цикл не создаётся (materializers-core buildable без pilot; pilot devDeps both).
- `packages/pilot/src/contracts/materializer.ts` полностью type-only (56 строк): `Materializer`, `MaterializationContext`, `OutputBuilder` — структурные, совместимы без импортов.
- `packages/pilot/src/contracts/terraform.ts` — `TerraformResource<T>` — structural interface.
- `packages/pilot/src/contracts/builder.ts` — `Artifact<T>` — уже реплицирован в builders-core; materializers-core повторяет.

## D-RE-3 — Повторная валидация D-3: новые артефактные типы `ycforge:api-gateway` и `ycforge:queue`

**Decision**: **KEEP** — два новых типа как forward contract; materializers-core фиксирует их shapes, producer'ы (Project B / explicit config) — spec 021.

**Rationale**:
- `ycforge:api-gateway`: `Artifact.value = { specPath: string; resourceReferences: ResourceReference[] }` — producer = Project B (composer, spec 008/009). Spec 009 фиксирует `ResourceReference: { logical: string; terraformType: string }`.
- `ycforge:queue`: `Artifact.value = { queueUrl: string }` — producer = explicit configuration (`.ycsf/apps.yaml` с `builder: "queue"`) или фабричный метод C (spec 021).
- Оба типа валидны по предикату pilot `ARTIFACT_TYPE_PATTERN` = `/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/`: `ycforge:api-gateway` ✓, `ycforge:queue` ✓.
- Два типа добавляются в общий `ArtifactType` union пакета и в каталог. Spec 018 не меняется (три типа builders-core остаются; пять типов materializers-core — superset).

## D-RE-4 — API Gateway materialization: `templatefile()` vs прямая замена строк

**Decision**: API Gateway materializer выполняет **прямую замену** логических resource references в companion spec файле, а **НЕ** использует `templatefile()` Terraform mechanism.

**Rationale**:
- D-4 spec 019 предполагает `templatefile()`, но plan-фаза перепроверяет (Assumption spec 019: «plan-фаза может предложить альтернативу»).
- Прямая замена проще, надёжнее и детерминированнее:
  - Materializer читает spec из `value.specPath`, заменяет `${resources.<type>.<name>.id}` → `${yandex_<terraformType>.<name>.id}`, записывает результат как companion-файл.
  - Terraform resource использует `file("${path.module}/generated/<name>-openapi.yaml")` для чтения companion-файла — это стандартный Terraform паттерн (IDEA §32).
- `templatefile()` добавляет лишний слой абстракции: нужно правильно escape template variables, бороться с recursion и escaping `${}` внутри OpenAPI YAML. Прямая замена — это ровно то, что описано в IDEA §33: materializer他知道 TF → logical mapping и выполняет подстановку.
- Результат тот же: companion-файл содержит `${yandex_function.user_service.id}` — читаемый Terraform expression. `templatefile()` не добавляет ценности здесь (resource references — это simple key→value mapping, не complex template logic).

**Alternatives considered**:
- `templatefile()` Terraform mechanism: избыточно; добавляет слой валидации template syntax, который materializer уже обрабатывает через прямую замену; companion-файл нужен в любом случае (Terraform resource ссылается на файл).

## D-RE-5 — Multi-resource materializer (bucket): возвращаемый тип

**Decision**: `yandex-storage-bucket` materializer возвращает `readonly TerraformResource[]` — массив из 1+ ресурсов. Dispatch spec 014 ограничивает one-resource-per-app, но это **тестовое ограничение** fixture-уровня; C (spec 021) будет materialize все resources из materializer result.

**Rationale**:
- Spec 019 Assumption: «spec 014 ограничивает one-resource-per-app на fixture-level; real dispatch (021) будет materialize all resources из materializer result.»
- Контракт `Materializer.materialize()` (spec 002) возвращает `Promise<TerraformResource>` — один ресурс. Для multi-resource有两种方案:
  - (a) `materialize()` возвращает массив (расширение контракта — additive, не breaking: default generic `A` остаётся `Artifact`, возвращаемый тип расширяется).
  - (b) `materialize()` возвращает один ресурс, C вызывает его N раз (но это неверно: bucket + objects — единая логическая операция).
- **Выбран вариант (a)**: возвращаемый тип `Promise<TerraformResource | readonly TerraformResource[]>` — dispatch (021) обрабатывает оба случая. Spec 014 fixture-тесты остаются single-resource; реальный dispatch (021) — массив.
- **Conformance**: `Materializer.materialize()` в `materializers-core/src/types.ts` расширяет return type: `Promise<TerraformResource | readonly TerraformResource[]>`. Pilot conformance test проверяет, что原始 Materializer<TerraformResource> assignment всё ещё валиден (additive).

## D-RE-6 — `user_hash` для yandex-function: детерминированный хеш

**Decision**: `user_hash` вычисляется как SHA-256 содержимого архива (`archivePath`), записанный как hex-строка.

**Rationale**:
- Spec 019 FR-009: «user_hash MUST быть детерминированным хешем содержимого архива (для стабильного Terraform state при неизменном контенте).»
- SHA-256 — стандартный хеш-алгоритм Node.js (`node:crypto`), deterministic, collision-resistant.
- Архив (`value.archivePath`) — единственный input, guaranteeing stability: одинаковый контент → одинаковый hash → нет пересоздания ресурса в Terraform.
- `user_hash` — это **required** поле `yandex_function` resource; без него Terraform пересоздаёт функцию при каждом apply.

**Alternatives considered**:
- MD5 — менее collision-resistant, но быстрее; SHA-256 — стандарт, Node.js уже содержит. Отклонено: нет причины экономить на хеш-алгоритме.

## D-RE-7 — Queue URL парсинг: формат и валидация

**Decision**: `value.queueUrl` парсится как полный URL очереди Yandex Message Queue. Формат: `https://message-queue.api.cloud.yandex.net/{cloud_id}/queues/{queue_id}`. Извлекается `queue_name` (= `queue_id`) и `region` (= cloud region, изображённый из URL или заданный дефолтом `ru-central1`).

**Rationale**:
- Spec 019 FR-020: «queue_name и region MUST быть извлечены из value.queueUrl.»
- Yandex Message Queue URL format: `https://message-queue.api.cloud.yandex.net/<cloud_id>/queues/<queue_id>`.
- Минимальный materializer: `queue_name` = segment after `/queues/`, `region` = default `ru-central1` (extractable from URL host/subdomain, но simplest: задать default).
- Fail-fast `YMT_INVALID_QUEUE_URL` при некорректном формате (无法 parse path segments).

**Alternatives considered**:
- Парсинг через `new URL()` + regex: стандартный, без зависимостей. Отклонены более сложные варианты (Yandex SDK).

## D-RE-8 — File sanitization для TF address (bucket objects)

**Decision**: Имя файла для TF address (`name`) санитизируется: `[a-zA-Z0-9_]` только; оригинальное имя сохраняется в `key` TF config.

**Rationale**:
- Spec 019 FR-025: «Имя файла для TF address MUST быть sanitized: [a-zA-Z0-9_] только.»
- Terraform address grammar: `[a-zA-Z_][a-zA-Z0-9_]*`. Некоторые символы в именах файлов (`-`, `.`, пробелы) не допустимы.
- Sanitization: замена `[^\w]` на `_`, дедупликация `__`, trim leading/trailing `_`.
- `<app_id>_<sanitized_filename>` — стабильный TF address; originals file → `key` field в `yandex_storage_object`.

## D-RE-9 — Конвенции пакета (build/test/typecheck)

**Decision**: Зеркало builders-core (spec 018):
- `type: "module"`, `engines.node: ">=22"`, `files: ["dist"]`, `sideEffects: false`.
- `tsup.config.ts` multi-entry (6 entry: `index`, `yandex-function/index`, `yandex-serverless-container/index`, `yandex-api-gateway/index`, `yandex-message-queue/index`, `yandex-storage-bucket/index`; format esm+cjs, `dts: true`, `clean: true`).
- `vitest.config.ts` с `typecheck` include → `test/types/**/*.test-d.ts`.
- `test`: `"tsup && vitest run"` (nest-bridge / builders-core pattern: self-reference subpath imports need built dist).
- tsconfig: копия pilot tsconfig (strict, NodeNext, exactOptionalPropertyTypes, noUncheckedIndexedAccess).
- **Ноль runtime зависимостей** (в отличие от builders-core с esbuild): materializers — pure functions,转 TF expressions, no I/O.

**Rationale**:
- Конвенция пакетов монорепо уже establecida. Отклонение не обосновано.
- Zero runtime dependencies: materializers читают artifact value и генерируют TerraformResource (plain objects). Нет bundling, нет child_process, нет fs operations.

## D-RE-10 — Тестовая инфраструктура (pilot integration)

**Decision**: US4-equivalent тесты (dispatch loading) живут в pilot `test/` (аналог D-RE-5 spec 018). Materializers-core имеет собственные unit-тесты. Compile-time conformance test в pilot.

**Rationale**:
- Materializers-core unit tests: hermetic, без pilot; `materialize()` вызывается на fixture artifacts, проверяется возвращаемый TerraformResource.
- Dispatch integration (spec 014 level): pilot `test/materializers-core/` — `import('@ycforge/materializers-core/*')` для загрузки по subpath specifiers (аналог US4 spec 018).
- Pilot devDependencies: `@ycforge/materializers-core: workspace:*`; `pretest: pnpm --filter @ycforge/materializers-core build`.
- Compile-time conformance: `packages/pilot/test/types/materializers-core-contract.test-d.ts`.

---

## Consolidated facts (проверено по репозиторию)

| Fact | Source |
|---|---|
| builders-core package.json: exports 4 subpaths, no runtime dep except esbuild | packages/builders-core/package.json |
| pilot contracts: materializer.ts (56 lines, type-only), terraform.ts (64 lines), builder.ts (45 lines, Artifact<T>) | packages/pilot/src/contracts/ |
| `ARTIFACT_TYPE_PATTERN` = `/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/` | packages/pilot/src/contracts/artifact-type.ts |
| `ResourceReference` = `{ logical: string; terraformType: string }` (IDEA §33) | IDEA.md §33 |
| dispatch spec 014: one-resource-per-app (fixture-level), DispatchResult.resources: readonly TerraformResource[] | specs/014-materializer-dispatch/spec.md |
| builders-core: standalone types pattern (zero pilot imports), conformance test in pilot | packages/builders-core/src/types.ts, packages/pilot/test/types/ |
| subpath exports convention: already used by pilot/contracts, nest-connector, builders-core | package.json exports maps |
| Zero runtime deps: no esbuild/yazl/archiver needed for materializers (pure functions) | spec 019 Scope decisions |
| Yandex Function: `user_hash` = required field (SHA-256 of archive content) | IDEA.md §27, Yandex Cloud docs |
| Yandex Message Queue URL format: `https://message-queue.api.cloud.yandex.net/{cloud}/queues/{queue}` | Yandex Cloud docs |
| Filename sanitization: TF address grammar `[a-zA-Z_][a-zA-Z0-9_]*` | Terraform docs |
