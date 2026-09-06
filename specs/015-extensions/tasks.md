---
description: "Task list for extensions — .ycsf/extensions.yaml, IDL-адресация (side-table IDL_DOMAIN_BY_TF_TYPE), deep merge, EXT_* diagnostics"
---

# Tasks: extensions — `.ycsf/extensions.yaml` (version: 1), IDL-target resolution, deep merge, EXT_* диагностики

**Input**: Design documents from `/specs/015-extensions/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/extensions.json, quickstart.md

**Tests**: Test-first per constitution (II). Каждый acceptance criterion (17 AC по US-1..US-8), каждый FR-001..FR-015 и каждый quickstart-сценарий Sc1–Sc10 маппится минимум на одну test-задачу (RED → GREEN). Тесты пишутся ДО реализации и подтверждаются как RED. 011/012/013/014 должны оставаться zero-regression на каждом шаге (baseline 259 tests / 43 files).

**Organization**: Задачи сгруппированы по фазам Setup / Tests (RED) / Core (GREEN) / Integration (quickstart) / Polish, зеркаля 013/014, чтобы каждый модуль `src/extensions/` реализовывался test-first, а весь quickstart-suite валидировался в конце.

## Format: `[ID] [P?] [P1/P2/P3] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[P1]/[P2]/[P3]**: Priority user story from spec.md (US-1..US-6, US-8 = P1; US-7 = P2)
- Include exact file paths in descriptions.

## Design decisions locked in (plan/research; open questions resolved into behavior + tests)

- **Module split (plan Q1, resolved)**: runtime — `src/extensions/` = `extensions-yaml.ts` (parseExtensionsYaml, паттерн 013 `parseBuildersYaml`, СВОЙ `parseDocument(uniqueKeys: true)` с EXT_* кодами; `parseYaml` НЕ используется — он хардкодит PML_*, research 3), `loader.ts` (loadExtensions — синхронный, паттерн `loadProjectModel`/`loadRegistry`; missing file → **throw** `Error('missing .ycsf/extensions.yaml (EXT_MISSING_FILE)')`), `idl.ts` (hardcoded C-owned `IDL_DOMAIN_BY_TF_TYPE` + `IDL_SEGMENT_RE` + `createIdlIndex`/resolution helpers, research 1), `deep-merge.ts` (`isPlainObject` + `deepMerge` — pure, non-mutating, research 2), `apply.ts` (двухфазный validate-first collect-all + детерминированный apply), `errors.ts` (factory `ExtensionsDiagnostic` + re-export `diag` для loader), `index.ts` (внутренний barrel). Публичные **type-only** контракты + `EXT_*` — в `src/contracts/extensions.ts` (zero-dep, research 9), re-export через `src/contracts/index.ts` → `@ycforge/pilot/contracts`; runtime API (`loadExtensions`, `applyExtensions`, `deepMerge`) через `src/index.ts`.
- **`parseExtensionsYaml` export surface (plan Q1, resolved)**: внутренний (тесты импортируют `src/extensions/extensions-yaml.js` напрямую, как 013 `builders-yaml.ts`); НЕ в публичном API. Публично — только `loadExtensions`, `applyExtensions`, `deepMerge`.
- **`IDL_SEGMENT_RE` (plan Q2, resolved)**: локальная 2-сегментная грамматика `[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*` в `src/extensions/idl.ts`; общий предикат из `src/contracts/resource-reference.ts` НЕ переиспользуется (minimal-diff default).
- **`createIdlIndex`/resolution helpers (plan Q5, resolved)**: module-level экспорты из `idl.ts` — импортируются `apply.ts` и напрямую unit-тестами через внутренний путь; НЕ часть публичного API (для 020 проверка — сам `applyExtensions`).
- **`applyExtensions(resources, extensionsYaml)` — ровно 2 аргумента** (spec Dispatch API / data-model; параметра `options` НЕТ — разрешение target чистое, file/line/column неизвестны transform-у). Спек имеет `ApplyExtensionsResult` = `{kind:'ok', resources} | {kind:'invalid', errors}`; `deepMerge`/`applyExtensions` — чисто in-memory, без fs (FR-014/SC-003).
- **Two-phase validate-first collect-all, all-or-nothing** (research 5): validation-фаза строит IDL-индекс (только типы из side-table), собирает defensive duplicate-IDL (в момент построения индекса), `EXT_DUPLICATE_TARGET` (в порядке первого появления), `EXT_UNRESOLVED_TARGET` (в порядке файла, каждый с `availableIdls` алфавитно) + defensive configuration-не-object (в порядке файла). Любая ошибка → `{kind:'invalid', errors: ВСЕ}`; **ни один patch не применяется**. Apply-фаза — только при чистой валидации, правила в порядке файла, каждый target ровно один раз.
- **Deep merge per FR-008/§25.2 точно**: рекурсия iff `isPlainObject(base) && isPlainObject(patch)` (`typeof === 'object'`, не null, не массив, прототип `Object.prototype` или `null`); array/scalar/null из patch → **replace**; base не plain-object → **replace**; новые ключи добавляются; входы `readonly`, non-mutating, нетронутые поддеревья base переиспользуются по ссылке. Кода `EXT_MERGE_ERROR` **нет**.
- **Fail-fast (Constitution V)**: duplicate target → `EXT_DUPLICATE_TARGET` (не sequential merge); неизвестные top-level/rule-ключи → `EXT_INVALID` (research 7, не ignore); `patch` не plain-object → `EXT_INVALID` (research 8). Значения patch против provider schema НЕ валидируются (FR-015).
- **Version / collect-all**: version-проверка — паттерн 013 (short-circuit: один `EXT_VERSION`), структурные проверки — collect-all `EXT_INVALID` (FR-004 short list: syntax/dup-keys/форма/грамматика). Duplicate YAML-keys в любом mapping, включая вложенные в `patch`, ловятся parse-gate `uniqueKeys` → `EXT_INVALID` (line/column из `error.linePos[0]`, как 013 `line + 1`).
- **Loader**: синхронный (`existsSync`/`readFileSync`, как `loadProjectModel`); отсутствующий файл — **throw** `Error` c `EXT_MISSING_FILE` в message (FR-002, паттерн `BRG_MISSING_FILE`/011); structural-ошибки — `kind:'invalid'` с collect-all через переиспользуемый `diag()` (ProjectModelDiagnostic); **дубликаты target НЕ проверяются в loader** (FR-005 — зона `applyExtensions`).
- **`${...}` и `{{$ENV}}`** — passthrough байт-в-байт, без обработки/валидации (FR-010/011).
- **Defensive checks**: duplicate IDL в индексе → `EXT_INVALID` «duplicate IDL <idl> in generated model»; configuration таргетированного ресурса не plain-object → `EXT_INVALID`; ресурсы с типом вне таблицы — не адресуемы, не ошибка.
- **Zero-dep контракты (research 9)**: `src/contracts/extensions.ts` — type-only + 5 чистых `EXT_*` констант; каталожное зеркало — `specs/015-extensions/contracts/extensions.json` (уже committed; консистентность — T103).

## Path Conventions

- **Monorepo package**: `packages/pilot/src/` — source, `packages/pilot/test/` — tests
- **Runtime extensions module** (`node:fs`/`node:path` ТОЛЬКО в `loader.ts`; `apply`/`deep-merge`/`idl` — чистые): `packages/pilot/src/extensions/`
- **Public type contracts**: `packages/pilot/src/contracts/extensions.ts`, re-export из `src/contracts/index.ts` (`@ycforge/pilot/contracts`; zero-runtime-dep), runtime export из `src/index.ts`
- **Unit tests**: `packages/pilot/test/unit/` (`extensions-yaml.spec.ts`, `idl.spec.ts`, `deep-merge.spec.ts`, `apply.spec.ts`, `loader.spec.ts`)
- **Integration / quickstart**: `packages/pilot/test/extensions/quickstart.spec.ts` (harness `test/extensions/`; committed `.mjs` fixtures НЕ нужны — apply цепочка без плагинов, в отличие от 014)
- **Fixture helper**: `packages/pilot/test/helpers/extensions-fixtures.ts`
- **Type tests**: `packages/pilot/test/types/extensions.test-d.ts` (`.test-d.ts`, vitest typecheck)

⚠️ **No new runtime deps (confirmed)**: `yaml` уже в `packages/pilot` (используется только в `extensions-yaml.ts`/loader-цепочке); `node:fs`/`node:path` — Node builtins; deep merge — plain JS ~20 строк. `packages/pilot/package.json` и `packages/pilot/tsup.config.ts` остаются UNCHANGED. `src/contracts/` остаётся zero-runtime-dep (T101).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Базлайн 011–014, scaffold модульных путей `src/extensions/`, fixture helper — чтобы последующие test/impl задачи имели конкретные файлы. Проверка «paths»: план `src/extensions/{extensions-yaml,loader,idl,deep-merge,apply,errors,index}.ts` + `src/contracts/extensions.ts`.

- [x] T001 Verify no new package wiring needed: подтвердить `packages/pilot/package.json` UNCHANGED (`yaml` уже dependency; `node:fs`/`node:path` — builtins; deep merge — свой код, без библиотек) и `packages/pilot/tsup.config.ts` по-прежнему эмитит `index` + `contracts/index` (entry `contracts/index` → `src/contracts/index.ts` баралирует новый `extensions.ts` через `export *`). Прогнать `pnpm --filter @ycforge/pilot test` — baseline 011/012/013/014 green (259 passed / 43 files) ДО изменений.
- [x] T002 [P] Scaffold `packages/pilot/src/extensions/` — пустые stubs `extensions-yaml.ts`, `loader.ts`, `idl.ts`, `deep-merge.ts`, `apply.ts`, `errors.ts`, `index.ts` (сигнатуры функций/типов per data-model.md поверх контрактов `ExtensionRule`/`ExtensionsYaml`/`ApplyExtensionsResult`), логика НЕ реализована (бросает `throw new Error('not implemented')` / возвращает заглушку) — последующие Phase-2 тесты импортируются и падают (RED), src touching fs появляется только в `loader.ts`. Контракты `src/contracts/extensions.ts` в Setup НЕ создаются (land в Phase 3 по плану; RED-тесты до этого частично «Cannot find export» — прецедент 014). No imports from composer.
- [x] T003 [P] Create `packages/pilot/test/helpers/extensions-fixtures.ts` — fixture helper (mind: reuse materialize-fixture pattern): 1) ресурсные фабрики `functionResource(name, configuration?)` → `TerraformResource{kind:'resource',type:'yandex_function',name,configuration}`, `gatewayResource(name, configuration?)` → `type:'yandex_api_gateway'`, `containerResource(name, configuration?)` → `type:'yandex_container'` (тип вне `IDL_DOMAIN_BY_TF_TYPE` — НЕ адресуем); 2) `canonicalResources()` — канонический набор quickstart: `yandex_function.user_service` (`{name:'user-service',runtime:'nodejs18',entrypoint:'main.handler',environment:{NODE_ENV:'production'},execution_timeout:'5s'}`), `yandex_function.analytics` (`{...,environment:{NODE_ENV:'production'},tags:{env:'prod'}}`), `yandex_api_gateway.openapi` (`{name:'openapi',custom_domains:[{domain_id:'d1'}]}`), `yandex_container.frontend` (не адресуем); 3) текстовые генераторы `.ycsf/extensions.yaml`: `extensionsYaml(rulesText)` — собирает `version: 1` + `extensions:` из переданных строк правил, плюс `canonicalExtensionsYaml()` (Sc1 файл: env/timeout/service_account для `functions.user_service`) — для loader/quickstart тестов; 4) `writeExtensionsYaml(project, yaml)` — пишет `.ycsf/extensions.yaml` в `TempProject` (переиспользуя `createTempProject` из `test/helpers/temp-project.ts`); 5) шаблон построения parsed `ExtensionsYaml`-объекта для apply-тестов (plain const, без fs) — контракт `ExtensionRule{target, patch}`. Герметично, параллельно-безопасно, БЕЗ process.env, не трогает реальные `.ycsf/` файлы пользователя.

---

## Phase 2: Tests — unit (RED)

**Purpose**: Failing unit-тесты для каждого `src/extensions/` модуля и контрактов, маппящие каждый AC/FR/edge на решение. Все RED; GREEN — в Phase 3. Фикстуры — через `test/helpers/extensions-fixtures.ts` (T003), fs — только в loader-тестах (mkdtemp).

### extensions-yaml.spec.ts — parseExtensionsYaml (US-1, US-7, FR-001/003/004, P1/P2)

- [x] T010 [P] [P1] Unit test parseExtensionsYaml valid file: канонический `.ycsf/extensions.yaml` (Sc1) → `kind:'ok'`, `data.version === 1`, `data.extensions` — массив правил, каждый `{target: string, patch: Record<string, unknown>}` — FR-001, US-1, quickstart Sc1 in `packages/pilot/test/unit/extensions-yaml.spec.ts`
- [x] T011 [P] [P2] Unit test version gate: `version` отсутствует → `EXT_VERSION` c message /missing version/; `version: 2` → `EXT_VERSION` c /unsupported version '2'.*supported: 1/ — FR-003, US-7 AC1, quickstart Sc7 in `packages/pilot/test/unit/extensions-yaml.spec.ts`
- [x] T012 [P] [P2] Unit test unknown/структурные keys: top-level `foobar:` → `EXT_INVALID`; правило с ключом `weight` (`target`+`patch`+лишний) → `EXT_INVALID`; отсутствие `extensions` → `EXT_INVALID` (message упоминает 'extensions'); `extensions:` не список (mapping/скаляр) → `EXT_INVALID` — FR-004, research 7 (fail-fast, not ignore), quickstart Sc7/Sc10.4 in `packages/pilot/test/unit/extensions-yaml.spec.ts`
- [x] T013 [P] [P2] Unit test правило-форма + грамматика target + patch-тип: элемент extensions не mapping → `EXT_INVALID`; правило без `target`/без `patch` → `EXT_INVALID`; `target` не строка (число) → `EXT_INVALID`; IDL-грамматика: `functions`, `functions.user_service.extra`, `Functions.user_service`, `functions.user-service`, `functions/user_service`, пустой сегмент — все `EXT_INVALID`; `patch` не plain-object mapping: `"not-an-object"`, список, `null` → `EXT_INVALID` — FR-004, US-7 AC3, spec Edge Case (1/3+ сегментов, not-lowercase, дефис/слэш), quickstart Sc7 in `packages/pilot/test/unit/extensions-yaml.spec.ts`
- [x] T014 [P] [P2] Unit test duplicate YAML keys + collect-all: `patch: { environment: { A: 1, A: 2 } }` (duplicate внутри patch) → `EXT_INVALID` (parse-gate `uniqueKeys`), присутствуют `line`/`column`; duplicate на уровне правила или top-level → `EXT_INVALID`; сразу несколько структурных ошибок (не-список `extensions` + bad `patch`) → `invalid` со ВСЕМИ errors (`errors.length >= 2`, collect-all) — FR-004 (collect-all), quickstart Sc7 dup-keys row в `packages/pilot/test/unit/extensions-yaml.spec.ts`

### idl.spec.ts — side-table, грамматика, индекс (US-3, FR-004/006/007, P1)

- [x] T015 [P] [P1] Unit test IDL resolution из `src/extensions/idl.ts`: `IDL_DOMAIN_BY_TF_TYPE` содержит ровно `yandex_function → functions` и `yandex_api_gateway → gateways` (замороженный `Readonly<Record<string,string>>`); `createIdlIndex(canonicalResources())` → `idl(resource) === domain + '.' + resource.name` для адресуемых (`functions.user_service`, `functions.analytics`, `gateways.openapi`); `yandex_container.frontend` НЕ входит в индекс и НЕ в `availableIdls` (не ошибка сама по себе) — FR-006, quickstart Sc3/Sc10.3 in `packages/pilot/test/unit/idl.spec.ts`
- [x] T016 [P] [P1] Unit test IDL-грамматика (резолвер-уровень, defensive): 2-сегментная проверка из `IDL_SEGMENT_RE` — accept `functions.user_service`, `gateways.openapi`, `a_1.b_2`; reject `functions`, `functions.user_service.extra`, `Functions.user_service`, `functions.user-service`, пустые сегменты; грамматически валидный, но несуществующий домен (`containers.user_service`) — НЕ структурная ошибка (проходит грамматику) — FR-004 (grammar), spec Edge Case, quickstart Sc3 («несуществующий домен») in `packages/pilot/test/unit/idl.spec.ts`
- [x] T017 [P] [P1] Unit test `createIdlIndex` defensive + порядок: два ресурса `yandex_function.user_service` (нарушение инварианта 014) → duplicate-IDL зафиксирован (тест через `applyExtensions`: `EXT_INVALID`, message «duplicate IDL functions.user_service in generated model»); `availableIdls` отсортирован лексикографически (`['functions.analytics','functions.user_service','gateways.openapi']`), детерминирован вне зависимости от входного порядка ресурсов — FR-007 (порядок availableIdls), spec Edge Case, quickstart Sc10.1 in `packages/pilot/test/unit/idl.spec.ts`

### deep-merge.spec.ts — семантика §25.2 (US-1, US-2, US-8, FR-008, P1)

- [x] T018 [P] [P1] Unit test object+object recursive merge + новые ключи: base `{a:{b:{x:1,y:2}},c:3}` + patch `{a:{b:{y:9},d:4}}` → `{a:{b:{x:1,y:9},d:4},c:3}` (рекурсия только оба plain-object); ресурс без `tags` + patch `{tags:{main:'http'}}` → `configuration.tags === {main:'http'}` (новый top-level ключ добавлен) — FR-008, US-8 AC3, quickstart Sc8.3 in `packages/pilot/test/unit/deep-merge.spec.ts`
- [x] T019 [P] [P1] Unit test replace-семантика: array replace целиком, без append: `{a:{list:[1,2,3]}}` + `{a:{list:[4]}}` → `{a:{list:[4]}}` (nested; НЕ `[1,2,3,4]`); `custom_domains:[{domain_id:'d1'}]` + `custom_domains:[{domain_id:'${yandex_api_gateway_domain.main.id}'}]` → ровно 1 элемент = patch-массив (US-2 AC1); scalar override `{a:1}`+`{a:2}` → `{a:2}`; null replace `{a:'old'}`+`{a:null}` → `{a:null}`; base не plain-object → replace: `{a:null}` + `{a:{x:1}}` → `{a:{x:1}}`; отсутствующий ключ + patch-массив → ключ добавлен — FR-008/§25.2, US-2 AC1, quickstart Sc2/Sc9 in `packages/pilot/test/unit/deep-merge.spec.ts`
- [x] T020 [P] [P1] Unit test immutability + no-op: входные `base` и `patch` не мутируются (JSON-снимок до/после, `toEqual`); нетронутые поддеревья base переиспользуются по ссылке (`result.a.b === base.a.b`, когда patch не тронул `a.b`); `deepMerge(base, {})` → новый объект структурно равен base (no-op, US-8 AC1); `deepMerge` на не-object входах возвращает значение patch — FR-008 (non-mutating), US-6 immutability, quickstart Sc9 immutability-check in `packages/pilot/test/unit/deep-merge.spec.ts`

### apply.spec.ts — applyExtensions (US-1..US-6, US-8, FR-005/007/008/009/010/011/012/013, P1)

- [x] T021 [P] [P1] Unit test single-target patch (happy path): ресурс `yandex_function.user_service` c `configuration.environment.NODE_ENV === 'production'` и `execution_timeout === '5s'`; правила c patch `{environment:{CUSTOM_VAR:'value'}, execution_timeout:'30s', service_account_id:'${yandex_iam_service_account.custom.id}'}` → `kind:'ok'`; `result.resources[0]` — НОВЫЙ объект с теми же `kind:'resource'`, `type:'yandex_function'`, `name:'user_service'` (FR-012); `configuration.environment` содержит ОБЕ переменные; `execution_timeout === '30s'`; `service_account_id === '${yandex_iam_service_account.custom.id}'` байт-в-байт (FR-010) — US-1 AC1, FR-008/010/012, quickstart Sc1 in `packages/pilot/test/unit/apply.spec.ts`
- [x] T022 [P] [P1] Unit test multiple targets + порядок файла: два правила (`functions.user_service`, `gateways.openapi`) в порядке файла → оба ресурса патчатся, каждый свой `configuration`; `functions.analytics` и `yandex_container.frontend` (не адресуемый) НЕ тронуты и переиспользованы по ссылке (`result.resources[i] === inputResources[i]`); значение `{{$ENV}}` в patch проходит как литерал без обработки (FR-011); application в порядке файла (FR-009) — US-1/US-2, FR-009/011, quickstart Sc2/Sc5.2 in `packages/pilot/test/unit/apply.spec.ts`
- [x] T023 [P] [P1] Unit test duplicate target → `EXT_DUPLICATE_TARGET` + all-or-nothing: файл с двумя правилами `target:'functions.user_service'` (разные patch) + валидный третий target `gateways.openapi` → `kind:'invalid'`; errors содержит `EXT_DUPLICATE_TARGET` с target; `gateways.openapi` НЕ патчен (входные ресурсы deep-equal снимку «до» — all-or-nothing US-4 AC2); duplicate зафиксирован по первому появлению, и для него НЕ дублируется `EXT_UNRESOLVED_TARGET`/повторная диагностика — US-4 AC1/AC2, FR-005, Constitution V, quickstart Sc4 in `packages/pilot/test/unit/apply.spec.ts`
- [x] T024 [P] [P1] Unit test unresolved target → `EXT_UNRESOLVED_TARGET`: resources c IDL `functions.user_service`, `functions.analytics`, `gateways.openapi`; файл c target `functions.user_servivce` + валидный второй target `functions.user_service` → `kind:'invalid'`; ровно один `EXT_UNRESOLVED_TARGET`, message содержит target `functions.user_servivce` И `availableIdls` в алфавитном порядке `functions.analytics`, `functions.user_service`, `gateways.openapi` (по строке, НЕ входной порядок); второй валидный target НЕ применён (all-or-nothing US-3 AC2, FR-007); несколько неразрешённых target собираются в порядке файла (collect-all); грамматически валидный, но несуществующий домен (`containers.user_service`) → тот же `EXT_UNRESOLVED_TARGET`, не структурная ошибка — US-3 AC1/AC2, FR-007, quickstart Sc3 in `packages/pilot/test/unit/apply.spec.ts`
- [x] T025 [P] [P1] Unit test детерминизм + пустые входы: два вызова `applyExtensions` с одинаковыми `resources`+правила → `result.resources` глубоко равны (SC-001, US-6 AC1); `extensions: []` → `kind:'ok'`, ресурсы идентичны входным (identity transform, US-8 AC2, FR-013); правило с `patch: {}` → `kind:'ok'`, `configuration` структурно равна исходной (no-op US-8 AC1); ресурс с типом вне таблицы в ok-результате присутствует БЕЗ изменений — US-6/US-8, FR-009/013, quickstart Sc6/Sc8.1/8.2/10.3 in `packages/pilot/test/unit/apply.spec.ts`

### loader.spec.ts — loadExtensions (US-8, FR-002/004, P2)

- [x] T026 [P] [P2] Unit test loader: (a) отсутствует `.ycsf/extensions.yaml` → **throw** `Error`, message матчит `/missing \.ycsf\/extensions\.yaml.*EXT_MISSING_FILE/` (FR-002, US-8 AC4, quickstart Sc8.4; CHANNEL: throw, не result — симметрично `loadProjectModel`/`BRG_MISSING_FILE`); (b) валидный файл → `{kind:'ok', data}` (ExtensionsYaml); (c) структурно невалидный файл (версия / bad patch / dup-keys) → `{kind:'invalid'}` с переиспользуемыми `ProjectModelDiagnostic` (file/line/column) — collect-all; (d) файл с дубликатом target но иначе валидный → `load` проходит `kind:'ok'` (FR-005 boundary: дубликаты target НЕ проверяются в loader, это зона `applyExtensions`) — FR-002/004, quickstart Sc7/Sc8.4 in `packages/pilot/test/unit/loader.spec.ts` (mkdtemp tmp dirs + cleanup)

### type-level (RED)

- [x] T027 [P] [P1] Type-test `packages/pilot/test/types/extensions.test-d.ts`: verify публичные contracts `ExtensionRule` (`{target, patch}`), `ExtensionsYaml` (`{version: 1, extensions}`), `ExtensionsDiagnostic` (code/message + optional `target`/`file`/`field`/`line`/`column`/`availableIdls`; location-поля optional — в apply не заполняются), `ExtensionsLoadResult` = `{kind:'ok', data: ExtensionsYaml} | {kind:'invalid', errors: readonly ProjectModelDiagnostic[]}` (loader переиспользует 011 shape), `ApplyExtensionsResult` = `{kind:'ok', resources: readonly TerraformResource[]} | {kind:'invalid', errors: readonly ExtensionsDiagnostic[]}` (дискриминированные union-ы per data-model); `EXT_*` 5 констант literal-типа (`EXT_MISSING_FILE`, `EXT_VERSION`, `EXT_INVALID`, `EXT_UNRESOLVED_TARGET`, `EXT_DUPLICATE_TARGET` как `'EXT_...'`, Constitution V); сигнатуры `applyExtensions(resources: readonly TerraformResource[], extensions: ExtensionsYaml)` и синхронный `loadExtensions(rootDir: string)` — importable+type-usable из `src/contracts/index.js` и `src/index.js` (mirror `test/types/materialize.test-d.ts`; `expectTypeOf` для discriminated union) — RED до Phase 3 (контракты приходят в T050).

---

## Phase 3: Core — contracts + implementation (GREEN)

**Purpose**: Реализовать контракты и `src/extensions/` модули, чтобы Phase-2 тесты стали GREEN. `src/contracts/` — zero-runtime-dep; fs — только в `loader.ts`.

### Public type contracts

- [x] T050 Create `packages/pilot/src/contracts/extensions.ts` — NEW type-only + pure public contracts per data-model.md / `contracts/extensions.json`: `ExtensionRule` (`{readonly target: string; readonly patch: Record<string, unknown>}`), `ExtensionsYaml` (`{readonly version: 1; readonly extensions: readonly ExtensionRule[]}`), `ExtensionsDiagnostic` (`{code, message}` + optional `target`/`file`/`field`/`line`/`column`/`availableIdls` — location-поля optional по data-model; в apply не заполняются), `ExtensionsLoadResult` (`{kind:'ok', data} | {kind:'invalid', errors: readonly ProjectModelDiagnostic[]}`), `ApplyExtensionsResult` (`{kind:'ok', resources: readonly TerraformResource[]} | {kind:'invalid', errors: readonly ExtensionsDiagnostic[]}`), и 5 чистых `EXT_*` констант (`as const`, как `MTL_*` в `src/contracts/materialize.ts`); docs-комментарий со ссылкой на `specs/015-extensions/contracts/extensions.json` `#/errorCodes`. type-only/pure — никаких импортов fs/yaml (zero-dep). — depends on T027 (RED shape)
- [x] T051 [P] Re-export новых contracts из `packages/pilot/src/contracts/index.ts`: добавить `export * from './extensions.js'` (барель `@ycforge/pilot/contracts`; stays zero-runtime-dep) — depends on T050

### Runtime module implementation (fs — только в `loader.ts`)

- [x] T052 [P] Implement `packages/pilot/src/extensions/errors.ts` — factory `ext(opts): ExtensionsDiagnostic` для apply-фазы (`EXT_UNRESOLVED_TARGET`/`EXT_DUPLICATE_TARGET`/defensive `EXT_INVALID`; поля `target`/`availableIdls` заполняются по коду; file/line/column НЕ заполняются — чистый transform) + re-export `diag` из `src/model/errors.js` для loader-структурных диагностиков (единый shape, research 3/5); коды сравниваются через `EXT_*` константы, никогда string literal (Constitution V) — depends on T050
- [x] T053 [P] Implement `packages/pilot/src/extensions/idl.ts` — `IDL_DOMAIN_BY_TF_TYPE: Readonly<Record<string, string>>` (замороженная side-table `yandex_function → functions`, `yandex_api_gateway → gateways`; research 1), local `IDL_SEGMENT_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/` (plan Q2 resolved: локальная копия грамматики, без импорта из resource-reference), `createIdlIndex(resources: readonly TerraformResource[])` → `{byIdl: ReadonlyMap<string, TerraformResource>, availableIdls: readonly string[], duplicateIdls: readonly string[]}` (только ресурсы с типом из таблицы; `availableIdls` лексикографически отсортирован; duplicate-IDL зафиксирован defensive) + helper `idlFor(resource)` (`domain = IDL_DOMAIN_BY_TF_TYPE[type]`; undefined domain → НЕ адресуем) — depends on T015–T017, T050
- [x] T054 [P] Implement `packages/pilot/src/extensions/deep-merge.ts` — `isPlainObject(value): value is Record<string, unknown>` (`typeof === 'object'`, не null, не Array, proto `Object.prototype` или `null`; research 2) + `deepMerge(base: unknown, patch: unknown): unknown` — рекурсия iff оба plain-object; array/scalar/null из patch → replace; base не plain-object → replace; новые ключи добавляются; inputs `readonly`, non-mutating, общие поддеревья base переиспользуются по ссылке. ~20 строк, без библиотек; кода `EXT_MERGE_ERROR` нет — depends on T018–T020, T050
- [x] T055 [P] Implement `packages/pilot/src/extensions/extensions-yaml.ts` — `parseExtensionsYaml(text: string, file: string): ParseExtensionsYamlResult` (`{kind:'ok', data: ExtensionsYaml} | {kind:'invalid', errors: readonly ProjectModelDiagnostic[]}`): собственный `parseDocument(text, {uniqueKeys: true})` (паттерн 013 `parseBuildersYaml`, research 3) — YAML-синтаксис и DUPLICATE_KEY → `EXT_INVALID` (line из `error.linePos[0]` + `line + 1`, как 013); version short-circuit → `EXT_VERSION` (missing/unsupported); структурная валидация collect-all `EXT_INVALID` (FR-004): ровно 2 top-level ключа, `extensions` список, правило mapping ровно с `target`+`patch`, target — строка по `IDL_SEGMENT_RE`, patch — plain-object mapping (scalar/list/null → invalid); неизвестные ключи → `EXT_INVALID` (research 7); ДУБЛИКАТЫ target НЕ проверяются — depends on T010–T014, T050/T052/T053 (grammar RE из idl.ts)
- [x] T056 Implement `packages/pilot/src/extensions/apply.ts` — `applyExtensions(resources: readonly TerraformResource[], extensions: ExtensionsYaml): ApplyExtensionsResult`, ровно 2 аргумента (plan Q4/Data-патч resolved): **фаза 1 validate-first collect-all all-or-nothing** (research 5): `createIdlIndex(resources)`; defensive duplicate IDL → `EXT_INVALID` («duplicate IDL <idl> in generated model») + duplicate-IDL ресурсы исключены; duplicate targets (в порядке первого появления, `Set`; для них unresolved-проверка пропускается — не дублировать сообщение) → `EXT_DUPLICATE_TARGET`; unresolved targets (в порядке файла) → `EXT_UNRESOLVED_TARGET` c `target` + `availableIdls` (алфавитно) + defensive configuration-не-object таргетированного ресурса → `EXT_INVALID`; любая ошибка → `{kind:'invalid', errors: ВСЕ}` и **ни один patch не применён**; **фаза 2 apply** (только при чистой валидации): правила в порядке файла, каждый target ровно один раз, `deepMerge(resource.configuration, rule.patch)` → НОВЫЙ объект ресурса (kind/type/name сохранены — FR-012), нетаргетированные и не-адресуемые ресурсы переиспользуются по ссылке; результат — новый массив. НЕТ fs (FR-014/SC-003) — depends on T053, T054, T050
- [x] T057 [P] Implement `packages/pilot/src/extensions/loader.ts` — `loadExtensions(rootDir: string): ExtensionsLoadResult` (синхронный, как `loadProjectModel`): `existsSync(join(rootDir, '.ycsf', 'extensions.yaml'))` → отсутствует → **throw** `Error('missing .ycsf/extensions.yaml (EXT_MISSING_FILE)')` (FR-002, паттерн BRG_MISSING_FILE/011); `readFileSync` → `parseExtensionsYaml(text, '.ycsf/extensions.yaml')` → `{kind:'ok', data} | {kind:'invalid', errors}` (ProjectModelDiagnostic collect-all). ЕДИНСТВЕННАЯ I/O-точка фичи — depends on T055, T026
- [x] T058 Implement `packages/pilot/src/extensions/index.ts` (внутренний barrel: `export *` из `./errors.js`, `./idl.js`, `./deep-merge.js`, `./extensions-yaml.js`, `./apply.js`, `./loader.js`) и обновить `packages/pilot/src/index.ts`: `export { loadExtensions, applyExtensions, deepMerge } from './extensions/index.js'` + type re-export `ExtensionsYaml`, `ExtensionRule`, `ExtensionsLoadResult`, `ApplyExtensionsResult`, `ExtensionsDiagnostic` из contracts (рядом с `loadProjectModel`/`loadRegistry`/`dispatch`); `parseExtensionsYaml`, `createIdlIndex`, `IDL_DOMAIN_BY_TF_TYPE`, `deepMerge` — переэкспорт `deepMerge` ПУБЛИЧНО, остальные внутренние (plan Q1/Q5) — depends on T056, T057, T050–T051

---

## Phase 4: Integration — quickstart scenarios (RED → GREEN)

**Purpose**: Прогнать quickstart Sc1–Sc10 против реальных `applyExtensions`/`loadExtensions` (+ serializer 014 `serializeResource`/`serializeResourceFile` из `src/materialize/serialize.js` для байт-проверок) в `packages/pilot/test/extensions/quickstart.spec.ts`. Тест пишется RED до Phase 3, GREEN после. Каждый сценарий — `it` block в одном файле; фикстуры — `test/helpers/extensions-fixtures.ts` (T003); loader-сценарии — `mkdtemp` tmp projects.

### Quickstart scenarios (RED)

- [x] T080 [P1] Integration test Sc1 (env/timeout/service_account на `yandex_function.user_service`): canonical resources + канонический extensions.yaml → `applyExtensions` → `kind:'ok'`; у `user_service`: `environment` содержит `NODE_ENV` И `CUSTOM_VAR`, `execution_timeout === '30s'`, `service_account_id === '${yandex_iam_service_account.custom.id}'` байт-в-байт, `kind`/`type`/`name` не изменены (FR-012); патченный ресурс → `serializeResourceFile('user_service', patched)` → `.tf.json` c merged-конфигурацией, валиден как JSON, ключи отсортированы (FR-009/014 serializer reuse; US-1 AC2) — US-1, FR-008/010/012, quickstart Sc1 in `packages/pilot/test/extensions/quickstart.spec.ts`
- [x] T081 [P1] Integration test Sc2 (array replace `custom_domains`): ресурс `gateways.openapi` c `custom_domains:[{domain_id:'d1'}]`, patch `custom_domains:[{domain_id:'${yandex_api_gateway_domain.main.id}'}]` → результат `custom_domains.length === 1` и равен patch-массиву целиком (replace, НЕ `[{domain_id:'d1'}, ...]`); ТОТ ЖЕ ресурс, patch `{tags:{...}}` без `custom_domains` → `configuration.custom_domains` остаётся исходным массивом (нет «чистки по умолчанию», US-2 AC2) — US-2, FR-008, quickstart Sc2 in `packages/pilot/test/extensions/quickstart.spec.ts`
- [x] T082 [P1] Integration test Sc3 (опечатка target → `EXT_UNRESOLVED_TARGET` + all-or-nothing): входные ресурсы c IDL `functions.user_service`, `functions.analytics`, `gateways.openapi`; файл: target `functions.user_servivce` + валидный `functions.user_service` → `kind:'invalid'`; единственный `EXT_UNRESOLVED_TARGET`; message содержит target и `availableIdls` в алфавитном порядке (`functions.analytics`, `functions.user_service`, `gateways.openapi`); валидный второй target НЕ применён; отдельная проверка: `containers.user_service` → тот же код (несуществующий домен — resolution-level) — US-3, FR-007, quickstart Sc3 in `packages/pilot/test/extensions/quickstart.spec.ts`
- [x] T083 [P1] Integration test Sc4 (дубликат target → `EXT_DUPLICATE_TARGET` + all-or-nothing): файл: два правила `functions.user_service` + валидный `gateways.openapi` c `custom_domains: []` → `kind:'invalid'`; `EXT_DUPLICATE_TARGET` c target; `openapi` НЕ патчится (`custom_domains` НЕ заменяется); порядок ошибок: duplicates (по появлению) → unresolved (в порядке файла) — US-4, FR-005/009, quickstart Sc4 in `packages/pilot/test/extensions/quickstart.spec.ts`
- [x] T084 [P1] Integration test Sc5 (user `.tf` не тронут; нет I/O в `applyExtensions`): tmp project (`mkdtemp`) с user-owned `infra/custom.tf` (`yandex_iam_service_account.custom`, `yandex_function_iam_binding.users`) и `.ycsf/extensions.yaml`; вызов `applyExtensions(resources, extensions)` → результат определяется ТОЛЬКО ресурсами+файлом; `infra/custom.tf` и `.ycsf/extensions.yaml` остаются БАЙТ-в-БАЙТ прежними (только transform над памятью; за application нет fs-записи в apply-модуле — статически подтверждается в T103); passthrough: `service_account_id: '${yandex_iam_service_account.custom.id}'` и `{{$ENV}}`-литерал проходят как есть (FR-010/011) — US-5, FR-014/010/011, SC-003, Constitution IV, quickstart Sc5 in `packages/pilot/test/extensions/quickstart.spec.ts`
- [x] T085 [P1] Integration test Sc6 (детерминизм двух запусков): два вызова `applyExtensions` с идентичными `resources`+extensions → оба `result.resources` глубоко равны (структурно идентичные configuration); оба результата → `serializeResource` (014) → **байты `.tf.json` идентичны** (SC-001); входные `resources` после обоих вызовов — прежние (immutability FR-008) — US-6, FR-009, SC-001, quickstart Sc6 in `packages/pilot/test/extensions/quickstart.spec.ts`
- [x] T086 [P2] Integration test Sc7 (`loadExtensions` ошибки версии/структуры): tmp project'ы c файлами из таблицы Sc7: `version: 2` → `invalid`, errors содержит `EXT_VERSION`; `version: 1` без `extensions` → `invalid`, `EXT_INVALID` (missing 'extensions'); `patch: "not-an-object"` → `EXT_INVALID`; `target: "functions/user_service"` / `"Functions.user_service"` / `"functions"` / `"functions.user_service.extra"` → `EXT_INVALID` (грамматика); несколько структурных ошибок сразу (не-список `extensions` + bad `patch`) → `invalid`, ВСЕ errors собраны (collect-all); `patch: { environment: { A: 1, A: 2 } }` → `EXT_INVALID` (parse-gate uniqueKeys); top-level `foobar:` → `EXT_INVALID` — US-7, FR-003/004, quickstart Sc7 in `packages/pilot/test/extensions/quickstart.spec.ts`
- [x] T087 [P2] Integration test Sc8 (пустые patch/list, новые ключи, missing file): (1) rule c `patch: {}` → `ok`, configuration структурно равна исходной (no-op); (2) `extensions: []` → `ok`, ресурсы идентичны входным (identity); (3) ресурс без `tags` + patch `{tags:{main:'http'}}` → `ok`, `configuration.tags === {main:'http'}` (новый ключ); (4) проект БЕЗ `.ycsf/extensions.yaml` → `loadExtensions(rootDir)` **throws** `Error` c `EXT_MISSING_FILE` — US-8, FR-013/002, quickstart Sc8 in `packages/pilot/test/extensions/quickstart.spec.ts`
- [x] T088 [P1] Integration test Sc9 (крайние случаи deep merge): прямые вызовы `deepMerge` по таблице Sc9: `{a:{list:[1,2,3]}}+{a:{list:[4]}}` → `{a:{list:[4]}}`; `{a:null}+{a:{x:1}}` → `{a:{x:1}}`; `{a:'old'}+{a:null}` → `{a:null}`; ресурс без `custom_domains` + patch `{custom_domains:[...]}` → массив добавлен; `{a:1}+{}` → `{a:1}`; immutability-проверка: после каждого вызова `JSON.stringify(result)` ≠ мутация входа (входные `resources`/patch-объекты не изменены — до/после `toEqual`) — US-2/8, FR-008, §25.2, quickstart Sc9 in `packages/pilot/test/extensions/quickstart.spec.ts`
- [x] T089 [P1] Integration test Sc10 (defensive checks): (1) два ресурса `yandex_function.user_service` (из canonical + дубликат) → `invalid`, `EXT_INVALID` «duplicate IDL functions.user_service in generated model»; (2) таргетированный ресурс c конфигурацией-не-object (materializer-вернул не-mapping) при валидном target → `invalid`, `EXT_INVALID`; НЕ таргетированные ресурсы не проверяются (ресурс с не-object configuration, но не затронутый правилом, ok); (3) `yandex_container.frontend` в ok-результате присутствует без изменений; (4) правило с лишним ключом (`target`+`patch`+`weight:`) → `EXT_INVALID`; (5) `${bad syntax` в значении patch проходит как строка (passthrough, FR-010) — FR-004/008/010, spec Edge Cases, quickstart Sc10 in `packages/pilot/test/extensions/quickstart.spec.ts`

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Полный suite zero-regression 011–014, zero-dep инвариант контрактов, typecheck/build, консистентность EXT_*-каталога, детерминизм и покрытие FR/AC.

- [x] T100 Full suite green incl. 011/012/013/014 zero-regression: `pnpm --filter @ycforge/pilot test` — все `test/unit/*`, `test/registry/*`, `test/materialize/*`, `test/extensions/*`, `test/build-env/*`, `test/project-model/*` и type-only `test/types/*.test-d.ts` (incl. новый `extensions.test-d.ts`) через vitest typecheck; baseline 259 (43 files) остаётся green и добавляются новые — vitest конфиг без изменений (typecheck include уже `test/types/**/*.test-d.ts`)
- [x] T101 Zero-dependency invariant: `pnpm --filter @ycforge/pilot test -- --run test/unit/zero-dependency.test.ts` — импорт-граф `src/contracts/` (включая новый `extensions.ts`) только relative modules; `src/contracts/extensions.ts` содержит НОЛЬ импортов не-runtime (type-only + pure `EXT_*` константы); `fs`/`yaml` — только в `src/extensions/loader.ts` и `extensions-yaml.ts`, никогда в `src/contracts/` (research 9)
- [x] T102 Typecheck + build: `pnpm --filter @ycforge/pilot typecheck` — исправить все TS errors (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` на optional полях `ExtensionsDiagnostic`, discriminated unions, `ReadonlyMap`); `pnpm --filter @ycforge/pilot build` — dist эмитит `index` + `contracts/index`, новый runtime + contracts включены (ESM + CJS + DTS); `packages/pilot/tsup.config.ts` UNCHANGED, `packages/pilot/package.json` UNCHANGED
- [x] T103 Determinism cross-platform + EXT_* constants consistency audit: (1) grep-verify в `src/extensions/` и `src/contracts/extensions.ts` нет `JSON.stringify(value)` без sorted-key replacer / недетерминированных конструкций; apply/deep-merge стабильны к порядку ключей входных объектов (детерминизм SC-001, US-6); (2) статический guard: в `src/extensions/apply.ts`/`deep-merge.ts`/`idl.ts` НЕТ `node:fs`/`node:path`/`node:fs/promises` импортов (CPU-only, FR-014/SC-003 — применение не трогает файлы, за который отвечает 021 write-слой); (3) 5 `EXT_*` констант в `src/contracts/extensions.ts` совпадают byte-for-byte с `specs/015-extensions/contracts/extensions.json` `#/errorCodes`; `ExtensionsYaml`/`ExtensionRule`/`ExtensionsDiagnostic`-поля соответствуют JSON-схеме (`additionalProperties: false`); НЕ создавать копию каталога в `packages/pilot/contracts/` — конвенция репо: каталоги живут в `specs/NNN-*/contracts/` (см. Ambiguity 1)
- [x] T104 Perf smoke: в `packages/pilot/test/extensions/quickstart.spec.ts` — inline `applyExtensions` на ~20 ресурсов × ~10 правил (N rules, все in-memory) → завершается < 2s (ms-scale; формат `toBeLessThan(5000)` для CI-безопасности, как 013/014) — SC-001 производительность, plan Performance Goals
- [x] T105 Final FR/AC traceability pass: подтвердить каждый FR-001..FR-015 → ≥1 тест (FR-002 — `EXT_MISSING_FILE` throw channel T026/T087; FR-003 — `EXT_VERSION` T011/T086; FR-004 — `EXT_INVALID` collect-all T012–T014/T086; FR-005 — `EXT_DUPLICATE_TARGET` T023/T083; FR-006 — IDL-индекс T015; FR-007 — `EXT_UNRESOLVED_TARGET` + availableIdls T017/T024/T082; FR-008 — deep merge T018–T020/T088; FR-009 — порядок файла/детерминизм T022/T025/T085; FR-010 — `${...}` T021/T084/T089; FR-011 — `{{$ENV}}` T022/T084; FR-012 — kind/type/name T021/T080; FR-013 — no-op T025/T087; FR-014 — только generated/resources, user `.tf` untouched T084; FR-015 — patch против provider schema НЕ валидируется, только type-structure); каждый US AC (US-1..US-8, 17 AC) → ≥1 тест; каждый quickstart Sc1–Sc10 → ≥1 сценарий Phase 4; SC-001..SC-008 покрыты (SC-004 — replace-проверка, SC-005 — §25.2 точно, SC-007 — passthrough, SC-008 — 100% AC); `specs/README.md` и `.specify/feature.json` обновляет main agent на PR (НЕ здесь).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 (baseline) → T002/T003 [P] (scaffold + fixture helper). T003 используется ВСЕМИ RED-тестами.
- **Tests (Phase 2)**: depends on T002/T003. RED only (падает с RED по отсутствию реализации соответствующего модуля / контрактов). T010–T014 (extensions-yaml), T015–T017 (idl), T018–T020 (deep-merge), T021–T025 (apply), T026 (loader), T027 (types) — независимы друг от друга (разные файлы), кроме внутренних цепочек (T016 зависит от грамматики T016/T015 контекста). Все [P].
- **Core (Phase 3)**: depends on Phase-2 тесты (GREEN-им их). Порядок: T050 (contracts PE reference — блокирует импорты всех runtime-модулей), T051 (barrel) следом; затем T052–T055, T057 — параллельно (независимые модули после contracts); T056 (apply orchestration) зависит от T053/T054; T058 (index + `src/index.ts`) зависит от T056/T057.
- **Integration (Phase 4)**: depends on Phase 3 (реальные `applyExtensions`/`loadExtensions`/`deepMerge`). T080–T089 [P] — один `quickstart.spec.ts`, разные `it` blocks.
- **Polish (Phase 5)**: depends on все фазы.

### Within Each Module

- Тесты (Phase 2/4) падают ДО реализации (RED), затем GREEN (Constitution II).
- Baseline T001 валидируется полным suite green на каждом шаге — observable поведение 011/012/013/014 не меняется (259/43).

### Parallel Opportunities

- Setup: T002/T003 [P].
- Phase 2: все test-задачи [P] (разные `.spec.ts` / `.test-d.ts`).
- Phase 3: после T050/T051 — T052/T053/T054/T055/T057 параллельны; T056 зависит от T053/T054; T058 зависит от T056.
- Integration: T080–T089 [P] в одном файле, разные `it` блоки (общий `let project`/`afterEach` cleanup).

---

## Parallel Example: Phase 3 core modules

```bash
# После contracts (T050–T051) — запустить независимые модули вместе:
Task: "Implement errors.ts (T052), idl.ts (T053), deep-merge.ts (T054), extensions-yaml.ts (T055), loader.ts (T057)"
# затем оркестрация + экспорт:
Task: "Implement apply.ts (T056), затем extensions/index.ts + src/index.ts export (T058)"
```

---

## Implementation Strategy

### MVP First (US-1 + US-2 core path)

1. Phase 1 Setup — T001 baseline, T002 scaffold, T003 fixtures.
2. Phase 2 RED — extensions-yaml (T010–T014), deep-merge (T018–T020), idl (T015–T017), types (T027).
3. Phase 3 GREEN — contracts (T050–T051) → deep-merge.ts (T054) + idl.ts (T053) + errors.ts (T052).
4. **STOP and VALIDATE**: T018–T020 + T015–T017 + T027 проходят (deep merge + IDL-index без apply).
5. **MVP reached**: `applyExtensions` happy path (US-1 US-2) покрыт после T056; loader/quickstart — следующий инкремент.

### Incremental Delivery

1. Setup + 011/012/013/014 zero-regression (T001–T003) → foundation.
2. Public contracts + EXT_* (T050–T051).
3. Deep-merge + IDL + errors (T054, T053, T052) → merge/resolution-ready.
4. Apply orchestration (T056) + loader (T057) + export (T058).
5. Integration Sc1–Sc10 (T080–T089) + Polish (T100–T105).

### Parallel Team Strategy

1. Setup вместе (T001–T003).
2. Developer A: contracts (T050–T051) + extensions-yaml (T055) + loader (T057).
3. Developer B: deep-merge (T054) + apply (T056).
4. Developer C: idl (T053) + errors (T052) + RED-тесты соответствующих модулей.
5. Интеграция + polish после land-а. Все PR в `dev`, ветка `015-extensions`.

---

## Ambiguity Surface (surfaced during task decomposition; decisions locked as defaults where repo convention resolves them — VERBATIM, no silent decisions)

**A1 (locked default per repo convention; план непоследователен).** plan.md §Project Structure указывает `packages/pilot/contracts/extensions.json # NEW (repo-root catalog mirror — alongside specs/*/contracts per convention)`. Но фактическая конвенция репо (011/013/014): каталоги ошибок живут в `specs/NNN-*/contracts/*.json` (`specs/014-materializer-dispatch/contracts/materialize.json` и т.д.); каталога `packages/pilot/contracts/` не существует; `specs/015-extensions/contracts/extensions.json` уже committed. **Locked**: новый файл не создаётся; консистентность EXT_* проверяется против `specs/015-extensions/contracts/extensions.json` (T103).

**A2 (locked per 014 precedent).** RED-тесты Phase 2 импортируют контракты (`ExtensionRule`, `EXT_*`) из `src/contracts/index.js`, которые появятся только в T050 (Phase 3) — до этого часть тестов RED из-за «Cannot find export»/typecheck-ошибок, а не assert-провалов. Это повторяет прецедент 014 (`materialize.test-d.ts` T026 «RED до Phase 3»). **Locked**: scaffold (T002) создаёт только runtime-стабы `src/extensions/`, contracts в Setup не создаются.

**A3 (locked per 013 pattern).** FR-004 требует collect-all для структурных ошибок `EXT_INVALID`, но версия в 013 (`parseBuildersYaml`) short-circuits'ит: `parseExtensionsYaml` возвращает ЕДИНСТВЕННЫЙ `EXT_VERSION` при отсутствии/не-1 version (не собирая параллельные `EXT_INVALID`). quickstart Sc7 согласуется (строка `version: 2` → один `EXT_VERSION`; collect-all-строка — про структурные EXT_INVALID). **Locked**: version short-circuit (013), структура — collect-all.

**A4 (locked per spec/data-model; userPrompt упоминал `options?`).** Сигнатура `applyExtensions(resources: readonly TerraformResource[], extensions: ExtensionsYaml)` в spec Dispatch API и data-model — ровно 2 аргумента, параметра `options` НЕТ (чистый transform не знает файла; location-поля `ExtensionsDiagnostic` optional). **Locked**: 2-арг. Если 020 check захочет опции — аддитивно потом.

**A5 (locked per data-model flow).** Порядок ошибок при mixed-сценарии: defensive duplicate-IDL из индекс-построения эмитится ПЕРВЫМ (в момент построения индекса), затем `EXT_DUPLICATE_TARGET` (по появлению), затем в порядке файла — `EXT_UNRESOLVED_TARGET` и defensive configuration-не-object. spec Edge Case фиксирует только «duplicates сначала, unresolved потом»; относительная позиция defensive duplicate-IDL/configuration-не-object vs duplicates явно не специфицирована. **Locked** по data-model: индексированный defensive — до duplicates.

**A6 (locked per research 1/honesty).** `IDL_DOMAIN_BY_TF_TYPE` — замороженная константа в `src/extensions/idl.ts`; никакого registry-пути/конфига «зарегистрировать домен» в v1 (research 1); расширение — аддитивно будущими спеками (019). Ресурс с типом вне таблицы никогда не приводит к ошибке сам по себе.

**A7 (locked per spec Scope).** Дубликат target: loader НЕ проверяет (FR-005 boundary — зона `applyExtensions`; проверка — единая точка входа для 020 check). Loader проверяет только форму; `EXT_UNRESOLVED_TARGET`/`EXT_DUPLICATE_TARGET` никогда не появляются на load-фазе.

---

## Guard Checklist

Before starting implementation, confirm:

1. **Baseline 011/012/013/014 green** (`pnpm --filter @ycforge/pilot test` — 259 passed / 43 files, 0 failures) до изменений и после каждого шага.
2. **`packages/pilot/package.json` UNCHANGED** — no new runtime deps; `yaml` уже есть (только `extensions-yaml.ts`/loader-цепочка); `node:fs`/`node:path` — builtins; deep merge — свой код.
3. **`packages/pilot/tsup.config.ts` UNCHANGED** — entry `index` + `contracts/index` уже баралируют новый `extensions.ts`/`src/extensions/` через `export *`.
4. **`test/helpers/extensions-fixtures.ts` создан (T003)** — ресурсные фабрики (`functionResource`/`gatewayResource`/`containerResource`), `canonicalResources()`, `extensionsYaml()`-генераторы, `writeExtensionsYaml`; механизм: inline-объекты + mkdtemp tmp dirs; process.env-фикстуры ОТВЕРГНУТЫ.
5. **Vitest picks up new paths** — `test/unit/*.spec.ts`, `test/extensions/*.spec.ts`, `test/types/*.test-d.ts` (typecheck include уже `test/types/**/*.test-d.ts`; без правки конфига).
6. **CWD-independence** — ни один тест не зависит от `process.cwd()`; пути — абсолютные (`fileURLToPath`/`mkdtemp`), loader-тесты — mkdtemp tmp roots.
7. **tmp dirs cleanup** — каждый `mkdtempSync`/`createTempProject` очищен в `afterEach`/`finally` (`removeTempProject`/`rmSync`), вкл. loader/quickstart сценарии.
8. **`.ycsf/extensions.yaml` missing-file channel** — `loadExtensions` **бросает** `throw`-`Error` c `EXT_MISSING_FILE` (паттерн `loadProjectModel`/`BRG_MISSING_FILE`), НЕ возвращает result; тесты ассертят `toThrow(/.*EXT_MISSING_FILE/)`.
9. **CPU-only apply/merge/idl (FR-014/SC-003)** — `applyExtensions`/`deepMerge`/`IDL`-резолвер не имеют fs и не читают/пишут файлы; fs — только в `loader.ts`; статический guard (T103) + integration Sc5 (T084) доказывают user `.tf` untouched (байт-сравнение до/после).
10. **EXT_* constants cross-location** — 5 констант в `src/contracts/extensions.ts` byte-identical `specs/015-extensions/contracts/extensions.json` `#/errorCodes`; сравнение через константы, без string literals (Constitution V); каталог в `packages/pilot/contracts/` НЕ создаётся (A1).
11. **process isolation / детерминизм** — никакие фикстуры не читают `process.env` для семантики; два запуска `applyExtensions` с теми же входами дают deep-equal результаты и идентичные байты сериализации (US-6/SC-001).
12. **No commits, no `specs/README.md` changes** — статус 015 🚧 и `.specify/feature.json` обновляет main agent на PR time; `/speckit.tasks` пишет только `specs/015-extensions/tasks.md`.

---

## Notes

- [P] tasks = different files, no dependencies.
- Тесты RED → GREEN (Constitution II): RED подтверждается запуском ДО реализации соответствующего модуля; для контрактов RED частично «Cannot find export» до T050 (A2).
- `src/extensions/` использует ТОЛЬКО Node builtins (`node:fs`, `node:path`) в `loader.ts` и `yaml` в `extensions-yaml.ts`; `apply.ts`/`deep-merge.ts`/`idl.ts` — чистая арифметика над данными, без fs.
- `EXT_*` — отдельная семья от `PML_*`/`BRG_*`/`MTL_*`; живут в `src/contracts/extensions.ts`, зеркало — `specs/015-extensions/contracts/extensions.json` (T103).
- Публичный API: `loadExtensions`, `applyExtensions`, `deepMerge` через `src/index.ts`; контракты через `@ycforge/pilot/contracts`; `parseExtensionsYaml`/`createIdlIndex` — внутренние (тесты — внутренний путь).
- Сериализация merged `configuration` — переиспользуемый serializer 014 (`serializeResource`/`serializeResourceFile`); 015 не вводит собственную сериализацию.
- Do NOT commit; all checkboxes остаются `- [ ]` до закрытия задач в implement.

---

## Converge Notes

_(Заполняется после /speckit.converge: gate outputs, FR → code → task matrix, deviations, readiness verdict.)_