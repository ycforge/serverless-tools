---
description: "Task list for materializer-dispatch — двухфазный dispatch (collision policy), TerraformResource → .tf.json serialization, regeneration"
---

# Tasks: materializer-dispatch — двуфазный dispatch, MTL_* диагностики, `.ycsf.tf.json` serialization

**Input**: Design documents from `/specs/014-materializer-dispatch/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/materialize.json, quickstart.md

**Tests**: Test-first per constitution (II). Каждый acceptance criterion, каждый FR-001..FR-017 и каждый quickstart-сценарий Sc1–Sc15 маппится минимум на одну test-задачу (RED → GREEN). Тесты пишутся ДО реализации и подтверждаются как RED. 011/012/013 должны оставаться zero-regression на каждом шаге.

**Organization**: Задачи сгруппированы по фазам Setup / Tests (RED) / Core (GREEN) / Integration (quickstart) / Polish, чтобы каждый модуль реализовывался test-first, а весь quickstart-suite валидировался в конце.

## Format: `[ID] [P?] [P1/P2/P3] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[P1]/[P2]/[P3]**: Priority user story from spec.md (US-1..US-4 P1, US-5/6/8 P1, US-7 P2)
- Include exact file paths in descriptions.

## Design decisions locked in (plan/research; open questions resolved into behavior + tests)

- **Module split (plan Q1/Q3)**: runtime — `src/materialize/` = `dispatch.ts`, `select.ts`, `materialize.ts`, `serialize.ts`, `write.ts`, `context.ts`, `shape.ts`, `errors.ts`, `index.ts`; публичные контракты — `src/contracts/materialize.ts` (types + `MTL_*` константы, zero-dep), re-export через `src/contracts/index.ts`; runtime entry — `dispatch()` + `writeGeneratedTerraform()` через `src/materialize/index.ts` и `src/index.ts`.
- **Two-phase dispatch**: Phase 1 selection (collect-all: MTL_COLLISION + MTL_UNHANDLED_ARTIFACT для ВСЕХ artifacts; при любой selection error → `{ kind:'invalid' }`, `materialize` НЕ вызывается ни для одного — FR-017); Phase 2 materialize (sequential, deterministic order, abort-on-first → MTL_MATERIALIZE_FAILED, без partial resources). try/catch — ТОЛЬКО вокруг `materialize`, никогда вокруг `supports` (research 3).
- **Determinism**: JSON — рекурсивный sorted-key replacer (`JSON.stringify(value, replacer, 2)`, ключи лексикографически, вложенный `configuration` тоже); artifacts — deterministic order (см. A5); materializers — `registry.records` в insertion order (builders.yaml order, research 2.3).
- **Materializer identity для диагностик** = `PluginEntry.id`; tf address = возвращённый `TerraformResource.type` + `.name`; narrow `PluginEntry.module: unknown` → `Materializer` — shape guard в `src/materialize/shape.ts` (research 4).
- **`MaterializationContext` = spec 002 `{ output }`**, НЕ расширяется (research 8): env wiring → spec 021.
- **Serialization**: `<app_id>.ycsf.tf.json`, content `{"resource":{"<type>":{"<name>":<configuration>}}}`; outputs → `00-ycsf-outputs.tf.json` `{"output":{"<name>":{"value":"${...}"}}}` (обёртка `${...}` — обязанность C, research 5); outputs-файл генерируется ТОЛЬКО если есть declared outputs. Без version-маркера в `.tf.json` (research 9).
- **Validation**: type/name против Terraform identifier grammar `[a-zA-Z_][a-zA-Z0-9_]*` → `MTL_INVALID_TERRAFORM_ADDRESS` (serialize-time, обе части address); filename collision defensive → `MTL_FILENAME_COLLISION` (app_id уникален, проверка по construction); duplicate output name → `MTL_OUTPUT_NAME_COLLISION` (см. A4).
- **Regeneration (FR-015/016)**: `writeGeneratedTerraform(infraDir, files)` — единственный fs-touching модуль; mkdir -p; write/overwrite каждое `{filename, content}`; stale-sweep: `readdir` → фильтр glob `*.ycsf.tf.json` (включая `00-ycsf-outputs.tf.json`) → unlink только не-в-текущем-наборе; user `*.tf` никогда не читается/пишется/удаляется (research 6).
- **Fixture strategy (T002, решено)**: (а) inline plain-object materializers (quickstart Assumption „fixture materializers are inline plain objects") через фабрику с записью вызовов (spy: `supportsCalls`, `materializeCalls`) — для чистого dispatch и большинства интеграционных сценариев; (б) per-test mkdtemp-generated `.mjs` модули (переиспользуя `writeFixtureModule` из 013 helpers) для сценариев, которые идут через реальный `loadRegistry` (E2E T093); (в) минимальный набор committed static `.mjs` в `test/materialize/fixtures/` (зеркало 013 конвенции). **Отвергнуто**: static `.mjs` + process.env-переключатели — `process.env` глобален между параллельными тестами, создаёт перекрёстное загрязнение и хрупкость; mkdtemp-подход герметичен и параллельно-безопасен (свой tmp dir на тест).

## Path Conventions

- **Monorepo package**: `packages/pilot/src/` — source, `packages/pilot/test/` — tests
- **Runtime materialize module** (Node builtins `node:fs/promises`, `node:path`; fs только в `write.ts`): `packages/pilot/src/materialize/`
- **Public type contracts**: `packages/pilot/src/contracts/materialize.ts`, re-export из `src/contracts/index.ts` (`@ycforge/pilot/contracts`; zero-runtime-dep)
- **Unit tests**: `packages/pilot/test/unit/` (`serialize.spec.ts`, `context.spec.ts`, `select.spec.ts`, `materialize.spec.ts`, `dispatch.spec.ts`, `write.spec.ts`)
- **Integration / quickstart**: `packages/pilot/test/materialize/quickstart.spec.ts` + `packages/pilot/test/materialize/fixtures/` (`.mjs`)
- **Fixture helper**: `packages/pilot/test/helpers/materialize-fixtures.ts`
- **Type tests**: `packages/pilot/test/types/materialize.test-d.ts` (`.test-d.ts`, витest typecheck)

⚠️ **No new runtime deps (confirmed)**: `node:fs/promises` и `node:path` — Node builtins; sorted-key replacer — свой ~10 строк; никаких новых npm-пакетов. `packages/pilot/package.json` и `packages/pilot/tsup.config.ts` остаются UNCHANGED. `src/contracts/` остаётся zero-runtime-dep (T101).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Базлайн 011/012/013, fixture helper для materializer-ов, scaffold `src/materialize/`, чтобы все последующие test/impl задачи имели конкретные файлы.

- [x] T001 Verify no new package wiring needed: подтвердить `packages/pilot/package.json` UNCHANGED (no new deps; `node:fs/promises`/`node:path` — builtins, sorted-key JSON replacer — без библиотек) и `packages/pilot/tsup.config.ts` по-прежнему эмитит `index` + `contracts/index` (entry 'contracts/index' → `src/contracts/index.ts` уже баралирует новый materialize.ts через `export *`). Прогнать `pnpm --filter @ycforge/pilot test` — baseline 011/012/013 green ДО изменений.
- [x] T002 [P] Create `packages/pilot/test/helpers/materialize-fixtures.ts` — fixture helper (T002): 1) `makeMaterializer(id, behavior)` — фабрика inline-материализатора `{ supports, materialize }` с записью вызовов (spy: `supportsCalls: ArtifactDescriptor[]`, `materializeCalls: MaterializationContext[]`, `.count`), behavior = `{ supports: (a) => boolean | string[] (supported types), materialize?: (a, ctx) => TerraformResource | throws }`; 2) `makeRegistry(entries: PluginEntry[]): PluginRegistry` — строит `records` Map в заданном insertion order (детерминизм), module = inline object; 3) канонические фикстуры по quickstart: `matNest()` (supports `nestjs-function`, возвращает `yandex_function`), `matDocker()` (supports `docker`, `yandex_container`), `matThrow()` (supports указанный type, materialize бросает `Error('plugin crashed')`), `matWithOutput()` (declare output `url`), `notAMaterializer()` (`{ foo }`); 4) `writeFixtureMaterializer(dir, name, { supportsSrc, materializeSrc })` — генерирует `.mjs` модуль в переданной директории (переиспользуя `writeFixtureModule` из `test/helpers/registry-fixtures.ts`) для сценариев через реальный `loadRegistry`; 5) canonical project helpers: `canonicalAppsYaml()` (apps `user_service`→`nestjs-function`, `analytics`→`docker`, `frontend`→`vite` depends_on `user_service`, `openapi`→`yandex-api-gateway` depends_on `user_service`) + `loadModel(project)` через `loadProjectModel`. Не трогает реальный `node_modules`/`builders.yaml`; герметично; параллельно-безопасно (каждый тест использует свой tmp dir / inline object).
- [x] T003 [P] Scaffold `packages/pilot/src/materialize/` — пустые stubs `dispatch.ts`, `select.ts`, `materialize.ts`, `serialize.ts`, `write.ts`, `context.ts`, `shape.ts`, `errors.ts`, `index.ts` (сигнатуры функций/типов per data-model.md), БЕЗ реализации логики (последующие test/impl задачи получают конкретные файлы). No imports from composer.

---

## Phase 2: Tests — unit (RED)

**Purpose**: Failing unit-тесты для каждого `src/materialize/` модуля, маппящие каждый AC / FR / edge на конкретный кейс. Все RED; GREEN — в Phase 3. Фикстуры — inline objects через `test/helpers/materialize-fixtures.ts` (T002), без fs в чистом пути dispatch.

### serialize.spec.ts — `.tf.json` content + address/filename validation (US-1, US-8, FR-007..FR-011, P1)

- [x] T010 [P] [P1] Unit test `serializeResource` (golden bytes): `TerraformResource({ kind:'resource', type:'yandex_function', name:'user_service', configuration:{ runtime:'nodejs20', name:'user_service', content:{ source:'dist/user_service.zip' } } })` → content ровно quickstart Sc1 golden (`{"resource":{"yandex_function":{"user_service":{...}}}}` c лексикографически отсортированными ключами ВНУТРИ configuration: `content` < `name` < `runtime`); структура валидна по `contracts/materialize.json` `#/definitions/terraformResourceFileSchema` (SC-004; terraform CLI не вызывается — caveat documented) — FR-007/009, US-1 AC1, quickstart Sc1 in `packages/pilot/test/unit/serialize.spec.ts`
- [x] T011 [P] [P1] Unit test address validation: `type: 'yandex-function'` (hyphen) и `name: '1bad'` (цифра в начале) → `MTL_INVALID_TERRAFORM_ADDRESS` с `type`/`name` и invalid char в diagnostic; filename guard: app_id с невалидным charset → тот же код (defensive, research 6) — FR-008/FR-011, spec Edge Case „invalid chars", quickstart Sc11 in `packages/pilot/test/unit/serialize.spec.ts`
- [x] T012 [P] [P1] Unit test filename: `<app_id>.ycsf.tf.json` для `app_id` (`user_service` → `user_service.ycsf.tf.json`) — FR-008; filename collision: синтетический дубликат (два файла с одинаковым filename) → `MTL_FILENAME_COLLISION` с обоими artifact ids — FR-010, quickstart Sc10 in `packages/pilot/test/unit/serialize.spec.ts`
- [x] T013 [P] [P1] Unit test determinism: тот же input → те же bytes при двух вызовах `serializeResource`; configuration subtree сортируется независимо от порядка вставки ключей объекта — FR-009, US-8 (serialization-level), SC-003 in `packages/pilot/test/unit/serialize.spec.ts`

### context.spec.ts — OutputBuilder + outputs serialization (FR-012, FR-013, P1)

- [x] T014 [P] [P1] Unit test outputs channel: 1) `serializeOutputs({ url: { value: 'function_url(user_service)', description: 'URL' } })` → golden quickstart Sc12 (`{"output":{"url":{"description":"URL","value":"${function_url(user_service)}"}}}` — value обёрнут в `${...}`, ключи отсортированы); 2) `OutputBuilder.declare('url', ...)` дважды (второй раз из другого artifact) → duplicate зафиксирован (`duplicateNames`) и сериализуется как `MTL_OUTPUT_NAME_COLLISION` с `outputName: 'url'` — FR-012/013, quickstart Sc12/Sc13 in `packages/pilot/test/unit/context.spec.ts`

### select.spec.ts — Phase 1 selection (US-2, US-3, US-7, FR-002..FR-004, FR-017, P1/P2)

- [x] T015 [P] [P1] Unit test `selectArtifacts`: 2 supporters (`m1`, `m2`, оба supports `true` для `nestjs-function`) → `MTL_COLLISION` diagnostic: artifact type, ОБА materializer ids в registry insertion order; `materialize` НЕ вызван ни для одного artifact (spy `materializeCalls.length === 0`) — US-2 AC1/AC2, FR-003/017, quickstart Sc2 in `packages/pilot/test/unit/select.spec.ts`
- [x] T016 [P] [P1] Unit test `selectArtifacts`: 0 supporters (материализатор supports только `nestjs-function`, artifact type `docker`) → `MTL_UNHANDLED_ARTIFACT`: artifactId, artifact type, cписок registered materializer ids; error (не warning) — US-3 AC1, FR-004, quickstart Sc3 in `packages/pilot/test/unit/select.spec.ts`
- [x] T017 [P] [P1] Unit test `selectArtifacts` collect-all all-or-nothing: 1 app ok + 1 app unhandled → errors содержат ОБА selection errors (collect-all); результат invalid; `supports` вызван для ВСЕХ artifacts (это cheap pure predicate), `materialize` НЕ вызван НИ для одного (spy) — US-3 AC2 / US-2 AC2, FR-017, quickstart Sc2/Sc3 in `packages/pilot/test/unit/select.spec.ts`
- [x] T018 [P] [P2] Unit test `selectArtifacts` пустой registry: 0 materializers + app → `MTL_UNHANDLED_ARTIFACT` на каждом app с пустым списком registered ids; 0 apps → ok (пустые artifacts) — US-7 AC1/AC2, FR-004, quickstart Sc7/Sc8; edge: materializer `supports` бросает → dispatch НЕ try/catch'ит supports, **`dispatch(...)` REJECTS** с plugin error (A2 RESOLVED: throw; `await expect(dispatch(...)).rejects.toThrow(...)`) in `packages/pilot/test/unit/select.spec.ts`

### dispatch.spec.ts — runtime entry (US-1, US-4, US-8, FR-001, FR-005, FR-014, P1)

- [x] T019 [P] [P1] Unit test `dispatch(projectModel, registry)`: happy path 1 app `user_service` + 1 materializer `yandex-function` → `{ kind:'ok' }`, `resources.length === 1` (`name === 'user_service'`, `type === 'yandex_function'`), `generatedFiles.length === 1` (`filename === 'user_service.ycsf.tf.json'`, content содержит `"resource"`/`"yandex_function"`/`"user_service"`); Artifact descriptor FR-001: `id === name === 'user_service'`, `type === 'nestjs-function'` (из `App.builder`) — US-1 AC1, FR-001/002/005, quickstart Sc1 in `packages/pilot/test/unit/dispatch.spec.ts`
- [x] T020 [P] [P1] Unit test `dispatch` deterministic order: 3 apps `analytics` (no deps), `user_service` (depends_on `analytics`), `frontend` (depends_on `user_service`) → resources/generatedFiles порядок `analytics → user_service → frontend` (topological + alphabetical tie-break, A5) — US-4 AC1/AC2, FR-014, quickstart Sc4 in `packages/pilot/test/unit/dispatch.spec.ts`
- [x] T021 [P] [P1] Unit test `dispatch` determinism: два вызова с одинаковыми projectModel + registry → `generatedFiles` byte-identical (filename + content) — US-8 AC1, SC-003, FR-009, quickstart Sc9 in `packages/pilot/test/unit/dispatch.spec.ts`

### materialize.spec.ts — Phase 2 (US-6, FR-005, FR-006, P1)

- [x] T022 [P] [P1] Unit test materialize phase: materializer возвращает `TerraformResource` → ok resource; materializer бросает `Error('plugin crashed')` → `MTL_MATERIALIZE_FAILED` diagnostic (artifactId `user_service`, materializerId, message содержит `'plugin crashed'`), dispatch НЕ crash (результат invalid, не throw); abort-on-first: 2 apps, первый ok, второй throws → invalid, диагностика по второму, первый resource НЕ в результате (без partial resources), третий (если есть) НЕ материализуется — US-6 AC1/AC2, FR-005/006, quickstart Sc6 in `packages/pilot/test/unit/materialize.spec.ts`

### write.spec.ts — writeGeneratedTerraform (US-5, FR-015, FR-016, P1)

- [x] T023 [P] [P1] Unit test `writeGeneratedTerraform`: infra dir отсутствует → создаётся (recursive mkdir, Sc15); запись/перезапись ровно указанных `files`; user-owned `main.tf` (content `# user\nresource "yandex_vpc_network" "net" {}`) НЕ изменяется (содержимое побайтно совпадает после `writeGeneratedTerraform`) — US-5 AC1, FR-015, quickstart Sc14/Sc15 in `packages/pilot/test/unit/write.spec.ts` (использовать абсолютные mkdtemp-директории)
- [x] T024 [P] [P1] Unit test stale cleanup: в infra уже есть `user_service.ycsf.tf.json` (предыдущий dispatch) + `main.tf` + чужой `other.ycsf.tf.json`; текущий generated set — только `analytics.ycsf.tf.json` → `user_service.ycsf.tf.json` удалён (stale, FR-016), чужой `other.ycsf.tf.json` НЕ удалён (вне ownership? — нет: glob `*.ycsf.tf.json` владеет ВСЕМИ такими именами, поэтому `other.ycsf.tf.json` ТОЖЕ удаляется как stale; это осознанное следствие glob-конвенции ownership, research 6), `main.tf` untouched; `00-ycsf-outputs.tf.json` матчится glob владения — US-5 AC2, FR-016, quickstart Sc5 in `packages/pilot/test/unit/write.spec.ts`
- [x] T025 [P] [P1] Unit test path traversal guard: `{ filename: '../escape.ycsf.tf.json' }` и `{ filename: 'a/b.ycsf.tf.json' }` → файл НЕ создаётся вне infraDir, `writeGeneratedTerraform` **REJECTS** с Error (A3 RESOLVED: throw, I/O-конвенция); внутри infraDir записывается только то, что внутри — edge, FR-015 in `packages/pilot/test/unit/write.spec.ts`

### type-level (RED)

- [x] T026 [P] [P1] Type-test `packages/pilot/test/types/materialize.test-d.ts`: verify новые public contracts `ArtifactDescriptor`, `GeneratedTfFile`, `DispatchOptions` (`infraDir?: string`, reserved), `DispatchResult` (discriminated union ok/invalid per spec Dispatch API), `DispatchDiagnostic` (code/message + optional `artifactId`/`materializerIds`/`materializerId`/`type`/`name`/`outputName`/`filename`), `MTL_*` 6 констант (`MTL_COLLISION`, `MTL_UNHANDLED_ARTIFACT`, `MTL_MATERIALIZE_FAILED`, `MTL_FILENAME_COLLISION`, `MTL_INVALID_TERRAFORM_ADDRESS`, `MTL_OUTPUT_NAME_COLLISION`), сигнатуры `dispatch(projectModel, registry, options?)` и `writeGeneratedTerraform(infraDir, files)` — importable + type-usable из `src/contracts/index.js` и `src/index.js` (mirror `test/types/registry.test-d.ts`; `expectTypeOf` для discriminated union) — RED до Phase 3. ⚠️ Полный GREEN зависит от разрешения A1 (контрактный generic `Materializer<A extends Artifact>` vs `ArtifactDescriptor`) — тест не кодирует спорный generic, only публичные Dispatch-типы.

---

## Phase 3: Core — contracts + implementation (GREEN)

**Purpose**: Реализовать контракты и `src/materialize/` модули, чтобы Phase 2 тесты стали GREEN. `src/contracts/` — zero-runtime-dep; fs только в `write.ts`.

### Public type contracts

- [x] T050 Create `packages/pilot/src/contracts/materialize.ts` — NEW type-only + pure public contracts per data-model.md / `contracts/materialize.json`: `ArtifactDescriptor` (`{ id, name, type }`), `GeneratedTfFile` (`{ filename, content }`), `DispatchOptions` (`{ infraDir?: string }` — reserved, использует 021 wiring), `DispatchResult` = `DispatchResultOk` (`{ kind:'ok'; resources: readonly TerraformResource[]; generatedFiles: readonly GeneratedTfFile[] }`) | `DispatchResultInvalid` (`{ kind:'invalid'; errors: readonly DispatchDiagnostic[] }`), `DispatchDiagnostic` (`{ code, message }` + optional `artifactId`/`materializerIds`/`materializerId`/`type`/`name`/`outputName`/`filename`), и `MTL_*` string-константы (6 кодов, чистые, как `BRG_*`/`PML_*`); `DispatchDiagnostic.code: string` (паттерн, согласованный с `ProjectModelDiagnostic.code`). Зеркалу `contracts/materialize.json` `#/errorCodes`. **Плюс (A1 RESOLVED): widen generic в `packages/pilot/src/contracts/materializer.ts` — `interface Materializer<A extends Artifact = Artifact>` → `interface Materializer<A = Artifact>`** (дефолт прежний; существующий `fr-014-dispatch.test-d.ts` остаётся green; non-breaking аддитивное изменение контракта 002). — type-only/pure, никаких импортов fs/yaml
- [x] T051 [P] Re-export новых contracts из `packages/pilot/src/contracts/index.ts`: добавить `export * from './materialize.js'` (барелль `@ycforge/pilot/contracts`; stays zero-runtime-dep) — depends on T050

### Runtime module implementation (fs — только в `write.ts`)

- [x] T052 [P] Implement `packages/pilot/src/materialize/shape.ts` — shape guard `isMaterializerShape(module: unknown): module is Materializer<ArtifactDescriptor>`, сужающий `PluginEntry.module: unknown` до spec 002 контракта (research 4): `{ supports: fn, materialize: fn }`. A1 RESOLVED: generic widened to `Materializer<A = Artifact>` in `src/contracts/materializer.ts` (lands in T050) — no casts needed. — depends on T050 (типы), A1
- [x] T053 [P] Implement `packages/pilot/src/materialize/errors.ts` — `DispatchDiagnostic` factory: `mtl({ code, message, artifactId?, materializerIds?, materializerId?, type?, name?, outputName?, filename? })` → `DispatchDiagnostic` (точный объект, никаких лишних ключей — `additionalProperties: false` в JSON-каталоге); коды сравниваются через `MTL_*` константы, никогда string literal (Constitution V). — depends on T050
- [x] T054 [P] Implement `packages/pilot/src/materialize/serialize.ts` — 1) `serializeJson(value): string` — `JSON.stringify(value, sortedKeyReplacer, 2)`, рекурсивная сортировка ключей plain objects (research 5); 2) `serializeResource(resource: TerraformResource): string` — `{"resource":{"<type>":{"<name>":<configuration>}}}`; 3) `serializeOutputs(declared): string` — `{"output":{"<name>":{"value":"${<value>}", ["description"]}}}` (обёртка `${...}` — C; research 5); 4) `computeFilename(appId): string` — `<app_id>.ycsf.tf.json` с defensive charset-guard; 5) validation `type`/`name` против `[a-zA-Z_][a-zA-Z0-9_]*` → `MTL_INVALID_TERRAFORM_ADDRESS` (diagnostic: type, name, invalid char); 6) filename collision → `MTL_FILENAME_COLLISION` (Map-детекция, defensive FR-010). No fs. — depends on T010–T013, T050
- [x] T055 [P] Implement `packages/pilot/src/materialize/context.ts` — `createContext(): MaterializationContext` c `{ output: OutputBuilder }` (spec 002, НЕ расширяется; research 8) — Fresh OutputBuilder на dispatch call (одна общая коллекция outputs на весь dispatch; spec Assumption „transient per-dispatch-call"); `OutputBuilder.declare(name, { value, description? })`: первый declare принимается, повторный (то же имя) → фиксируется в `duplicateNames` (НЕ бросает; коллизия обнаруживается на serialize-step, A4); `value` — raw Terraform expression БЕЗ `${...}`. — depends on T014, T050
- [x] T056 [P] Implement `packages/pilot/src/materialize/select.ts` — Phase 1: 1) `deterministicOrder(projectModel)` — alphabetical pre-sort app_ids + топологический порядок по `depends_on_graph.adjacency` (research 2 / A5, матчит US-4); 2) `buildArtifactDescriptors(projectModel)` — каждый app → `{ id: app.app_id, name: app.app_id, type: app.builder }` (FR-001); 3) `selectArtifacts(projectModel, registry, context)` — для каждого artifact в deterministic order итерировать `registry.records` в insertion order, фильтр `kind === 'materializer'`, вызвать `supports(artifact, ctx)` последовательно (pure, без try/catch — research 3), подсчитать supporters: 0 → `MTL_UNHANDLED_ARTIFACT` (artifactId, type, registered materializer ids), 2+ → `MTL_COLLISION` (type, все ids), 1 → ok match (materializerId); collect-all selection errors (FR-017). — depends on T015–T018, T050, T055
- [x] T057 [P] Implement `packages/pilot/src/materialize/materialize.ts` — Phase 2: для artifacts в том же deterministic order вызвать `materializer.materialize(artifact, ctx)`; try/catch вокруг ВЫЗОВА materialize (не supports): throw/reject → `MTL_MATERIALIZE_FAILED` diagnostic (artifactId, materializerId, original message — prefix сохранён, US-6 „message содержит 'plugin crashed'"); abort-on-first: возвращает один diagnostic, последующие не вызываются, частичные результаты НЕ возвращаются (research 7). — depends on T022, T050, T055, T056
- [x] T058 Implement `packages/pilot/src/materialize/dispatch.ts` — `dispatch(projectModel: ProjectModel, registry: PluginRegistry, options?: DispatchOptions): Promise<DispatchResult>`: фаза 1 select (все-or-nothing: любая selection error → `{ kind:'invalid', errors: ВСЕ }`, materialize не вызывается); фаза 2 materialize (abort-on-first); serialize успешных resources в deterministic order (address validation + filename + golden content); A4: если `duplicateNames` (output collision) → `{ kind:'invalid', errors:[MTL_OUTPUT_NAME_COLLISION] }`; иначе `{ kind:'ok', resources, generatedFiles }` (per-app файлы в deterministic порядке + `00-ycsf-outputs.tf.json` ПОСЛЕДНИМ, если есть outputs). dispatch — БЕЗ fs (options.infraDir зарезервирован; I/O исполняет write). — depends on T019–T021, T054–T057
- [x] T059 [P] Implement `packages/pilot/src/materialize/write.ts` — `writeGeneratedTerraform(infraDir: string, files: readonly GeneratedTfFile[]): Promise<void>`: 1) `mkdir(infraDir, { recursive: true })`; 2) path traversal guard на каждый filename (A3 RESOLVED: `../`, абсолютный путь, `..`/`/`-сепараторы → **throw Error** I/O-конвенции; filename должен матчить `[A-Za-z0-9_-]+\.ycsf\.tf\.json`); 3) `writeFile(join(infraDir, filename), content, 'utf8')` для каждого файла; 4) stale-sweep: `readdir(infraDir)` → фильтр `*.ycsf.tf.json` (glob владения, включая `00-ycsf-outputs.tf.json`) → `unlink` те, что НЕ в текущем `files` наборе (cleanup ПОСЛЕ writes, research 6); user `*.tf` и прочие файлы не читаются/пишутся/удаляются (FR-015). ЕДИНСТВЕННЫЙ fs-touching модуль (`node:fs/promises`, `node:path`). — depends on T023–T025
- [x] T060 Implement `packages/pilot/src/materialize/index.ts` (barrel: `export { dispatch, writeGeneratedTerraform }` + types) и обновить `packages/pilot/src/index.ts`: `export { dispatch, writeGeneratedTerraform } from './materialize/index.js'` + type re-export `DispatchResult`, `GeneratedTfFile`, `ArtifactDescriptor`, `DispatchOptions` (рядом с `loadProjectModel`, `prepareBuildEnv`, `loadRegistry`) — зависит от T058/T059, T050–T051

---

## Phase 4: Integration — quickstart scenarios (RED → GREEN)

**Purpose**: Прогнать quickstart Sc1–Sc15 против реальных `loadProjectModel` (011) + `dispatch` + `writeGeneratedTerraform` в `packages/pilot/test/materialize/quickstart.spec.ts`. Тест пишется RED до Phase 3, GREEN после. Каждый сценарий — `it` block в одном файле, registry строится через `test/helpers/materialize-fixtures.ts` (inline; кроме E2E T093).

### Fixture setup

- [x] T080 [P1] Create `packages/pilot/test/materialize/fixtures/` со static committed `.mjs` materializer-фикстурами (зеркало 013): `materializer-nest.mjs` (supports `nestjs-function`, возвращает `yandex_function` c canned configuration — аналог quickstart matMockNest), `materializer-docker.mjs` (supports `docker`, `yandex_container`), `materializer-vite-throw.mjs` (supports `vite`, materialize бросает `Error('plugin crashed')`), `materializer-outputs.mjs` (supports `nestjs-function`, declares output `url` через `context.output.declare`), `not-a-materializer.mjs` (`export default { foo: () => {} }`). Committed (не gitignored), reviewable, используются как import-спецификаторы в E2E (T093). Конфигурируемое поведение per-test — через helper T002 (inline / mkdtemp-generated), не через process.env.

### Quickstart scenarios (RED)

- [x] T081 [P1] Integration test Sc1 (single app materialize): temp project `.ycsf/apps.yaml` с 1 app `user_service` (builder `nestjs-function`), registry с 1 materializer `yandex-function`; `loadProjectModel` + `dispatch` → `{ kind:'ok' }`, golden content (равно T010 golden; filename `user_service.ycsf.tf.json`) — US-1, FR-001/005/007/008/009, quickstart Sc1 in `packages/pilot/test/materialize/quickstart.spec.ts`
- [x] T082 [P1] Integration test Sc2 (MTL_COLLISION, no materialize): 1 app `user_service`, registry `m1`+`m2` (оба supports all) → `{ kind:'invalid' }`, единственный `MTL_COLLISION` (`materializerIds: ['m1','m2']` в registry order), оба `materialize` не вызваны (spy) — US-2, FR-003/017, quickstart Sc2
- [x] T083 [P1] Integration test Sc3 (MTL_UNHANDLED_ARTIFACT): app `analytics` (builder `docker`), registry `yandex-function` (supports только `nestjs-function`) → `{ kind:'invalid' }`, `MTL_UNHANDLED_ARTIFACT` (`materializerIds: ['yandex-function']`) — US-3, FR-004/017, quickstart Sc3
- [x] T084 [P1] Integration test Sc4 (dependency order): apps `analytics`/`user_service`/`frontend` с depends_on, registry 3 materializers → `resources`/`generatedFiles` порядок `analytics → user_service → frontend`, filenames `analytics.ycsf.tf.json`, `user_service.ycsf.tf.json`, `frontend.ycsf.tf.json` — US-4, FR-014, quickstart Sc4
- [x] T085 [P1] Integration test Sc5 (regeneration: stale removal + user .tf untouched): infra содержит `user_service.ycsf.tf.json` + `main.tf`; текущий проект — только `analytics`; `writeGeneratedTerraform` → `analytics.ycsf.tf.json` создан, `user_service.ycsf.tf.json` удалён, `main.tf` untouched (content preserved) — US-5, FR-015/016, quickstart Sc5
- [x] T086 [P1] Integration test Sc6 (MTL_MATERIALIZE_FAILED abort-on-first): apps `user_service`+`analytics`, registry `yandex-function` + `throw-materializer` (supports `docker`, бросает) → `analytics` первый (alphabetical, no deps) → бросает → `MTL_MATERIALIZE_FAILED` (`artifactId: 'analytics'`, `materializerId: 'throw-materializer'`, message содержит `'plugin crashed'`), `user_service` НЕ материализуется, `{ kind:'invalid' }` без resources — US-6, FR-006, quickstart Sc6
- [x] T087 [P2] Integration test Sc7+Sc8 (empty registry): registry 0 materializers + app `user_service` → `MTL_UNHANDLED_ARTIFACT` с пустым `materializerIds: []` (Sc7); registry 0 + 0 apps → `{ kind:'ok' }`, `resources.length === 0`, `generatedFiles.length === 0` (Sc8) — US-7, FR-004, quickstart Sc7/Sc8
- [x] T088 [P1] Integration test Sc9 (determinism byte-identical): тот же projectModel + registry, `dispatch` дважды → `JSON.stringify(r1.generatedFiles) === JSON.stringify(r2.generatedFiles)` — US-8, SC-003, FR-009, quickstart Sc9
- [x] T089 [P1] Integration test Sc10+Sc11 (defensive serialize checks): Sc10 — synthetic duplicate artifact ids → `MTL_FILENAME_COLLISION` (оба artifact ids); Sc11 — materializer возвращает `type: 'yandex-function'` или `name: '1bad'` → `MTL_INVALID_TERRAFORM_ADDRESS` с offending value — FR-010/011, quickstart Sc10/Sc11
- [x] T090 [P1] Integration test Sc12 (outputs file): materializer declares `context.output.declare('url', { value: 'function_url(user_service)', description: 'URL' })` → `generatedFiles` содержит `00-ycsf-outputs.tf.json` c golden content (равно T014) — FR-012, quickstart Sc12
- [x] T091 [P1] Integration test Sc13 (duplicate output name): 2 apps, оба materializers declare `url` → `{ kind:'invalid' }`, `MTL_OUTPUT_NAME_COLLISION` (`outputName: 'url'`) — FR-013, quickstart Sc13
- [x] T092 [P1] Integration test Sc14+Sc15 (write: user .tf never modified + mkdir): infra отсутствует → `writeGeneratedTerraform` создаёт директорию (Sc15), пишет `user_service.ycsf.tf.json`; затем поверх pre-existing `main.tf` → content не изменён (Sc14) — FR-015, Constitution IV, quickstart Sc14/Sc15
- [x] T093 [P1] E2E composition (wiring 013+011+014): temp project: `.ycsf/apps.yaml` (canonical, 2–3 apps) + `.ycsf/builders.yaml` c `materializers:` указывающим на mkdtemp-generated `.mjs` (T002 `writeFixtureMaterializer`) → `loadRegistry` (013) → `loadProjectModel` (011) → `dispatch` → `writeGeneratedTerraform` → golden files на диске, user `*.tf` untouched; доказывает композицию registry→model→dispatch→write end-to-end через РЕАЛЬНЫЕ PluginEntry из динамического import (research: PluginEntry.module — реальный module namespace, а не inline object)

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end pipeline surface, zero-regression 011/012/013, консистентность MTL_* каталога, детерминизм и покрытие FR/AC.

- [x] T100 [P1] Full suite green incl. 011/012/013 zero-regression: `pnpm --filter @ycforge/pilot test` — все `test/unit/*`, `test/registry/*`, `test/materialize/*`, `test/build-env/*`, `test/project-model/*` и type-only `test/types/*.test-d.ts` (incl. новый `materialize.test-d.ts`) через vitest typecheck; убедиться, что vitest конфиг (без изменений) подхватывает новые пути `test/materialize/*.spec.ts`
- [x] T101 [P1] `src/contracts/` zero-dependency invariant intact: `pnpm --filter @ycforge/pilot test -- --run test/unit/zero-dependency.test.ts` — импорт-граф contracts только relative modules; `src/contracts/materialize.ts` содержит НОЛЬ импортов Node/не-runtime (type-only + pure `MTL_*` константы); `fs` только в `src/materialize/write.ts`
- [x] T102 [P1] Typecheck: `pnpm --filter @ycforge/pilot typecheck` — исправить все TS errors (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` строгость на `DispatchDiagnostic` optional fields, discriminated union `DispatchResult`, `ReadonlyMap` iteration)
- [x] T103 [P1] tsup build: `pnpm --filter @ycforge/pilot build` — dist эмитит `index` + `contracts/index`, новый runtime + contracts включены (ESM + CJS + DTS); `packages/pilot/tsup.config.ts` UNCHANGED
- [x] T104 [P1] Determinism + constants consistency audit: (1) grep-verify в `src/materialize/` нет ни одного `JSON.stringify(value, null, 2)` / `JSON.stringify(value)` без sorted-key replacer (детерминизм cross-platform: лексикографический порядок ключей стабилен независимо от Node/OS, FR-009); (2) `MTL_*` 6 констант в `src/contracts/materialize.ts` совпадают byte-for-byte с `specs/014-materializer-dispatch/contracts/materialize.json` `#/errorCodes` (Constitution III/V); (3) `DispatchDiagnostic` fields соответствуют JSON-каталогу (additionalProperties: false)
- [x] T105 [P2] Perf smoke (SC-003): в `packages/pilot/test/materialize/quickstart.spec.ts` — inline registry 3 materializers × 20 apps → `dispatch` завершается < 2s (all in-memory, ms-scale; no I/O в чистом пути; формат `toBeLessThan(5000)` для CI-безопасности, как 013)
- [x] T106 [P1] Final consistency pass: подтвердить каждый FR-001..FR-017 → ≥1 тест, каждый US AC (US-1..US-8) → ≥1 тест, каждый quickstart Sc1–Sc15 → ≥1 сценарий Phase-4; SC-001..SC-008 покрыты (SC-004 — schema-conformance по `contracts/materialize.json`, terraform CLI вне scope); `specs/README.md` и `.specify/feature.json` обновляет main agent на PR (НЕ здесь)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 (baseline) → T002/T003 [P] (fixture helper + scaffold).
- **Tests (Phase 2)**: depends on T002 (fixtures). RED only. T010–T013 (serialize), T014 (context), T015–T018 (select), T019–T021 (dispatch), T022 (materialize), T023–T025 (write), T026 (types) — независимы друг от друга (разные `.spec.ts` файлы), кроме внутренних цепочек. T026 RED только частично зависит от A1.
- **Core (Phase 3)**: depends on Phase 2 tests (GREEN-им). Порядок: T050 (contracts) должен лечь ПЕРВЫМ (блокирует импорты всех runtime-модулей), T051 (barrel) следом; затем T052–T057 + T059 — параллельно (независимые модули после contracts), T058 (dispatch orchestration) зависит от T054–T057, T060 (export) зависит от T058/T059.
- **Integration (Phase 4)**: depends on Phase 3 (реальные `dispatch`/`writeGeneratedTerraform`). T080 (фикстуры) — первым; T081–T093 все [P] — один `quickstart.spec.ts`, разные `it` blocks.
- **Polish (Phase 5)**: depends on все фазы.

### Within Each Module

- Тесты (Phase 2 / Phase 4) должны падать ДО реализации (RED), затем GREEN (Constitution II).
- Baseline T001 валидируется полным suite green на каждом шаге — observable поведение 011/012/013 не меняется.

### Parallel Opportunities

- Setup: T002/T003 [P].
- Phase 2: все test-задачи [P] (разные `.spec.ts`).
- Phase 3: после T050/T051 — T052/T053/T054/T055/T056/T057/T059 параллельны; T058 зависит от них; T060 зависит от T058.
- Integration: T081–T093 [P] в одном файле, разные `it` блоки.

---

## Parallel Example: Phase 3 core modules

```bash
# После contracts (T050–T051) — запустить runtime-модули вместе:
Task: "Implement shape.ts (T052), errors.ts (T053), serialize.ts (T054), context.ts (T055), select.ts (T056), materialize.ts (T057), write.ts (T059)"
# затем оркестрация + export:
Task: "Implement dispatch.ts (T058) + materialize/index.ts + src/index.ts export (T060)"
```

---

## Implementation Strategy

### MVP First (US-1 + US-2 core path)

1. Phase 1 Setup — T001 baseline, T002 fixtures, T003 scaffold.
2. Phase 2 RED — serialize (T010–T013), select (T015–T017), type (T026).
3. Phase 3 GREEN — contracts (T050–T051) → serialize.ts (T054) + select.ts (T056) + errors.ts (T053).
4. **STOP and VALIDATE**: T010–T013 + T015–T017 + T026 проходят (serialization + selection без materialize).
5. **MVP reached**: `dispatch` возвращает correct-selection / invalid, serialization детерминирован; materialize-фаза ещё не полна.

### Incremental Delivery

1. Setup + 011/012/013 zero-regression (T001–T003) → foundation.
2. Public contracts + MTL_* (T050–T051).
3. Serialize + select + errors (T054, T056, T053) → selection-ready.
4. Context + materialize-фаза (T055, T057) → abort-on-first.
5. Dispatch orchestration (T058) + write (T059) + export (T060).
6. Integration Sc1–Sc15 + E2E (T080–T093) + Polish (T100–T106).

### Parallel Team Strategy

1. Setup вместе (T001–T003).
2. Developer A: contracts (T050–T051) + serialize (T054) + contexts (T055).
3. Developer B: select (T056) + materialize-фаза (T057) + их RED тесты (T015–T018, T022).
4. Developer C: shape (T052) + errors (T053) + write (T059) + их RED тесты (T023–T025).
5. Dispatch orchestration (T058) + интеграция + polish после land-а. Все PR в `dev`, ветка `014-materializer-dispatch`.

---

## Ambiguity Surface (surfaced during task decomposition; resolved before implementation)

**RESOLVED (user decisions, clarify 014):**

**A1 (RESOLVED — **WIDEN** generic).** User chose variant (a): widen contract 002 to `Materializer<A = Artifact>` (drop the `A extends Artifact` bound) in `packages/pilot/src/contracts/materializer.ts`. Default stays `Artifact`; existing plugins/test-d stay green; dispatch passes `ArtifactDescriptor` without casts. Effect: T052 (shape guard narrows `.module` to `Materializer<ArtifactDescriptor>`-compatible shape), T056/T057 (typed `supports(artifact: ArtifactDescriptor, ctx)`), T026 can assert dispatch-side types against `Materializer<ArtifactDescriptor>`. The widening edit lands with T050 (contracts phase).

**A2 (RESOLVED — **THROW**).** User chose variant (a): a throwing `supports` is NOT caught by dispatch — `dispatch(projectModel, registry, options?)` **rejects** with the plugin error (hard error, I/O/plugin-contract-violation convention like `BRG_MISSING_FILE`). T018 asserts `await expect(dispatch(...)).rejects.toThrow()` for the `supports`-throws edge. `MTL_*` catalog stays at exactly 6 codes; no `MTL_SUPPORTS_FAILED` added.

**A3 (RESOLVED — THROW, aligned with A2).** Path-traversal / invalid filename on `writeGeneratedTerraform(infraDir, files)` input → **throw** `Error` (I/O-layer convention; `MTL_INVALID_TERRAFORM_ADDRESS` remains on the serialize-side compute-time guard only). T025 asserts `rejects.toThrow()` + no file created outside `infraDir`. Not a silent drop (Constitution V).

**LOCKED defaults (flagged earlier; confirmed at analyze, no user ask needed):**

**A4 (LOCKED default, confirmed at analyze). Timing `MTL_OUTPUT_NAME_COLLISION`.** Spec говорит только „collision = error, никогда merge". data-model размещает детекцию duplicate output name на serialize-step ПОСЛЕ полной Phase 2 (все materializers отработали, затем invalid c единственным `MTL_OUTPUT_NAME_COLLISION`) — т.е. коллизия outputs НЕ является ни selection error (all-or-nothing), ни materialize-error (abort-on-first). Locked per data-model; T014/T058 encode it.

**A5 (LOCKED default, confirmed at analyze). Точность правила deterministic order.** research.md decision 2 формулирует два варианта: „stable sort keyed by app_id для равных позиций" и „sort app ids alphabetically, затем topologically order тот пре-отсортированный список". US-4 фиксирует один конкретный ожидаемый результат (`analytics → user_service → frontend`). Locked: alphabetical pre-sort app_ids + топологический порядок по `depends_on_graph.adjacency` (реализация `deterministicOrder(projectModel)`, T056) — совпадает с US-4; результат — НЕ массивы `topologicalOrder` из 011 как есть (его tie-продукт зависит от порядка файлов, а не алфавита), consumption идёт по `adjacency`. T020/T056 encode it.

**A6 (LOCKED default, confirmed at analyze). `DispatchOptions.infraDir` не используется чистым `dispatch`.** Spec API включает `infraDir?: string` (default 'infra'), но `dispatch` не имеет fs (write отделен). Поле объявлено в `DispatchOptions` как reserved (consume — зона 021 CLI), `dispatch` его не читает. T050/T058 encode it.

---

## Guard Checklist

Before starting implementation, confirm:

1. **Baseline 011/012/013 green** (`pnpm --filter @ycforge/pilot test` — все preexisting тесты, 0 failures) до изменений и после каждого шага.
2. **`packages/pilot/package.json` UNCHANGED** — no new runtime deps; `node:fs/promises`, `node:path` — builtins; sorted-key replacer — свой код, без библиотек.
3. **`packages/pilot/tsup.config.ts` UNCHANGED** — entry `index` + `contracts/index` уже баралируют новый materialize.ts через `export *`.
4. **`test/helpers/materialize-fixtures.ts` создан (T002)** — `makeMaterializer` (inline + spy), `makeRegistry`, canonical fixtures `matNest`/`matDocker`/`matThrow`/`matWithOutput`/`notAMaterializer`, `writeFixtureMaterializer` (mkdtemp), canonical project helpers. Механизм выбран: inline-объекты для чистого dispatch + mkdtemp-generated `.mjs` для loadRegistry-композиции; process.env-фикстуры ОТВЕРГНУТЫ.
5. **`test/materialize/fixtures/` static `.mjs` commитed (T080)** — committed, reviewable, НЕ gitignored; used по абсолютному пути.
6. **Vitest picks up new paths** — `test/unit/*.spec.ts`, `test/materialize/*.spec.ts`, `test/types/*.test-d.ts` (typecheck include уже `test/types/**/*.test-d.ts`; без правки конфига).
7. **CWD-independence** — ни один тест не зависит от `process.cwd()`; пути fixture абсолютные (`fileURLToPath(new URL(...))`), infra dir — абсолютные mkdtemp.
8. **tmp dirs cleanup** — каждый `createTempProject()`/`mkdtempSync` очищен в `afterEach`/`finally` (`removeTempProject`/`rmSync`), вкл. mkdtemp-generated `.mjs` из T002.
9. **`*.ycsf.tf.json` glob safety** — `write.ts` владеет только glob `*.ycsf.tf.json` (incl. `00-ycsf-outputs.tf.json`); тесты используют уникальные infra-dir; user `*.tf` никогда не пишется/не удаляется (assert content preserved).
10. **process.env isolation** — никакие фикстуры НЕ читают реальный `process.env` для семантики dispatch; если нужен env-стаб — только `vi.stubEnv` + `afterEach(vi.unstubAllEnvs)` (паттерн 012); предпочтительный путь — mkdtemp-generated модули без env.
11. **Constituent invariants** — `src/contracts/` zero-runtime-dep (T101), `materialize.ts` в contracts — type-only/pure; `MTL_*` сравниваются через константы, без string literals.
12. **No commits, no `specs/README.md` changes** — статус 014 🚧 обновляет main agent на PR time.

---

## Notes

- [P] tasks = different files, no dependencies.
- Тесты RED → GREEN (Constitution II): RED подтверждается запуском ДО реализации соответствующего модуля.
- `src/materialize/` использует ТОЛЬКО Node builtins (`node:fs/promises`, `node:path`); fs — только в `write.ts`; `dispatch` — pure+async, testable без filesystem.
- `MTL_*` — отдельная семья от `PML_*`/`BRG_*`; живут в `src/contracts/materialize.ts`, зеркало — `specs/014-materializer-dispatch/contracts/materialize.json` (T104).
- `MaterializationContext` — spec 002 `{ output }`, НЕ расширяется; env wiring → spec 021 (research 8).
- Outputs: обёртка `${...}` — обязанность C при сериализации (spec 002 comment); materializer объявляет raw expression.
- Do NOT commit; all checkboxes `- [x]` до закрытия задач в implement.