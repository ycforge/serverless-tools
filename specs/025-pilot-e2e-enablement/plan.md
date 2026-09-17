# Implementation Plan: pilot-e2e-enablement — значения артефактов через materialize (BIG-1), artifact-типы в builders-реестре (BIG-2), suspicious-keys в `ycsf check` (BIG-6)

**Branch**: `025-pilot-e2e-enablement` | **Date**: 2026-09-12 | **Spec**: [specs/025-pilot-e2e-enablement/spec.md](./spec.md)

**Input**: Feature specification from `./spec.md` (FR-001..FR-016, US-1..US-5, D-1..D-6, A-1..A-8, NG-1..NG-8, SC-001..SC-007) + checklists/requirements.md (16/16 pass)

## Summary

Spec 025 доводит reference-проект 024 до `terraform plan` на реальных артефактах, закрывая три разрыва в `packages/pilot` (Project C):

- **BIG-1 — значения артефактов прошиваются через materialize.** Built-артефакты (`BuiltArtifact { appId, artifact: { type, value } }`) доходят до стадии materialize через аддитивный контракт: `DispatchOptions.artifacts?: AppIdArtifactMap` → `ArtifactDescriptor { id, name, type, value? }` (оба шага — `supports` и `materialize` — видят `value`; `value` остаётся opaque `unknown`, C схемы не знает, Constitution I). `DispatchResult.ok` пополняется `materializerOutputs: ReadonlyMap<string, OutputValue>` (`OutputBuilder.declared`), и pipeline передаёт его в `buildOutputs` вместо литерала `materializerOutputs: new Map()` (`pipeline.ts:102`) — реальные auto-outputs (например `user_service_function_id`) попадают в `99-ycsf-outputs.tf.json`, «тихий сброс» объявлений устранён (D-2).
- **BIG-2 — реестр builders принимает artifact-типы.** `KEY_RE = /^[\w-]+$/` (`builders-yaml.ts:15`) расширяется: ключ секций `builders`/`materializers` = либо legacy `[\w-]+` (без изменений, 0 регрессий), либо `[a-z][a-z0-9-]*:[a-z][a-z0-9-]*` (concordant `ARTIFACT_TYPE_PATTERN`, `isArtifactType` уже есть). `app.builder: ycforge:function` адресует запись registry напрямую (D-5); `BRG_KEY_COLLISION`, `BRG_UNKNOWN_BUILDER`, селекция по `supports(type)` и `MTL_UNHANDLED_ARTIFACT`/`MTL_COLLISION` не меняются.
- **BIG-6 — `ycsf check` детектит suspicious-keys.** Новая категория `scanSuspiciousKeys(rootDir, model)` сканирует имена ключей (value-free, по raw-YAML — D-6) в `.ycsf/apps.yaml|builders.yaml|outputs.yaml|extensions.yaml|moved.yaml|resources.yaml` и per-app `<appId>/build_config.yaml` (A-8) по детерминированному denylist EXACT/SUFFIX (D-4), выдаёт collect-all `YCK_SUSPICIOUS_KEY` (`file`, путь ключа через точку/индексы, `key`, машино-читаемый `reason`), exit 1 на любой находке; отсутствующие/синтаксически-битые файлы пропускаются (FR-015).

Попутная осознанная поправка к spec 016 — **D-3**: требование префикса `ycsf_` у auto-outputs снято (реальные materializers 019 объявляют без префикса); строгое relaxation: auto-output валидируется грамматикой `[a-z][a-z0-9_]*` + уникальностью (`OUT_INVALID`/`OUT_DUPLICATE_NAME`); `OUT_INVALID_AUTO_PREFIX` сохраняется frozen c комментарием «superseded by FR-008» (SC-007, FR-016). Reserved-префикс `ycsf_` для user-объявленных output'ов (`OUT_RESERVED_PREFIX`) не трогается.

Контракт — строго аддитивный (`ArtifactDescriptor.value?`, `DispatchOptions.artifacts?`, `DispatchResult.ok.materializerOutputs`, `YCK_SUSPICIOUS_KEY` + `key?`/`reason?` у `YckDiagnostic`); ни один существующий тип не редактируется (test-d guard). NG-3 (мифические cwd-правки materializers-core: companion-файл api-gateway, хеши путей) — вне 025, фиксируется координационным note для B-слоя.

## Technical Context

**Language/Version**: TypeScript (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — conditional spread при прошивке `value`), Node 22+ ESM, `"type": "module"`; сборка tsup → `dist/cli/index.js` (bin `ycsf`). Изменяется только `packages/pilot`.

**Primary Dependencies**: runtime — без новых (существующие: `yaml`). devDependencies: `@ycforge/builders-core`, `@ycforge/materializers-core` (уже подключены; 1 интеграционный тест на реальных cores, subpath default-export'ы `@ycforge/builders-core/nestjs-function`, `@ycforge/materializers-core/yandex-function`).

**Storage**: только чтение существующих файлов: `.ycsf/*.yaml`, `.ycsf/artifacts/<appId>/` (blobs build-cache 022 — не меняются, A-7), `<appId>/build_config.yaml` (A-8), `infra/*.ycsf.tf.json`. Запись — только там же, где и сегодня (`infra/`, `.ycsf/artifacts/`). Новая fixture-папка в `test/check/fixtures/suspicious-keys/`.

**Testing**: Vitest, test-first (Constitution II), RED→GREEN на каждый FR-001..016 / US-1..5. Страты: чисто-функциональные unit-тесты (select/materialize/dispatch/buildOutputs/builders-yaml/check-category), расширенный fixture-спай (изучает `value` в descriptor и на `supports`, и на `materialize`), dumps: существующие quickstart fixture-материализаторы продолжают работать без `value` (US-5, §13), 1 e2e на реальных builders-core + materializers-core (zip в temp, paths relative-to-cwd как в их собственных фикстурах, без сети/облака). Тип-тесты test-d (materialize.test-d.ts, outputs.test-d.ts, fr-004-artifact-type.test-d.ts) замораживают аддитивность.

**Target Platform**: CLI `ycsf` (plan/build/materialize/check) + контракт `@ycforge/pilot/contracts` (additive).

**Project Type**: library + CLI (Project C orchestration/build). Rule: A owns runtime, B owns composition, C owns orchestration, Terraform owns provisioning — незатронуты.

**Performance Goals**: SC-001 — генерация детерминирована бит-в-бит (`git stash`/`pop`); нулевых лишних IO-проходов pipeline (проброс артефактов in-memory); категория suspicious-keys — 1 read + линейный обход ключей на файл, табличный линейный matcher.

**Constraints**: Constitution I — `value` opaque, C не валидирует и не интерпретирует; III — только аддитивные изменения контрактов, `version: 1` всех `.ycsf/*.yaml` не трогаются (NG-6); V — fail-fast, коллизии = ошибки, константы кодов не удаляются (`OUT_INVALID_AUTO_PREFIX` — frozen+superseded, не deleted); A-1..A-8 (вкл. A-2: reference-проект планируется без `--target`; A-3: cwd-дефект materializers-core — вне объёма, B-layer note; A-5: `ycsf check` НЕ пересчитывает auto-outputs — там остаётся пустая карта); NG-1..NG-8 (026 dialect, 027 no_push, materializers-core, composer/builders-core, кэш-standalone, форматные изменения — вне).
**Scale/Scope**: `packages/pilot` only. ~9 src-модулей затронуто (3 контракта, 4 materialize/pipeline, outputs/build, builders-yaml, check-категория), ~4 новых тест-файла + ~4 расширенных, 1 новая fixture-папка, 3 типа правок существующих тестов (flip D-3), 2 документальных комментария (frozen/superseded).

## Constitution Check

*GATE: Passed before Phase 0 research; re-checked after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Работает только Project C (`packages/pilot`). `value` прошивается opaque (`unknown`), C не знает схем builders/materializers (D-1). NG-3/NG-4 подтверждают: правки B-слоя НЕ входят. Terraform provisioning не трогается (NG-7). |
| II. Spec-First, Test-First | ✅ PASS | Каждый FR-001..016 → ≥1 тест RED→GREEN (§13 стр. тест. стратегии). Исключение «thin orchestration» по конституции применяется только к тонким слоям, инвокация Terraform CLI; здесь все регионы чисто-функциональные и unit-testable. |
| III. Contracts Versioned | ✅ PASS | Строго аддитивно: `ArtifactDescriptor.value?`, `DispatchOptions.artifacts?` (+ тип `AppIdArtifactMap`), `DispatchResult.ok.materializerOutputs`, `YCK_SUSPICIOUS_KEY`, `YckDiagnostic.key?/reason?`. Существующие типы не редактируются; test-d guard'ы (materialize/outputs/fr-004) это проверяют. Форматы `.ycsf/*.yaml` — `version: 1` без изменений (кроме аддитивного приёма ключей-артефактов в builders.yaml, FR-009/NG-6). |
| IV. Terraform Stays Terraform | ✅ PASS | `.tf.json` продолжает генерироваться тем же serialize/write; suspicious-keys — read-only категория check, без записи. |
| V. Explicit Over Magic | ✅ PASS | Никаких тихих merge/auto-renames: коллизии → `BRG_KEY_COLLISION`/`OUT_DUPLICATE_NAME`/`OUT_RESERVED_PREFIX` (без изменений); `OUT_INVALID_AUTO_PREFIX` — не удалён, а объявлен superseded (FR-016); materializer без `value` падает документированным `MTL_MATERIALIZE_FAILED`, а не TypeError/молчанием (FR-007); suspicious-keys — детерминированный denylist, не эвристика. |
| VI. Ownership: apps=managed | ✅ PASS | Не меняется; сканер suspicious-keys не переименовывает и не редактирует конфигурации. |
| Monorepo Tooling | ✅ PASS | Один пакет (`packages/pilot`), тесты в `packages/pilot/test/` рядом с существующими; vitest; build `pretest` собирает builders/materializers-core + pilot (package.json pilot). |

**Deviations (не проход через silent, осознанные и задокументированные)**:
1. **D-3 — поправка к spec 016** (с разрешения spec 025 §8/§9/FR-008): требование префикса `ycsf_` у auto-outputs снято. Это «strict relaxation»: ранее валидные входы остаются валидными; previously-invalid → valid. Fail-fast сохраняется через грамматику `[a-z][a-z0-9_]*` + уникальность. Константа `OUT_INVALID_AUTO_PREFIX` сохраняется (frozen + комментарий «superseded by FR-008»), удаление недопустимо (SC-007). Обновляются 3 существующих теста (Sc4/T020/T028 — ниже, Modified Tests).
2. **Интеграционный тест на реальных cores фиксирует текущее поведение NG-3** (A-3): materializers-core yandex-function принимает только relative `archivePath`; значение от реального builders-core nestjs-function — абсолютный путь (`join(outputDir, out_filename)`). Тест (а) покрывает GREEN на relative-value и (б) УПИНУЕТ документированная ошибка `MTL_MATERIALIZE_FAILED` (`YMT_INVALID_ARTIFACT_VALUE`) на absolute-value — как подтверждение, что значения реально прошились. Когда B-слой починит NG-3, expectation в (б) переворачивается на ok (комментарий-ссылка на coordination note). Это не «фикс» в 025 и не молчаливое мириание с дефектом — поведение очевидно и документировано.

**Gate Decision**: All gates PASS. Phase 1 design re-check: аддитивность подтверждена типом `OutputValue`/`OutputBuilderWithCollection.declared` (`ReadonlyMap<string, OutputValue>`), `DispatchResult.ok` — существующая union-ветка (поле добавляется к ok-ветке), типы `Artifact`/`BuiltArtifact` уже содержат `value`/`appId` — менять их НЕ требуется. Ничего не потребовало правки spec.

## Project Structure

### Documentation (this feature)

```text
specs/025-pilot-e2e-enablement/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Авторитетный input
├── checklists/requirements.md
└── tasks.md             # Phase 2 output (created by /speckit.tasks — NOT created here)
```

### Source Code (repository root) — только `packages/pilot`, test-first

```text
packages/pilot/src/
├── contracts/
│   ├── materialize.ts                 # ADD: ArtifactDescriptor.value?; DispatchOptions.artifacts?; AppIdArtifactMap; DispatchResult.ok.materializerOutputs
│   ├── check.ts                       # ADD: YCK_SUSPICIOUS_KEY; YckDiagnostic.key?/reason?
│   ├── outputs.ts                     # DOC: frozen-комментарий «superseded by FR-008» на OUT_INVALID_AUTO_PREFIX
│   └── index.ts                       # barrel: AppIdArtifactMap, (value уже)
├── materialize/
│   ├── select.ts                      # MOD: buildArtifactDescriptors(model, artifacts?); selectArtifacts(model, registry, artifacts?) — values в supports
│   ├── materialize.ts                 # MOD: materializeAll(..., outputBuilder, artifacts?) — descriptor c value (conditional spread)
│   └── dispatch.ts                    # MOD: dispatch(model, registry, options?) — artifacts → select+materialize; ok += materializerOutputs: outputBuilder.declared
├── outputs/
│   └── build.ts                       # MOD: D-3 — снять префикс-проверку на auto-outputs (:81-86), добавить NAME_RE-проверку; убрать импорт OUT_INVALID_AUTO_PREFIX из модуля (константа остаётся в contracts)
├── registry/
│   └── builders-yaml.ts               # MOD: KEY_RE → legacy [\w-]+ (без изменений) ИЛИ isArtifactType(key); прочие → BRG_INVALID
├── cli/
│   └── pipeline.ts                    # MOD: runBuildAndMaterialize → AppIdArtifactMap из buildResult.artifacts; runMaterializeGeneration(..., artifacts?) → dispatch({ artifacts }) + buildOutputs({ materializerOutputs: dispatchResult.materializerOutputs }) (:45,:100-104,:164)
└── check/
    ├── categories/
    │   └── suspicious-keys.ts         # NEW: scanSuspiciousKeys(rootDir, model) — denylist EXACT/SUFFIX, raw-YAML walk, collect-all
    └── check.ts                       # MOD: добавить вызов категории (после шага 1, model available — app-ids для build_config.yaml)

packages/pilot/test/
├── unit/
│   ├── select.spec.ts                 # EXT: value в descriptor на supports
│   ├── materialize.spec.ts            # EXT: value в descriptor на materialize; FR-007 документ.ошибка
│   ├── dispatch.spec.ts               # EXT: artifacts → значения + materializerOutputs в ok-result
│   ├── outputs-build.spec.ts          # MOD: T020 flip, T028 fused; EXT: NAME_RE auto (UpperCase→OUT_INVALID), frozen OUT_INVALID_AUTO_PREFIX
│   └── builders-yaml.spec.ts          # EXT: artifact-типы приняты в обеих секциях; YC:Function → BRG_INVALID
├── cli/unit/pipeline.test.ts          # EXT: проброс artifacts в runMaterializeGeneration (mock), materializerOutputs → buildOutputs
├── types/
│   ├── materialize.test-d.ts          # EXT: value?, artifacts?, materializerOutputs, AppIdArtifactMap
│   └── outputs.test-d.ts              # DOC: frozen-комментарий (список 8 кодов не меняется)
├── check/
│   ├── suspicious-keys.spec.ts        # NEW: табличный denylist (EXACT/SUFFIX, token_endpoint negative, non-string, path walk)
│   ├── aggregation.integration.spec.ts# EXT: canonical → по-прежнему 0 диагностик; suspicious fixture → YCK_SUSPICIOUS_KEY
│   └── fixtures/suspicious-keys/      # NEW: вариант canonical + build_config.yaml c DB_TOKEN (и .ycsf/apps.yaml c api_key)
└── materialize/
    └── e2e-real-cores.spec.ts         # NEW: реальные builders-core/materializers-core (см. Deviations п.2)
```

**Structure Decision**: Расширяем существующие контракты и оркестраторы in-place (никаких новых пакетов/server). Категория suspicious-keys кладётся рядом с прочими категориями (`check/categories/suspicious-keys.ts` — паттерн `env-in-patch.ts`: чистая функция → `readonly YckDiagnostic[]`), вызывается из `check/check.ts` единым push-выражением. Value-проброс реализуется через существующие точки: `buildArtifactDescriptors` (select.ts:65) используется ОБОИМИ шагами (select и materializeAll) — единая точка построения descriptor'а исключает расхождение FR-003. Fixture-спай расширяется аддитивно (`MaterializerSpy.materializeArtifacts`) — тестовый хелпер, src не трогает.

## Complexity Tracking

> No constitution violations introduced — all gates pass. Отсутствие нового пакета гарантировано (Proof: тесты 027/constitution остаются зелёными; изменения — аддитивные поля и одна новая category-функция; NG-1..NG-8 перечислены в spec).

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Implementation Phases (RED → GREEN)

> Порядок фаз соблюдает зависимости: контракты (1) → materialize-поток (2) → outputs/D-3 (3) → registry (4) → check-категория (5) → e2e/приёмка (6). Внутри каждой фазы сначала тесты (RED), затем реализация (GREEN). Thin orchestration (pipeline) — characterization-тесты после реализации (конституция, exception).

### Phase 1 — Аддитивный контракт (FR-016/FR-001/FR-004, SC-007)

**RED**: `packages/pilot/test/types/materialize.test-d.ts` — новые типовые утверждения:
- `ArtifactDescriptor['value']` — `unknown | undefined` (expectedTypeOf optional);
- `DispatchOptions['artifacts']` — `AppIdArtifactMap | undefined`, `AppIdArtifactMap` импортируется из `contracts/index.js`;
- `DispatchResult` ok-ветка (объект целиком) содержит `materializerOutputs: ReadonlyMap<string, OutputValue>`;
- `dispatch` по-прежнему callable с `(model, registry)` и с `(model, registry, DispatchOptions)`.

`packages/pilot/test/types/outputs.test-d.ts` — только комментарий: `OUT_INVALID_AUTO_PREFIX` остаётся в замороженном списке из 8 кодов (без изменения самих утверждений). `test/types/fr-014-dispatch.test-d.ts` — без изменений (не зависит от DispatchResult shape).

**GREEN**:
- `contracts/materialize.ts`: `AppIdArtifactMap = ReadonlyMap<string, Artifact>`; `ArtifactDescriptor.value?: unknown` (exactOptional — рекомендательный комментарий «opaque, Constitution I»); `DispatchOptions.artifacts?: AppIdArtifactMap`; `DispatchResult` ok-ветка += `readonly materializerOutputs: ReadonlyMap<string, OutputValue>` (import type OutputValue).
- `contracts/check.ts`: `YCK_SUSPICIOUS_KEY` константа (семья `YCK_*`, `check/errors.ts` реэкспорт как у остальных); `YckDiagnostic` += `key?: string`, `reason?: string`.
- `contracts/outputs.ts:59`: frozen-комментарий `// OUT_INVALID_AUTO_PREFIX: superseded by FR-008 (spec 025, D-3) — frozen, не использовать.`
- `contracts/index.ts`: экспорт `AppIdArtifactMap`.

### Phase 2 — BIG-1: значения артефактов в materialize (FR-001..FR-007, FR-005, US-1)

**RED**:
- `test/unit/select.spec.ts` +2 кейса: (а) `selectArtifacts(model, registry, artifacts)` — `supportsCalls` 1-го вызова несут `{ value }` для appId из карты и без `value` для отсутствующего; (б) значение прошивается ТОЛЬКО при presence (FR-002 — exactOptional).
- `test/unit/materialize.spec.ts` +2 кейса: (а) `materializeAll(model, registry, matches, outputBuilder, artifacts)` — descriptor из `materializeArtifacts` содержит `value`; (б) FR-007: materializer, требующий value, без значения → `MTL_MATERIALIZE_FAILED` с message упоминающим значение и необходимость полного build (не TypeError).
- `test/unit/dispatch.spec.ts` +2 кейса: (а) `dispatch(model, registry, { artifacts })` — materializer получает descriptor с `value`, result `ok.materializerOutputs` содержит объявленные outputs в порядке объявления (`matWithOutput` → `url`); (б) `dispatch(model, registry)` (без опций) — `ok.materializerOutputs` = size 0 (обратная совместимость, US-5). Существующий T019/T020/T021 остаются зелёными (безусловный вызов `dispatch(model, registry)`).
- `test/cli/unit/pipeline.test.ts` +1 кейс (mock builder): `runMaterializeGeneration(..., { artifacts })` передаёт artifacts в dispatch и `materializerOutputs: dispatchResult.materializerOutputs` в `buildOutputs`; +1 characterization после реализации: `runBuildAndMaterialize` собирает `AppIdArtifactMap` из `buildResult.artifacts` (`[appId, artifact]`) и передаёт в runMaterializeGeneration (thin orchestration — characterization постфактум).

**GREEN**:
- `materialize/select.ts`: `buildArtifactDescriptors(model, artifacts?: AppIdArtifactMap)` — conditional spread `...(artifact ? { value: artifact.value } : {})` по `artifacts?.get(id)`; `selectArtifacts(model, registry, artifacts?)` — проброс. (Одна точка построения descriptor'а для обоих шагов, FR-003.)
- `materialize/materialize.ts`: `materializeAll(model, registry, matches, outputBuilder = createOutputBuilder(), artifacts?: AppIdArtifactMap)`; descriptor из `buildArtifactDescriptors(model, artifacts)` по Map(id → descriptor) — вместо инлайн-сборки `:52-53`; catch `:59-68` оставляет `MTL_MATERIALIZE_FAILED` (message уже включает `errorMessage` — «документированная ошибка» FR-007).
- `materialize/dispatch.ts`: `_options ? ...` → используем `options?.artifacts` в `selectArtifacts (:30)` и `materializeAll (:37)`; ок-ветка `:74` → `{ kind: 'ok', resources, generatedFiles, materializerOutputs: outputBuilder.declared }`.
- `cli/pipeline.ts`: `runMaterializeGeneration(rootDir, model, registry, opts?, artifacts?: AppIdArtifactMap)` — `dispatch(projectModel, registry, { artifacts })` `:45`; `buildOutputs({ ..., materializerOutputs: dispatchResult.materializerOutputs, ... })` вместо `new Map()` `:100-104`; `runBuildAndMaterialize` `:164` → `new Map(buildResult.artifacts.map((b) => [b.appId, b.artifact]))`.

### Phase 3 — BIG-1/D-3: auto-outputs (FR-008, FR-006, US-3)

**RED** (обновление существующих тестов + новые):
- `test/outputs/quickstart.spec.ts:142-154` (Sc4) — flip: `function_user_service_id` (без `ycsf_`) теперь ВАЛИДЕН → `kind: 'ok'`, ключ присутствует, `value === '${yandex_function.user_service.id}'`.
- `test/unit/outputs-build.spec.ts:101-114` (T020) — flip на `kind: 'ok'` (тот же сценарий); `test/unit/outputs-build.spec.ts:257` (T028) — коды `[OUT_INVALID_VALUE]` (без `OUT_INVALID_AUTO_PREFIX`).
- `test/unit/outputs-build.spec.ts` +2: (а) auto-output `User_Service_Function_Id` → `OUT_INVALID` (грамматика); (б) авто-имя, конфликтующее с user output → `OUT_DUPLICATE_NAME` (edge §8: user wins не происходит — честная ошибка).
- `test/unit/outputs-build.spec.ts` +1 frozen-guard: `OUT_INVALID_AUTO_PREFIX` по-прежнему экспортируется и типизирован literal (records superseded-комментарий) — §13 «Сохранение OUT_INVALID_AUTO_PREFIX — отдельный тест».

**GREEN**: `outputs/build.ts` — в цикле auto-outputs (:80-95) удалить проверку префикса (:81-86), добавить `if (!NAME_RE.test(name)) → OUT_INVALID`; сохранить `OUT_DUPLICATE_NAME` (:87-90); удалить импорт `OUT_INVALID_AUTO_PREFIX` из модуля (константа остаётся в contracts, комментарий Phase 1). RESERVED_AUTO_PREFIX и правило OUT_RESERVED_PREFIX для user output'ов — без изменений (:50-55, T023).

### Phase 4 — BIG-2: artifact-типы в builders.yaml (FR-009..FR-011, US-2, SC-004)

**RED**: `test/unit/builders-yaml.spec.ts` +4 кейса:
- `ycforge:function` в `builders` и `yandex-function` в `materializers` → ok, домен сохраняется как есть (без трансформаций, D-5);
- legacy `nestjs_function` продолжает приниматься (SC-004, 0 регрессий) — существующие T010/T019 остаются зелёными;
- `YC:Function` → `BRG_INVALID` (uppercase в namespace/kind, edge §8);
- `ycforge` (без колонки) → legacy-допустим (осознанная трактовка FR-009: bare-token = legacy ключ; «отсутствие колонки» = формы, содержащие `:`, но не соответствующие паттерну / с пробелом / с uppercase — см. ниже), `ycforge :function` (пробел) → `BRG_INVALID`.
Дополнительно: `test/unit/load-registry.spec.ts` +1 кейс (registry store ключуется по полному ключу, artifact-тип включ.); `test/unit/validate-builders.spec.ts` +1 кейс (apps.yaml c `builder: ycforge:function` → validation ok при объявленном ключе; BRG_UNKNOWN_BUILDER при отсутствии — FR-011). `test/registry/quickstart.spec.ts` Sc1 (legacy) — без изменений.

**GREEN**: `registry/builders-yaml.ts` — `KEY_RE` → `isValidBuildersKey(key)`: `(!key.includes(':') && LEGACY_KEY_RE.test(key)) || isArtifactType(key)`, где `LEGACY_KEY_RE = /^[\w-]+$/` (текущий, без изменений); validation-сообщение уточнить перечислением двух допустимых форм (сохранение BRG_INVALID, код/канал без изменений). Коллизия секций (`BRG_KEY_COLLISION`) и `BRG_DUPLICATE_KEY` — без изменений (A-6: грамматика не порождает «дубликат другой формы» — legacy и artifact-type непересекающихся лексем, `:` вне `[\w-]`).

### Phase 5 — BIG-6: suspicious-keys (FR-012..FR-016, US-4, SC-005)

**RED**:
- `test/check/suspicious-keys.spec.ts` (NEW, in-memory/temp файлы): таблица EXACT-positive (`api_key`→apikey, `db_password`→dbpassword, `access_token`→accesstoken, `DB_TOKEN` uppercase-normalized, `client_secret`, `authorization`), EXACT/SUFFIX-negative (`token_endpoint` — суффикс торчит, `refresh_token` — осознанный false-positive ПОДСВЕЧИВАЕТСЯ и упинается тестом, D-4), boundary (`secret` exact без суффикса-квака), non-string ключи игнор, walk по вложенности + индекс массива (путь `extensions.0.patch.API_KEY`), collect-all ≥2 за один запуск, отсутствующие файлы — тишина, синтаксически-битый YAML — пропуск (не дублировать валидаторов), value-free (значение не читается/не рендерится в message).
- `test/check/aggregation.integration.spec.ts` — EXT: (а) canonical → по-прежнему `diagnostics.length === 0` (SC-006 регрессия); (б) NEW fixture `test/check/fixtures/suspicious-keys/` (каноническая структура + `api_key` в `.ycsf/apps.yaml` и `DB_TOKEN` в `<app>/build_config.yaml`) → содержит `YCK_SUSPICIOUS_KEY` с ожидаемыми `file`/`field`.
- `test/types/outputs.test-d.ts`/unit — frozen-guard кода (уже в Phase 3); `test/check/env-in-patch.integration.spec.ts` — verify-only: фикстура содержит `API_KEY` в `extensions.yaml`, фильтрация по коду сохраняет зелёным (проверка неявная — не менять).

**GREEN**:
- `contracts/check.ts`: `YCK_SUSPICIOUS_KEY` + `key?`/`reason?` (Phase 1).
- `packages/pilot/src/check/categories/suspicious-keys.ts` (NEW): `scanSuspiciousKeys(rootDir, model): readonly YckDiagnostic[]`; базовые set'ы EXACT/SUFFIX из D-4 (frozen `as const` массивы, аддитивны по A-4); нормализация `key.toLowerCase().replace(/[^a-z0-9]/g, '')`; критерий `EXACT.has(n(` | any suffix: `n.length > s.length && n.endsWith(s)`; обход raw-YAML (parse; throw → skip), путь через dot/чislenые индексы (`apps.user_service.env.API_KEY`, `extensions.0.patch.API_KEY`); нестроковые ключи игнор; `reason` машиночитаемый: `'exact-match:<normalized>' | 'suffix-match:<suffix>'`; `file`, `field: путь`; файлы в порядке FR-012 + `<appId>/build_config.yaml` (appIds отсорт. из model); каждый файл открывается ровно 1 раз (шаред read).
- `check/check.ts`: `diagnostics.push(...scanSuspiciousKeys(rootDir, model))` — новый шаг после шага 1 (model loaded; места: после шага 7/8, до return). Выход кода 1 — уже покрыт `checkAction` (`cli/check.ts`: exit 1 при `diagnostics.length > 0`) — CLI не меняется. A-5 соблюден: auto-outputs в check не пересчитываются.

### Phase 6 — E2E/приёмка (SC-001..SC-007, US-1)

**RED**:
- `test/materialize/e2e-real-cores.spec.ts` (NEW): реальные `@ycforge/builders-core/nestjs-function` + `@ycforge/materializers-core/yandex-function` (subpath default-export). (а) build реального архива в temp (path relative-to-cwd — как матеериализаторов-core собственные фикстуры `makeZipUnder`), `dispatch(model, registry, { artifacts })` → `ok`; ресурс yandex_function; `ok.materializerOutputs` содержит объявленный materializer'ом output. (б) УПИНУТЬ NG-3: absolute archivePath (реальный вывод builders-core) → `MTL_MATERIALIZE_FAILED` с message `YMT_INVALID_ARTIFACT_VALUE` (документ. ошибка, не TypeError) — см. Deviations п.2. В память листов: значения НЕ ходят в сеть/облако.
- `test/build/materialize-equivalence.spec.ts` — verify-only: canonical-equivalence (инфра-эквивалентность после реформы descriptor'ов) остаётся зелёным; при нарушении — обновить сценарии фикстур, НЕ ослаблять.
- Прогон полного билд-пайплайна (buildApps-ориентир): `test/cli/unit/pipeline.test.ts` characterization (Phase 2).

**GREEN**: без изменений src в Phase 6 — прогон RED-тестов на реализованном коде фаз 1-5 до полного зелёного; фиксация результатов SC-001/SC-002/SC-005.

## Modified Tests

| Файл:строка | Тип правки | Причина |
|---|---|---|
| `packages/pilot/test/outputs/quickstart.spec.ts:142-154` | flip invalid→valid (Sc4) | D-3/FR-008: auto-output без `ycsf_` валиден |
| `packages/pilot/test/unit/outputs-build.spec.ts:101-114` (T020) | flip invalid→valid | D-3/FR-008 |
| `packages/pilot/test/unit/outputs-build.spec.ts:241-257` (T028, строка 257) | ожидаемые коды → `[OUT_INVALID_VALUE]` | D-3/FR-008 |
| `packages/pilot/test/types/materialize.test-d.ts` | EXT (value?, artifacts?, materializerOutputs, AppIdArtifactMap) | контракт-аддитивность, FR-016/SC-007 |
| `packages/pilot/test/unit/select.spec.ts` | EXT (значения на supports) | FR-003 |
| `packages/pilot/test/unit/materialize.spec.ts` | EXT (значения + FR-007 ошибка) | FR-002/FR-007 |
| `packages/pilot/test/unit/dispatch.spec.ts` | EXT (артефакты + materializerOutputs, empty-map) | FR-004/US-5 |
| `packages/pilot/test/unit/builders-yaml.spec.ts` | EXT (ключи-артефакты, BRG_INVALID) | FR-009 |
| `packages/pilot/test/unit/load-registry.spec.ts`, `validate-builders.spec.ts` | EXT (registry store по полному ключу) | FR-011 |
| `packages/pilot/test/cli/unit/pipeline.test.ts` | EXT (проброс артефактов + materializerOutputs; characterization) | FR-005 |
| `packages/pilot/test/check/suspicious-keys.spec.ts` | NEW | FR-012..015 |
| `packages/pilot/test/check/aggregation.integration.spec.ts` | EXT (canonical 0, suspicious fixture) | SC-005/SC-006 |
| `packages/pilot/test/materialize/e2e-real-cores.spec.ts` | NEW | US-1/SC-001/SC-002, NG-3 pin |
| `packages/pilot/test/types/outputs.test-d.ts` | DOC-комментарий (список без изменений) | FR-016 (frozen) |
| `packages/pilot/test/helpers/materialize-fixtures.ts` | EXT `MaterializerSpy.materializeArtifacts` | поддержка тестов (value на materialize) |

Существующие тесты, остающиеся зелёными БЕЗ правки (fixture-семантика сохранена, US-5): `dispatch.spec.ts` T019/T020/T021, `select.spec.ts` T015-T018, `materialize.spec.ts` T022, `outputs-build.spec.ts` T021/T023-T027, `build/materialize-equivalence.spec.ts`, `cli/integration/*`, `check/*.integration.spec.ts` (фильтрация по кодам), `registry/quickstart.spec.ts`, `test/types/*` остальные.

## Additive-proofs

| Контракт | Изменение | Аддитивность (чьё существующее использование не задето) |
|---|---|---|
| `ArtifactDescriptor` | `value?: unknown` | Новых полей не указано — старые литералы `{ id, name, type }` (materialize.ts:53) остаются валидными; тест T026 (materialize.test-d.ts) на id/name/type не меняется |
| `DispatchOptions` | `artifacts?: AppIdArtifactMap` | `_options?: DispatchOptions` уже опциональен; все существующие `dispatch(model, registry)` компилируются и работают как раньше |
| `DispatchResult.ok` | `materializerOutputs: ReadonlyMap<string, OutputValue>` | Поле добавлено к ok-ветке union; читатели `ok.resources`/`ok.generatedFiles` (pipeline:45-53, write.ts, тесты T019/equivalence) не требуют правок; type-test `toMatchTypeOf` (materialize.test-d) — loose |
| `YckDiagnostic` | `key?: string`, `reason?: string` | optional-поля; все существующие YCK-диагностики и их тесты (env-in-patch, resource-consistency, …) не затронуты |
| Токены `AppIdArtifactMap` | NEW тип | экспорт из `contracts/index.js` — net-new |
| `YCK_SUSPICIOUS_KEY` | NEW код | семья `YCK_*` расширяется; ни один существующий код не меняется |
| `OUT_INVALID_AUTO_PREFIX` | НЕ изменён (комментарий frozen) | значение константы и экспорт сохранены; только ре-смысление в документации |
| Форматы `.ycsf/*.yaml` | `version: 1`, грамматика builders.yaml — accept-расширение | legacy-ключи (`[\w-]+`) продолжают приниматься без изменений (SC-004) |

Гарантии: `BuiltArtifact`/`Artifact`/`OutputValue`/`namespaces` не редактируются; `dispatch`, `buildOutputs`, `selectArtifacts`, `materializeAll`, `parseBuildersYaml`, `check` сигнатуры расширяются только опциональными параметрами/полями.

## Conjoined Change

Ожидаемая **изменения вне 025: НЕТ**. Маст-обязательное сопутствующее:
- **Координационный note (NG-3)**: materializers-core — cwd-зависимость companion-файла api-gateway (`resolve(process.cwd(), 'generated')`), хеширование путей архивов, избыточность имён `ycsf_*` — известный дефект пакета 019, чинится в B-слое отдельной правкой/spec (не в 025). Pilot фиксирует контракт передачи значений (`dispatch` + descriptor), materializers-core обязаны читать `value` из root-относительных/абсолютных путей (A-3). Интеграционный тест (б) одного из них упинает текущее поведение и переворачивается после B-фикса.
- **NOTICE для 024 (вне 025)**: spec 024 (Plan) ещё не создан (`specs/024-e2e-reference/plan.md` отсутствует — 024 только ⬜ в roadmap). После 025 участки A/B плана 024 (build → materialize с values → outputs → terraform validate/plan) станут реализуемы; 025 не дублирует и не заменяет 024.
- Никаких правок `packages/composer`, `packages/builders-core`, `packages/materializers-core`, `IDEA.md`, `specs/README.md` в этом цикле не производится (специфика 026/027 зарезервирована за своими циклами).

## Open Questions

1. **ремнатура `--target` + реальные materializers** (edge §8, A-2): подтверждается, что при `--target` materialize затрагивает все приложения, non-target получают descriptor без `value` → реальный материализатор завершится документ. ошибкой. План принимает это поведение ФАКТИЧЕСКИ без кастомизации (fail честный, не тихий) и покрывает тестом; вопрос только в формулировке message «значение и способ (полный build)» на `MTL_MATERIALIZE_FAILED` — уточнить формулировку во время /speckit.implement, константа кода не меняется.
2. **Сообщение BRG_INVALID** для ключей builders.yaml: перечислять обе допустимые формы (legacy + artifact-type) в одном сообщении — формат не является контрактным (message — human-readable); финализируется в фазе implement.
3. **`reason` машиночитаемость**: формат `exact-match:<normalized>` / `suffix-match:<suffix>` — семантика человекочитаема и стабильна; при желании строго-машиночитаемого ENUM можно заменить на изомасленные значения (равносильно, зафиксировать в quickstart).

## Tasks Readiness

Готово к `/speckit.tasks`. Спецификация и план не содержат [NEEDS CLARIFICATION]; FR-001..FR-016 имеют test-first связки (Phases 1-6); предварительный список задач:
- T1: контракт-аддитивность (value?/artifacts?/materializerOutputs/YCK_SUSPICIOUS_KEY/AppIdArtifactMap) + test-d RED/GREN.
- T2: select/materialize/dispatch value-проброс (одна точка `buildArtifactDescriptors`) + unit RED.
- T3: pipeline проброс artifacts + materializerOutputs в buildOutputs (+ characterization).
- T4: D-3 outputs — flip Sc4/T020/T028 + NAME_RE/uniqueness + frozen-guard.
- T5: builders.yaml artifact-type keys + BRG_INVALID edge + registry/validate EXT.
- T6: suspicious-keys категория + контракт + check wiring + табличные тесты + fixture.
- T7: e2e-real-cores интеграция (GREEN-путь + NG-3 pin).
- T8: регрессия полного набора (pretest сборка cores+pilot, vitest run, zero-dependency/примеры/acceptance).

**Notifications** (без правок файлов): 024 — блокирующий notice выше; materializers-core — coordination note (NG-3).

## Артефакты для ревью (после /speckit.plan)

- `spec.md` — авторитетный input; requirements.md — 16/16 pass.
- `plan.md` — настоящий файл (Summary, Technical Context, Constitution Check, Phases RED→GREEN, Modified Tests, Additive-proofs, Conjoined Change, Open Questions, Tasks Readiness).
- Следующий шаг — `/speckit.tasks` (plan.md сам по себе — артефакт плана; research/data-model/quickstart как отдельные файлы в 025-цикле не создаются, всё содержимое этих фаз сведено в plan.md).