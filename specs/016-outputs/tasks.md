---
description: "Task list for outputs — .ycsf/outputs.yaml user outputs, ycsf_ prefix, IDL-resolution, buildOutputs/loadOutputs, OUT_* diagnostics, 99-ycsf-outputs.tf.json"
---

# Tasks: outputs — `.ycsf/outputs.yaml` (version: 1), IDL-resolution user outputs, auto-generated outputs (`ycsf_` prefix), merged `99-ycsf-outputs.tf.json`, OUT_* диагностики

**Input**: Design documents from `/specs/016-outputs/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/outputs.{ts,json}, quickstart.md

**Tests**: Test-first per constitution (II). Каждый acceptance criterion (AC по US-1..US-5), каждый FR-001..FR-020 и каждый quickstart-сценарий Sc1–Sc15 маппится минимум на одну test-задачу (RED → GREEN). Тесты пишутся ДО реализации и подтверждаются как RED. 011/012/013/014/015 должны оставаться zero-regression на каждом шаге (baseline 297 tests / 50 files на 2026-09-07).

**Organization**: Задачи сгруппированы по фазам Setup / Tests (RED) / Core (GREEN) / Integration (quickstart) / Migration-014 / Polish, зеркаля 013/014/015, чтобы каждый модуль `src/outputs/` реализовывался test-first, а весь quickstart-suite валидировался в конце.

## Format: `[ID] [P?] [P1/P2] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[P1]/[P2]**: Priority user story from spec.md (US-1..US-4 = P1; US-5 = P2)
- Include exact file paths in descriptions.

## Design decisions locked in (plan/research; open questions resolved into behavior + tests)

- **Module split (plan Q1, resolved)**: runtime — `src/outputs/` = `outputs-yaml.ts` (parseOutputsYaml, паттерн 015 `parseExtensionsYaml` — СВОЙ `parseDocument(text, { uniqueKeys: true })` с OUT_* кодами), `loader.ts` (loadOutputs — синхронный, паттерн `loadExtensions`; missing file → **throw** `Error('missing .ycsf/outputs.yaml (OUT_MISSING_FILE)')`), `resolver.ts` (DOMAIN_TO_TF_TYPE обратная side-table, выведенная из `IDL_DOMAIN_BY_TF_TYPE` 015 + `resolveIdlReference` pure, research 1), `build.ts` (двухфазный validate-first collect-all + детерминированная assembly через `serializeJson`), `errors.ts` (factory `OutsDiagnostic` + re-export `diag` для loader), `index.ts` (внутренний barrel). Публичные **type-only** контракты + `OUT_*` — в `src/contracts/outputs.ts` (zero-dep, research 4), re-export через `src/contracts/index.ts` → `@ycforge/pilot/contracts`; runtime API (`loadOutputs`, `buildOutputs`) через `src/index.ts`.
- **`DOMAIN_TO_TF_TYPE` derivation (plan Q2, resolved)**: в `src/outputs/resolver.ts`, генерируется из `IDL_DOMAIN_BY_TF_TYPE` (импорт из `src/extensions/idl.ts`) — единственный consumer; НЕ отдельный shared-модуль.
- **`serializeOutputs` removal scope (plan Q3, resolved — DEVIATION from plan default)**: удаляется ТОЛЬКО `serializeOutputs` из `src/materialize/serialize.ts` (dead code после миграции; 014 quickstart T090 переписывается). `outputCollisionDiagnostics` **ОСТАЁТСЯ**: он жив — `dispatch.ts` продолжает использовать его для `MTL_OUTPUT_NAME_COLLISION` (spec Assumption: materializer-level collision detection остаётся в 014; superseded только merged-file контекст). `OutputValue` (serialize.ts) остаётся (тип `OutputBuilder.declared`).
- **Diagnostic field population (plan Q4, resolved)**: `OutputsDiagnostic` держит `file`/`line`/`column` optional; заполняются ТОЛЬКО loader-ом для структурных `OUT_INVALID`/`OUT_VERSION` (паттерн 015 `ExtensionsDiagnostic`); build-фаза (pure transform) их не заполняет.
- **Export surface (plan Q5, resolved)**: `loadOutputs` + `buildOutputs` — публичный runtime API из `src/outputs/index.ts` и `src/index.ts` (композиция `loadOutputs`+`buildOutputs` — seam для `ycsf check` 020); `resolveIdlReference`, `parseOutputsYaml`, `DOMAIN_TO_TF_TYPE`, `out` — внутренние, unit-тестируемые через внутренний импорт `src/outputs/*.js`.
- **`buildOutputs(input)` — ровно 3 поля** (data-model): `outputsYaml` + `materializerOutputs: ReadonlyMap<string, OutputValue>` (прямой passthrough из `OutputBuilder.declared`, research 10) + `resources` (для IDL-индекса через `createIdlIndex` 015).
- **Two-phase validate-first collect-all, all-or-nothing** (research 2/3): фаза 1 собирает `OUT_RESERVED_PREFIX` (user name c `ycsf_`) + `OUT_INVALID_VALUE` (грамматика value через `parseResourceReference` → перехват `ContractError`) + `OUT_UNRESOLVED_IDL` (домен не в `DOMAIN_TO_TF_TYPE` ИЛИ `domain.name` не в IDL-индексе; каждый c message = ссылка + `availableIdls` алфавитно) + `OUT_DUPLICATE_NAME` (user-user, user-auto, auto-auto) + `OUT_INVALID_AUTO_PREFIX` (auto name без `ycsf_`) — ВСЕ ошибки в одном вызове; любая → `{kind:'invalid', errors: ВСЕ}`; файл НЕ генерируется. Фаза 2 (assembly) — только при чистой валидации: resolved user + auto в единый `Record`, keys sorted лексикографически, `serializeJson({ output: merged })`, `filename: '99-ycsf-outputs.tf.json'`.
- **Пустые outputs** (FR-014/US2-AC3/US5-AC1): нет user И нет auto → `kind:'ok'`, content = `'{"output":{}}'` (стабильный пустой блок, не отсутствие файла).
- **`${...}` wrapping** (FR-011): user outputs — при резолве IDL (`${<tf_type>.<name>.<property>}`); auto-generated — при assembly (`${<raw_tf_expr>}`); в `.tf.json` value всегда в `${...}`. `value` user output, уже содержащий `${` → `OUT_INVALID_VALUE` (это не IDL-ссылка; FR-016; `parseResourceReference` отклонит).
- **Description omit** (FR-013, Assumption): `undefined` → ключ не записывается; `""` → записывается как `""`. `serializeJson` (014) уже это делает через conditional spread; НЕ добавлять key c `undefined`.
- **Loader** (FR-002/003/004): `loadOutputs` — синхронный (`existsSync`/`readFileSync`); файла нет → **throw** `Error` c `OUT_MISSING_FILE`; structural-ошибки → `kind:'invalid'` c collect-all через переиспользуемый `diag()` (ProjectModelDiagnostic-совместимый shape); **IDL-грамматика value в loader НЕ проверяется** (зона `buildOutputs`, как 015 loader≠apply).
- **Migration 014 (SC-007, spec-vs-code divergence)**: `dispatch.ts` перестаёт генерировать `00-ycsf-outputs.tf.json` (строки 70–75 удаляются: `if (outputBuilder.declared.size > 0) {...}`); **строки 66–69 (`outputCollisionDiagnostics` → `MTL_OUTPUT_NAME_COLLISION`) ОСТАЮТСЯ** (materializer-level). Кто вызывает `loadOutputs`+`buildOutputs` — оркестратор 021 (вне scope; в 016 генерируется только сам `99-` через `buildOutputs`). Файл `99-ycsf-outputs.tf.json` попадает в C-owned lifecycle автоматически — regex `FILENAME_RE`/orphan-механизм `write.ts` уже покрывают `99-` (research 8; FR-020).
- **Defensive**: ресурс с типом вне `IDL_DOMAIN_BY_TF_TYPE` не адресуем и не ошибка сам по себе; IDL-ссылка на него (или на external resource) → `OUT_UNRESOLVED_IDL` (Constitution VI). Дубликат `ycsf_` между user и auto невозможен по construction (user c `ycsf_` заблокирован раньше) — edge-тест фиксирует приоритет: `OUT_RESERVED_PREFIX` при user-`ycsf_`, `OUT_INVALID_AUTO_PREFIX` при auto-без-`ycsf_`, `OUT_DUPLICATE_NAME` для прочего.
- **Zero-dep контракты (research 4)**: `src/contracts/outputs.ts` — type-only + 8 чистых `OUT_*` констант; каталожное зеркало — `specs/016-outputs/contracts/outputs.json` (уже committed; консистентность — T103).
- **Fixture materializers/`MaterializationContext`**: `outputsFixture`-паттерн как 014 (fixture materializer c `ctx.output.declare('ycsf_...', ...)`); 021-orchestration в тестах НЕ строится.

## Path Conventions

- **Monorepo package**: `packages/pilot/src/` — source, `packages/pilot/test/` — tests
- **Runtime outputs module** (`node:fs`/`node:path` ТОЛЬКО в `loader.ts`; build/resolver — чистые): `packages/pilot/src/outputs/`
- **Public type contracts**: `packages/pilot/src/contracts/outputs.ts`, re-export из `src/contracts/index.ts` (`@ycforge/pilot/contracts`; zero-runtime-dep), runtime export из `src/index.ts`
- **Unit tests**: `packages/pilot/test/unit/` (`outputs-yaml.spec.ts`, `outputs-resolver.spec.ts`, `outputs-build.spec.ts`, `outputs-loader.spec.ts`)
- **Integration / quickstart**: `packages/pilot/test/outputs/quickstart.spec.ts` (harness `test/outputs/`; committed `.mjs` fixtures НЕ нужны — buildOutputs чистый, loader через `mkdtemp` tmp projects,  как 015)
- **Fixture helper**: `packages/pilot/test/helpers/outputs-fixtures.ts`
- **Type tests**: `packages/pilot/test/types/outputs.test-d.ts` (`.test-d.ts`, vitest typecheck)

⚠️ **No new runtime deps (confirmed)**: `yaml` уже в `packages/pilot`; `node:fs`/`node:path` — Node builtins; resolver/build — plain TS. `packages/pilot/package.json` и `packages/pilot/tsup.config.ts` остаются UNCHANGED. `src/contracts/` остаётся zero-runtime-dep (T101). Baseline перед изменениями: 297 passed / 50 files (T001).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Базлайн 011–015, scaffold модульных путей `src/outputs/`, fixture helper — чтобы последующие test/impl задачи имели конкретные файлы. Проверка «paths»: план `src/outputs/{outputs-yaml,loader,resolver,build,errors,index}.ts` + `src/contracts/outputs.ts`.

- [ ] T001 Verify no new package wiring needed: подтвердить `packages/pilot/package.json` UNCHANGED (`yaml` уже dependency; `node:fs`/`node:path` — builtins; resolver/build — свой код) и `packages/pilot/tsup.config.ts` по-прежнему эмитит `index` + `contracts/index`. Прогнать `pnpm --filter @ycforge/pilot test` — baseline 011/012/013/014/015 green (297 passed / 50 files) ДО изменений.
- [ ] T002 [P] Scaffold `packages/pilot/src/outputs/` — пустые stubs `outputs-yaml.ts`, `loader.ts`, `resolver.ts`, `build.ts`, `errors.ts`, `index.ts` (сигнатуры функций/типов per data-model.md поверх контрактов `OutputsYaml`/`BuildOutputsInput`/`OutputsDiagnostic`), логика НЕ реализована (бросает `throw new Error('not implemented')` / возвращает заглушку) — последующие Phase-2 тесты импортируются и падают (RED); fs-импорт появляется ТОЛЬКО в `loader.ts`. Контракты `src/contracts/outputs.ts` в Setup НЕ создаются (land в Phase 3 по плану; RED-тесты до этого частично «Cannot find export» — прецедент 015/014). No imports from composer.
- [ ] T003 [P] Create `packages/pilot/test/helpers/outputs-fixtures.ts` — fixture helper (mind: reuse extensions-fixtures/materialize-fixtures pattern): 1) ресурсные фабрики `functionResource(name, configuration?)` → `TerraformResource{kind:'resource',type:'yandex_function',name,configuration}`, `gatewayResource(name, configuration?)` → `type:'yandex_api_gateway'`, `containerResource(name, configuration?)` → `type:'yandex_container'` (тип вне `IDL_DOMAIN_BY_TF_TYPE` — НЕ адресуем); 2) `canonicalResources()` — канонический набор quickstart: `yandex_function.user_service`, `yandex_function.analytics`, `yandex_api_gateway.openapi`, `yandex_container.frontend` (quickstart Sc-блок); 3) текстовые генераторы `.ycsf/outputs.yaml`: `outputsYamlText(outputsBlock)` — собирает `version: 1` + `outputs:` из переданных строк, плюс `canonicalOutputsYamlText()` (Sc1 файл: frontend_api_url/uservice ids) — для loader/quickstart тестов; 4) `writeOutputsYaml(project, yaml)` — пишет `.ycsf/outputs.yaml` в `TempProject` (переиспользуя `createTempProject` из `test/helpers/temp-project.ts`); 5) построение parsed `OutputsYaml`-объекта для build-тестов (plain const, без fs) — контракт `{version: 1, outputs: Record<string,{value, description?}>}`. Герметично, параллельно-безопасно, БЕЗ process.env, не трогает реальные `.ycsf/` файлы пользователя.

---

## Phase 2: Tests — unit (RED)

**Purpose**: Failing unit-тесты для каждого `src/outputs/` модуля и контрактов, маппящие каждый AC/FR/edge на решение. Все RED; GREEN — в Phase 3. Фикстуры — через `test/helpers/outputs-fixtures.ts` (T003), fs — только в loader-тестах (mkdtemp).

### outputs-yaml.spec.ts — parseOutputsYaml (US-1/US-3/US-5, FR-001/003/004, P1)

- [ ] T010 [P] [P1] Unit test parseOutputsYaml valid file: канонический `.ycsf/outputs.yaml` (Sc1) → `kind:'ok'`, `data.version === 1`, `data.outputs` — Record c `value`-строками и опциональным `description` — FR-001, US-1, quickstart Sc1 in `packages/pilot/test/unit/outputs-yaml.spec.ts`
- [ ] T011 [P] [P1] Unit test version gate: `version` отсутствует → `OUT_VERSION` c message /missing version/; `version: 2` → `OUT_VERSION` c /unsupported version '2'.*supported: 1/ — FR-003, US-3 AC4, quickstart Sc10 in `packages/pilot/test/unit/outputs-yaml.spec.ts`
- [ ] T012 [P] [P1] Unit test structural invalid (collect-all): top-level `foobar:` → `OUT_INVALID`; отсутствие `outputs` → `OUT_INVALID` (message упоминает 'outputs'); `outputs:` не mapping (scalar/list/null) → `OUT_INVALID`; имя output нарушает грамматику `[a-z][a-z0-9_]*` (`MyOutput`, `my-output`, `my.output`, пустая строка) → `OUT_INVALID`; несколько структурных ошибок сразу (нет `outputs` + bad value-тип) → `invalid` со ВСЕМИ errors (collect-all) — FR-004, quickstart Sc10 in `packages/pilot/test/unit/outputs-yaml.spec.ts`
- [ ] T013 [P] [P2] Unit test value/description типы + duplicate YAML keys: `value: 123` (не строка) → `OUT_INVALID`; `description: 123` → `OUT_INVALID`; duplicate YAML key в `outputs` (`{ a: {...}, a: {...} }`) → `OUT_INVALID` (parse-gate `uniqueKeys`), присутствуют `line`/`column` — FR-004, US-5, quickstart Sc10 (dup-key row) in `packages/pilot/test/unit/outputs-yaml.spec.ts`

### outputs-resolver.spec.ts — resolveIdlReference + DOMAIN_TO_TF_TYPE (US-1/US-3/US-5, FR-006/007/017, P1)

- [ ] T014 [P] [P1] Unit test DOMAIN_TO_TF_TYPE + резолв happy path: `DOMAIN_TO_TF_TYPE` из `src/outputs/resolver.ts` — обратная таблица `functions → yandex_function`, `gateways → yandex_api_gateway`, замороженная; `resolveIdlReference('gateways.openapi.domain', index)` → `'${yandex_api_gateway.openapi.domain}'`; `functions.user_service.id` → `'${yandex_function.user_service.id}'`; `index` из `createIdlIndex(canonicalResources())` (015) — резолюция уважает только адресуемые ресурсы — FR-006, US-1, quickstart Sc1 in `packages/pilot/test/unit/outputs-resolver.spec.ts`
- [ ] T015 [P] [P1] Unit test unresolved IDL → `OUT_UNRESOLVED_IDL`: domain не в `DOMAIN_TO_TF_TYPE` (`databases.postgres.id`) → код + message содержит `databases.postgres.id` и `availableIdls` алфавитно (`functions.analytics`, `functions.user_service`, `gateways.openapi` — по строке, НЕ входной порядок); грамматически валидный, но не-существующий `domain.name` в таблице, но не в индексе (`containers.user_service`) → тот же код; external reference `queues.events.qurl` → тот же код (не в индексе; Constitution VI) — FR-006/017, US-3 AC3, US-5 AC3, quickstart Sc8/Sc12 in `packages/pilot/test/unit/outputs-resolver.spec.ts`
- [ ] T016 [P] [P2] Unit test grammar violations → `OUT_INVALID_VALUE`: `Functions.User_Service.Id` (uppercase), `functions.user_service` (2 сегмента), `a.b.c.d` (4 сегмента), `func-ions.user_service.id` (дефис), `functions/user_service/id`, пустая строка → каждая → `OUT_INVALID_VALUE` (перехват `ContractError` от `parseResourceReference`, contract 002); `value: "${yandex_function.foo.id}"` (уже `${...}`) → `OUT_INVALID_VALUE` (не IDL-ссылка, FR-016) — FR-007/016, US-5 AC4, quickstart Sc9 in `packages/pilot/test/unit/outputs-resolver.spec.ts`

### outputs-build.spec.ts — buildOutputs (US-1..US-5, FR-005/008/009/010/011/012/013/014/015/016, P1)

- [ ] T017 [P] [P1] Unit test happy path (US1): `outputsYaml` c двумя outputs (`frontend_api_url`→`gateways.openapi.domain`, `user_service_function_id`→`functions.user_service.id`), пустой `materializerOutputs`, `resources` = canonical → `kind:'ok'`; `file.filename === '99-ycsf-outputs.tf.json'`; parsed content JSON: `"frontend_api_url": {"value": "${yandex_api_gateway.openapi.domain}", "description": "Public API endpoint"}`; `"user_service_function_id": {"value": "${yandex_function.user_service.id}", ...}`; JSON keys лексикографически отсортированы (FR-012) — US-1 AC1/AC2, FR-006/010/011/012, quickstart Sc1 in `packages/pilot/test/unit/outputs-build.spec.ts`
- [ ] T018 [P] [P1] Unit test description omit + empty-string preserve: output без `description` → JSON-объект содержит только `"value"` (нет ключа `description` — FR-013, US-1 AC3, Sc2); `description: ""` → записывается как `""` (Assumption) — quickstart Sc2 in `packages/pilot/test/unit/outputs-build.spec.ts`
- [ ] T019 [P] [P1] Unit test merge user + auto outputs (US2): `materializerOutputs: Map { 'ycsf_function_user_service_id' => { value: 'yandex_function.user_service.id', description: 'serverless-tools generated: ...' } }`, `outputsYaml` c `frontend_api_url` → merged file содержит ОБА entries; `ycsf_function_user_service_id.value === "${yandex_function.user_service.id}"` (wrapped); `frontend_api_url.value === "${yandex_api_gateway.openapi.domain}"`; keys sorted — US-2 AC1, FR-008/010/011/012, quickstart Sc3 in `packages/pilot/test/unit/outputs-build.spec.ts`
- [ ] T020 [P] [P1] Unit test auto output без `ycsf_` префикса → `OUT_INVALID_AUTO_PREFIX`: `materializerOutputs: Map { 'function_user_service_id' => {...} }` → `kind:'invalid'`, `OUT_INVALID_AUTO_PREFIX` c `name` — US-2 AC2, FR-008, Constitution V, quickstart Sc4 in `packages/pilot/test/unit/outputs-build.spec.ts`
- [ ] T021 [P] [P1] Unit test empty outputs → stable `{ "output": {} }`: `outputs: {}` + пустой `materializerOutputs` → `kind:'ok'`; `file.content === '{"output":{}}'`; `filename === '99-ycsf-outputs.tf.json'` — US-2 AC3, US-5 AC1, FR-014, quickstart Sc5 in `packages/pilot/test/unit/outputs-build.spec.ts`
- [ ] T022 [P] [P1] Unit test duplicate user name → `OUT_DUPLICATE_NAME`: два outputs оба `name: 'api_url'` → `kind:'invalid'`, `OUT_DUPLICATE_NAME`; другие ошибки тоже собираются (collect-all) — US-3 AC1, FR-009/015, quickstart Sc6 in `packages/pilot/test/unit/outputs-build.spec.ts`
- [ ] T023 [P] [P1] Unit test reserved prefix → `OUT_RESERVED_PREFIX`: output name `ycsf_function_id` → `kind:'invalid'`, `OUT_RESERVED_PREFIX` c `name: 'ycsf_function_id'` (НЕ silent swap) — US-3 AC2, FR-005, Constitution V, quickstart Sc7 in `packages/pilot/test/unit/outputs-build.spec.ts`
- [ ] T024 [P] [P1] Unit test unresolved IDL → `OUT_UNRESOLVED_IDL`: value `databases.postgres.id` → `kind:'invalid'`; ровно один/все `OUT_UNRESOLVED_IDL`; message содержит `databases.postgres.id` и `availableIdls` алфавитно (`functions.analytics`, `functions.user_service`, `gateways.openapi`); второй валидный output НЕ применён (all-or-nothing) — US-3 AC3, FR-006/015, quickstart Sc8 in `packages/pilot/test/unit/outputs-build.spec.ts`
- [ ] T025 [P] [P2] Unit test invalid grammar value → `OUT_INVALID_VALUE`: `Functions.User_Service.Id` → `kind:'invalid'`; `OUT_INVALID_VALUE`; auto-выходы ignore (all-or-nothing) — US-5 AC4, FR-007/016, quickstart Sc9 in `packages/pilot/test/unit/outputs-build.spec.ts`
- [ ] T026 [P] [P1] Unit test determinism: два вызова с идентичными `outputsYaml`+`materializerOutputs`+`resources` → `result1.file.content === result2.file.content` (byte-identical) — US-4 AC1, FR-012/019, SC-001, quickstart Sc13 in `packages/pilot/test/unit/outputs-build.spec.ts`
- [ ] T027 [P] [P1] Unit test mixed errors collect-all all-or-nothing: outputs c (a) duplicate name, (b) unresolved IDL, (c) invalid-grammar value → `kind:'invalid'`; errors содержит ВСЕ РАЗНЫЕ коды (`OUT_DUPLICATE_NAME`+`OUT_UNRESOLVED_IDL`+`OUT_INVALID_VALUE`), файл НЕ сериализован (нет ok-branch); вызов после фикса ошибок → `kind:'ok'` — US-3, FR-015/009, quickstart Sc14 in `packages/pilot/test/unit/outputs-build.spec.ts`
- [ ] T028 [P] [P1] Unit test приоритет / дубликат user-auto и immutable input: (a) auto без `ycsf_` + куча ошибок → `OUT_INVALID_AUTO_PREFIX` присутствует наравне с прочими (коды собираются вместе, порядок детерминирован); (b) входные `outputsYaml`/`materializerOutputs`/`resources` после `buildOutputs` не мутированы (JSON-снимок до/после) — FR-008/015, research 2, quickstart Sc4/Sc14 in `packages/pilot/test/unit/outputs-build.spec.ts`

### outputs-loader.spec.ts — loadOutputs (US-3/US-5, FR-002/004, P2)

- [ ] T029 [P] [P2] Unit test loader: (a) отсутствует `.ycsf/outputs.yaml` → **throw** `Error`, message матчит `/missing \.ycsf\/outputs\.yaml.*OUT_MISSING_FILE/` (FR-002, US-5 AC2, quickstart Sc11; CHANNEL: throw, не result — симметрично `loadExtensions`/`BRG_MISSING_FILE`); (b) валидный файл → `{kind:'ok', data: OutputsYaml}`; (c) структурно невалидный (`version: 2`, нет `outputs`, bad value-тип, dup-keys) → `{kind:'invalid'}` c diagnostics (file/line/column присутствуют для структурных) — collect-all; (d) IDL-грамматика value в loader НЕ проверяется (валидный load для `Functions.User_Service.Id`; зона `buildOutputs`) — FR-002/004, US-5 AC4, quickstart Sc9/Sc10/Sc11 in `packages/pilot/test/unit/outputs-loader.spec.ts` (mkdtemp tmp dirs + cleanup)

### type-level (RED)

- [ ] T030 [P] [P1] Type-test `packages/pilot/test/types/outputs.test-d.ts`: verify публичные contracts `OutputValue` (`{value: string, description?: string}`), `OutputsYaml` (`{version: 1, outputs: Record<string, {...}>}`), `OutputsDiagnostic` (code/message + optional `name`/`file`/`field`/`line`/`column`/`availableIdls`; location-поля optional — в build не заполняются), `OutputsLoadResult` = `{kind:'ok', data: OutputsYaml} | {kind:'invalid', errors: readonly OutputsDiagnostic[]}` (loader НЕ переиспользует ProjectModelDiagnostic — у OutputsDiagnostic свой `name`, не `app`/`target`), `BuildOutputsInput` (`{outputsYaml, materializerOutputs: ReadonlyMap<string, OutputValue>, resources: readonly TerraformResource[]}`), `BuildOutputsResult` = `{kind:'ok', file: GeneratedTfFile} | {kind:'invalid', errors: readonly OutputsDiagnostic[]}` (дискриминированные union-ы per data-model); `OUT_*` 8 констант literal-типа (`OUT_MISSING_FILE`, `OUT_VERSION`, `OUT_INVALID`, `OUT_RESERVED_PREFIX`, `OUT_INVALID_VALUE`, `OUT_UNRESOLVED_IDL`, `OUT_DUPLICATE_NAME`, `OUT_INVALID_AUTO_PREFIX` как `'OUT_...'`, Constitution V); сигнатуры `loadOutputs(rootDir: string)` (синхронная) и `buildOutputs(input: BuildOutputsInput)` — importable+type-usable из `src/contracts/index.js` и `src/index.js` (mirror `test/types/materialize.test-d.ts`/`extensions.test-d.ts`; `expectTypeOf` для discriminated union) — RED до Phase 3 (контракты приходят в T050).

---

## Phase 3: Core — contracts + implementation (GREEN)

**Purpose**: Реализовать контракты и `src/outputs/` модули, чтобы Phase-2 тесты стали GREEN. `src/contracts/` — zero-runtime-dep; fs — только в `loader.ts`.

### Public type contracts

- [ ] T050 Create `packages/pilot/src/contracts/outputs.ts` — NEW type-only + pure public contracts per data-model.md / `contracts/outputs.json`: `OUT_MISSING_FILE`, `OUT_VERSION`, `OUT_INVALID`, `OUT_RESERVED_PREFIX`, `OUT_INVALID_VALUE`, `OUT_UNRESOLVED_IDL`, `OUT_DUPLICATE_NAME`, `OUT_INVALID_AUTO_PREFIX` (8 `as const`, как `EXT_*`/`MTL_*`), `OutputValue` (`{readonly value: string; readonly description?: string}` — структурно идентична `OutputValue` из `src/materialize/serialize.ts`, дублирование type-only допустимо), `OutputsYaml` (`{readonly version: 1; readonly outputs: Readonly<Record<string, {readonly value: string; readonly description?: string}>>}`), `OutputsDiagnostic` (`{code, message}` + optional `name`/`file`/`field`/`line`/`column`/`availableIdls`), `OutputsLoadResult` (`{kind:'ok', data} | {kind:'invalid', errors: readonly OutputsDiagnostic[]}`), `BuildOutputsInput`, `BuildOutputsResult`; docs-комментарий со ссылкой на `specs/016-outputs/contracts/outputs.json` `#/errorCodes`. type-only/pure — никаких импортов fs/yaml (zero-dep) — depends on T030 (RED shape)
- [ ] T051 [P] Re-export новых contracts из `packages/pilot/src/contracts/index.ts`: добавить `export * from './outputs.js'` (барель `@ycforge/pilot/contracts`; stays zero-runtime-dep) — depends on T050

### Runtime module implementation (fs — только в `loader.ts`)

- [ ] T052 [P] Implement `packages/pilot/src/outputs/errors.ts` — factory `out(opts): OutputsDiagnostic` для build-фазы (`OUT_RESERVED_PREFIX`/`OUT_INVALID_VALUE`/`OUT_UNRESOLVED_IDL`/`OUT_DUPLICATE_NAME`/`OUT_INVALID_AUTO_PREFIX`; поля `name`/`availableIdls` заполняются по коду; file/line/column НЕ заполняются — чистый transform) + re-export `diag` из `src/model/errors.js` для loader-структурных диагностиков (единый shape, research 4); коды сравниваются через `OUT_*` константы, никогда string literal (Constitution V) — depends on T050
- [ ] T053 [P] Implement `packages/pilot/src/outputs/resolver.ts` — `DOMAIN_TO_TF_TYPE: Readonly<Record<string,string>>` — ОБРАТНАЯ таблица из `IDL_DOMAIN_BY_TF_TYPE` (импорт из `src/extensions/idl.js`; derive на module load, замороженная; research 1/plan Q2) + `resolveIdlReference(ref: string, index: IdlIndex): {id?: string} | {error: OutputsDiagnostic}`: `parseResourceReference(ref)` (contract 002) → `try/catch ContractError` → `OUT_INVALID_VALUE` (message с причиной); `domain = ref.domain`, `tfType = DOMAIN_TO_TF_TYPE[domain]` → нет → `OUT_UNRESOLVED_IDL` c ref + `index.availableIdls`; `index.byIdl.has('domain.name')` → нет → `OUT_UNRESOLVED_IDL`; ок → `${tfType}.${name}.${property}` — depends on T050, T014–T016
- [ ] T054 [P] Implement `packages/pilot/src/outputs/outputs-yaml.ts` — `parseOutputsYaml(text: string, file: string): {kind:'ok', data: OutputsYaml} | {kind:'invalid', errors: readonly OutputsDiagnostic[]}` (паттерн 015 `parseExtensionsYaml`, research 5): собственный `parseDocument(text, {uniqueKeys: true})` — YAML-синтаксис и DUPLICATE_KEY → `OUT_INVALID` (line из `error.linePos[0]` + `line + 1`, как 015); version short-circuit → `OUT_VERSION` (missing/unsupported); структурная валидация collect-all `OUT_INVALID` (FR-004): ровно 2 top-level ключа, `outputs` — mapping (scalar/list/null → invalid), имя output `[a-z][a-z0-9_]*`, `value` — string, `description` — string или absent; **IDL-грамматика value НЕ проверяется** (зона build); неизвестные ключи → `OUT_INVALID` (Constitution V) — depends on T010–T013, T050/T052
- [ ] T055 [P] Implement `packages/pilot/src/outputs/loader.ts` — `loadOutputs(rootDir: string): OutputsLoadResult` (синхронный, как `loadExtensions`): `readFileSync(join(rootDir,'.ycsf','outputs.yaml'),'utf8')` в `try/catch` → отсутствие → **throw** `Error('missing .ycsf/outputs.yaml (OUT_MISSING_FILE)')` (FR-002, паттерн EXT_MISSING_FILE/BRG_MISSING_FILE); `parseOutputsYaml(text, '.ycsf/outputs.yaml')` → `{kind:'ok', data} | {kind:'invalid', errors}` (OutputsDiagnostic c file/line/column). ЕДИНСТВЕННАЯ I/O-точка фичи — depends on T054, T029
- [ ] T056 Implement `packages/pilot/src/outputs/build.ts` — `buildOutputs(input: BuildOutputsInput): BuildOutputsResult`, ровно 3 поля (plan Q-Data/Data-патч resolved, research 6/10): **фаза 1 validate-first collect-all all-or-nothing** (research 2/3): пропустить user outputs в порядке файла: (1) имя начинается с `ycsf_` → `OUT_RESERVED_PREFIX`; (2) `resolveIdlReference` для каждого `value` → `OUT_INVALID_VALUE`/`OUT_UNRESOLVED_IDL` (collect-all; НЕ останавливаться на первой ошибке); (3) дубликаты user имён → `OUT_DUPLICATE_NAME`; auto-generated в порядке declaration (`materializerOutputs`): имя без `ycsf_` → `OUT_INVALID_AUTO_PREFIX`; дубликаты auto имён → `OUT_DUPLICATE_NAME`; user+auto дубликат → `OUT_DUPLICATE_NAME` (приоритет: user `ycsf_` уже отловлен раньше); `createIdlIndex(resources)` (015) — НЕ расширять 015, только вызывать (defensive duplicate IdlIndex НЕ обрабатывать — индекс строится из generated resources 014, инвариант); ЛЮБАЯ ошибка → `{kind:'invalid', errors: ВСЕ}` и **ни один output не сериализован**; **фаза 2 assembly** (только при чистой валидации): `Record<string, {value, description?}>` = resolved user (value уже `${...}`) + auto (value оборачивается в `` `\${${entry.value}}` ``; description omit по тому же правилу, что 014) → `serializeJson({ output: merged })` (014, sorted keys) → `{kind:'ok', file: {filename: '99-ycsf-outputs.tf.json', content}}`; пусто → `"{"output":{}}"` (FR-014). НЕТ fs (FR-018/SC-003) — depends on T053, T050, T017–T028
- [ ] T057 [P] Implement `packages/pilot/src/outputs/index.ts` (внутренний barrel: `export *` из `./errors.js`, `./resolver.js`, `./outputs-yaml.js`, `./build.js`, `./loader.js`) и обновить `packages/pilot/src/index.ts`: `export { loadOutputs, buildOutputs } from './outputs/index.js'` + type re-export `OutputsYaml`, `OutputsLoadResult`, `BuildOutputsInput`, `BuildOutputsResult`, `OutputsDiagnostic` из contracts (рядом с `loadExtensions`/`applyExtensions`/`dispatch`); `parseOutputsYaml`, `resolveIdlReference`, `DOMAIN_TO_TF_TYPE`, `out` — внутренние (plan Q5 resolved) — depends on T056, T055, T050–T051

### Migration-014: `00-` → `99-` (SC-007)

- [ ] T058 [P] Update `packages/pilot/src/materialize/dispatch.ts` — REMOVE строки 70–75 (генерацию `00-ycsf-outputs.tf.json`: `if (outputBuilder.declared.size > 0) { generatedFiles.push({...}) }`) и импорт `serializeOutputs` из `./serialize.js`; **ОСТАВИТЬ** строки 66–69 (`outputCollisionDiagnostics` → `MTL_OUTPUT_NAME_COLLISION`, materializer-level dup-detection — spec Assumption) и импорт `outputCollisionDiagnostics`. Dispatch больше НЕ эмитит output-файл; merged `99-` генерирует `buildOutputs` (вызов — оркестратор 021). Комментарий над блоком — обновить (ссылку FR-012 заменить пояснением: востребовано спецификацией 016, see spec §7 migration) — depends on T059 (убрать dead code)
- [ ] T059 [P] Update `packages/pilot/src/materialize/serialize.ts` — REMOVE `serializeOutputs` (dead code после T058; JSDoc 124–127 и реализацию 128–136 удалить целиком). **ОСТАВИТЬ**: `OutputValue` (тип `OutputBuilder.declared`, используется `context.ts` и contracts), `serializeJson` (используется build.ts), `outputCollisionDiagnostics` (используется dispatch.ts), `SORTED_KEY_REPLACER` (внутренний). Удалить неиспользуемый импорт `MTL_OUTPUT_NAME_COLLISION`? НЕТ — он используется `outputCollisionDiagnostics`. — depends on T058 (сначала dispatch перестаёт её импортировать)
- [ ] T060 [P] Update `packages/pilot/src/contracts/materialize.ts` — в JSDoc `GeneratedTfFile.filename` (строка 58) заменить `00-ycsf-outputs.tf.json` на `99-ycsf-outputs.tf.json` (обновить заводскую документацию; кодам/типам не трогаем — `MTL_OUTPUT_NAME_COLLISION` остаётся). — depends on T058

### Update affected 014 characterization tests (spec-vs-code divergence fix)

- [ ] T061 Update `packages/pilot/test/materialize/quickstart.spec.ts` — тест `T090 Sc12: declared outputs → 00-ycsf-outputs.tf.json, appended last (FR-012)` ПЕРЕПИСАТЬ в соответствии с миграцией: dispatch больше НЕ генерирует output-файл; ожидание `result.generatedFiles.map(f => f.filename)` → `['user_service.ycsf.tf.json']` (без `*-outputs.tf.json`); удалить проверку `GOLDEN_OUTPUTS_TF_JSON` как files[1]. Файл `GOLDEN_OUTPUTS_TF_JSON` константа удаляется/cтановится unused — если больше нигде не используется — удалить (проверить `rg GOLDEN_OUTPUTS_TF_JSON` в `test/materialize/quickstart.spec.ts`); текст `it(...)` переформулировать: «declared outputs не эмитятся в generatedFiles dispatch-а (merged 99- через buildOutputs, orchestration 021)». `MTL_OUTPUT_NAME_COLLISION` тест T091 ОСТАЁТСЯ без изменений (dispatch-level dup-detection жив) — SC-007, quickstart Sc15 in `packages/pilot/test/materialize/quickstart.spec.ts`
- [ ] T062 Update `packages/pilot/test/unit/context.spec.ts` — блок `describe('context.ts / serializeOutputs', ...)`: первый `it` (golden `serializeOutputs`) УДАЛИТЬ (функции больше нет); второй `it` (OutputBuilder first-wins + `outputCollisionDiagnostics` → MTL_OUTPUT_NAME_COLLISION) ОСТАВИТЬ без изменений (его поведение живо); импорт `serializeOutputs` из `../../src/materialize/serialize.js` убрать (оставить `outputCollisionDiagnostics`, `OutputValue`); header describe переименовать в `'context.ts / OutputBuilder + output collision (MTL_OUTPUT_NAME_COLLISION)'`. — depends on T059

---

## Phase 4: Integration — quickstart scenarios (RED → GREEN)

**Purpose**: Прогнать quickstart Sc1–Sc15 против реальных `loadOutputs`/`buildOutputs` (+ `serializeJson` 014 для байт-проверок) в `packages/pilot/test/outputs/quickstart.spec.ts`. Тест пишется RED до Phase 3, GREEN после. Каждый сценарий — `it` block в одном файле; фикстуры — `test/helpers/outputs-fixtures.ts` (T003); loader-сценарии — `mkdtemp` tmp projects.

### Quickstart scenarios (RED)

- [ ] T080 [P1] Integration test Sc1 (happy path, user outputs → expressions): canonical resources + canonical outputs.yaml (opня/скрипт) → `buildOutputs` → `kind:'ok'`; `file.filename === '99-ycsf-outputs.tf.json'`; parsed content: оба entries c `${...}`-value и description; `JSON.parse(file.content)` валиден; keys sorted (FR-012); входные объекты не мутированы (SC-003 immutability) — US-1, FR-006/010/011/012, quickstart Sc1 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T081 [P1] Integration test Sc2 (description omit + empty-string): output без `description` → JSON имеет только `"value"` (omit); `description: ""` → записывается как `""` — US-1 AC3, FR-013, quickstart Sc2 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T082 [P1] Integration test Sc3 (auto-generated merge): fixture materializer (inline, как 014) c `ctx.output.declare('ycsf_function_user_service_id', {value:'yandex_function.user_service.id', description:'serverless-tools generated: functions.user_service.id'})` → her `materializerOutputs` Map (из `OutputBuilder.declared`) + outputsYaml c `frontend_api_url` → merged file оба entries, оба wrapped, keys sorted — US-2 AC1, FR-008/010/011/012, quickstart Sc3 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T083 [P1] Integration test Sc4 (invalid auto prefix): `materializerOutputs: Map { 'function_user_service_id' => {...} }` → `OUT_INVALID_AUTO_PREFIX` — US-2 AC2, FR-008, quickstart Sc4 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T084 [P1] Integration test Sc5 (empty stable file): `outputs: {}` + пустой auto → `kind:'ok'`, `file.content === '{"output":{}}'` — US-2 AC3/US-5 AC1, FR-014, quickstart Sc5 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T085 [P1] Integration test Sc6 (duplicate user name): окрест — `OUT_DUPLICATE_NAME` collect-all — US-3 AC1, FR-009, quickstart Sc6 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T086 [P1] Integration test Sc7 (reserved prefix): `ycsf_function_id` → `OUT_RESERVED_PREFIX` — US-3 AC2, FR-005, quickstart Sc7 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T087 [P1] Integration test Sc8 (unresolved IDL + availableIdls): value `databases.postgres.id` → `OUT_UNRESOLVED_IDL`; message содержит target и availableIdls алфавитно (`functions.analytics`, `functions.user_service`, `gateways.openapi`); отдельный кейс: валидный домен, не-существующий `name` (`functions.user_servivce.id`) → тот же код — US-3 AC3, FR-006/017, quickstart Sc8 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T088 [P2] Integration test Sc9 (invalid grammar + `${...}` edge): `Functions.User_Service.Id` → `OUT_INVALID_VALUE`; `value: "${yandex_function.foo.id}"` → `OUT_INVALID_VALUE` (не IDL-ссылка; НЕ passthrough — FR-016) — US-5 AC4, FR-007/016, quickstart Sc9 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T089 [P2] Integration test Sc10 (`loadOutputs` ошибки версии/структуры): tmp project'ы c файлами из таблицы Sc10: `version: 2` → `invalid`, `OUT_VERSION`; `version: 1` без `outputs` → `OUT_INVALID`; `outputs: "not-a-mapping"` → `OUT_INVALID`; `value: 123` → `OUT_INVALID`; top-level `foobar:` → `OUT_INVALID`; несколько ошибок → ВСЕ в `errors` (collect-all); dup YAML key → `OUT_INVALID` (parse gate) — US-3 AC4, FR-003/004, quickstart Sc10 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T090 [P2] Integration test Sc11 (missing file throw): tmp project БЕЗ `.ycsf/outputs.yaml` → `loadOutputs(rootDir)` **throws** `Error` c `/OUT_MISSING_FILE/` — US-5 AC2, FR-002, quickstart Sc11 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T091 [P1] Integration test Sc12 (external resource → unresolved): value `queues.events.qurl` → `OUT_UNRESOLVED_IDL` (external не в IDL-индексе; Constitution VI) — US-5 AC3, FR-017, quickstart Sc12 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T092 [P1] Integration test Sc13 (детерминизм двух запусков): два вызова `buildOutputs` c идентичными входами → `result1.file.content === result2.file.content` (байт-в-байт); входы после обоих — прежние (immutability FR-018) — US-4, FR-012/019, SC-001, quickstart Sc13 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T093 [P1] Integration test Sc14 (mixed errors collect-all all-or-nothing): (a) duplicate name, (b) unresolved IDL, (c) invalid grammar → ВСЕ ТРИ в одном `errors`; нет ok-branch (all-or-nothing FR-015) — US-3, FR-009/015, quickstart Sc14 in `packages/pilot/test/outputs/quickstart.spec.ts`
- [ ] T094 [P1] Integration test Sc15 (dispatch migration `00-` удалён, `99-` генерируется; user `.tf` не тронут): (1) tmp project c user-owned `infra/custom.tf` (Yaml/разметка); `writeGeneratedTerraform(join(root,'infra'), [{filename:'custom.yaml.tf.json'...}])` не трогает `.tf`; (2) `dispatch` с fixture materializer c `output.declare(...)` → `generatedFiles` НЕ содержит `*-outputs.tf.json` (миграция); (3) прямой `buildOutputs` → `99-ycsf-outputs.tf.json` c пофиксированным из declare output; (4) orphan: `writeGeneratedTerraform` с набором БЕЗ `00-ycsf-outputs.tf.json`, в tmp лежит старый `00-ycsf-outputs.tf.json` → после записи `00-` удалён (размещенный механизм 014, SC-007) — US-5/FR-020/SC-007, Constitution IV, quickstart Sc15 in `packages/pilot/test/outputs/quickstart.spec.ts`

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Полный suite zero-regression 011–015, zero-dep инвариант контрактов, typecheck/build, консистентность OUT_*-каталога, детерминизм и покрытие FR/AC.

- [ ] T100 Full suite green incl. 011/012/013/014/015 zero-regression: `pnpm --filter @ycforge/pilot test` — все `test/unit/*`, `test/registry/*`, `test/materialize/*`, `test/extensions/*`, `test/outputs/*`, `test/build-env/*`, `test/project-model/*` и type-only `test/types/*.test-d.ts` (incl. новый `outputs.test-d.ts`) через vitest typecheck; baseline 297 (50 files) остаётся green и добавляются новые — vitest конфиг без изменений (typecheck include уже `test/types/**/*.test-d.ts`)
- [ ] T101 Zero-dependency invariant: `pnpm --filter @ycforge/pilot test -- --run test/unit/zero-dependency.test.ts` — импорт-граф `src/contracts/` (включая новый `outputs.ts`) только relative modules; `src/contracts/outputs.ts` содержит НОЛЬ импортов не-runtime (type-only + pure `OUT_*` константы); `fs`/`yaml` — только в `src/outputs/loader.ts` и `outputs-yaml.ts`, никогда в `src/contracts/` (research 4)
- [ ] T102 Typecheck + build: `pnpm --filter @ycforge/pilot typecheck` — исправить все TS errors (`exactOptionalPropertyTypes` на optional полях `OutputsDiagnostic`, discriminated unions, `ReadonlyMap` input); `pnpm --filter @ycforge/pilot build` — dist эмитит `index` + `contracts/index`, новый runtime + contracts включены (ESM + CJS + DTS); `packages/pilot/tsup.config.ts` UNCHANGED, `packages/pilot/package.json` UNCHANGED
- [ ] T103 Determinism cross-platform + OUT_* constants consistency audit: (1) grep-verify в `src/outputs/` и `src/contracts/outputs.ts` нет `JSON.stringify(value)` без sorted-key replacer / недетерминированных конструкций; build стабилен к порядку ключей входных объектов (SC-001, US-4); (2) статический guard: в `src/outputs/build.ts`/`resolver.ts` НЕТ `node:fs`/`node:path`/`node:fs/promises` импортов (CPU-only, FR-018/SC-003); (3) 8 `OUT_*` констант в `src/contracts/outputs.ts` совпадают byte-for-byte с `specs/016-outputs/contracts/outputs.json` `#/errorCodes`, `required` список соответствует; `OutputsYaml`/`OutputValue`/`OutputsDiagnostic`-поля соответствуют JSON-схеме (`additionalProperties: false`)
- [ ] T104 Perf smoke: в `packages/pilot/test/outputs/quickstart.spec.ts` — inline `buildOutputs` на ~20 resources × ~10 user outputs → завершается ms-scale (формат `toBeLessThan(5000)` для CI-безопасности, как 013/014/015) — SC-001 производительность, plan Performance Goals
- [ ] T105 Final FR/AC traceability pass: подтвердить каждый FR-001..FR-020 → ≥1 тест (FR-001 — T010/T080; FR-002 — throw OUT_MISSING_FILE T029/T090; FR-003 — OUT_VERSION T011/T089; FR-004 — OUT_INVALID collect-all T012/T013/T089; FR-005 — OUT_RESERVED_PREFIX T023/T086; FR-006 — IDL resolution + OUT_UNRESOLVED_IDL T014/T015/T017/T024/T087; FR-007 — OUT_INVALID_VALUE T016/T025/T088; FR-008 — OUT_INVALID_AUTO_PREFIX T020/T083; FR-009 — OUT_DUPLICATE_NAME T022/T028/T085/T093; FR-010 — 99-ycsf-outputs.tf.json T017/T021/T094; FR-011 — ${...} wrapping T017/T019/T080/T082; FR-012 — sorted keys T017/T026/T080; FR-013 — description omit T018/T081; FR-014 — {output:{}} T021/T084; FR-015 — collect-all all-or-nothing T027/T093; FR-016 — ${...} passthrough-reject T016/T088; FR-017 — createIdlIndex + external T015/T091; FR-018 — no user .tf I/O T080/T092/T094; FR-019 — deterministic order T026/T092; FR-020 — C-owned lifecycle T094); каждый US AC (US-1..US-5, 12 AC) → ≥1 тест; каждый quickstart Sc1–Sc15 → ≥1 сценарий Phase 4; SC-001..SC-009 покрыты (SC-007 — Sc15/T058–T062; SC-009 — 100% AC); `specs/README.md` и `.specify/feature.json` обновляет main agent на PR (НЕ здесь).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 (baseline) → T002/T003 [P] (scaffold + fixture helper). T003 используется ВСЕМИ RED-тестами.
- **Tests (Phase 2)**: depends on T002/T003. RED only (падает с RED по отсутствию реализации соответствующего модуля / контрактов). T010–T013 (outputs-yaml), T014–T016 (resolver), T017–T028 (build), T029 (loader), T030 (types) — независимы друг от друга (разные файлы). Все [P].
- **Core (Phase 3)**: depends on Phase-2 тесты (GREEN-им их). Порядок: T050 (contracts — блокирует импорты всех runtime-модулей), T051 (barrel) следом; затем T052–T055 — параллельно (независимые модули после contracts); T056 (build orchestration) зависит от T053/T050; T057 (index + `src/index.ts`) зависит от T056/T055. Migration-014: T058 (dispatch) → T059 (serialize dead-code, зависит от T058) → T060 (doc); T061/T062 (тесты 014) после T058/T059.
- **Integration (Phase 4)**: depends on Phase 3 (реальные `loadOutputs`/`buildOutputs`/`writeGeneratedTerraform`). T080–T094 [P] — один `quickstart.spec.ts`, разные `it` blocks.
- **Polish (Phase 5)**: depends on все фазы.

### Within Each Module

- Тесты (Phase 2/4) падают ДО реализации (RED), затем GREEN (Constitution II).
- Baseline T001 валидируется полным suite green на каждом шаге — observable поведение 011/012/013/014/015 не меняется (297/50), кроме санкционированных миграционных тестов 014 (T061/T062 — spec-vs-code divergence fix, SC-007).
- Migration-014 (T058–T062) выполняется в 016, НЕ в 021: `00-`/`serializeOutputs` — мёртвый код после этого spec (SC-007).

### Parallel Opportunities

- Setup: T002/T003 [P].
- Phase 2: все test-задачи [P] (разные `.spec.ts` / `.test-d.ts`).
- Phase 3: после T050/T051 — T052/T053/T054/T055 параллельны; T056 зависит от T053; T057 зависит от T056; T058/T060 параллельны; T059 зависит от T058; T061/T062 зависят от T058/T059.
- Integration: T080–T094 [P] в одном файле, разные `it` блоки (общий `let project`/`afterEach` cleanup).

---

## Parallel Example: Phase 3 core modules

```bash
# После contracts (T050–T051) — запустить независимые модули вместе:
Task: "Implement errors.ts (T052), resolver.ts (T053), outputs-yaml.ts (T054), loader.ts (T055)"
# затем оркестрация + экспорт:
Task: "Implement build.ts (T056), затем outputs/index.ts + src/index.ts export (T057)"
# затем миграция 014 (dispatch → serialize → doc → тесты):
Task: "dispatch.ts (T058) + materialize.ts doc (T060), затем serialize.ts (T059), затем тесты 014 (T061, T062)"
```

---

## Implementation Strategy

### MVP First (US-1 + US-2 core path)

1. Phase 1 Setup — T001 baseline, T002 scaffold, T003 fixtures.
2. Phase 2 RED — outputs-yaml (T010–T013), resolver (T014–T016), build (T017–T019 happy paths), types (T030).
3. Phase 3 GREEN — contracts (T050–T051) → resolver.ts (T053) + errors.ts (T052) → build.ts (T056).
4. **STOP and VALIDATE**: T017–T019 + T014 + T030 проходят (резолв + happy path без edge).
5. **MVP reached**: `buildOutputs` happy path (US-1 US-2) покрыт; loader/edge-фолбэки — следующий инкремент.

### Incremental Delivery

1. Setup + 011–015 zero-regression (T001–T003) → foundation.
2. Public contracts + OUT_* (T050–T051).
3. Resolver + errors + yaml + loader (T053, T052, T054, T055) → load/resolve-ready.
4. Build orchestration (T056) + export (T057).
5. Migration-014 (T058–T062) + Integration Sc1–Sc15 (T080–T094) + Polish (T100–T105).

### Parallel Team Strategy

1. Setup вместе (T001–T003).
2. Developer A: contracts (T050–T051) + outputs-yaml (T054) + loader (T055).
3. Developer B: resolver (T053) + build (T056) + сервис экспорт (T057).
4. Developer C: migration-014 (T058–T060) + тесты 014 (T061–T062).