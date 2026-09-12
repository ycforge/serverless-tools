---
description: "Task list for pilot-e2e-enablement — значения артефактов через materialize, artifact-типы в builders.yaml, suspicious-keys в `ycsf check`"
---

# Tasks: pilot-e2e-enablement — `@ycforge/pilot`, BIG-1 / BIG-2 / BIG-6

**Input**: Design documents from `/specs/025-pilot-e2e-enablement/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), checklists/requirements.md

**Tests**: Test-first per constitution (II). Каждый FR-001..FR-016 / US-1..US-5 → ≥1 тест (RED → GREEN). Thin orchestration (pipeline.ts characterization) — exception per constitution: characterization-тесты постфактум.

**Organization**: Задачи сгруппированы по фазам: (1) Additive contract / (2) BIG-1 values threading / (3) D-3 auto-outputs / (4) BIG-2 builders registry / (5) BIG-6 suspicious-keys / (6) E2E + приёмка / (7) Verification / (8) Convergence. Фазы 2–4 могут идти параллельно друг с другом; фаза 5 параллельна с 2–4; фаза 6 последовательна после 2–5; фазы 7–8 — финальные. `packages/pilot` — единственный пакет.

## Format: `[ID] [P?] [USn] Description with file path`

- **[P]**: Can run in parallel (different files, no incomplete deps)
- **[US1]–[US5]**: User story labels (required in US phases)
- Include exact file paths in descriptions

## Path Conventions

- **Contracts**: `packages/pilot/src/contracts/materialize.ts`, `packages/pilot/src/contracts/check.ts`, `packages/pilot/src/contracts/outputs.ts`, `packages/pilot/src/contracts/index.ts`
- **Materialize flow**: `packages/pilot/src/materialize/select.ts` (`:65 buildArtifactDescriptors`, `:80 selectArtifacts`), `packages/pilot/src/materialize/materialize.ts` (`:36 materializeAll`), `packages/pilot/src/materialize/dispatch.ts` (`:24 dispatch`), `packages/pilot/src/materialize/context.ts` (`:24 createOutputBuilder`)
- **Pipeline**: `packages/pilot/src/cli/pipeline.ts` (`:35 runMaterializeGeneration`, `:100-104 buildOutputs`, `:135 runBuildAndMaterialize`)
- **Outputs**: `packages/pilot/src/outputs/build.ts` (`:80-86 prefix check`)
- **Registry**: `packages/pilot/src/registry/builders-yaml.ts` (`:15 KEY_RE`, `:85 validate`), `packages/pilot/src/registry/validate.ts`, `packages/pilot/src/registry/load.ts`
- **Check**: `packages/pilot/src/check/check.ts`, `packages/pilot/src/check/errors.ts`, `packages/pilot/src/check/categories/`
- **Tests**: `packages/pilot/test/unit/`, `packages/pilot/test/types/`, `packages/pilot/test/check/`, `packages/pilot/test/cli/unit/pipeline.test.ts`, `packages/pilot/test/outputs/quickstart.spec.ts`, `packages/pilot/test/unit/outputs-build.spec.ts`, `packages/pilot/test/build/materialize-equivalence.spec.ts`
- **Fixtures**: `packages/pilot/test/helpers/materialize-fixtures.ts`, `packages/pilot/test/check/fixtures/suspicious-keys/`
- **Import from contracts barrel**: `packages/pilot/src/contracts/index.js` (re-exports all contracts)

---

## Phase 1: Additive Contract (FR-016, SC-007, D-3)

**Purpose**: Расширить контракты (`ArtifactDescriptor.value?`, `DispatchOptions.artifacts?`, `DispatchResult.ok.materializerOutputs`, `YCK_SUSPICIOUS_KEY`, `YckDiagnostic.key?/reason?`, `AppIdArtifactMap`, frozen-комментарий на `OUT_INVALID_AUTO_PREFIX`) — тест-first, затем реализация. Фаза BLOCKS все остальные.

### Tests for Contract Additivity (RED — write FIRST)

- [x] T001 [P] [US1] RED type-test `packages/pilot/test/types/materialize.test-d.ts` EXT — (a) `ArtifactDescriptor['value']` expected as `unknown | undefined` (exactOptionalPropertyTypes compatible); (b) `DispatchOptions['artifacts']` typed as `AppIdArtifactMap | undefined`; (c) `dispatch` callable with `(model, registry)` AND `(model, registry, DispatchOptions)`; (d) DispatchResult ok-ветка (объект целиком) содержит `materializerOutputs: ReadonlyMap<string, OutputValue>` через `toMatchTypeOf`. RED: `AppIdArtifactMap` / `value` не экспортируются, `materializerOutputs` нет в ok-ветке. **Ref**: FR-016, SC-007, plan §Phase 1.
- [x] T002 [P] [US4] RED type-test `packages/pilot/test/types/outputs.test-d.ts` EXT — (a) frozen-guard: импортированный `OUT_INVALID_AUTO_PREFIX` по-прежнему экспортируется и типизирован как литерал (frozen не удалён); (b) количество OUT_*-кодов по-прежнему 8 (additive — ни один не удалён); (c) новый тип `YckDiagnostic` содержит опциональные `key?: string` и `reason?: string` через `toMatchTypeOf`. RED: `YckDiagnostic` без `key`/`reason`, `OUT_INVALID_AUTO_PREFIX` frozen не заморожен комментарием. **Ref**: FR-008/FR-016, SC-007, plan §Phase 1.

### Implementation for Contract Additivity (GREEN)

- [x] T003 [US1] Modify `packages/pilot/src/contracts/materialize.ts:22-26` — (a) `ArtifactDescriptor.value?: unknown` (conditional spread в conditional property, exactOptional compatible); (b) `AppIdArtifactMap = ReadonlyMap<string, import('./builder.js').Artifact>` как type alias; (c) `DispatchOptions.artifacts?: AppIdArtifactMap` как новое optional поле; (d) ok-ветка `DispatchResult` (`:74-78`) += readonly поле `materializerOutputs: ReadonlyMap<string, import('./outputs.js').OutputValue>`. **Depends**: T001.
- [x] T004 [P] [US4] Modify `packages/pilot/src/contracts/check.ts:28-41` — (a) `YckDiagnostic` += `key?: string`, `reason?: string`; (b) добавить `YCK_SUSPICIOUS_KEY = 'YCK_SUSPICIOUS_KEY' as const` после `YCK_TERRAFORM_UNAVAILABLE` (`:23`). **Depends**: T002.
- [x] T005 [P] [US3] Modify `packages/pilot/src/contracts/outputs.ts:56-59` — frozen-комментарий `// OUT_INVALID_AUTO_PREFIX: superseded by FR-008 (spec 025, D-3) — frozen, не использовать.` на строке константы (код и экспорт сохраняются). **Ref**: FR-008, D-3, plan §Phase 1 GREEN.
- [x] T006 [P] Modify `packages/pilot/src/contracts/index.ts` — добавить `export type { AppIdArtifactMap } from './materialize.js';` (тип используется тестами и src-модулями). **Depends**: T003.
- [x] T007 [P] Modify `packages/pilot/src/check/errors.ts:4,9-11,13,21-23,28-36,42` — (a) добавить `import { YCK_SUSPICIOUS_KEY } from '../contracts/check.js';`; (b) добавить `key?: string` и `reason?: string` в `YckOptions` (`:15-23`); (c) добавить оба поля в `diagnostic` объект в `yck()` (`:25-42`) с guarded assignment: `if (opts.key !== undefined) diagnostic.key = opts.key;` etc; (d) реэкспорт `YCK_SUSPICIOUS_KEY` из десятой строки. **Depends**: T004.

**Checkpoint**: `pnpm --filter @ycforge/pilot typecheck` — zero errors. Все type-test файлы T001/T002 GREEN (отдельно `test-d`-файлы).

---

## Phase 2: BIG-1 — Значения артефактов в materialize (FR-001..FR-007, FR-005, US-1)

**Purpose**: Значения (`value`) built-артефактов прошиваются через `DispatchOptions.artifacts` → `ArtifactDescriptor.value` → `materializer.materialize(descriptor)` → `DispatchResult.ok.materializerOutputs`. Единая точка построения descriptor (`buildArtifactDescriptors`). Thin orchestration pipeline.ts — characterization postfactum.

### Tests for Value Threading (RED — write FIRST)

- [x] T008 [P] [US1] RED unit-test `packages/pilot/test/unit/select.spec.ts` EXT +2 кейса — (a) `selectArtifacts(model, registry, { artifacts })` — artifacts содержит appId→`{ type: 'yandex-function', value: { archivePath: 'dist/func.zip' } }`; spy на supports-вызове 1-го вызова содержит descriptor с `{ value: { archivePath: 'dist/func.zip' } }`, 2-го appId (отсутствующий в artifacts map) — descriptor без `value`; (b) selectArtifacts(model, registry) без опций — `supportsCalls` без `value` ни в одном descriptor (backward-compat, US-5). RED: `selectArtifacts` не принимает artifacts параметр / `buildArtifactDescriptors` не прошивает value. **Ref**: FR-002/FR-003, plan §Phase 2 RED.
- [x] T009 [P] [US1] RED unit-test `packages/pilot/test/unit/materialize.spec.ts` EXT +2 кейса — (а) `materializeAll(model, registry, matches, outputBuilder, { artifacts })` — spy фиксирует descriptor через `materializeArtifacts[0]` и он содержит `{ value }`; (б) FR-007 document-error: materializer, требующий `value` (тестовый spy `options: { requiresValue: true }`), без artifacts в карте → `result.kind === 'failed'` с `error.code === 'MTL_MATERIALIZE_FAILED'` и message содержит слово "value" (или "built" или "full build"). RED: `materializeAll` не принимает artifacts / нет MTL_MATERIALIZE_FAILED message на missing value. **Ref**: FR-007, plan §Phase 2 RED.
- [x] T010 [P] [US1] RED unit-test `packages/pilot/test/unit/dispatch.spec.ts` EXT +2 кейса — (а) `dispatch(model, registry, { artifacts })` — materializer получает descriptor с `value`; `result.kind === 'ok'` && `result.materializerOutputs.size > 0` (matWithOutput fixture); `result.materializerOutputs.get('url')` содержит `{ value: 'function_url(user_service)', description: 'URL' }` (порядок declaration). (б) `dispatch(model, registry)` без options — `result.kind === 'ok'` && `result.materializerOutputs.size === 0` (US-5 backward-compat). Существующие T019/T020/T021 остаются зелёными (безусловный `dispatch(model, registry)`). RED: `dispatch` не возвращает `materializerOutputs` / нет `artifacts` option. **Ref**: FR-004/US-5, plan §Phase 2 RED.
- [x] T011 [P] [US1] RED unit-test `packages/pilot/test/cli/unit/pipeline.test.ts` EXT +2 кейса — (а) `runMaterializeGeneration(rootDir, model, registry, undefined, { artifacts })` — dispatch mock вызывается с `{ artifacts }` (второй аргумент options); `buildOutputs` mock вызывается с `materializerOutputs` (не пустой Map); (б) characterization после реализации: `runBuildAndMaterialize` строит `AppIdArtifactMap` из `buildResult.artifacts` и передаёт в `runMaterializeGeneration` (`buildResult.artifacts.map((b) => [b.appId, b.artifact])`). RED: `runMaterializeGeneration` не принимает artifacts / `runBuildAndMaterialize` не передаёт artifacts. **Ref**: FR-005, plan §Phase 2 RED.
- [x] T012 [P] [US1] EXT `packages/pilot/test/helpers/materialize-fixtures.ts` — добавить в `MaterializerSpy` поле `readonly materializeArtifacts: ArtifactDescriptor[]` (architecture: spy фиксирует descriptor на который materializer был вызван); добавить в `makeMaterializer` опцию `readonly requiresValue?: boolean` (materializer throws if `artifact.value === undefined`); в `makeMaterializer` callback spy-секция `materializerCalls.push(context)` ALSO push `materializeArtifacts.push(artifact)` в spy; spy обновлён: `{ supportsCalls, materializeCalls, materializeArtifacts, count }`. **Ref**: plan §Phase 2, helpers ext.

### Implementation for Value Threading (GREEN)

- [x] T013 [US1] Modify `packages/pilot/src/materialize/select.ts:65-69` — `buildArtifactDescriptors(model, artifacts?: AppIdArtifactMap)` — (a) signature: `model: ProjectModel, artifacts?: AppIdArtifactMap`; (b) body: `const artifact = artifacts?.get(id); return { id, name: id, type: app?.builder ?? 'unknown', ...(artifact !== undefined ? { value: artifact.value } : {}) } as ArtifactDescriptor` (exactOptionalPropertyTypes-safe conditional spread); (c) строка :80 `selectArtifacts` обновить сигнатуру `model, registry, artifacts?: AppIdArtifactMap` и передать в `buildArtifactDescriptors(model, artifacts)` (:82). **Depends**: T003, T008.
- [x] T014 [US1] Modify `packages/pilot/src/materialize/materialize.ts:36-73` — (a) `materializeAll(model, registry, matches, outputBuilder, artifacts?: AppIdArtifactMap)` — добавить параметр; (b) descriptor на :53 построить через `buildArtifactDescriptors(model, artifacts)` (Map id → descriptor: `new Map(deterministicOrder(model).map(id => [id, desc])).get(appId)`) — или просто повторить `buildArtifactDescriptors(model, artifacts)` once и map; проще: `const descriptors = new Map(buildArtifactDescriptors(model, artifacts).map(d => [d.id, d])); const artifact = descriptors.get(appId); const descriptor = artifact ?? { id: appId, name: appId, type }` — один descriptors map для цикла; (c) `:57` materialize вызывается с descriptor (уже содержит value если есть). Ошибка на :59-68 не меняется (MTL_MATERIALIZE_FAILED уже с errorMessage). **Depends**: T003, T009.
- [x] T015 [US1] Modify `packages/pilot/src/materialize/dispatch.ts:24-74` — (a) signature: `dispatch(projectModel, registry, options?: DispatchOptions)` (существующий `_options?` → `options?`); (b) `:30` `selectArtifacts(projectModel, registry, options?.artifacts)`; (c) `:37` `materializeAll(projectModel, registry, selection.matches, outputBuilder, options?.artifacts)`; (d) `:74` ok-ветка: `{ kind: 'ok', resources, generatedFiles, materializerOutputs: outputBuilder.declared }`. **Depends**: T003, T010.
- [x] T016 [US1] Modify `packages/pilot/src/cli/pipeline.ts:35-45,100-102,135-164` — (a) `:35-45` `runMaterializeGeneration` signature: `(..., artifacts?: import('../contracts/index.js').AppIdArtifactMap)`; (b) `:45` `dispatch(projectModel, registry, { artifacts })` вместо `dispatch(projectModel, registry)`; (c) `:100-102` `buildOutputs({ outputsYaml: outputsResult.data, materializerOutputs: dispatchResult.materializerOutputs, resources })` вместо `new Map()`; (d) `:135-164` `runBuildAndMaterialize`: после `:159` добавить `const appArtifacts = new Map(buildResult.artifacts.map((b) => [b.appId, b.artifact]));` и передать в `runMaterializeGeneration(..., genOpts, appArtifacts)` (`:164`). **Depends**: T003, T011.
- [x] T017 [US1] Modify `packages/pilot/src/materialize/dispatch.ts:24` — убрать `_options?` комментарий если есть; `_options` переименовать в `options`. Обновить JSDoc с `@param options` — artifacts optional. **Depends**: T015.

**Checkpoint**: `pnpm --filter @ycforge/pilot test -- --run test/unit/select.spec.ts test/unit/materialize.spec.ts test/unit/dispatch.spec.ts test/cli/unit/pipeline.test.ts` — все зелёные. `typecheck` zero errors.

---

## Phase 3: D-3 — Auto-outputs (FR-008, FR-006, US-3, SC-002)

**Purpose**: Требование префикса `ycsf_` у auto-outputs снято (D-3): auto-output валиден если проходит `NAME_RE = /^[a-z][a-z0-9_]*$/` + уникальность в merged-файле. `OUT_INVALID_AUTO_PREFIX` frozen. Изменения в существующих тестах (Sc4/T020/T028 flip + новые кейсы).

### Tests for D-3 Auto-Outputs (RED — write FIRST)

- [x] T018 [M] [P] [US3] Modify RED test `packages/pilot/test/outputs/quickstart.spec.ts:142-154` (Sc4) — flip: `function_user_service_id` (без `ycsf_`) теперь ВАЛИДЕН → изменить ожидание `result.kind` с `'invalid'` на `'ok'`; проверить `Object.keys(output)` включает `'function_user_service_id'`; `output['function_user_service_id']?.value === '${yandex_function.user_service.id}'`. **Ref**: FR-008, D-3, plan §Modified Tests. **Depends**: T005.
- [x] T019 [M] [P] [US3] Modify RED test `packages/pilot/test/unit/outputs-build.spec.ts:101-114` (T020) — flip: автоматическое имя `function_user_service_id` теперь ВАЛИДНО → `result.kind` = `'ok'`, `Object.keys(output)` содержит `'function_user_service_id'`. **Ref**: FR-008, D-3, plan §Modified Tests. **Depends**: T005.
- [x] T020 [M] [P] [US3] Modify RED test `packages/pilot/test/unit/outputs-build.spec.ts:241-257` (T028, строка 257) — коды `[OUT_INVALID_VALUE]` вместо `[OUT_INVALID_VALUE, OUT_INVALID_AUTO_PREFIX]` (`function_user_service_id` теперь валиден; единственный код — невалидный grammar `bad_grammar`). **Ref**: FR-008, D-3, plan §Modified Tests. **Depends**: T005.
- [x] T021 [P] [US3] RED new unit-test `packages/pilot/test/unit/outputs-build.spec.ts` EXT +3 кейса — (а) `User_Service_Function_Id` (UpperCase) → `OUT_INVALID` (NAME_RE не проходит); (б) авто-имя, конфликтующее с user output (одно и то же имя в outputsYaml и materializerOutputs) → `OUT_DUPLICATE_NAME` (user wins не происходит — честная ошибка, edge §8); (в) frozen-guard: `OUT_INVALID_AUTO_PREFIX` по-прежнему экспортируется и импортируется (константа существует + frozen). **Ref**: FR-008/FR-013/FR-016, SC-007, plan §Phase 3 RED.

### Implementation for D-3 Auto-Outputs (GREEN)

- [x] T022 [US3] Modify `packages/pilot/src/outputs/build.ts:80-86` — (a) удалить проверку `if (!name.startsWith(RESERVED_AUTO_PREFIX))` (`:81-86`) из цикла auto-outputs; (b) добавить вместо неё `if (!NAME_RE.test(name))` → `OUT_INVALID` (grammatical validation, NAME_RE определён на `:31`); (c) сохранить `OUT_DUPLICATE_NAME` проверку (`:87-90`); (d) удалить импорт `OUT_INVALID_AUTO_PREFIX` из `:15` (константа остаётся в contracts, импорт в модуле `build.ts` больше не нужен). RESERVER_AUTO_PREFIX и `OUT_RESERVED_PREFIX` для user output'ов — без изменений (`:50-55`). **Depends**: T003, T005, T018, T019, T020, T021.

**Checkpoint**: `pnpm --filter @ycforge/pilot test -- --run test/outputs/quickstart.spec.ts test/unit/outputs-build.spec.ts` — все зелёные. Sc4/T020/T028 flips PASS.

---

## Phase 4: BIG-2 — Artifact-типы в builders.yaml (FR-009..FR-011, US-2, SC-004)

**Purpose**: Ключи builders.yaml принимают форму `[a-z][a-z0-9-]*:[a-z][a-z0-9-]*` (concordant `ARTIFACT_TYPE_PATTERN`) кроме legacy `[\w-]+`. `BRG_KEY_COLLISION` сохраняется.

### Tests for Artifact-Type Keys (RED — write FIRST)

- [x] T023 [P] [US2] RED unit-test `packages/pilot/test/unit/builders-yaml.spec.ts` EXT +4 кейса — (а) `ycforge:function` в builders + `yandex-function` в materializers → `kind: 'ok'`, домен сохраняется как есть (без трансформаций, D-5); (б) legacy `nestjs_function` продолжает приниматься (SC-004, 0 регрессий) — существующие T010/T019-T021 остаются зелёными; (в) `YC:Function` → `BRG_INVALID` (uppercase в namespace/kind, edge §8); (г) `ycforge :function` (пробел перед колонкой) → `BRG_INVALID`. **Ref**: FR-009/FR-010, plan §Phase 4 RED.
- [x] T024 [P] [US2] RED unit-test `packages/pilot/test/unit/validate-builders.spec.ts` EXT +1 кейс — `builder: ycforge:function` в apps.yaml + registry содержит `ycforge:function` → `validateBuilders` возвращает `ok` (не `BRG_UNKNOWN_BUILDER`). Существующий T031 (BRG_UNKNOWN_BUILDER для отсутствующего ключа) продолжает зелёным. **Ref**: FR-011, plan §Phase 4 RED.
- [x] T025 [P] [US2] RED unit-test `packages/pilot/test/unit/load-registry.spec.ts` EXT +1 кейс — builders.yaml с `ycforge: [./path]` (legacy bare-token без колонки) → registry store содержит ключ `ycforge` (bare token = legacy, осознанная трактовка FR-009: `:` не в строке → legacy). **Ref**: FR-009, plan §Phase 4 RED.

### Implementation for Artifact-Type Keys (GREEN)

- [x] T026 [US2] Modify `packages/pilot/src/registry/builders-yaml.ts:15,84-98` — (a) добавить `import { isArtifactType } from '../contracts/index.js';`; (b) `:15` добавить `const LEGACY_KEY_RE = /^[\w-]+$/;` (переименовать текущий `KEY_RE`, без изменений regex); (c) добавить функцию `function isValidBuildersKey(key: string): boolean { return (!key.includes(':') && LEGACY_KEY_RE.test(key)) || isArtifactType(key); }`; (d) `:85` и `:98` заменить `KEY_RE.test(key)` на `isValidBuildersKey(key)`; (e) обновить message: `invalid key '${key}' in builders (must match [\\w-]+ or artifact type <scope>:<kind>)`. Коллизия `BRG_KEY_COLLISION` и `BRG_DUPLICATE_KEY` — без изменений. **Depends**: T006, T023, T024, T025.

**Checkpoint**: `pnpm --filter @ycforge/pilot test -- --run test/unit/builders-yaml.spec.ts test/unit/validate-builders.spec.ts test/unit/load-registry.spec.ts` — все зелёные.

---

## Phase 5: BIG-6 — Suspicious-keys в `ycsf check` (FR-012..FR-016, US-4, SC-005)

**Purpose**: Новая категория `scanSuspiciousKeys` сканирует имена ключей в raw-YAML (value-free), collect-all `YCK_SUSPICIOUS_KEY` с `key`/`reason`, exit 1. Детерминированный denylist EXACT/SUFFIX (D-4).

### Tests for Suspicious-Keys (RED — write FIRST)

- [x] T027 [P] [US4] RED new unit-test `packages/pilot/test/check/suspicious-keys.spec.ts` — in-memory/temp файлы: таблица EXACT-positive (`api_key` → normalised `apikey` ∈ EXACT, `db_password` → `dbpassword`, `access_token` → `accesstoken`, `DB_TOKEN` → `dbtoken`, `client_secret`, `authorization`); EXACT/SUFFIX-negative (`token_endpoint` — suffix `token` обязан быть концом, имя длиннее суффикса → НЕ подсвечивается, D-4); boundary (`secret` exact без суффикса-квака); non-string ключи (числовой ключ) → игнор; walk по вложенности + индекс массива (путь `extensions.0.patch.API_KEY` через dot/индексы); collect-all ≥2 за один запуск; отсутствующие файлы → тишина (0 диагностик); синтаксически-битый YAML → пропуск (не дублировать валидаторов); value-free (значение не читается и не рендерится в message — message содержит только ключ и путь). RED: `scanSuspiciousKeys` функция не существует. **Ref**: FR-012..FR-015, D-4, SC-005, plan §Phase 5 RED.
- [x] T028 [P] [US4] RED integration-test `packages/pilot/test/check/aggregation.integration.spec.ts` EXT +2 кейса — (а) canonical fixture → по-прежнему `diagnostics.length === 0` (SC-006 регрессия — canonical не содержит секрето-подобных ключей); (б) NEW fixture `test/check/fixtures/suspicious-keys/` (каноническая структура + `api_key` в `.ycsf/apps.yaml` + `DB_TOKEN` в `<app>/build_config.yaml`) → содержит `YCK_SUSPICIOUS_KEY` с ожидаемыми `file`/`field`/`key` (оба файла). **Ref**: SC-005/SC-006, plan §Phase 5 RED.
- [x] T029 [P] Create fixture `packages/pilot/test/check/fixtures/suspicious-keys/` — (a) `.ycsf/apps.yaml` с `api_key: [secret-value]` в одном из приложений; (b) `<appId>/build_config.yaml` с `DB_TOKEN: [tok]`; (c) скопировать canonical `.ycsf/builders.yaml` и `.ycsf/extensions.yaml` (или minimal по образцу canonical). **Ref**: plan §Phase 5.

### Implementation for Suspicious-Keys (GREEN)

- [x] T030 [US4] Create `packages/pilot/src/check/categories/suspicious-keys.ts` — `scanSuspiciousKeys(rootDir: string, model: { apps: Map<string, unknown> }): readonly YckDiagnostic[]` — (a) EXACT = `new Set(['token', 'password', 'passwd', 'secret', 'apikey', 'accesskey', 'secretkey', 'clientsecret', 'privatekey', 'authorization', 'credential', 'sessionid']) as ReadonlySet<string>`; SUFFIX = `new Set(['token', 'password', 'passwd', 'secret', 'apikey', 'accesskey', 'secretkey', 'clientsecret', 'privatekey']) as ReadonlySet<string>` (D-4, frozen `as const`); (b) `normalizeKey(k: string): string` = `k.toLowerCase().replace(/[^a-z0-9]/g, '')`; (c) `isSuspicious(normalized: string): { suspicious: boolean; reason?: string }` = `if (EXACT.has(normalized)) return { suspicious: true, reason: 'exact-match:' + normalized }; for (const suffix of SUFFIX) if (normalized.length > suffix.length && normalized.endsWith(suffix)) return { suspicious: true, reason: 'suffix-match:' + suffix }; return { suspicious: false }`; (d) `scanObject(value, path, file, diagnostics)` — recursive walk (по образцу `env-in-patch.ts:19-44`), нестроковые ключи игнор; путь через dot/индексы: `path.join('.')`; файлы: `.ycsf/apps.yaml`, `.ycsf/builders.yaml`, `.ycsf/outputs.yaml`, `.ycsf/extensions.yaml`, `.ycsf/moved.yaml`, `.ycsf/resources.yaml` + `model.apps.keys()` → `<appId>/build_config.yaml`; каждый файл читается ровно 1 раз (шаред read, try/catch → skip); `reason` = exact-match/suffix-match (машиночитаемый, D-4). **Depends**: T004, T007.
- [x] T031 [US4] Modify `packages/pilot/src/check/check.ts:107-114` — добавить вызов `scanSuspiciousKeys` после шага 8 (C10 moves) и до C13 terraform-validate: `diagnostics.push(...scanSuspiciousKeys(rootDir, model))` (новый импорт `scanSuspiciousKeys` из `'./categories/suspicious-keys.js'`). `model` доступен (загружен на `:33`). `A-5` соблюден: auto-outputs в check не пересчитываются — `buildOutputs` (`:87-89`) по-прежнему получает `new Map()`. **Depends**: T030.

**Checkpoint**: `pnpm --filter @ycforge/pilot test -- --run test/check/suspicious-keys.spec.ts test/check/aggregation.integration.spec.ts` — все зелёные. Fixture `suspicious-keys` содержит `YCK_SUSPICIOUS_KEY` diagnostics.

---

## Phase 6: E2E — Приёмка на реальных cores + существующие тесты (SC-001..SC-007, US-1)

**Purpose**: E2E интеграционный тест на реальных builders-core + materializers-core; characterization существующих тестов; regression suite.

### Tests for E2E (RED — write FIRST)

- [x] T032 [P] [US1] RED e2e-test `packages/pilot/test/materialize/e2e-real-cores.spec.ts` — реальные `@ycforge/builders-core/nestjs-function` + `@ycforge/materializers-core/yandex-function` (subpath default-export'ы, devDependencies). (а) build реального архива в temp (path relative-to-cwd — как materializers-core собственные фикстуры `makeZipUnder`): `dispatch(model, registry, { artifacts: new Map([['user_service', { type: 'ycforge:function', value: { archivePath: './dist/user_service.zip', entryPoint: 'handler' } }]]) })` → `ok`; ресурс `yandex_function`; `ok.materializerOutputs` содержит объявленный materializer'ом output. (б) УПИНУТЬ NG-3: absolute archivePath (`/tmp/dist/user_service.zip`) → `MTL_MATERIALIZE_FAILED` с message `YMT_INVALID_ARTIFACT_VALUE` (документ. ошибка B-слоя, не TypeError) — перевернуть после B-фикса. (в) Дескриптор value для каждой из 4 реальных форм (dispatch с `{ artifacts }` по фикстурам shapes, shape-ключи сверяются с контрактами materializers-core на этапе implement): `ycforge:function` → `value.archivePath`/`entryPoint`, `ycforge:docker-image` → image-адрес, `ycforge:frontend` → bucket/static, `ycforge:api-gateway` → `value.specPath`; для каждой — `dispatch` ok (или документированный `MTL_MATERIALIZE_FAILED` для api-gateway companion-file NG-3) и descriptor гарантированно донёс `value` до `supports`. Cwd/infra: `process.chdir(tempInfraDir)` до dispatch (materializers резолвят relative paths от cwd) и восстановление cwd в finally; тест держит всё в памяти/temp — значения НЕ ходят в сеть/облако. **Ref**: US-1/SC-001/SC-002, FR-003, plan §Phase 6 RED, Deviations п.2.
- [x] T033 [P] [US1] RED verify-only test `packages/pilot/test/build/materialize-equivalence.spec.ts` EXT — существующий canonical-equivalence test остаётся зелёным после D-3 реформы (auto-outputs теперь проходят). Если нарушается — обновить сценарии фикстур, НЕ ослаблять. **Ref**: plan §Phase 6, SC-001.
- [x] T034 [P] Verify existing type-test `packages/pilot/test/types/materialize.test-d.ts:26-54` + `packages/pilot/test/types/fr-014-dispatch.test-d.ts` — существующие T026 утверждения (id/name/type) и fr-014 (DispatchResult shape) остаются зелёными (дополнительные поля `value?`, `materializerOutputs` не ломают `toMatchTypeOf`; fr-014 не зависит от shape ok-ветки). **Ref**: SC-007, plan §Additive-proofs.

### Implementation for E2E (GREEN)

- [x] T035 Запуск full test suite — `pnpm exec vitest run` в `packages/pilot` (pretest собирает builders-core + materializers-core + pilot) — zero NEW failures. Все RED-тесты T001-T034 проходят GREEN. Существующие тесты (dispatch T019-T021, select T015-T018, materialize T022, outputs quickstart, outputs-build T021/T023-T027, build/materialize-equivalence, cli/integration, check/*.integration, registry quickstart, types/*) — все зелёные без правок. **Ref**: SC-006, plan §Modified Tests "Существующие тесты остающиеся зелёными". **Depends**: T013, T014, T015, T016, T022, T026, T031, T032, T033, T034.

**Checkpoint**: `pnpm exec vitest run` в packages/pilot — ALL GREEN, 0 NEW FAILURES.

---

## Phase 7: Verification & Convergence (SC-001..SC-007, all FR)

**Purpose**: typecheck, lint, tsup build, full regression, convergence placeholder для `/speckit.converge`.

- [x] T036 Typecheck clean — `pnpm --filter @ycforge/pilot typecheck` → zero errors (`tsc --noEmit`, strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes). Все новые типы (AppIdArtifactMap, ArtifactDescriptor.value?, DispatchResult.ok.materializerOutputs, YckDiagnostic.key/reason, YCK_SUSPICIOUS_KEY) компилируются. **Depends**: T035.
- [x] T037 Lint clean — `pnpm exec eslint packages/pilot/src check/categories/suspicious-keys.ts packages/pilot/src/check/check.ts packages/pilot/src/outputs/build.ts packages/pilot/src/registry/builders-yaml.ts packages/pilot/src/materialize/dispatch.ts packages/pilot/src/materialize/select.ts packages/pilot/src/materialize/materialize.ts packages/pilot/src/cli/pipeline.ts packages/pilot/src/contracts/materialize.ts packages/pilot/src/contracts/check.ts packages/pilot/src/contracts/outputs.ts` — zero scoped errors. **Depends**: T036.
- [x] T038 Full build + zero-regression — (a) `pnpm --filter @ycforge/pilot build` (tsup) → `dist/contracts/index.{js,cjs,d.ts}` + `dist/index.{js,cjs,d.ts}` present, `AppIdArtifactMap` / `YCK_SUSPICIOUS_KEY` в dist d.ts; (b) `pnpm exec vitest run` (full suite) → ALL GREEN. **Depends**: T037.

---

## Phase 8: Convergence

**Purpose**: Placeholder для `/speckit.converge` — read-only audit.

- [x] T039 Convergence — read-only audit `/speckit.converge` выполнен: полный набор `pnpm exec vitest run` в packages/pilot — **121 файлов / 607 тестов PASS**, vitest typecheck «Type Errors no errors»; `pnpm exec tsc --noEmit` — 0 ошибок (exit 0); `pnpm exec tsup` — build success, `dist/contracts/index.{js,d.ts}`/`dist/index.{js,cjs,d.ts}` присутствуют, `AppIdArtifactMap` и `YCK_SUSPICIOUS_KEY` в dist d.ts; eslint по `packages/pilot/src packages/pilot/test` — findings ТОЛЬКО в известных legacy-файлах вне границ 025 (cache/*, moves/quickstart, registry/quickstart, types/project-model.test-d.ts, types/registry.test-d.ts, unit/build-moves.spec.ts, unit/moves-loader.spec.ts), в 025-touched файлах — 0 ошибок; граница `git diff dev...HEAD` — только `packages/pilot/**`, `specs/025-pilot-e2e-enablement/**`, `specs/README.md` (composer/builders-core/materializers-core/nest-bridge/js-dev-tools/examples — не тронуты); `git status` чистый, последний коммит на месте; контракты строго аддитивны (`ArtifactDescriptor.value?`, `DispatchOptions.artifacts?`, `DispatchResult.ok.materializerOutputs`, `YCK_SUSPICIOUS_KEY`, `YckDiagnostic.key?/reason?`); `OUT_INVALID_AUTO_PREFIX` сохранён frozen+superseded — удалённых кодов/типов 0; traceability: каждый FR-001..FR-016 и US-1..US-5 → ≥1 задача T001–T038 [x]; Constitution I (только C), II (test-first; thin orchestration pipeline — characterization exception), III (аддитивность), V (fail-fast; suspicious-keys value-free) — соблюдены. Legitimate deviations задокументированы: (1) D-3 strict relaxation spec 016 — flips точно там, где в плане (quickstart Sc4, outputs-build T020/T028); (2) C-layer адаптация по реальным materializers-core (T032): multi-resource flatten + per-app merge (`serializeResources`/`serializeAppFile` в serialize.ts) и surfacing кода ошибки (`YMT_INVALID_ARTIFACT_VALUE`) в `MTL_MATERIALIZE_FAILED` — аддитивные экспорты, план фазы 6 GREEN расширен по результатам e2e; (3) NG-3 pin (T032(b)): absolute archivePath → документированная ошибка вместо TypeError, переворот после B-фикса. Verdict: **CONVERGED** — спека, план и код согласованы в полном объёме скоупа 025. **Ref**: SC-001..SC-007, FR-001..016, plan §Phase 6 GREEN/Additive-proofs, constitution II. **Depends**: T038.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Contract Additivity)**: No deps — BLOCKS phases 2–6. T001/T002 [P] (type-test RED) → T003-T007 [P] (GREEN).
- **Phase 2 (BIG-1 Values)**: Depends on Phase 1 (contracts exist). T008-T012 [P] (unit-test RED + helpers) → T013-T017 (GREEN). Independent of Phase 3/4/5 (different files).
- **Phase 3 (D-3 Auto-Outputs)**: Depends on Phase 1 (contracts exist). T018-T021 [P] (test flips RED) → T022 (GREEN). Independent of Phase 2/4/5.
- **Phase 4 (BIG-2 Builders Registry)**: Depends on Phase 1 (AppIdArtifactMap export). T023-T025 [P] (RED) → T026 (GREEN). Independent of Phase 2/3/5.
- **Phase 5 (BIG-6 Suspicious-Keys)**: Depends on Phase 1 (YCK_SUSPICIOUS_KEY, YckDiagnostic.key/reason). T027-T029 [P] (RED + fixture) → T030-T031 (GREEN). Independent of Phase 2/3/4.
- **Phase 6 (E2E/Acceptance)**: Depends on Phase 2 + Phase 3 + Phase 4 + Phase 5 complete. T032-T034 [P] → T035 (full suite GREEN).
- **Phase 7 (Verification)**: Depends on Phase 6. T036 → T037 → T038.
- **Phase 8 (Convergence)**: Depends on Phase 7. T039 placeholder.

### Dependency Graph

```
Phase 1 (Contract) ─────┬────────────────────────────────────────────────┐
                         │                                                │
              ┌──────────┼───────────────────┬──────────────┬─────────────┘
              ▼          ▼                   ▼              ▼
Phase 2 (Values)  Phase 3 (D-3)  Phase 4 (Registry)  Phase 5 (Suspicious)
    │                  │                │                   │
    └──────────┬───────┴────────┬───────┴───────────────────┘
               ▼                ▼
          Phase 6 (E2E) ──► Phase 7 (Verification) ──► Phase 8 (Convergence)
```

- **Phases 2, 3, 4, 5** — параллельны (разные файлы src, общие контракты Phase 1 заморожены).
- **Phase 6** ждёт все 2–5 (интеграционный e2e + full regression).
- **Phase 8** — read-only placeholder, заполняется после actual convergence.

### Parallel Opportunities

- **Phase 1**: T001/T002 [P] (разные type-test файлы); T004/T005/T006/T007 [P] (разные src-файлы).
- **Phases 2–5**: параллельны (разные модули):
  - Phase 2: T008/T009/T010/T011/T012 [P] (разные test + helper файлы)
  - Phase 3: T018/T019/T020/T021 [P] (разные test файлы / секции)
  - Phase 4: T023/T024/T025 [P] (разные test файлы)
  - Phase 5: T027/T028/T029 [P] (разные test/fixture файлы)
- **After Phase 6**: T032/T033/T034 [P] (разные e2e/verify файлы).

### Parallel Example: After Phase 1

```bash
# Phase 1 done — parallel phases 2–5:
Task: "Phase 2: Values T008–T012 → T013–T017"
Task: "Phase 3: D-3 T018–T021 → T022"
Task: "Phase 4: Registry T023–T025 → T026"
Task: "Phase 5: Suspicious-keys T027–T029 → T030–T031"
# After all 2–5:
Task: "Phase 6: E2E T032–T034 → T035"
```

---

## Notes

- [P] tasks = different files, no dependencies — safe to parallelize.
- [USn] label maps task to specific user story for traceability (FR→AC→task).
- Each phase: tests (RED) MUST be written and FAIL before implementation (GREEN) — Constitution II.
- Thin orchestration (pipeline.ts characterization, T011/T016) — exception per Constitution: characterization-тесты постфактум (impl first, then snapshot characterization).
- Commit after each phase or logical group.
- Stop at any checkpoint to validate phase independently (`pnpm --filter @ycforge/pilot test -- --run <file>`).
- Fixture-семантики сохраняются (US-5): quickstart fixture-материализаторы (не требующие value) продолжают работать без изменений.
- `OUT_INVALID_AUTO_PREFIX` frozen (FR-008/FR-016) — не удалять; константа сохранена для обратной совместимости ссылок; код/экспорт не меняется.
- NG-3 (cwd-зависимость materializers-core): e2e-тест T032(b) упинает текущее поведение с documented error, а не TypeError; переворачивается после B-фикса.
- Suspicious-keys denylist — аддитивная константа (A-4): расширение не ломает предыдущие поведения.
- `packages/pilot` — единственный пакет. `packages/composer`, `packages/builders-core`, `packages/materializers-core` — НЕ трогаем (NG-3, NG-4).
