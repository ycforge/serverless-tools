---
description: "Task list for composer-builder — @ycforge/composer/builder, Builder-модуль Project B для конвейера ycsf build (ycforge:api-gateway)"
---

# Tasks: composer-builder — `@ycforge/composer/builder`, Builder-модуль Project B для конвейера `ycsf build` (`ycforge:api-gateway`)

**Input**: Design documents from `/specs/026-composer-builder/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), checklists/requirements.md

**Tests**: Test-first per constitution (II). Каждый FR-001..FR-016 и US-1..US-5 → ≥1 тест (RED → GREEN). Тесты пишутся ДО реализации и подтверждаются RED. Constitution II exception не применяется — компиляция/collectResourceReferences/отклонение build — чистые функции и интеграционные сценарии без сети/инфраструктуры.

**Organization**: Задачи сгруппированы по фазам плана P0..P5 (characterization → compile-core extraction → builder module core → публикация контракта → pilot-интеграция → CLI-parity) + Verification + Convergence. Фаза 2 (P1) блокирует все остальные; фазы 4/5 идут после P2+P3; фазы 6/7/8 — финальные, последовательные. `packages/composer` — единственный пакет, где меняется исходник; `packages/pilot` и `packages/materializers-core` — только потребляются (NG-3, NG-5); CLI-путь `ycsf-api` остаётся как есть (NG-1, NG-2).

## Format: `[ID] [P?] [USn] Description with file path`

- **[P]**: Can run in parallel (different files, no incomplete deps)
- **[M]**: Модификация существующего файла (не net-new)
- **[US1]–[US5]**: User story labels (только в US-фазах; P0/P1/Verification/Convergence — без label)
- Include exact file paths in descriptions

## Path Conventions

- **Package root**: `packages/composer/` — `package.json`, `tsup.config.ts`, `vitest.config.ts`, `src/index.ts`
- **Shared compile pipeline**: `packages/composer/src/compile-core.ts` (НОВЫЙ, P1), `packages/composer/src/cli/compile.ts` (glue, [M], P1)
- **Builder module**: `packages/composer/src/builder/` — `index.ts`, `artifact.ts`, `errors.ts` (НОВЫЕ, P2); публикуется как subpath `./builder`
- **Builder tests**: `packages/composer/test/builder/` — `builder-api.integration.spec.ts`, `safe-mode.spec.ts`, `artifact-value.test-d.ts`, `pilot-integration.spec.ts`, `cache-roundtrip.spec.ts`, `cli-parity.spec.ts`; `packages/composer/test/compile-core.integration.spec.ts`
- **Fixtures**: `packages/composer/test/fixtures/builder-openapi/` (map-form C-проект), `packages/composer/test/fixtures/runner-entry-*` (safe-mode), `packages/composer/test/fixtures/parity-legacy/` (CLI-parity, P5)
- **Existing legacy fixtures** (`test/fixtures/cli-pass`, `cli-bad-*`): НЕ трогаются (SC-006)
- **IDT-порядок/хэнд-офф**: `src/resource/types.ts` (`RESOURCE_DOMAINS`, `REFERENCE_BEARER_FIELDS`, `DOMAIN_PROPERTIES`, `types.ts:69-75`), `src/resource/refs/template.ts` (`TEMPLATE_RE`), `@ycforge/pilot/contracts` (`Builder/BuildContext/Artifact`, `parseResourceReference`)

---

## Phase 1: Setup — P0 Characterization (базовый CLI-контракт, без новых тестов)

**Purpose**: Зафиксировать pre-026 baseline CLI-пути: инвентаризация тестов/фикстур и legacy-контракта (array-form `.ycsf/apps.yaml`, корневой `openapi_entry` в `build_config.yaml`, module side-effect env в `compile.ts:18`). Доказать, что до СЮДА suite зелёный. Никаких новых тестов и правок существующих (F0 deliverable).

- [x] T001 Audit/инвентаризация CLI-контракта — задокументировать (в commit-сообщении задач) текущий набор: `packages/composer/src/cli/compile.ts:18` (module-global `SERVERLESS_TOOLS_OPENAPI_BUILD='1'`), `cli/load-config.ts:18-60` (array-form `apps.yaml`), `cli/load-openapi.ts:94-119` (`loadBuildConfig` корневой `openapi_entry`, fallback 006), fixtures `test/fixtures/cli-pass/` (array-form + корневой `build_config.yaml`), негативные `test/fixtures/cli-bad-*`, интеграционные `test/check.integration.spec.ts`, `test/extraction.integration.spec.ts`, `test/auth-config.integration.spec.ts`. Без правок кода. **Ref**: spec NG-1/NG-2/FR-012, plan P0, SC-006. **Depends**: —
- [x] T002 Verify baseline green — `pnpm --filter @ycforge/composer test` И `pnpm --filter @ycforge/pilot test` зелёные ДО любых изменений (gate P0). **Ref**: plan P0 (Verification). **Depends**: T001

**Checkpoint**: baseline-контракт зафиксирован и зелёный; `git status` чистый.

---

## Phase 2: Foundational — P1 compile-core extraction (общая пайплайн-логика, BLOCKS US-1..US-5)

**Purpose**: Извлечь единый pipeline композиции (D-3: merge → auth → overrides → sort → resolveReferences) в `src/compile-core.ts`, переиспользуемый CLI и builder'ом; CLI `compile.ts` становится тонким glue БЕЗ изменения поведения (SC-006). Без этой фазы не существует ни builder, ни parity.

### RED тесты compile-core (пишутся ДО реализации)

- [ ] T011 RED integration-test `packages/composer/test/compile-core.integration.spec.ts` (детерминизм + env-scope) — (a) два вызова `compileComposition` на одном входе → byte-equal JSON (SC-005/A-6); (b) env-scope: `process.env.SERVERLESS_TOOLS_OPENAPI_BUILD === '1'` НА ВРЕМЯ вызова и восстановлен (прежнее значение/undefined) после; импорт модуля `compile-core` НЕ выставляет env глобально (в отличие от `compile.ts:18` — модульного side-effect, который остаётся только у CLI). RED: `src/compile-core.ts` не существует. **Ref**: FR-007/D-5, plan P1 "env-safe-mode". **Depends**: T002
- [ ] T012 RED EXT расширение `packages/composer/test/compile-core.integration.spec.ts` (приоритет entry + 006 fallback + fail-fast) — (a) `openapiEntry` задан → грузится артефакт `openapi.json|yaml|yml` (`loadOpenApiArtifactFile`), runner/extract НЕ запускается; (b) entry отсутствует → 006 fallback: auto-detect артефакта `openapi.json`/`swagger.json` в appDir (`readOpenApiArtifact`), затем `dist/main[.js|.mjs|.cjs]` convention → runner; (c) ни источника, ни entry → `OpenApiExtractError('NO_SOURCE')` с семантикой семейства `OPENAPI_*` (fail-fast, без тишины); (d) `envMapping.mode === 'env-only'` → placeholder-документ (`paths: {}`, `info.title = appName`). RED: функции нет. **Ref**: FR-008, edge §8 «buildConfig пустой», plan P1/P2 RED. **Depends**: T011

### Реализация compile-core (GREEN)

- [ ] T013 Create `packages/composer/src/compile-core.ts` — `CompileSource { appId, appName, appDir, openapiEntry?, envOnly? }`, `compileComposition(source, projectRoot): { document, provenance }`; внутри: env set-at-call + restore, `buildResourceIndex(projectRoot)` (`cli/resource-index.ts`), `loadOverrides(projectRoot, appDir)` + `resolveOverrideValues` (`cli/load-overrides.ts`), source-load (entry через `load-openapi.ts`-семантику ИЛИ 006 fallback ИЛИ env-only placeholder), `applyAuth` → `applyOverrides` → `mergeDocuments` (single-app) → `sortRecordKeys` (включая рекурсию components) → `resolveReferences(..., REFERENCE_BEARER_FIELDS, index)`. Loader'ы `cli/load-*.ts` и `buildResourceIndex` НЕ выносятся из CLI (минимизируем churn; parity-риск). Единственная реализация композиции в пакете. **Ref**: D-3, plan P1 deliverable. **Depends**: T012
- [ ] T014 [M] Refactor `packages/composer/src/cli/compile.ts` в тонкий glue над compile-core — `loadAppsYaml`/`filterGatewayApps`/`selectGatewayApp` (legacy array-form, `cli/load-config.ts`) + `loadBuildConfig` (legacy корневой `openapi_entry`, `cli/load-openapi.ts:15-44`) → сборка `CompileSource` → `compileComposition` → запись stdout/`--output`; СОХРАНИТЬ `CLIError`/`CompileError`/`IOError`-обёртки и exit-коды 1/2/3 (`cli/errors.ts`), включая `ResourceRefError → CompileError('UNRESOLVED_RESOURCE_REF')` (`:105-106`); module side-effect env `:18` сохраняется (backcompat 010). **Ref**: FR-012, plan P1 glue, NG-1. **Depends**: T013
- [ ] T015 Verify backcompat SC-006 — весь существующий composer-набор (`src/**/*.spec.ts`, `test/*.integration.spec.ts`, CLI fixtures `cli-pass`/`cli-bad-*`, `check.integration.spec.ts`) зелёный БЕЗ правок тестов и фикстур — доказательство неломления CLI после extraction. **Ref**: SC-006, plan P1 Verification. **Depends**: T013, T014

**Checkpoint**: `pnpm --filter @ycforge/composer test` зелёный; CLI-поведение (вывод, exit-коды, корневой `openapi_entry`) не изменилось. Foundation готов — фазы 4/5/6 могут стартовать после P2+P3.

---

## Phase 3: US-1/US-2/US-3/US-4 — P2 builder module core (`src/builder/`, `test/builder/`)

**Goal**: Builder-модуль `{ default: { build } }`, совместимый с контрактом `@ycforge/pilot/contracts` Builder: потребляет всю модель через `BuildContext` (НЕ читает `.ycsf/apps.yaml` — BIG-4, US-2), компилирует по compile-core в safe mode (US-4), возвращает артефакт `{ type: 'ycforge:api-gateway', value: { specPath, resourceReferences } }` (US-3).

### Fixtures (установка)

- [ ] T021 Create fixture `packages/composer/test/fixtures/builder-openapi/` (map-form C-проект, US-2 AC1) — `.ycsf/apps.yaml` в map-form (`version: 1`, `apps: { openapi: { source_path: apps/openapi, builder: ycforge:api-gateway } }` — заведомо невалиден для B-парсера array-form, чем гарантирует падение теста, если файл будет прочитан); `.ycsf/resources.yaml` (`functions.user_service`, `buckets.frontend`); `.ycsf/env.yaml`; `apps/openapi/build_config.yaml` (C-формат wrapper: `version: 1`, `build_config: { openapi_entry: ./openapi.json }`); `apps/openapi/auth.yaml`; `apps/openapi/overrides.yaml`; `apps/openapi/openapi.json` (authorizer `function_id` = `${resources.functions.user_service.id}` + ссылка вне bearer-полей, напр. в `summary`, + недостижимый ?? НЕ добавлять — необъявленный ресурс тестируется через отдельный разовый root). `builders.yaml` НЕ коммитится — генерируется в тесте (T041, absolute dist-путь). **Ref**: US-2 AC1, plan P2/P4 structure. **Depends**: T015
- [ ] T022 [P] Create runner-entry fixtures `packages/composer/test/fixtures/runner-entry-*` (US-4): (a) `runner-entry-env-probe.mjs` — читает `process.env.SERVERLESS_TOOLS_OPENAPI_BUILD` и возвращает его значение в документ; (b) `runner-entry-noisy.mjs` — пишет маркер в process.stdout/stderr + возвращает валидный документ; (c) `runner-entry-hang.mjs` — не завершается (для timeout). **Ref**: US-4 AC1-3, plan P2 fixtures. **Depends**: T015

### RED тесты builder (пишутся ДО реализации)

- [ ] T023 RED `packages/composer/test/builder/builder-api.integration.spec.ts` part 1 (US-2/FR-005/FR-008/FR-006) — (a) fs-проба US-2 AC1: build успешен на map-form проекте T021; NPR-проверка pipeline-инструментов перед вызовом (hoisted fs probe — `openapi_entry` wrapper прочитан из context, `.ycsf/apps.yaml` не открывался); (b) US-2 AC2: wrapper `build_config.openapi_entry` приоритетнее — источник загружен по нему, fallback 006 НЕ срабатывает; (c) US-2 AC3: entry отсутствует в buildConfig → 006 fallback auto-detect (`openapi.json`/`swagger.json` в appDir); (d) пустой buildConfig `{}` (legacy root-form под C даёт пустой wrapper) → fallback; отсутствие источника → fail-fast `NO_SOURCE`/`OPENAPI_*`, не тишина. RED: `src/builder/index.ts` не существует. **Ref**: US-2 AC1-3, FR-005/FR-008, edge §8 «buildConfig пустой», risk #1. **Depends**: T021, T013
- [ ] T024 RED EXT `packages/composer/test/builder/builder-api.integration.spec.ts` part 2 (fail-fast + артефакт + resourceReferences + specPath) — (a) `sourcePath` undefined/несуществующий/не каталог → fail-fast BuilderError (НЕ fallback к projectRoot; plan open-question 3); (b) `openapi_entry` в wrapper не-string → fail-fast; (c) US-3 AC1/AC4 + FR-009/D-4/D-7: `collectResourceReferences` — ровно одна запись `{ logical: 'functions.user_service', terraformType: 'yandex_function' }` на уникальный `domain.name` в bearer-полях (`REFERENCE_BEARER_FIELDS`), дубликаты по `logical` схлопнуты, порядок — по `RESOURCE_DOMAINS`, затем алфавит по `name`; ссылки вне bearer-полей не тронуты И не в списке; (d) US-3 AC3: ссылка на необъявленный ресурс → `RESOURCE_REF_NOT_DECLARED` (fail-fast, не пропустить); (e) FR-004/FR-015: `specPath` — absolute путь в `context.outputDir`, файл существует, `JSON.parse` + `openapi`/`paths`, таблица ключей отсортирована; пустой `paths: {}` → валидный артефакт (edge §8). RED: builder не существует. **Ref**: US-3 AC1/3/4, FR-003/004/009/011/015, D-4/D-7, edge §8. **Depends**: T023
- [ ] T025 RED `packages/composer/test/builder/safe-mode.spec.ts` (US-4/FR-007/FR-013/D-5) — (a) env-probe entry (T022a) выполнялся в процессе с `SERVERLESS_TOOLS_OPENAPI_BUILD === '1'`; (b) noisy entry (T022b): маркер stdout/stderr НЕ появляется в выводе процесса build (изоляция канала fd 3); (c) hanging entry (T022c) → диагностика семейства `ENTRY_TIMEOUT`-диагностики, процесс убит, `build()` отклонён, не утечка; (d) user-код НИКОГДА не импортируется in-process builder'а (runner — единственная граница исполнения; статическая проба по импортам runner/spawn vs прямой load). RED: builder не существует. **Ref**: US-4 AC1-3, FR-007/FR-013, D-5, constitution I. **Depends**: T022

### Реализация builder (GREEN)

- [ ] T026 Create `packages/composer/src/builder/artifact.ts` — `ResourceReferenceValue { logical, terraformType }`, `ApiGatewayArtifactValue { specPath, resourceReferences }` (контракт 019 shape), frozen IDT-таблица (D-4: `functions → yandex_function`, `queues → yandex_message_queue`, `buckets → yandex_storage_bucket`, `containers → yandex_serverless_container`, `gateways → yandex_api_gateway`; сверено с materializers-core 019), `collectResourceReferences(document)` — по `REFERENCE_BEARER_FIELDS` (wildcard `components.securitySchemes.*.x-yc-apigateway-authorizer.function_id`), уникализация по `logical`, порядок D-7 (появление домена в `RESOURCE_DOMAINS`, затем алфавит по `name`). Единственное Terraform-знание B — адресная таблица, не семантика. **Ref**: FR-009/FR-011, D-4/D-7, A-4. **Depends**: T024
- [ ] T027 [P] Create `packages/composer/src/builder/errors.ts` — `BuilderError` (code + контекст appId/sourcePath/artifactType; FR-010 — диагностика с контекстом artifact/appId); транслировать `CLIError`/`IOError`/`ResourceRefError`/`OpenApiExtractError` в fail-fast-отклонение `build()` (rejected Promise), без тихих деградаций. **Ref**: FR-010, constitution V. **Depends**: T024
- [ ] T028 Create `packages/composer/src/builder/index.ts` — default-экспорт `{ build }` (shape-совместим с `getBuilder`/`detectPluginKind` в C, `registry/shape.ts:17-25`): `deriveCompileSource(context)` — `appId = basename(resolve(context.outputDir))`, `appDir = resolve(context.sourcePath)` (fail-fast если undefined), `openapi_entry` из `(context.buildConfig as { build_config?: { openapi_entry?: unknown } }).build_config?.openapi_entry` (wrapper-фабрика = единая точка чтения; non-string → fail-fast BuilderError; legacy root-form → wrapper пуст → fallback 006), `appName = appId` (env-only placeholder); `compileComposition`; `collectResourceReferences(document)`; `mkdirSync(context.outputDir, { recursive: true })` + `writeFile(resolve(context.outputDir, 'openapi.json'), JSON.stringify(document, null, 2))` (absolute, cwd-robust; имя файла — стабильная константа artifact.ts); возврат `{ type: 'ycforge:api-gateway', value: { specPath, resourceReferences } }`. Runner-резолв из dist (`resolveRunnerPath` → `packages/composer/runner/runner.mjs`, `spawn-runner.ts:8-14`) не ломается. **Ref**: FR-001/002/003/004/006/008, D-1/D-2/D-6, plan orchestration frontier. **Depends**: T013, T026, T027
- [ ] T029 Verify GREEN — `builder-api.integration.spec.ts` (part 1+2), `safe-mode.spec.ts`, `compile-core.integration.spec.ts` зелёные; RED→GREEN по фазам соблюдён (каждый RED-тест против T026-T028). **Ref**: SC-002/SC-003/SC-007, plan P2 Verification. **Depends**: T021-T028

**Checkpoint**: builder работает unit-уровне в compose-пакете; `.ycsf/apps.yaml` не читается (fs-проба), env-only/safe-mode изоляция доказаны, `resourceReferences`/`specPath` соответствуют 019-контракту.

---

## Phase 4: US-1/US-3 — P3 публикация контракта `./builder` (FR-014/FR-016, SC-007)

**Purpose**: Аддитивная публикация subpath `@ycforge/composer/builder`: exports map, tsup-сборка, объявление devDep `@ycforge/materializers-core` и включение тест-d в vitest typecheck. Тип-тесты доказывают conformance value ↔ 019 и assignability контрактов pilot (без локального ре-объявления).

### RED тип-тест (до реализации)

- [ ] T031 RED type-test `packages/composer/test/builder/artifact-value.test-d.ts` (прецедент: `packages/pilot/test/types/materializers-core-contract.test-d.ts`, expectTypeOf) — (a) composer `ApiGatewayArtifactValue` ↔ materializers-core `ApiGatewayArtifactValue` structural (`toEqualTypeOf`); `ResourceReferenceValue` ↔ core `ResourceReference` (FR-014); (b) `import type { Builder, BuildContext, Artifact } from '@ycforge/pilot/contracts'` — типы контракта, НЕ локальные; default-объект builder assignable к `Builder` (FR-002, D-3); (c) `await import('@ycforge/composer/builder')` резолвится (publish-contract через dist; FR-001/D-1). RED: `./builder` subpath отсутствует, dist/builder не существует. **Ref**: FR-002/FR-014/FR-016, SC-007, plan P3. **Depends**: T029, T028

### Реализация (GREEN)

- [ ] T032 [M] Modify `packages/composer/package.json` — exports `"./builder": { "types": "./dist/builder/index.d.ts", "import": "./dist/builder/index.js" }` (additive, `"."`/bin `ycsf-api` не меняются — FR-016); devDependencies `"@ycforge/materializers-core": "workspace:*"`; `pretest` → `pnpm --filter @ycforge/pilot build && pnpm build` (порядок pilot-first: tsup dts резолвит типы pilot из dist — литеральный порядок плана `pnpm build && pilot build` сломал бы dts; self-build нужен тестам для dist/builder; runner → `../../runner/runner.mjs` находится outside dist в `files: ["dist","runner"]`); `pnpm install`. **Ref**: FR-001/FR-016, risk #5, plan P3. **Depends**: T031
- [ ] T033 [M] Modify `packages/composer/tsup.config.ts` — третий entry `{ 'builder/index': 'src/builder/index.ts' }`, format esm, dts: true, clean: false, sourcemap: true, external `['yaml','commander','@ycforge/pilot']` (→ `dist/builder/index.js` + `.d.ts`); Modify `packages/composer/vitest.config.ts` — `test.typecheck = { enabled: true, include: ['test/builder/**/*.test-d.ts'] }` (прецедент `packages/pilot/vitest.config.ts:3-7`). **Ref**: plan P3 deliverable, publish-contract. **Depends**: T032
- [ ] T034 Verify GREEN — `pnpm --filter @ycforge/composer build` → `dist/builder/index.{js,d.ts}` присутствуют; T031 type-test GREEN (vitest typecheck + `tsc --noEmit`); `"."`-импорт `@ycforge/composer` (compose/auth/resource API) работает как раньше (аддитивность, SC-007); dist строится без новых external-зависимостей. **Ref**: FR-016, SC-007, plan P3 Verification. **Depends**: T032, T033

**Checkpoint**: `@ycforge/composer/builder` издаваем как subpath; value-типы conformance доказаны; bin/`"."` нетронуты.

---

## Phase 5: US-1/US-3 — P4 pilot-интеграция (registry + materializer hand-off + blob-cache)

**Goal**: Полный e2e по конвейеру C: `buildApps` (pilot) диспатчит real `@ycforge/composer/builder` через registry (absolute dist-путь, прецедент 025 e2e-real-cores), артефакт пробрасывается в real `@ycforge/materializers-core` yandex-api-gateway → замена ``${resources.*}`` → ``${terraformType.*}``; spawn-probe (0 CLI-субпроцессов); blob-cache round-trip (FR-015).

- [ ] T041 Create pilot-фикстура/хелпер внутри `packages/composer/test/builder/pilot-integration.spec.ts` — temp-копия fixture `builder-openapi` + запись `.ycsf/builders.yaml` с ключом `builders:\n  ycforge:api-gateway: <absolute path packages/composer/dist/builder/index.js>` (прецедент-паттерн `packages/pilot/test/registry/quickstart.spec.ts:50-68`; in-workspace subpath-import из dynamic-import'а pilot не резолвится — risk #2, mirror 025 T032). **Ref**: US-1 AC1, risk #2, plan P4. **Depends**: T021, T033
- [ ] T042 RED integration `packages/composer/test/builder/pilot-integration.spec.ts` (US-1 AC1/AC2 + SC-001) — публичный API `buildApps(tempRoot)` (pilot 025): registry загружает модуль по absolute-пути, `detectPluginKind` → builder, 0 ошибок `BRG_*`; `build()` исполнен ровно один раз; `artifact.type === 'ycforge:api-gateway'`; `value.specPath` absolute в `.ycsf/artifacts/openapi/openapi.json`, файл существует + парсится (`openapi`/`paths`); `value` JSON-сериализуем (валиден для blob-кэша 022). RED: builder не загружается (subpath/dist отсутствуют). **Ref**: US-1 AC1/AC2, FR-003/004, plan P4. **Depends**: T041
- [ ] T043 [P] RED EXT `packages/composer/test/builder/pilot-integration.spec.ts` (US-3 AC2 + SC-002, hand-off реальный materializers-core) — `dispatch(model, registry, { artifacts: AppIdArtifactMap })` с real `@ycforge/materializers-core/yandex-api-gateway`: `replaceResourceRefs` по specPath — `${resources.functions.user_service.id}` → `${yandex_function.user_service.id}`; ресурс `yandex_api_gateway` в ok-ветке (name = `artifact.name` = appId, TF-address проставляется C-dispatch); NG-3 согласован: companion `<cwd>/generated/<name>-openapi.yaml` создаётся в temp-cwd, `process.chdir`/restore в finally, НИКАКИХ фиксов materializers-core (NG-5). **Ref**: US-3 AC2, FR-014, NG-3/NG-5, plan P4 hand-off. **Depends**: T042
- [ ] T044 [P] RED EXT `packages/composer/test/builder/pilot-integration.spec.ts` (US-1 AC3, spawn-probe) — observability-проба: во время build порождается 0 composer CLI-субпроцессов (`ycsf-api`/compile), runner-spawn разрешён (node `runner.mjs` — это и есть сборка); композиция in-process, без субпроцессного `ycsf-api`. **Ref**: US-1 AC3, SC-001, plan P4. **Depends**: T042
- [ ] T045 [P] RED `packages/composer/test/builder/cache-roundtrip.spec.ts` (FR-015 + A-7) — артефакт `{ type, value }` переживает blob-cache round-trip (022 `saveBlob`/`restoreBlob` с тем же `outputDir`, или два прогона `buildApps` при активном кэше): после restore `value.specPath` (absolute) остаётся валидным при неизменном корне, документ парсится; перемещение корня — документированная граница (edge §8). **Ref**: FR-015, A-7, edge «restored из кэша», plan P4 FR-015. **Depends**: T042
- [ ] T046 Verify GREEN — `pilot-integration.spec.ts` + `cache-roundtrip.spec.ts` проходят БЕЗ правок `packages/pilot` (NG-3) и БЕЗ правок `packages/materializers-core` (NG-5); full build не создаёт субпроцесс `ycsf-api`. **Ref**: SC-001/SC-002, plan P4 Verification. **Depends**: T042-T045

**Checkpoint**: полный конвейер `ycsf build` → materialize работает in-process на map-form проекте; no-CLI-subprocess доказан; кэш-восстановление работоспособно.

---

## Phase 6: US-5 — P5 CLI-parity + backcompat guard (SC-005/SC-006)

**Goal**: bit-parity builder vs CLI на одном app-dir + одном entry (SC-005, детерминизм); полный legacy-набор composer остаётся зелёным без правок (SC-006).

- [ ] T051 Create parity-комплект `packages/composer/test/fixtures/parity-legacy/` — legacy-корень: array-form `.ycsf/apps.yaml` (`id: openapi`, `builder: yandex-api-gateway`, `path` → общий app-dir `../builder-openapi/apps/openapi`), корневой `build_config.yaml` (`openapi_entry: ./openapi.json` — legacy root-form), идентичные `.ycsf/resources.yaml`/`.ycsf/env.yaml` и глобальные `openapi/overrides.yaml` (копии из builder-openapi — для bit-parity глобальные overrides ДОЛЖНЫ быть идентичны с обеих сторон; appId совпадает: CLI `openapi` = builder `basename(outputDir)` = `openapi`). **Ref**: SC-005, plan P5 (данные parity — резолв в этой задаче: равенство resources/env/global-overrides + совпадение appId — инварианты setup). **Depends**: T021
- [ ] T052 RED `packages/composer/test/builder/cli-parity.spec.ts` (SC-005/A-6) — один и тот же app-dir + один и тот же `openapi_entry`: `compileCommand` (CLI, projectDir=parity-legacy) и `build()` (builder, context по builder-openapi) → bit-identical JSON-документ (сравнение байтов, включая сортировку ключей 008); 2 builder-запуска → byte-equal (детерминизм D-7). RED: builder отсутствует/расхождение. **Ref**: SC-005, FR-011, plan P5 RED. **Depends**: T013, T028, T051
- [ ] T053 Backcompat guard (SC-006/FR-012) — refinal-прогон ВСЕГО существующего composer CLI-набора (включая негативные `cli-bad-*`, `check.integration.spec.ts`) после фаз 2-5: зелёный БЕЗ единой правки фикстур/тестов (0 регрессий). **Ref**: SC-006, NG-1/NG-2, US-5 AC1. **Depends**: T015, T029, T046, T052
- [ ] T054 [M] Backcompat документация — строка в `specs/026-composer-builder/spec.md` (edge case §8): env-only placeholder `info.title` — CLI берёт `name` из array-form apps.yaml, builder — `appId` (`basename(outputDir)`); документированное расхождение, реальную композицию не затрагивает; parity покрывает только реальную композицию (plan escalation). **Ref**: FR-012, plan §Эскалация/удаления, open-question 2(a). **Depends**: T052
- [ ] T055 Verify — `pnpm --filter @ycforge/composer test` И `pnpm --filter @ycforge/pilot test` полные зелёные; `git status` — только планируемые файлы (`packages/composer/**` + `specs/026-composer-builder/**`). **Ref**: SC-006, plan P5 Verification. **Depends**: T052, T053, T054

**Checkpoint**: builder и CLI бит-в-бит совпадают на общей композиции; zero-regression legacy-суита зафиксирован.

---

## Phase 7: Verification (typecheck, lint, build, full regression)

**Purpose**: Сквозная проверка перед converge: типы, lint, tsup, полные suite'ы, границы git-diff.

- [ ] T061 Typecheck — `pnpm --filter @ycforge/composer typecheck` (`tsc --noEmit`, strict) zero errors: новые `src/compile-core.ts`, `src/builder/**`, `test/builder/**`, `.test-d.ts` компилируются. **Ref**: SC-007, plan P5 Verification. **Depends**: T055
- [ ] T062 Scoped lint — `pnpm exec eslint packages/composer/src packages/composer/test` zero NEW errors; 026-touched файлы чисты, legacy-baseline за границами 026 не трогается (паттерн 023 T144). **Depends**: T061
- [ ] T063 Build — `pnpm --filter @ycforge/composer build` → `dist/index.{js,d.ts}`, `dist/cli/index.{js,d.ts}`, `dist/builder/index.{js,d.ts}` присутствуют; exports `"."`/`"./builder"` резолвятся; bin `ycsf-api` нетронут. **Depends**: T062
- [ ] T064 Full regression — `pnpm exec vitest run` в `packages/composer` (all specs + integrations + type-tests) И `pnpm --filter @ycforge/pilot test` (pilot-side suite без новых failures; pilot не тронут). **Depends**: T063
- [ ] T065 Git-status audit — `git diff dev...HEAD` покрывает только `packages/composer/**` + `specs/026-composer-builder/**` (+ `specs/README.md` roadmap); `packages/pilot`, `packages/materializers-core`, `packages/nest-bridge`, `packages/js-dev-tools` — не тронуты. **Depends**: T064

**Checkpoint**: typecheck/lint/build/regression чистые; границы диффа соблюдены.

---

## Phase 8: Convergence

**Purpose**: Read-only аудит `/speckit.converge` — вердикт-плейсхолдер, заполняется после implementation комплекса.

- [ ] T066 Convergence placeholder (T150-style) — read-only аудит: полные suite'ы GREEN (composer + pilot), `tsc --noEmit` 0 ошибок, scoped eslint 0 NEW, tsup build с `dist/builder`; traceability: каждый FR-001..FR-016 и US-1..US-5 → ≥1 задача T011-T065; additivity SC-007 (`.`/bin/`@ycforge/pilot/contracts`/materializers-core не менялись); RED→GREEN дисциплина по фазам; задокументированные расхождения: env-only placeholder (T054), wrapper-vs-root `openapi_entry` (T023/T032), NG-3 pin (T043), pretest-order pilot-first (T032). Вердикт-плейсхолдер. **Ref**: plan §Wrap-up, AGENTS.md work loop. **Depends**: T061-T065

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (P0)**: Без внешних зависимостей. T001 → T002.
- **Phase 2 (P1)**: После Phase 1. Блокирует ВСЕ US-фазы. Внутри: T011 → T012 → T013 → T014 → T015 (последовательная цепочка — один общий модуль `compile-core.ts` и glue).
- **Phase 3 (P2)**: После Phase 2 (compile-core). Fixtures T021/T022 → RED T023/T024/T025 → GREEN T026/T027/T028 → verify T029.
- **Phase 4 (P3)**: После Phase 3 (builder/index.ts есть). T031 (RED) → T032 → T033 → T034.
- **Phase 5 (P4)**: После Phase 3 (builder core) И Phase 4 (dist/builder существует для absolute-пути) И T021 (fixture). T041 → T042 → {T043, T044, T045 [P]} → T046.
- **Phase 6 (P5)**: После Phase 2 (compile-core), Phase 3 (builder), Phase 5 (e2e). T051 → T052 → {T053, T054 [P]} → T055.
- **Phase 7 (Verification)**: После Phase 6. T061 → T062 → T063 → T064 → T065 (последовательные).
- **Phase 8 (Convergence)**: После Phase 7. T066 placeholder.

### Dependency Graph

```
Phase 1 (P0):  T001 → T002
                   │
Phase 2 (P1):  T011 → T012 → T013 → T014 → T015 ──────────────────────┐ blocks US
                   │                                                    │
Phase 3 (P2):  T021,T022 → T023 → T024 → T025                          │
                   │        └──────────────┐  ┌─────────────┐          │
                   │        ┌──────────────┴──▼──▼───┐       │          │
                   │        T026 → T027(→T028) → T029               │
                   ▼            (artifact → errors → index)            │
Phase 4 (P3):  T031 → T032 → T033 → T034 ────────────────┐             │
Phase 5 (P4):  T041 → T042 → {T043,T044,T045} → T046      │             │
Phase 6 (P5):  T051 → T052 → {T053,T054} → T055            │             │
Phase 7 (Vrf): T061 → T062 → T063 → T064 → T065           ▼             │
Phase 8 (Cnv): T066 ◀───────────────────────────────────────────────────┘
```

- **Phase 2** — критическая блокирующая (compile-core = фундамент builder и parity).
- **Phases 3, 4, 5** — строго последовательные в данных (builder → дистрибутив → e2e), НО внутри параллелятся RED-тесты/модули (см. ниже).
- **Phase 6** можно начать сразу после Phase 3 для самого parity (T051/T052 зависят от T013/T028, не от P4) — P4/P6 параллелизуемы по разным файлам; T053/T055 — финальные агрегаты.
- **Phase 7/8** — после всего.

### Parallel Opportunities

- Phase 3: T021 (fixture builder-openapi) и T022 [P] (fixtures runner-entry) — разные каталоги, параллельно.
- Phase 3: T026 (artifact.ts) и T027 [P] (errors.ts) — разные файлы, параллельно; T028 (index.ts) — после обоих; T029 — verify после T021-T028.
- Phase 5: T043 (hand-off), T044 (spawn-probe), T045 (cache-roundtrip) [P] — параллельные секции/файлы после T042.
- Phase 6: T053 (backcompat refinal) и T054 [P] (spec-документация) — параллельно после T052.
- Phase 4↔Phase 6: T034 и T051/T052 — независимы после Phase 3 (dist/builder и compile-core).

### Parallel Example: после Phase 3

```bash
# Phase 4 (publish contract):
Task: "T031→T032→T033→T034"
# Phase 6 pre-work (parity data):
Task: "T051 parity-legacy fixture → T052"
# После T052+T034: T053/T054 → T055, затем Phase 7/8.
```

---

## Implementation Strategy

### MVP First (US-1 only)

1. Phase 1: P0 baseline (T001-T002).
2. Phase 2: P1 compile-core extraction (T011-T015) — **CRITICAL, blocks everything**.
3. Phase 3: P2 builder core (T021-T029) — builder уже артефактится на compose-фикстуре.
4. **STOP and VALIDATE**: `builder-api.integration.spec.ts` + `safe-mode.spec.ts` GREEN; fs-проба US-2 AC1 проходит (apps.yaml не читается).
5. Phase 4: publish `./builder` (T031-T034) — контракт аддитивен, type-tests доказывают conformance.

### Incremental Delivery

1. Setup + Foundational → CLI живёт на compile-core (SC-006), builder executable локально.
2. Builder-модуль core → артефакт на фикстуре (US-1/US-2/US-3 US-level).
3. Публикация subpath → дистрибутив издаваем (US-3, FR-014/016).
4. Pilot e2e → real `buildApps` + real materializers-core hand-off (US-1/US-3 acceptance).
5. CLI-parity + backcompat → bit-identity и 0-регрессий legacy (US-5, SC-005/006).
6. Verification + Convergence → полный green, T066 вердикт `/speckit.converge`.

### Parallel Team Strategy

После Phase 2 один исполнитель может вести Phase 3, второй — параллельно готовить данные parity (T051, зависит только от T021). После Phase 3: один — Phase 4, второй — Phase 6 T052; после обоих — P4 e2e и финальные агрегаты T053/T055.

---

## Notes

- [P] tasks = different files, no incomplete deps — safe to parallelize.
- [M] tasks = модификация существующего файла; всё остальное — net-new.
- [USn] label мэппится на user story (FR→AC→task traceability).
- Constitution II: каждый RED-тест пишется ДО реализации и подтверждается RED; GREEN — после реализации. Исключений для характеристик в 026 нет (композиция/collect/reject — чистые функции).
- **NG-3/NG-5**: никаких фиксов `packages/materializers-core` (cwd-companion, non-`.id` refs) — поведение упинается в тестах (T043), как 025 T032(b).
- **NG-3 pilot**: никаких правок `packages/pilot`; builder — consumer контракта.
- **CLI dialect сохранён**: array-form apps.yaml + корневой `openapi_entry` живут в fixtures как есть (NG-2, SC-006); builder никогда не читает `.ycsf/apps.yaml` (BIG-4, FR-005).
- **Wrapper-vs-root `openapi_entry`**: builder читает ТОЛЬКО `buildConfig.build_config.openapi_entry` (C-wrapper); root-form под C даёт пустой wrapper → fallback 006 (риск #1, документировано T023/T054).
- **Pretest порядок**: `pnpm --filter @ycforge/pilot build && pnpm build` (pilot-first) — необходимость для dts-резолва pilot-типов; отклонение от литерала плана обосновано в T032.
- **env-only placeholder**: `info.title` — CLI `name` из apps.yaml, builder `appId`; документированное расхождение (T054), parity покрывает реальную композицию.
- **Convergence**: tasks.md считается выполненным, когда T061-T065 зелёные и T066 заполнен вердиктом; roadmap `specs/README.md` обновляется на ✅ только после `/speckit.converge`.