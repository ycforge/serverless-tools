---
description: "Task list for e2e-final-enablement — 5 фиксов: composer apps-index, standalone materialize, required YC attrs, docker dev-modes, registry resolution"
---

# Tasks: e2e-final-enablement — пять фиксов тулчейна (Fix-1..Fix-5), финальная готовность reference-проекта 024

**Input**: Design documents from `/specs/028-e2e-final-enablement/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), checklists/requirements.md (16/16 ✅)

**Tests**: Test-first per constitution (II). Каждый FR-001..FR-020 / US-1..US-6 → ≥1 тест (RED → GREEN). Тонкая CLI/daemon/tf-оркестрация — characterization-тесты через fake / gated (Constitution II exception, подход 018/025/027). Все unit-тесты hermetic (реальный docker daemon на машине автора недоступен, A-4; никаких сетей/креденшалов).

**Organization**: Задачи сгруппированы по контрактам + пяти фиксам, каждый фикс — свой пакет-слой (Constitution I). (0) Контрактная аддитивность блокирует все фиксы; (1) Fix-1 composer B + pilot C; (2) Fix-2 pilot C + guards materializers-core B-слой; (3) Fix-3 materializers-core B-слой + pilot C (context); (4) Fix-4 builders-core A-build; (5) Fix-5 pilot registry; (6) Verification по всем четырём пакетам; (7) Convergence (T150-style placeholder). Контракт-фаза блокирует 1–5; фазы фиксов идут последовательно (пересечения: Fix-2/Fix-3 правят одни и те же materializers-core index.ts — guards сначала, attrs после; Fix-1/Fix-5 делят pilot `build/index.ts`/registry — разными файлами). `@ycforge/pilot/contracts` — только additive (Constitution III, SC-006).

## Format: `[ID] [P?] [M?] [USn] Description`

- **[P]**: can run in parallel (different files, no incomplete deps)
- **[M]**: модификация существующего файла (не net-new). Без `[M]` — новое содержимое (обычно новые `it`/блоки в существующем файле — тоже аддитивно)
- **[US1]–[US6]**: user story label (только в US-фазах; Contract/Verification/Convergence — по обслуживаемой истории или без label)
- **Ref**: привязка к FR/SC/решениям плана (D-1..D-5); **Depends**: блокирующие задачи
- Семантика задач: **RED** (пишется/прогоняется ДО реализации → ожидаемый failure) | **GREEN** (реализация) | guard-GREEN (тест на уже реализованное поведение, фиксирует инвариант после GREEN) | verify-only (прогон без правок)

## Path Conventions

- **Contracts (pilot C)**: `packages/pilot/src/contracts/resource-domain.ts` (NEW), `packages/pilot/src/contracts/builder.ts` (`BuildContext` :20), `packages/pilot/src/contracts/materializer.ts` (`MaterializationContext` :34), `packages/pilot/test/types/{builders-core,materializers-core}-contract.test-d.ts`
- **Fix-1**: `packages/composer/src/resource/app-identities.ts` (NEW, `mergeResourceIndex`), `packages/composer/src/resource/index.ts`, `packages/composer/src/compile-core.ts`, `packages/composer/src/builder/index.ts` (`deriveCompileSource` :51), `packages/pilot/src/build/index.ts` (context build :274-280), `packages/pilot/src/model/resources.ts` (`checkIdentityCollision`)
- **Fix-2**: `packages/pilot/src/build/store.ts` (NEW), `packages/pilot/src/build/index.ts` (build loop), `packages/pilot/src/cli/materialize.ts:110`, `packages/pilot/src/cli/pipeline.ts:41-56` (`runMaterializeGeneration(…, artifacts?)`, 025)
- **Fix-3**: `packages/materializers-core/src/yandex-function/index.ts:30-42`, `packages/materializers-core/src/yandex-api-gateway/index.ts:13-40` (companion write :28 — `resolve(process.cwd(),'generated')`, cwd-dependency NG=026 NG-5), `packages/pilot/src/materialize/context.ts:53` (`createContext(builder)`), `packages/pilot/src/materialize/dispatch.ts` (+`DispatchOptions`), `packages/pilot/src/cli/pipeline.ts`
- **Fix-4**: `packages/builders-core/src/types.ts` (`DockerBuildConfig.image`), `src/docker/config.ts` (`parseDockerConfig` :26-51), `src/docker/cli.ts` (`buildAndPush` :56-99), `src/docker/index.ts`, `src/diagnostics.ts`, `specs/018-builders-core/contracts/builders-core.json`
- **Fix-5**: `packages/pilot/src/registry/load.ts:18-45`, `registry/index.ts` (record keys :30-47), `registry/validate.ts:14`, `registry/builders-yaml.ts` (cross-section :119-126), `registry/select.ts:122`, `build/index.ts:172,256`
- **Tests**: composer `packages/composer/test/unit/`; pilot `packages/pilot/test/{unit,registry,materialize,cli,types}/`; materializers-core `packages/materializers-core/test/unit/`; builders-core `packages/builders-core/test/{unit,types,helpers/fake-bins.ts}`

---

## Phase 1: Контрактная аддитивность (FR-001/002, FR-006/009, FR-010/011, FR-019; D-1/D-2/D-4/D-5; SC-006)

**Purpose**: Все договорные поверхности 028 — аддитивные optional-поля/новые модули `@ycforge/pilot/contracts` + структурные replica (materializers-core) + store-модуль + yaml-парсер Fix-5. Тип-гейты (test-d) и аудит-тесты легитимируют аддитивность (SC-006). Фаза BLOCKS все фиксы (кроме Fix-4-контракта, который живёт в своём пакете и уносится в фазу 5).

### RED-тесты (пишутся ДО реализации; ожидаемые failure'и — отсутствие модуля/поля)

- [ ] T001 [P] RED type-test+audit — **NEW** `packages/pilot/test/types/resource-domain.test-d.ts` + **EXT [M]** `packages/pilot/test/types/builders-core-contract.test-d.ts` + composer аудит-`it` в `packages/composer/test/unit/resource/errors.spec.ts`: (a) `ResourceDomain` = `'functions'|'queues'|'buckets'|'containers'|'gateways'`; (b) `AppIdentity { readonly appId: string; readonly artifactType: string }`; (c) frozen `ARTIFACT_TYPE_DOMAIN_MAP: Readonly<Record<string, ResourceDomain>>` — ровно 4 пары `ycforge:function|ycforge:docker-image|ycforge:frontend|ycforge:api-gateway` → `functions|containers|buckets|gateways` (FR-002), и `Object.values(ARTIFACT_TYPE_DOMAIN_MAP)` ⊆ composer `RESOURCE_DOMAINS` (resource/types.ts:1 — словарь не расходится, SC-006); (d) `artifactTypeToResourceDomain(type): ResourceDomain | undefined`; (e) `BuildContext` принимает `appIdentities?: readonly AppIdentity[]` обеими сторонами (loose `toMatchTypeOf` обе направления — D-1). RED: модуль `resource-domain.ts` отсутствует / `BuildContext` без поля / map без пары → type-error/assert FALL. **Ref**: FR-001/FR-002, SC-006, D-1, plan §Phase 1 RED. **Depends**: —
- [ ] T002 [P] [M] RED type-test **EXT [M]** `packages/pilot/test/types/materializers-core-contract.test-d.ts` — `MaterializationContext.projectRoot?: string` в pilot-контракте И структурной replica materializers-core **одновременно** (`toEqualTypeOf` обе направления — иначе RED; exactOptionalPropertyTypes-совместим, D-2). RED: `projectRoot` отсутствует в любой из сторон → FALL. **Ref**: FR-010/FR-011, SC-006, D-2, plan §Phase 1 RED. **Depends**: —
- [ ] T003 [P] RED unit **NEW** `packages/pilot/test/unit/artifacts-store.spec.ts` — store-дескриптор `{ version: 1, type, value }` round-trip (write→read, canonical `JSON.stringify`, детерминизм); version-mismatch → actionable throw; отсутствующий `.ycsf/artifacts/` dir → пустой map (НЕ ошибка загрузки); `readStoreDescriptorsFrom(dir)` для `--artifacts`-корня (та же структура `<dir>/<appId>/artifact.json`). RED: `build/store.ts` не существует → FALL. **Ref**: FR-006/FR-009, D-4/`ARTIFACT_STORE_VERSION`, SC-007, plan §Phase 1 RED. **Depends**: —
- [ ] T004 [P] [M] RED flip `packages/pilot/test/unit/builders-yaml.spec.ts:53` (T013) — cross-section `builders:{my-plugin:"pkg-a"}` + `materializers:{my-plugin:"pkg-b"}` оба present → `kind: 'ok'`, `BRG_KEY_COLLISION` НЕ эмитируется (relaxation 025 FR-010, D-8); прежний ассерт снабдить superseded-комментарием. RED: ручной cross-section-цикл всё ещё эмитирует `BRG_KEY_COLLISION` → FALL. **Ref**: FR-019, D-5/D-8, SC-005, plan §Phase 1 RED + §Modified Tests (builders-yaml.spec.ts:53). **Depends**: —

### GREEN (реализация)

- [ ] T005 [US1] **NEW** `packages/pilot/src/contracts/resource-domain.ts` — `ResourceDomain`, `AppIdentity`, frozen `ARTIFACT_TYPE_DOMAIN_MAP` (ровно 4 пары FR-002), `artifactTypeToResourceDomain(type)`; re-export из `contracts/index.ts`; **[M]** `packages/pilot/src/contracts/builder.ts:20` — `BuildContext` += `readonly appIdentities?: readonly AppIdentity[]` (optional, additive; conditional-spread exactOptionalPropertyTypes-совместимо). **Depends**: T001.
- [ ] T006 [US3] [M] `packages/pilot/src/contracts/materializer.ts` (additive) + структурная replica `packages/materializers-core/src/types.ts` — `MaterializationContext` += `readonly projectRoot?: string` (ОБЕ копии правятся в одном commit, иначе `toEqualTypeOf`-гейт RED — риск-таблица плана). **Depends**: T002.
- [ ] T007 [US2] **NEW** `packages/pilot/src/build/store.ts` — `ARTIFACT_STORE_VERSION = 1`; `writeStoreDescriptor(outputDir, artifact)` (canonical `JSON.stringify`); `readStoreDescriptors(rootDir)` (wrong version → actionable throw; отсутствующий dir → пустой map); `readStoreDescriptorsFrom(dir)`. **Depends**: T003.
- [ ] T008 [US5] [M] `packages/pilot/src/registry/builders-yaml.ts:119-126` — удалить ручной cross-section-цикл (`BRG_KEY_COLLISION`); const `BRG_KEY_COLLISION` frozen + `@deprecated`/superseded-комментарий (паттерн 025 D-3/D-8; вызов больше не производится); `uniqueKeys: true` (YAML) внутри-секций НЕ трогать (`BRG_DUPLICATE_KEY`/`BRG_INVALID` сохраняются, FR-019/020). **Depends**: T004.

**Фаза-1 Checkpoint**: `pnpm --filter @ycforge/pilot typecheck` + отдельный прогон test-d файлов T001/T002 → GREEN; composer typecheck untouched (контракт-гейты = аддитивность SC-006); RED-прогоны дали ожидаемые failure'и по всем четырём кейсам.

---

## Phase 2: Fix-1 — composer apps-index (FR-001..005, US-1, SC-001/SC-006)

**Purpose**: Ресурсный индекс композиции объединяет external-entries (`.ycsf/resources.yaml`) и app-identities C-модели (domain из artifact type через контракт-маппинг); `${resources.<domain>.<app_id>.<property>}` валиден без деклараций; auth-ссылки резолвятся (FR-005). Композиция БЕЗ перечитывания apps.yaml (D-6/026 FR-005) — вход аддитивно из `BuildContext.appIdentities?`. Пр-project: B = `packages/composer`, C-side = `packages/pilot`.

### RED-тесты (пишутся ДО реализации)

- [ ] T009 [US1] RED unit **NEW** `packages/composer/test/unit/app-identities.spec.ts` — `mergeResourceIndex(index, appIdentities)`: (a) external-entries ПЕРВЫМИ, app-identities ПОСЛЕ (фиксированный порядок входного списка — determinism FR-003); (b) свойства из `DOMAIN_PROPERTIES` домена (functions/containers/gateways → `id`, buckets → `name`, queues → `qurl`, resource/types.ts:18-24); (c) fail-fast: app_id == external resource id в том же домене → `RESOURCE_REF_IDENTITY_COLLISION` (never merge, V/VI); domain не в `RESOURCE_DOMAINS` → `RESOURCE_REF_DOMAIN_UNKNOWN` (не угадывание, FR-004); (d) auth-ref `functions.<app_id>` на app-identity в auth.yaml резолвится через merged-index (FR-005, research T002), несуществующее имя → прежний `RESOURCE_REF_NOT_DECLARED` (009/FR-004 сохранён). RED: `mergeResourceIndex` отсутствует → FALL. **Ref**: FR-001/FR-002/FR-003/FR-004/FR-005, D-1, spec §8 deep-link, plan §Phase 2 RED. **Depends**: T005.
- [ ] T010 [US1] RED integration EXT `packages/composer/test/unit/builder/*.spec.ts` (или compile.spec) — build app `openapi` на map-form fixture (4 app: `user_service`/`analytics`/`frontend`/`openapi`, artifact-type builder keys `ycforge:*`) со ссылками `${resources.functions.user_service.id}`, `${resources.buckets.frontend.name}`, `${resources.containers.analytics.id}` БЕЗ `.ycsf/resources.yaml` → 0 `RESOURCE_REF_*`; golden `specPath`-документ (каноническая форма рефов сохранена); `resourceReferences` = `[{logical:'functions.user_service',terraformType:'yandex_function'},{logical:'containers.analytics',terraformType:'yandex_serverless_container'},{logical:'buckets.frontend',terraformType:'yandex_storage_bucket'}]` (IDT-таблица 026 D-4). RED: app-identities не в индексе → `RESOURCE_REF_NOT_DECLARED` → FALL. **Ref**: FR-001/FR-005, SC-001, US-1-AC1, plan §Phase 2 RED (integration). **Depends**: T009.
- [ ] T011 [P] [US1] [M] RED flip `packages/pilot/test/unit/resources.spec.ts:83/101` — legacy-builder app (`user_service_builder`) НЕ деривирует identity → НЕ коллизия `PML_IDENTITY_COLLISION` (flip, D-8/superseded-комментарий); НОВЫЕ кейсы: artifact-type app (`ycforge:function` и др.) коллизирует с individual resource в containers/gateways/buckets доменах → `PML_IDENTITY_COLLISION` (домен из `artifactTypeToResourceDomain`, не only-functions). RED: `checkIdentityCollision` всё ещё только functions-домен → FALL. **Ref**: FR-003, D-1/D-8, plan §Modified Tests (resources.spec.ts:83/101). **Depends**: T005.

### GREEN (реализация)

- [ ] T012 [US1] **NEW** `packages/composer/src/resource/app-identities.ts` — `mergeResourceIndex(index, appIdentities)` pure-модуль + barrel-export (`resource/index.ts`); `compile-core.ts` — вызов merge сразу после `buildResourceIndex`, до вывода `functions` и `loadAuthConfig` → FR-005 (detail: run merge after both builds, resolution order B-порядок внешних сущностей с app-identity переопределением БЕЗ коллизий → V); `builder/index.ts` `deriveCompileSource` (:51) копирует `context.appIdentities` в `CompileSource` (D-6, 026 FR-005 соблюдён). **Depends**: T009, T010.
- [ ] T013 [US1] [M] pilot C-side — `build/index.ts:274-280`: вычислить `appIdentities` из `projectModel.apps.entries()` (для `a` с `artifactTypeToResourceDomain(a.builder) !== undefined` → `{appId, artifactType: a.builder}`) и включить в `context`; `model/resources.ts` `checkIdentityCollision` — домен из `artifactTypeToResourceDomain(app.builder)`, коллизия `resources.yaml[domain][app_id]` → `PML_IDENTITY_COLLISION` (apps — единственный источник identity, VI); C-build integrations pass `appIdentities` насквозь. **Depends**: T011.

**Фаза-2 Checkpoint**: composer suite + legacy CLI (array-form `ycsf-api compile`) зелёный БЕЗ правок (NG-10, FR-004 verify-only); `pnpm --filter @ycforge/composer exec vitest run` + typecheck; pilot resources.spec.ts полный (flip зелёный).

---

## Phase 3: Fix-2 — standalone `ycsf materialize` (FR-006..009, US-2, SC-002)

**Purpose**: `ycsf build` пишет per-app store-дескриптор (`<root>/.ycsf/artifacts/<appId>/artifact.json {version:1,type,value}`); standalone `ycsf materialize` читает store или `--artifacts <dir>` → byte-идентичный pipeline-output (SC-002). Guard'ы в materializers-core устраняют TypeError-destructure (FR-008). 025 US-5 legacy (materializers без value) сохраняется.

### RED-тесты (пишутся ДО реализации)

- [ ] T014 [US2] RED integration **EXT [M]** `packages/pilot/test/unit/build.spec.ts` (artifact-store asserts) — `buildApps` на реальных cores (`ycforge:*`-fixture): miss/hit/noCache → `.ycsf/artifacts/<appId>/artifact.json` существует **ровно 1 на app**, `{version:1, type, value}` (values = build-артефакты, НЕ blob-cache 022); fingerprint/cache-логика 022 не затронута (store НЕ входит в filesHash — verify-assert, FR-009). RED: build loop не пишет дескриптор → FALL. **Ref**: FR-006/FR-009, D-4, plan §Phase 3 RED. **Depends**: T007.
- [ ] T015 [US2] RED e2e byte-compare **EXT [M]** `packages/pilot/test/materialize/e2e-real-cores.spec.ts` (или NEW `store-materialize.spec.ts`) — после `buildApps` standalone `runMaterializeGeneration(rootDir, model, registry, genOpts, readStoreDescriptors(rootDir))` → **byte-идентичный** набор `infra/*.tf.json` (вкл. `99-ycsf-outputs.tf.json`) против integrated build→materialize одного прохода (SC-002, US-2-AC2); идемпотентен (повторный прогон — тот же output, FR-007); `--artifacts <dir>`-корень → тот же output (единая семантика обоих путей). RED: standalone не принимает store / descriptors без value → FALL. **Ref**: FR-006/FR-007, SC-002, US-2-AC1/AC2, plan §Phase 3 RED. **Depends**: T014.
- [ ] T016 [P] [US2] RED guards materializers-core — **EXT [M]** `packages/materializers-core/test/unit/yandex-function.spec.ts` + `yandex-api-gateway.spec.ts` (новые `it`, guard-ентификация): descriptor без `value` (функция → `input.zip`-путь, gateway → напрямую без specPath) → `YMT_INVALID_ARTIFACT_VALUE` с actionable текстом («run `ycsf build` first or pass `--artifacts <dir>`»), НЕ TypeError-destructure; ни одного тихого каскада (V). RED: `const { archivePath } = value` при `undefined` → TypeError → FALL. **Ref**: FR-008, D-4, plan §Phase 3 RED (guards). **Depends**: —
- [ ] T017 [US2] RED pilot CLI — EXT `packages/pilot/test/cli/` (materialize integration): standalone `ycsf materialize` без store на function/gateway fixture → fail-fast `MTL_MATERIALIZE_FAILED` с actionable текстом (запусти `ycsf build` / `--artifacts <dir>`), message НЕ «Cannot destructure property of 'value' as it is undefined» (research T003); fixture-materializers БЕЗ value (legacy 025 US-5) работают как раньше (descriptor без value, 0 регрессий). RED: TypeError / отсутствие actionable → FALL. **Ref**: FR-008, US-2-AC3/AC4, plan §Phase 3 RED (CLI). **Depends**: T016.

### GREEN (реализация)

- [ ] T018 [US2] [M] `packages/pilot/src/build/index.ts` — в build loop РОВНО один вызов `writeStoreDescriptor(outputDir, resolvedArtifact)` на app независимо hit/miss/noCache (после miss-GREEN `artifacts.push` и после `restoreBlob`-hit); fingerprint-логика 022 НЕ трогается (FR-009); **[M]** `packages/pilot/src/cli/materialize.ts:110-111` — commander `--artifacts <dir>`; `store = opts.artifacts ? readStoreDescriptorsFrom(opts.artifacts) : readStoreDescriptors(rootDir)`; проброс в `runMaterializeGeneration(rootDir, model, registry, genOpts, store)` (существующий optional-параметр 025, pipeline.ts:41-56); **[M]** guards в двух materializers-core — `yandex-function/index.ts:12-16` и `yandex-api-gateway/index.ts:12-18`: пред-декструкционный `if (artifact.value === undefined) throw materializerError(YMT_INVALID_ARTIFACT_VALUE, …actionable…)`. **Depends**: T015, T016, T017.

**Фаза-3 Checkpoint**: byte-identity прогон (SC-002) зелёный; CLI-кейсы FR-008 с «без TypeError» assert'ами; pilot typecheck.

---

## Phase 4: Fix-3 — materializers attrs (FR-010..013, US-3, SC-003/SC-007)

**Purpose**: `yandex_function` получает детерминированные `name`+`memory: 128` (константа), `yandex_api_gateway` — `name`; companion-api-gateway пишется в `<rootDir>/infra/generated/` через `MaterializationContext.projectRoot?` (текущая запись `resolve(process.cwd(),'generated')` = cwd-зависимость NG, индекс :28; устранение NG-3/026 NG-5). Авто-outputs 025 (FR-012) структурно не затронуты; goldens обновляются ровно в точке эмиссии Fix-3.

### RED-тесты (пишутся ДО реализации)

- [ ] T019 [P] [US3] [M] RED `packages/materializers-core/test/unit/yandex-function.spec.ts:38` — новая ожидаемая форма `configuration`: `{ runtime, name, memory, entrypoint, user_hash, content }` (`name` = `artifact.name`, `memory: 128` const); determinism-кейс (два вызова → идентичные config, НИКАКИХ UUID/timestamps — SC-007, spec §8); авто-output `<name>_function_id` по-прежнему объявляется (FR-012, verify внутри теста). RED: эмиссия без `name`/`memory` → toEqual FALL. **Ref**: FR-010/FR-012, D-2, SC-003/SC-007, plan §Phase 4 RED + §Modified Tests (:38). **Depends**: —
- [ ] T020 [P] [US3] [M] RED `packages/materializers-core/test/unit/yandex-api-gateway.spec.ts:51/54/74/128` — (a) `configuration` = `{ name, spec }` (добавляется `name`); (b) `:54`/`:74` companion читается из `join(<root>/infra,'generated',…)` при переданном `context.projectRoot` и из legacy `resolve(process.cwd(),'generated')` при его отсутствии (fallback задокументирован; оба пути детерминированы) — сейчас тесты зависят от chdir на tmpDir (NG, фиксируется); (c) `:51` (config.spec) и `:128` (`spec attribute is file() verbatim`) — строка `file("${path.module}/generated/<name>-openapi.yaml")` НЕ меняется (terraform cwd = `infra` → `path.module` = `infra`, файл физически в `infra/generated` — адресация сходится, перенос companion в `infra/generated` сохраняет ссылку). RED: companion cwd-зависим → FALL. **Ref**: FR-011, D-2/D-7, SC-003, US-3-AC2/AC3, plan §Phase 4 RED + §Modified Tests (:51/54/74/128). **Depends**: —
- [ ] T021 [US3] [M] RED pilot **EXT [M]** `packages/pilot/test/materialize/e2e-real-cores.spec.ts:90-99` — добавочные asserts: материализованный `yandex_function` configuration содержит `name`/`memory`, `yandex_api_gateway` — `name`; авто-outputs 025 (`<name>_function_id`/`<name>_gateway_id`, :225-231) по-прежнему объявляются (FR-012 verify-only). RED: конфигурации без required attrs → FALL. **Ref**: FR-010/FR-011/FR-012, D-2, plan §Phase 4 RED + §Modified Tests (e2e-real-cores :90-99). **Depends**: —
- [ ] T022 [P] (gated) [US3] RED characterization — `terraform validate -no-color` на materialized golden-конфигах function/gateway → exit 0, **0 «Missing required argument»** (тонкая tf-оркестрация, Constitution II exception; gated на probe `terraform` в PATH — иначе skip + golden-форма как unit-эффект; на машине автора terraform присутствует). RED: заданные attrs отсутствуют → «Missing required argument _name_» → FALL. **Ref**: FR-013, SC-003, US-3-AC1, plan §Phase 4 RED (characterization, gated). **Depends**: T021.

### GREEN (реализация)

- [ ] T023 [US3] [M] `packages/materializers-core/src/yandex-function/index.ts:30-42` — config порядок `{ runtime, name, memory, entrypoint, user_hash, content }`, `name = artifact.name`, `memory = 128` (const, комментарий «provider default, deterministic»); **[M]** `yandex-api-gateway/index.ts:13-40` — value-guard на specPath + config `{ name, spec }`; companion `baseDir = context.projectRoot !== undefined ? resolve(context.projectRoot,'infra','generated') : resolve(process.cwd(),'generated')` (legacy fallback задокументирован); tf.json-ссылка `${path.module}/generated/...` не меняется; авто-outputs 025 не трогаются (FR-012). **Depends**: T019, T020.
- [ ] T024 [US3] [M] pilot `materialize/context.ts:53` — `createContext(builder, projectRoot?)` → `{ output, ...(projectRoot ? { projectRoot } : {}) }` (exactOptionalPropertyTypes-safe); `materialize/dispatch.ts` — `DispatchOptions.projectRoot?` additive, проброс из `runMaterializeGeneration(rootDir, …)` (pipeline.ts:41-56) → materializers получают `projectRoot` из C всегда передаваемого rootDir; GOLDEN-обновления — grep-обновление pilot и materializers-core golden-эталонов, содержащих `yandex_function`/`yandex_api_gateway` configuration (новая форма Fix-3, детерминированные значения); determinism fixать (SC-007: два прогона на неизменённых исходниках → byte-идентичный `infra/*.tf.json`); characterization T022 green (или gated-skip). **Depends**: T006, T021, T023, T022.

**Фаза-4 Checkpoint**: полный materializers-core suite + pilot e2e green; авто-outputs 025 без изменений (verify-only); golden-эталоны обновлены ровно в точках эмиссии Fix-3 и закоммичены.

---

## Phase 5: Fix-4 — docker dev-modes (FR-014..017, US-4, SC-004)

**Purpose**: Аддитивная поверхность `image`-блока `build_config.yaml` (C-opaque, versionless — 0 правок pilot): `mode?: 'registry-ref'|'remote'`, `image.ref` (строго `/^[^@]+@sha256:[0-9a-f]{64}$/`), `image.host` (DOCKER_HOST); новый код `BLC_DOCKER_UNREACHABLE`; 027 `no_push` совместим во всех режимах; инвариант «never a mutable tag» охраняется (018/019). Существующий `docker.spec.ts` (прежний describe :58 + 027 no-push describe :256) — без единой правки, только ADD-дескрибы (SC-005).

### RED-тесты (пишутся ДО реализации; инфраструктура fake сначала)

- [ ] T025 [P] [M] [US4] RED type-test **EXT [M]** `packages/builders-core/test/types/builders-core.test-d.ts` (+1 describe «docker dev-modes (spec 028)») — `DockerBuildConfig.image` принимает `mode?: 'registry-ref'|'remote'`, `ref?: string`, `host?: string` все optional (exactOptionalPropertyTypes-совместимо); негатив: литералы вне объединения (`'build'`, `'registry-ref'|'remote'|'default'`) НЕ присваиваемы (строгое enum, V); frozen `DockerArtifactValue` = `{ readonly image: string }` БЕЗ изменений (SC-007/NG-7). RED: mode/ref/host отсутствуют → FALL. **Ref**: FR-014/FR-015, D-3, SC-006, plan §Phase 5 RED (+1 test-d). **Depends**: —
- [ ] T026 [P] [M] [US4] RED audit-it **EXT [M]** `packages/builders-core/test/unit/diagnostics.test.ts` — чтение `specs/018-builders-core/contracts/builders-core.json` (тот же `CONTRACT_PATH`): (a) `image.properties` += `mode`/`ref`/`host` (обязательно — `image.additionalProperties === false`), существующие `repository`/`tag`/`no_push` НЕизменны (deep-equal snapshot); (b) `errorCodes.properties` += `BLC_DOCKER_UNREACHABLE`; (c) набор ключей `errorCodes.properties` равен экспортированному набору const (+1 только). RED: JSON без полей → FALL. **Ref**: FR-014/FR-017, D-3, SC-007, plan §Phase 5 RED (audit). **Depends**: —
- [ ] T027 [P] [US4] [M] fake-bins infra **EXT [M]** `packages/builders-core/test/helpers/fake-bins.ts` — envLog-захват `DOCKER_HOST` для remote-режима (dispatch по новой env-опции fake) + argv-журнал (registry-ref → 0 вызовов, remote → присутствует). **Ref**: D-3, plan §Phase 5 RED (infra, hermetic). **Depends**: —
- [ ] T028 [US4] RED **EXT [M]** `packages/builders-core/test/unit/docker.spec.ts` (new describe «docker dev-modes (spec 028): registry-ref») — valid `image.ref` `/^[^@]+@sha256:[0-9a-f]{64}$/` → artifact `{ type:'ycforge:docker-image', value:{ image: ref } }` verbatim; **argv-журнал fake-docker пуст** (0 subprocess docker — daemon не требуется, креды не читаются, FR-015/US-4-AC1); mutable-tag ref (`repo:latest@sha256:…` / `repo:latest`) → `BLC_INVALID_CONFIG` поле `image.ref` (инвариант «never a mutable tag», edge §8); mutual exclusion `repository`/`tag`/`dockerfile` вместе с registry-ref → `BLC_INVALID_CONFIG` (D-3); `no_push: true` + registry-ref — valid no-op (027-compat, edge §8). RED: registry-ref-ветки в cli нет → docker-вызовы/неверная форма → FALL. **Ref**: FR-014/FR-015, D-3, US-4-AC1/AC4, plan §Phase 5 RED. **Depends**: T027.
- [ ] T029 [P] [US4] RED **EXT [M]** `docker.spec.ts` (describe «…: remote + default-unreachable») — remote: `image.host` обязателен (иначе `BLC_INVALID_CONFIG`); build (+ при `no_push: false` push) argv И env-журнал содержит `DOCKER_HOST=<host>` (remote-host passthrough, D-3); digest из `docker image inspect '{{.Id}}'` с тем же `DOCKER_HOST` (content-digest удалённого daemon, FR-016); connect/auth-fail stderr-маркер → `BLC_DOCKER_UNREACHABLE` + host в message (remote-scope, НЕ путать с локальным, edge §8); `no_push` + remote = only-build на удалённом daemon; default-unreachable: daemon-down stderr-маркеры (`Cannot connect to the Docker daemon at …`, `error during connect`, `failed to connect to the docker API`) → `BLC_DOCKER_UNREACHABLE`, message со stairway (запуск daemon / `image.mode: registry-ref` / `image.mode: remote`); прочий CLI/build-fail → прежний `BLC_BUILD_FAILED`+tail; ни partial-артефакта, ни тихого пропуска (V); 027-compat таблица форм `value.image` во всех режимах без mutable-tag. RED: remote/env/nunreachable-веток нет → FALL. **Ref**: FR-016/FR-017, D-3, US-4-AC2/AC3, SC-004, plan §Phase 5 RED. **Depends**: T027.

### GREEN (реализация)

- [ ] T030 [US4] [M] `packages/builders-core/src/types.ts` — `DockerBuildConfig.image` += `mode?/ref?/host?`; `src/diagnostics.ts` += `BLC_DOCKER_UNREACHABLE` (new const, keys-множество += 1); `specs/018-builders-core/contracts/builders-core.json` — `image.properties.{mode,ref,host}` + `errorCodes.BLC_DOCKER_UNREACHABLE` (additive, frozen keys не трогаются). **Depends**: T025, T026.
- [ ] T031 [US4] [M] `packages/builders-core/src/docker/config.ts` — `ParsedDockerConfig` += mode/ref/host + матрица валидации D-3 (mode enum строго; registry-ref: ref required+regex + mutual exclusion с repository/tag/dockerfile; remote: host required); `docker/cli.ts` — registry-ref early-return (ни одного docker), remote `DOCKER_HOST=<host>` в env подпроцесса + inspect `{{.Id}}` с тем же host, default-unreachable classifier (stderr-маркеры → `BLC_DOCKER_UNREACHABLE`, иначе build-fail → `BLC_BUILD_FAILED`+tail); push-ветка (без no_push) бит-в-бит (SC-005, 027-совместимость); `docker/index.ts` — проброс mode/ref/host. **Depends**: T028, T029, T030.

**Фаза-5 Checkpoint**: полный `docker.spec.ts` — существующие `it` (описы дескриба :58 прежнего + :256 027 no-push) зелёные БЕЗ единой правки (SC-005, diff только ADD); audit-тест JSON (+1 const); hermetic (A-4).

---

## Phase 6: Fix-5 — pilot registry (FR-018..020, US-5, SC-005)

**Purpose**: Резолюция bare-specifier'ов из consumer-graph проекта (`createRequire(join(rootDirAbs,'package.json')).resolve` + `import(pathToFileURL(resolved).href)`, subpath exports + pnpm-aware); относительные/абсолютные пути резолвятся как сегодня (module-relative, legacy). Секции `builders`/`materializers` — раздельные key namespaces: records-ключ `&#96;${entry.kind}:${entry.id}&#96;` (id raw), cross-section дубликат валиден (FR-019), `BRG_KEY_COLLISION` frozen+superseded (T008).

### RED-тесты (пишутся ДО реализации)

- [ ] T032 [P] [US5] RED **EXT [M]** `packages/pilot/test/registry/quickstart.spec.ts` (+ NEW fixture dir `consumer-project/`) — consumer-graph fixture (tmp: `package.json` deps `{ "@ycforge/builders-core": "*" }`, `node_modules/@ycforge/builders-core` → symlink на собранный `packages/builders-core`; hermetic, без сети) с `builders.yaml`: `builders:{ycforge:docker-image:"@ycforge/builders-core/docker"}` + `materializers:{ycforge:docker-image:"@ycforge/materializers-core/yandex-serverless-container"}` → `loadRegistry(rootDir)` → **0 `BRG_PACKAGE_NOT_FOUND` / 0 `BRG_KEY_COLLISION`**, обе записи присутствуют (keys `builder:ycforge:docker-image` / `materializer:ycforge:docker-image`, id raw); Sc3 flip (cross-section collision больше не ошибка, :77 — ссылается на relax-раздел T004); qualified-lookup asserts `records.has('builder:ycforge:docker-image')` / `records.get('materializer:…')` + `build/index.ts:256`/`:172`-lookups через private API fixture (или assert E2E-клика в materialize) (validate.ts:14); nonexistent bare → actionable `BRG_PACKAGE_NOT_FOUND` («not reachable from the project node_modules — declare as a dependency of the consumer project»); внутри-секционный дубликат → `BRG_DUPLICATE_KEY` (нетто, FR-019); existing relative-path packageName-записи legacy-фикстур — зелёные БЕЗ правок (FR-020). RED: load.ts резолвит из dist-pilot → `BRG_PACKAGE_NOT_FOUND` → FALL. **Ref**: FR-018/FR-019/FR-020, D-5, SC-005, plan §Phase 6 RED. **Depends**: —
- [ ] T033 [US5] RED unit **EXT [M]** `packages/pilot/test/unit/load-plugins.spec.ts` (или load-registry.spec) — bare-specifier dispatch: `createRequire(join(rootDir,'package.json')).resolve(packageName)` (subpath exports, pnpm `.pnpm`-структура) → `import(pathToFileURL(resolved).href)`; relative/absolute → прежний `import` (module-relative, legacy convenience); unresolved bare → «not reachable…» + `BRG_PACKAGE_NOT_FOUND`; import-ошибки → `BRG_LOAD_ERROR` (как сегодня, :37-45). RED: `loadPlugins` не принимает resolveFrom / резолвит из dist → FALL. **Ref**: FR-018, D-5, plan §Phase 6 RED. **Depends**: T032.

### GREEN (реализация)

- [ ] T034 [US5] [M] `packages/pilot/src/registry/load.ts` — `loadPlugins(entries, { resolveFrom })` новый аддитивный параметр-резолвер (bare-only правило; член класса/функция `resolveFrom = createRequire(...)`-замыкание); bare-specifier → `resolveFrom.resolve` (exception → `BRG_PACKAGE_NOT_FOUND` + actionable, additive; константа-код frozen), success → `import(pathToFileURL(resolved).href)`; import-ошибки → `BRG_LOAD_ERROR`; relative/absolute → прежний `import` (изменения module-relative пути — нет, сохранение). **Depends**: T033.
- [ ] T035 [US5] [M] `packages/pilot/src/registry/index.ts` — `loadPlugins(entries, { resolveFrom })` из rootDir (`createRequire` входной точки registry-инициализации, rootDir используется для consumer-graph); records-ключ `loaded.set(`&#96;${entry.kind}:${entry.id}&#96;`, …)` (id raw, `PluginEntry.id` не меняется, grammar 025 ER-009); `registry/validate.ts:14` → `registry.records.has(`&#96;builder:${app.builder}&#96;`)`; `build/index.ts:256`/`:172` → qualified `get`/resolveBuilderVersion-lookup (каст Map-имётся в виду — сужение типа для records-строк); `select.ts` без изменений (values+filter: `kind==='materializer'`, диагностики печатают raw `id`/`materializerIds` БЕЗ изменения текста — D-5). **Depends**: T034.

**Фаза-6 Checkpoint**: registry + materialize suites зелёные; legacy relative-path fixtures (FR-020) зелёные; `BRG_KEY_COLLISION` superseded-комментарий (025 D-3) in place; pilot typecheck.

---

## Phase 7: Verification & Acceptance (US-1..US-6, SC-001..008)

**Purpose**: Полный per-package прогон всех четырёх пакетов, typecheck/test-d, scoped eslint, tsup subpaths; граница диффа и regression anchors; conjoined notices.

- [ ] T036 Verification full — `pnpm exec vitest run` в `packages/pilot`, `packages/composer`, `packages/builders-core`, `packages/materializers-core` (pretest-сборки pilot тянут cores) → **ALL GREEN**, 0 NEW failures; фикстуры reference-final (`ycforge:*`-builder keys, cross-domain refs, function/gateway attrs) проходят все стадии; byte-determinism повторных прогонов (SC-007); traceability: каждый FR-001..020 и US-1..US-6 → ≥1 задача T001–T035 RED→GREEN; test-d gates (T001/T002/T025) и audit-тесты (T001/T026) зелёные. **Ref**: SC-001..008, plan §Phase 7. **Depends**: все задачи фаз 1–6.
- [ ] T037 Verification typecheck/lint/build + граница диффа — per-package `pnpm --filter @ycforge/<pkg> typecheck` → 0 ошибок (strict, exactOptionalPropertyTypes; test-d зелёные); scoped `pnpm exec eslint packages/<pkg>/src packages/<pkg>/test` → 0 NEW errors; `pnpm --filter @ycforge/<pkg> build` (tsup) → subpath-артефакты present: pilot `dist/contracts/resource-domain.{js,d.ts}`, composer dist, builders-core `dist/docker/`, materializers-core dist; новых npm-зависимостей нет; `git diff dev...HEAD` покрывает ТОЛЬКО 4 владеющих пакета (`packages/{pilot,composer,builders-core,materializers-core}/**`), `specs/028-e2e-final-enablement/**`, `specs/README.md` (+ `pnpm-lock.yaml` если задет); `packages/nest-bridge`, `js-dev-tools`, `examples` — 0 диффов; `git status` чистый; regression anchors ровно из плана §Modified Tests: `resources.spec.ts:83/101` (flip), `builders-yaml.spec.ts:53` (T004 flip), `quickstart.spec.ts:77` (Sc3 flip), `yandex-function.spec.ts:38`, `yandex-api-gateway.spec.ts:51/54/74/128`, `e2e-real-cores.spec.ts:90-99`, оба pilot test-d (EXT-only), pilot goldens по grep T024; docker.spec.ts существующие `it` без правок (SC-005); composer legacy CLI fixtures без правок (NG-10); Conjoined NOTES (без правок файлов): NOTICE 024 (reference-проект собирается при artifact-type builder keys, D-1; правка проекта — зона 024) + README-примечания при /speckit.implement (docker modes в README builders-core; store-контракт в README pilot; artifact-type builder keys как precondition app-identities). **Ref**: SC-005/006, plan §Modified Tests + §Conjoined Change. **Depends**: T036.

**Checkpoint**: границы диффа соблюдены; 0 NEW failures во всех четырёх пакетах.

---

## Phase 8: Convergence (T150-style placeholder)

**Purpose**: Placeholder для `/speckit.converge` — read-only аудит, вердикт заполняется после implementation.

- [ ] T038 Convergence placeholder — read-only аудит `/speckit.converge` (заполнить после implementation): полный set всех четырёх пакетов (vitest + test-d + typecheck + scoped eslint + tsup subpaths: `dist/contracts/resource-domain.d.ts`, `dist/builder/`, `dist/docker/`) ALL GREEN; аддитивность (ни один public type/const/код не изменён; frozen сохранены — `BRG_KEY_COLLISION`+superseded, `RESOURCE_REF_*`, `BLC_*`; только +`BLC_DOCKER_UNREACHABLE`; `DockerArtifactValue` frozen); git-diff граница = 4 пакета + specs/028 + specs/README (+lock); traceability FR-001..020/US-1..6 → T001–T037; Constitution I/II/III/V/VI соблюдены. **Ref**: SC-006, pattern 023 T150 / 025 T039 / 027 T060. **Depends**: T037.

---

## Dependencies & Execution Order

### Phase Dependencies (T0xx)

- **Phase 1 (Контракты, T001–T008)**: Без внешних. T001/T002/T003/T004 [P] (RED) → T005→T006 (materializer context .test-d gate)/T007 (store)/T008 (builders-yaml) [P] (GREEN). BLOCKS фазы 2–6 (Fix-4-контракт живёт в фазе 5 — пакет изолирован).
- **Phase 2 (Fix-1, T009–T013)**: После Phase 1 (контракт-маппинг T005). T009 → T010; T011 [P] (pilot flip) → T012 (composer GREEN) после T009/T010 → T013 (pilot GREEN) после T011.
- **Phase 3 (Fix-2, T014–T018)**: После T007 (store-модуль, Phase 1). T014 → T015; T016 [P] (guards RED, materializers-core) параллельно; T017 (CLI RED) после T016 → T018 (GREEN: build-loop + CLI `--artifacts` + guards) после T015/T016/T017.
- **Phase 4 (Fix-3, T019–T024)**: После Phase 1 (context-контракт T006). T019/T020/T021 [P] (RED) → T022 (gated, после T021) → T023 (materializers GREEN) после T019/T020 → T024 (pilot context + goldens) после T006/T021/T023/T022.
- **Phase 5 (Fix-4, T025–T031)**: Пакет-изолирован. T025/T026 [P] (RED) + T027 (fake infra, до T028/T029) → T028/T029 [P] (RED) → T030 (types/diagnostics/JSON) после T025/T026 → T031 (config/cli/index) после T028/T029/T030.
- **Phase 6 (Fix-5, T032–T035)**: T032 [P] (quickstart consumer-graph) → T033 (load dispatch unit) после T032 → T034 (load.ts) → T035 (registry keys + qualified lookups) после T034.
- **Phase 7 (Verification, T036–T037)**: После фаз 1–6. T036 → T037.
- **Phase 8 (Convergence, T038)**: После Phase 7. Placeholder.

### Dependency Graph

```
Phase 1 (Контракты, T001-008) ──┬──► Phase 2 (Fix-1, T009-013) ──► Phase 3 (Fix-2, T014-018)
                                │                                                        │
                                └──► Phase 4 (Fix-3, T019-024) ───────────────────────────┤
                                └──► Phase 5 (Fix-4, T025-031) ───────────────────────────┤
                                └──► Phase 6 (Fix-5, T032-035) ───────────────────────────┤
                                                                                           ▼
                                                       Phase 7 (Verification, T036-037) ──► Phase 8 (Convergence, T038)
```

### Parallel Opportunities

- **Phase 1**: T001–T004 [P] (новые test-d / spec-файлы); T005→T006/T007/T008 [P] после соответствующих RED.
- **Phase 2**: T011 [P] (pilot resources.spec) параллелен T009/T010 (composer); T012 после двух composer-RED.
- **Phase 3**: T016 [P] (guards RED) параллелен T014/T015 (pilot); T018 (GREEN) ждёт T015/T016/T017.
- **Phase 4**: T019/T020/T021 [P] (materializers-core × 2 + pilot e2e); T022 (gated) после T021.
- **Phase 5**: T025/T026 [P] (test-d + audit-json); T028/T029 [P] после fake-инфраструктуры T027.
- **Phase 6**: T032 [P] (quickstart consumer-graph) → T033; остальное последовательно.
- **Phase 7**: T036 полный set → T037 границы/anchors.

## Notes

- [P] = разные файлы / независимые секции — параллелить безопасно; [M] = модификация существующего файла; остальное — аддитивные новые блоки.
- **Никаких правок существующих тестов вне regression anchors плана**: docker.spec.ts (прежний describe :58 + 027 no-push :256, всего 31 it) — только ADD; composer legacy CLI fixtures — 0 правок (NG-10); единственные [M]-флипы — `resources.spec.ts:83/101`, `builders-yaml.spec.ts:53` (T004), `quickstart.spec.ts:77` (Sc3, T032) — все D-8, superseded-комментарии; `yandex-function.spec.ts:38`, `yandex-api-gateway.spec.ts:51/54/74/128`, оба pilot test-d, e2e-real-cores.spec.ts:90-99.
- **Const frozen**: `BRG_KEY_COLLISION`, `RESOURCE_REF_*`, `BLC_*` не переименовываются/не удаляются; `BRG_KEY_COLLISION` — superseded-комментарий (вызов больше не производится после T008/T035); `BLC_DOCKER_UNREACHABLE` — новая const (keys += 1, audit-тест T026).
- **Контракты только аддитивны** (Constitution III): `BuildContext.appIdentities?` (T005), `MaterializationContext.projectRoot?` (T006 — обе структурные копии в одном commit, иначе `toEqualTypeOf` RED), `DockerBuildConfig.image.{mode,ref,host}?` (T030), store `artifact.json {version:1}` (T007 — код-файл, не `.ycsf/*.yaml` — NG-2), `DockerArtifactValue`/`TerraformResource.configuration` не меняются.
- **Never warn-and-continue** (V): недостижимый daemon → `BLC_DOCKER_UNREACHABLE` c actionable-направлением, никогда тихий успех/partial (T029); коллизия app↔external в merged-индексе → `RESOURCE_REF_IDENTITY_COLLISION`, никогда merge (T009); guards без exception-каскада (T016/T018).
- **Determinism (SC-007)**: `name`/`memory` из стабильных входов (app_id/константы `128`), никаких UUID/timestamps (T019); store-дескриптор canonical `JSON.stringify` (T007); companion-tray при `projectRoot` адресуем через `${path.module}` (terraform cwd = `infra`).
- `BRG_PACKAGE_NOT_FOUND` — расширение message actionable («declare as a dependency of the consumer project») additive; код frozen (T033/T034).
- Commit после каждой фазы или логической группы; последний коммит цикла — только `specs/028-e2e-final-enablement/tasks.md` с `docs(specs): tasks spec 028 e2e-final-enablement`.
- Spec 024 — NOTICE (без правок): reference-проект собирается после 028 при artifact-type builder keys (`ycforge:function` и т.д.); правка проекта — зона 024 (A-7).
- Smoke на реальном docker daemon (A-4) — вне unit-CI (daemon на машине автора выключен, всё hermetic через fake-bins); `terraform validate`-characterization (T022) — gated probe PATH.