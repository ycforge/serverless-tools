# Research: ycsf-check — consolidated validation layer

**Spec**: [specs/020-ycsf-check/spec.md](./spec.md) | **Branch**: `020-ycsf-check` | **Date**: 2026-09-10

Резолюция всех unknown-вопросов плановой фазы. Каждое решение: Decision / Rationale / Alternatives considered. Факты проверены по репозиторию (packages/pilot/src/, contracts, specs 011–017).

---

## D-RE-1 — Загрузка generated Terraform resources (FR-002)

**Decision**: Check загружает `TerraformResource[]` из файловой системы: `readdir(<rootDir>/.ycsf/)` → фильтр `*.ycsf.tf.json` (reuse `FILENAME_RE` из `materialize/serialize.ts`) → `JSON.parse` каждого файла → извлечение блоков `{ resource: { [type]: { [name]: config } } }` → flatten в `TerraformResource[]`.

**Rationale**:
- Check выполняется ПОСЛЕ dispatch/materialization (D-2 spec), когда `.ycsf/*.ycsf.tf.json` файлы уже записаны на диск (spec 014, `writeGeneratedTerraform`).
- Loading из файлов — самый простой и надёжный способ: check не требует pipeline state, не дублирует materialization. Это минимальный контекст: check имеет и project model, и generated resources.
- `JSON.parse` + structure extraction — deterministic, O(N) по числу файлов.
- Generated files supplement `resource` blocks (only), что совместимо с `serializeResource()` из `materialize/serialize.ts`.

**Alternatives considered**:
- Загрузка через dispatch pipeline (вторичный dispatch): избыточно; dispatch — это materialization, check должен быть отдельным step. Отклонено.
- Хранение generated model в memory между pipeline steps:增加了 coupling; check работает автономно (CLI invocation). Отклонено.
- Memory-mapped loading: нет benefit для <100ms latency (SC-008). Отклонено.

---

## D-RE-2 — Стратегия переиспользования существующих валидаций (FR-020–FR-024)

**Decision**: `check.ts` напрямую импортирует и вызывает существующие функции-валидаторы из модулей 011–017. Результаты (diagnostics) агрегируются в `CheckResult.diagnostics`.

| Категория | Реuse-модуль | Функция | Диагностики |
|-----------|-------------|---------|-------------|
| C2–C3 | `model/env-requirements.ts` | `checkEnvRequirements(appId, buildConfig, file)` | `PML_ENV_NOT_SET` |
| C5–C8 | `extensions/apply.ts` | `applyExtensions(resources, extensions)` | `EXT_UNRESOLVED_TARGET`, `EXT_DUPLICATE_TARGET`, `EXT_INVALID` |
| C9 | `outputs/build.ts` | `buildOutputs(input)` | `OUT_*` |
| C10 | `moves/validate.ts` | `validateMoves(moves)` | `MOV_*` |
| C11 | `registry/validate.ts` | `validateBuilders(projectModel, registry)` | `BRG_UNKNOWN_BUILDER` |
| C12 | `model/loader.ts` | `loadProjectModel(rootDir)` | `PML_*` (load-time structural) |

**Rationale**:
- Существующие модули уже валидируют свои контракты (specs 011–017). Check агрегирует, не дублирует.
- `applyExtensions` (015) — collect-all pattern, perfectly fits check aggregation (D-4 spec).
- `buildOutputs` (016) — validate-first; check вызывает его для validation side-effect, результат `file` discarded.
- `loadProjectModel` (011) — check загружает project model как вход для всех reuse-валидаций (extensions, outputs, moves, builders).
- Available `extensions` (C5–C8) загружаются через `loadExtensions` (опционально — файл может отсутствовать).

**Alternatives considered**:
- Дублирование логики валидации в check module: нарушение DRY, создаёт рассинхронизацию при изменениях. Отклонено.
- Calling-only-validation-only pattern (каждый reuse-модуль экспортирует отдельную `validate*` функцию): уже есть (`checkEnvRequirements`, `validateBuilders`, `validateMoves`), за исключением `applyExtensions` (который валидирует + применяет). Check вызывает `applyExtensions` и игнорирует `kind: 'ok'` результат (resources not needed for validation).

---

## D-RE-3 — Scan `{{$ENV}}` в extensions patch (C7, FR-011–FR-013)

**Decision**: Deep recursive scan patch object string values с `ENV_REF_RE` из `model/env-requirements.ts` (`/\{\{\$([A-Z0-9_]+)\}\}/g`). Каждое вхождение → `YCK_ENV_IN_PATCH` с `target` (IDL) и `field` (path к полю в patch, где найден `{{$ENV}}`).

**Rationale**:
- `ENV_REF_RE` — стабильный regex spec 011/012; используется в `extractEnvRequirements` и `isEnvRef`. Консистентность.
- Deep scan: рекурсивный обход `patch` object по всем string values (depth ≥2, per SC-003).
- Паттерн `{{$NAME}}` не конфликтует с Terraform `${...}` (другой синтаксис) и `${resources...}` (B→Materializer). False positives отсутствуют.
- Scan — O(E × P) где E = extension rules, P = depth patch tree. Минимальный overhead.

**Alternatives considered**:
- JSON.stringify + regex match: проще, но loses field path information (нужно для `field` в `YCK_ENV_IN_PATCH`). Отклонено.
- Плоский scan (только string values): не покрывает nested depth ≥2. Отклонено.

---

## D-RE-4 — Resource consistency check (C4, FR-014–FR-016)

**Decision**: Для каждого resource в `resources.yaml` проверяем, что в generated model существует `TerraformResource` с matching `type` (по IDL domain → TF type mapping из `extensions/idl.ts` `IDL_DOMAIN_BY_TF_TYPE`) и `name` (resource_id).

**Rationale**:
- `IDL_DOMAIN_BY_TF_TYPE = { yandex_function: 'functions', yandex_api_gateway: 'gateways' }` — фиксированная mapping spec 015.
- Обратный mapping (domain → TF type): `Object.fromEntries(Object.entries(IDL_DOMAIN_BY_TF_TYPE).map(([tf, domain]) => [domain, tf]))`.
- `resources.yaml` содержит entries вида `{ functions: { external_svc: {} } }` → domain = `functions`, resource_id = `external_svc`.
- Matching: `generatedResources.some(r => r.type === tfType && r.name === resourceId)`.
- Если `resources.yaml` отсутствует или пуст — category пропускается (no error).

**Alternatives considered**:
- Use `createIdlIndex` (extensions) для lookup: IDL = `domain.resource_id`, lookup by IDL. Работает, но добавляет dependency на extensions module (не на reverse mapping). Используем `IDL_DOMAIN_BY_TF_TYPE` напрямую — проще и идиоматичнее.

---

## D-RE-5 — `terraform validate` invocation (C13, FR-017–FR-019)

**Decision**: `child_process.spawnSync('terraform', ['validate', '-no-color'], { cwd: infraDir, encoding: 'utf8', timeout: 30_000 })`. Optional, off by default (`--validate-tf` flag).

**Rationale**:
- `spawnSync` — синхронный; check выполняется в pipeline step, timeout 30s достаточен для `terraform validate`.
- Non-zero exit code → `YCK_TERRAFORM_INVALID` с `message` (terraform stderr output).
- Binary not found (`ENOENT`) → `YCK_TERRAFORM_UNAVAILABLE`. Base checks продолжаются (base checks выполнены ДО terraform step).
- Base checks (C1–C12) обнаружили errors → `--validate-tf` НЕ выполняется (fail-fast: исправить project contracts first, затем validate terraform — spec FR-018).
- `infraDir = join(rootDir, 'infra')` — стандартная директория для Terraform files (IDEA §23).

**Alternatives considered**:
- `execFile` (async): избыточно; check sync для base checks, async только для terraform validate. `spawnSync` проще.
- No timeout: `terraform validate` обычно быстрый (<5s), но safety net 30s нужен для больших проектов.
- `--validate-tf` default true: отклонено — `terraform validate` требует `terraform init` (user responsibility), check должен быть lightweight.

---

## D-RE-6 — Generated model loader implementation

**Decision**: `generated-loader.ts` — модуль в `src/check/`:

```ts
export function loadGeneratedModel(rootDir: string): readonly TerraformResource[]
```

1. `readdir(join(rootDir, '.ycsf'))` → filter `*.ycsf.tf.json` (reuse `FILENAME_RE` pattern from `materialize/serialize.ts`).
2. For each file: `JSON.parse(content)` → extract `{ resource: { [type]: { [name]: config } } }` → map to `TerraformResource { kind: 'resource', type, name, configuration }`.
3. Flatten all resources into single array.
4. Empty dir → empty array (C1/C4 report all targets as missing).

**Rationale**:
- Generated files follow strict structure (`serializeResource` from spec 014). Defensive extraction: skip files without `resource` key.
- `FILENAME_RE` = `/^[A-Za-z0-9_-]+\.ycsf\.tf\.json$/` — validates ownership (C does not read user `*.tf` files).
- Synchronous: `readFileSync` + `JSON.parse` — O(N) by number of files, <100ms per SC-008.
- No `99-ycsf-outputs.tf.json` in generated model (outputs file has different naming pattern, skip by regex).

**Alternatives considered**:
- Async loading (`readdir` + `readFile`): check is already async for terraform validate; sync is simpler for base checks. Keep sync.
- Streaming JSON parse: overkill for small files (<1KB each typically).

---

## D-RE-7 — Reuse `buildOutputs` for validation (C9, FR-023)

**Decision**: Check вызывает `buildOutputs(input)` для validation side-effect. Результат `file` discarded; только `errors` collected в `CheckResult.diagnostics`.

**Rationale**:
- `buildOutputs` — validate-first, collect-all (spec 016). Perfect fit: check использует его validation phase.
- В standalone check context: `materializerOutputs` = empty Map (materialization не выполнялась); `resources` = generated model (from D-RE-1).
- `outputs.yaml` загружается через `loadOutputs` (если файл отсутствует → check пропускает C9, не ошибается — файл optional).

**Alternatives considered**:
- Extract validation-only function from `buildOutputs`: нарушает DRY; `buildOutputs` уже чистый. Отклонено.
- Not including C9 in check: spec explicitly requires outputs validation (FR-023). Отклонено.

---

## D-RE-8 — Async vs Sync API

**Decision**: `check()` — `async function check(rootDir: string, options?: CheckOptions): Promise<CheckResult>`. Base checks (C1–C12) sync (call sync validators); `terraform validate` (C13) async (`spawnSync` — sync, but wrapped in async for uniform API).

**Rationale**:
- Overall API is async to accommodate potential future async validators and `terraform validate` (which could be made async).
- `spawnSync` — sync; wrapping in `async` is negligible overhead.
- CLI layer (`ycsf check`) awaits the result; pipeline integration (spec 021) awaits.

**Alternatives considered**:
- Pure sync API: `terraform validate` is inherently sync via `spawnSync`. But future-proofing for async validators; keeping async consistent with existing patterns (`dispatch`, `writeGeneratedTerraform`).

---

## D-RE-9 — No `terraform init` for base checks

**Decision**: Base checks (C1–C12) — pure contract validation. НЕ требуют `terraform init`, terraform state, provider cache, module sources. `--validate-tf` requires init as prerequisite (user responsibility).

**Rationale**:
- Constitution IV: Terraform stays real Terraform. Check validates C's contracts, not terraform state.
- Base checks operate on in-memory data (project model, generated resources, extensions, outputs, moves). No terraform interaction.
- `terraform validate` reads `.tf.json` files (generated by C) + user `.tf` files; requires provider plugins (from `terraform init`). User runs `ycsf check --validate-tf` after `terraform init`.

**Alternatives considered**:
- Auto-run `terraform init` before `terraform validate`: violates Constitution IV (C managing Terraform lifecycle). User explicitly manages init.

---

## D-RE-10 — Duplicate diagnostics between check and reuse modules (SC-005/AC5.3)

**Decision**: Check emits BOTH `YCK_MISSING_TARGET` AND `EXT_UNRESOLVED_TARGET` for the same missing extension target. Both appear in `CheckResult.diagnostics`. This is intentional per spec SC-005/AC5.3.

**Rationale**:
- `applyExtensions` (015) emits `EXT_UNRESOLVED_TARGET` — this is extensions-module-level diagnostic.
- `check` (020) emits `YCK_MISSING_TARGET` — this is check-layer-level diagnostic with additional context (`availableIdls`).
- User sees both: they describe the same problem from different abstraction levels. `YCK_MISSING_TARGET` is check-specific (emitted only by `ycsf check`), `EXT_UNRESOLVED_TARGET` is reusable.
- No deduplication — Constitution V: explicit over magic. Consumers can filter by code family.

**Alternatives considered**:
- Deduplication (remove one): loses information; different consumers may use different codes. Отклонено.
- Emit only `YCK_MISSING_TARGET` (suppress `EXT_*`): breaks `applyExtensions` contract semantics. Отклонено.

---

## Consolidated facts (проверено по репозиторию)

| Fact | Source |
|---|---|
| `FILENAME_RE` = `/^[A-Za-z0-9_-]+\.ycsf\.tf\.json$/` | `materialize/serialize.ts:61` |
| `IDL_DOMAIN_BY_TF_TYPE = { yandex_function: 'functions', yandex_api_gateway: 'gateways' }` | `extensions/idl.ts:10` |
| `ENV_REF_RE = /\{\{\$([A-Z0-9_]+)\}\}/g` | `model/env-requirements.ts:18` |
| `checkEnvRequirements(appId, buildConfig, file)` returns `{ requirements, errors }` | `model/env-requirements.ts:64` |
| `applyExtensions(resources, extensions)` returns `ApplyExtensionsResult` | `extensions/apply.ts:117` |
| `buildOutputs(input)` returns `BuildOutputsResult` | `outputs/build.ts:33` |
| `validateMoves(moves)` returns `ValidatedMoves` | `moves/validate.ts:58` |
| `validateBuilders(projectModel, registry)` returns `BuilderRegistryValidationResult` | `registry/validate.ts:6` |
| `loadProjectModel(rootDir)` returns `ProjectModelLoadResult` | `model/loader.ts:33` |
| `loadExtensions(rootDir)` throws on missing file | `extensions/loader.ts:11` |
| `loadOutputs(rootDir)` throws on missing file | `outputs/loader.ts:13` |
| `loadMoves(rootDir)` returns ok with empty moves on missing file | `moves/loader.ts:12` |
| Diagnostic families: PML_*, EXT_*, OUT_*, MOV_*, MTL_*, BRG_* | `contracts/*.ts` |
| `extensions/idl.ts`: `createIdlIndex(resources)` → `{ byIdl, availableIdls, duplicateIdls }` | `extensions/idl.ts:34` |
| `serializeResource(resource)` → JSON string `{ resource: { [type]: { [name]: config } } }` | `materialize/serialize.ts:31` |
| Pilot internal entry: `src/index.ts` exports public API | `index.ts` |
