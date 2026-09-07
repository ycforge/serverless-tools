---
description: "Task list for moved — .ycsf/moved.yaml (version: 1), chain resolution, MOV_* diagnostics, buildMoves/buildMovedFile compile to TerraformMoved[]"
---

# Tasks: moved — `.ycsf/moved.yaml` (version: 1), chains, MOV_* диагностики, компиляция `TerraformMoved[]`

**Input**: Design documents from `/specs/017-moved/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Test-first per constitution (II). Каждый acceptance criterion (US1..US9, 23 AC), каждый FR-001..FR-016, каждый quickstart-сценарий Sc1–Sc10 и каждый SC-001..SC-010 маппится минимум на одну test-задачу (RED → GREEN). Тесты пишутся ДО реализации и подтверждаются как RED. 011/012/013/014/015 должны оставаться zero-regression на каждом шаге (baseline 297 passed / 50 files на `dev` к моменту старта; зафиксировать актуальное число в T001).

**Organization**: Задачи сгруппированы по фазам Setup / Tests (RED) / Core (GREEN) / Integration (quickstart Sc1–Sc10) / Polish — по прецеденту 015/016. US-лейблы `[USn]` даются test-задачам Phase 2/4 и single-story модулям Phase 3 для traceability (spec-kit: user-story-лейбл обязателен для US-phase задач; foundational/polish-cross-cutting задач — нет).

## Format: `[ID] [P?] [USn] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[USn]**: User story из spec.md (US1..US9; US1..US7 = **P1** (MVP), US8 = **P2**, US9 = **P1**)
- Include exact file paths in descriptions.

## Design decisions locked in (plan/research/data-model; open questions resolved into behavior + tests)

- **Module split (plan Structure Decision)**: runtime — `packages/pilot/src/moves/` = `moves-yaml.ts` (parse gate `parseMovesYaml(text, file)`, СВОЙ `parseDocument(uniqueKeys: true)` c MOV-кодами; `parseYaml` из `src/model/parse.ts` НЕ используется — он хардкодит PML_*, research 6), `loader.ts` (`loadMoves(rootDir)` — ЕДИНСТВЕННАЯ fs-точка; missing file → **ok** с `{version:1, moves:[]}`, НЕ throw — в отличие от `EXT_MISSING_FILE` 015: файл optional по FR-002/IDEA §35), `validate.ts` (пер-entry + cross-entry validation фаза), `chain.ts` (outEdge/inEdge degree≤1 walk, стартовые узлы, `MOV_CYCLE`, terminal resolution → live/dangling, canonical order), `build.ts` (`buildMoves(currentResources, moves)` — чистый two-phase transform all-or-nothing + `buildMovedFile(moved)` — тонкий wrapper над `serializeJson` 014), `errors.ts` (`mov()` factory + re-export `diag` для loader), `index.ts` (внутренний barrel). Public **type-only** contracts + 8 `MOV_*` as-const констант — в `src/contracts/moves.ts` (zero-dep, зеркало `specs/017-moved/contracts/moves.ts` byte-for-byte), re-export через `src/contracts/index.ts` → `@ycforge/pilot/contracts`; runtime API (`loadMoves`, `buildMoves`, `buildMovedFile`) через `src/index.ts`. **`packages/pilot/package.json` и `packages/pilot/tsup.config.ts` UNCHANGED** (research 6; guard T102).
- **JSON moved shape (research 1)**: top-level `{"moved": [{from:<addr>, to:<addr>}, ...]}` — массив объектов, адреса — строки; сериализация — существующий `serializeJson` (sorted keys) из `src/materialize/serialize.ts`, НЕ изменяется; wrapper-ем `buildMovedFile`; `filename = 'moved.ycsf.tf.json'` (matches `write.ts` FILENAME_RE `/^[A-Za-z0-9_-]+\.ycsf\.tf\.json$/` — C-owned glob 014); `null` при пустом `moved`.
- **Chain-алгоритм (research 2/3, FR-009/FR-010)**: key узла = полная пара `{idl, idt}`; связывание `prev.to === next.from` по ОБЕИМ компонентам; degree≤1 гарантируется validation (MOV_CONTRADICTORY/MOV_DUPLICATE); старты = узлы без inEdge; циклы = компоненты без старта → ОДИН `MOV_CYCLE` на цикл; terminal-lookup в `Map<endpointKey, currentEndpoint>` (first-wins) → live или `MOV_TARGET_UNRESOLVED` (терминал + available алфавитно) + `MOV_DANGLING` на каждый entry (N+1 диагностик). Порядок **diagnostics** — file order (пер-entry → cross-entry → chain-level по первому появлению entry); порядок **compiled `moved`** — canonical по `(start.idl, start.idt)`, внутри цепочки хронологически (два РАЗНЫХ порядка, FR-016).
- **idl-only семантика (research 4, FR-011/FR-012)**: `moved`-блок эмитится по дистинктным историческим адресам (skip `n_i.idt === n_{i-1}.idt`, skip `a === current.idt`), `to` ВСЕГДА = current.idt из `currentResources`. idl-only no-op — валидный `kind:'ok'`, `moved === []` (кода нет, spec Error Codes); missing file — валидный `ok` (`moves: []`, кода нет).
- **Version / collect-all**: version — short-circuit ОДИН `MOV_VERSION` (паттерн 013/015); структурные проверки — collect-all `MOV_INVALID` (YAML-синтаксис / dup-keys parse-gate `uniqueKeys` / топ-уровень ровно `{version, moves}` / `moves` не список / entry не mapping / ключи ≠ `{from,to}` / `from`/`to` не mapping / idl/idt не строка или нарушение грамматики / `from === to` no-op). IDL-грамматика (два сегмента `[a-z][a-z0-9_]*`) — через переиспользуемый `parseResourceReference` из `src/contracts/resource-reference.js` (append dummy сегмент → 3 сегмента; `ContractError` ловится и re-мапится в `MOV_INVALID`); IDT (два сегмента `[a-zA-Z_][a-zA-Z0-9_]*`) — local RE как pattern 014 `MTL_INVALID_TERRAFORM_ADDRESS`.
- **Validation-фаза buildMoves (research 5, FR-013)**: two-phase validate-first collect-all all-or-nothing; defensive `MOV_INVALID` для грамматики/no-op на programmatic `MovesYaml` (020 check seam); любая ошибка → `{kind:'invalid', errors: ALL}`, ни один `moved` не компилируется.
- **Zero-dep contracts (research 6)**: `src/contracts/moves.ts` — type-only (type-imports `ProjectModelDiagnostic`/`TerraformMoved`) + 8 чистых `MOV_*` констант; I/O — только `src/moves/loader.ts` (`node:fs`), yaml — только `src/moves/moves-yaml.ts`; консистентность каталога — статический тест T103 (зеркало `contracts/moves.json` `#/errorCodes` + `contracts/moves.ts`).

## Path Conventions

- **Monorepo package**: `packages/pilot/src/` — source, `packages/pilot/test/` — tests
- **Runtime moves module** (fs ТОЛЬКО в `loader.ts`; `validate`/`chain`/`build` — чистые, без I/O): `packages/pilot/src/moves/`
- **Public type contracts**: `packages/pilot/src/contracts/moves.ts`, re-export из `src/contracts/index.ts` (`@ycforge/pilot/contracts`; zero-runtime-dep), runtime export из `src/index.ts`
- **Unit tests**: `packages/pilot/test/unit/{moves-yaml,validate,chain,build-moves,moves-loader}.spec.ts`
- **Integration / quickstart**: `packages/pilot/test/moves/quickstart.spec.ts` (Sc1..Sc10 против canonical project: `user_service` / `analytics` / `frontend` / `openapi`)
- **Fixture helper**: `packages/pilot/test/helpers/moves-fixtures.ts` (по образцу `extensions-fixtures.ts`)
- **Type tests**: `packages/pilot/test/types/moves.test-d.ts` (mirror `extensions.test-d.ts`)
- **Silent inserts**: `src/contracts/moves.ts` — byte-for-byte зеркало `specs/017-moved/contracts/moves.ts` (8 `MOV_*` as-const + shapes); каталог-зеркало — `specs/017-moved/contracts/moves.json` `#/errorCodes`

⚠️ **No new runtime deps (confirmed, research 6)**: `yaml` уже в `packages/pilot` (только `moves-yaml.ts`); `node:fs`/`node:path` — builtins; `packages/pilot/package.json` и `packages/pilot/tsup.config.ts` UNCHANGED. `src/contracts/` остаётся zero-runtime-dep (T101). `src/contracts/terraform.ts` (`TerraformMoved`), `src/materialize/serialize.ts` (`serializeJson`) и `src/materialize/write.ts` (FILENAME_RE, stale-cleanup) НЕ изменяются (research 1/5; миграционная нота «no write.ts/orphan changes needed» верифицируется фикстурой/тестом в T104).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Базлайн 011–015, scaffold модульных путей `src/moves/`, fixture helper — чтобы последующие test/impl задачи имели конкретные файлы. Проверка «paths»: план `src/moves/{moves-yaml,loader,validate,chain,build,errors,index}.ts` + `src/contracts/moves.ts`.

- [x] T001 Verify no new package wiring needed: подтвердить `packages/pilot/package.json` UNCHANGED (`yaml` уже dependency; `node:fs`/`node:path` — builtins; новых пакетов нет) и `packages/pilot/tsup.config.ts` по-прежнему эмитит `index` + `contracts/index` (entry `contracts/index` → `src/contracts/index.ts` баралирует новый `moves.ts` через `export *`). Прогнать `pnpm --filter @ycforge/pilot test` — зафиксировать baseline 011/012/013/014/015 green (ожидается 297 passed / 50 files; записать актуальные цифры) ДО изменений.
- [x] T002 [P] Scaffold `packages/pilot/src/moves/` — пустые stubs `moves-yaml.ts`, `loader.ts`, `validate.ts`, `chain.ts`, `build.ts`, `errors.ts`, `index.ts` (сигнатуры функций/типов per data-model поверх контрактов `MoveEndpoint`/`MoveEntry`/`MovesYaml`/`MovesDiagnostic`/`MovesLoadResult`/`BuildMovesResult`), логика НЕ реализована (бросает `throw new Error('not implemented')` / возвращает заглушку) — последующие Phase-2 тесты импортируются и падают (RED). fs-код появляется ТОЛЬКО в `loader.ts`. Контракты `src/contracts/moves.ts` в Setup НЕ создаются (land в T050; RED-тесты до этого частично «Cannot find export» — прецедент 015 A2). No imports from composer.
- [x] T003 [P] Create `packages/pilot/test/helpers/moves-fixtures.ts` — fixture helper (mind: extensions-fixtures pattern): 1) фабрики `endpoint(idl, idt): MoveEndpoint`, `entry(from: MoveEndpoint, to: MoveEndpoint): MoveEntry`; 2) `canonicalCurrentResources(): readonly MoveEndpoint[]` — канонический набор quickstart: `functions.user_service / yandex_function.user_service`, `functions.analytics / yandex_function.analytics`, `gateways.openapi / yandex_api_gateway.openapi`, `containers.frontend / yandex_container.frontend`; 3) текстовые генераторы `.ycsf/moved.yaml`: `movesYaml(movesText)` — собирает `version: 1` + `moves:` из переданных строк, плюс `canonicalMovesYaml()` (Sc1 файл: `from{idl: functions.users, idt: yandex_function.users} → to{idl: functions.users, idt: yandex_function.user_api}`) — для loader/quickstart тестов; 4) parsed-generator `movesFrom(...)` — собирает `MovesYaml`-объект (plain const, без fs) для buildMoves-тестов; 5) `writeMovedYaml(project, yaml)` — пишет `.ycsf/moved.yaml` в `TempProject` (переиспользуя `createTempProject` из `test/helpers/temp-project.ts`). Герметично, параллельно-безопасно, БЕЗ process.env, не трогает реальные `.ycsf/` файлы пользователя.

---

## Phase 2: Tests — unit (RED)

**Purpose**: Падающие unit-тесты для каждого `src/moves/` модуля и контрактов, маппящие каждый AC/FR/edge на решение. Все RED; GREEN — в Phase 3. Фикстуры — через `test/helpers/moves-fixtures.ts` (T003); fs — только в loader-тестах (mkdtemp). RED-канал: модули-стабы T002 бросают `not implemented` / contracts-импорты «Cannot find export» до T050 (прецедент 015 A2).

### moves-yaml.spec.ts — parseMovesYaml parse gate + структура (US8, FR-001/003/004, P2)

- [x] T010 [P] [US8] Unit test parseMovesYaml valid file: канонический `.ycsf/moved.yaml` (Sc1) → `kind:'ok'`, `data.version === 1`, `data.moves` — массив записей, каждый `{from: {idl, idt}, to: {idl, idt}}` — FR-001, quickstart Sc9 в `packages/pilot/test/unit/moves-yaml.spec.ts` (RED: `parseMovesYaml` отсутствует/стаб).
- [x] T011 [P] [US8] Unit test version gate: `version` отсутствует → `MOV_VERSION` c message /missing version/; `version: 2` → `MOV_VERSION` c /unsupported version/ (short-circuit, ОДИН diagnostic, не collect-all параллельно с MOV_INVALID) — FR-003, US8 AC1, quickstart Sc9 в `packages/pilot/test/unit/moves-yaml.spec.ts`.
- [x] T012 [P] [US8] Unit test структурные формы: `moves` отсутствует → `MOV_INVALID` (missing 'moves'); `moves` не список (mapping/скаляр) → `MOV_INVALID`; top-level неизвестный ключ `chains:` → `MOV_INVALID` (ровно 2 ключа) (Constitution V); entry не mapping → `MOV_INVALID`; entry с ключами ≠ `{from,to}` (лишний/отсутствующий) → `MOV_INVALID`; `from`/`to` не mapping → `MOV_INVALID` — FR-004, US8 AC2, research/data-model validation table, quickstart Sc9 в `packages/pilot/test/unit/moves-yaml.spec.ts`.
- [x] T013 [P] [US8] Unit test грамматика idl/idt: idl с 1 сегментом (`functions`), 3 сегментами (`functions.user_service.extra`), пустым сегментом, uppercase (`Functions.user_service`), дефисом/слэшем → `MOV_INVALID` (два сегмента `[a-z][a-z0-9_]*`; через `parseResourceReference` re-map `ContractError` → `MOV_INVALID`); idt c дефисом в типе (`yandex-Function.users`), слэшем, 1 сегментом → `MOV_INVALID` (два сегмента `[a-zA-Z_][a-zA-Z0-9_]*`, pattern 014) — FR-004, spec Edge Cases, quickstart Sc9 в `packages/pilot/test/unit/moves-yaml.spec.ts`.
- [x] T014 [P] [US8] Unit test duplicate YAML keys + collect-all: `from: {idl: functions.users, idl: functions.accounts, idt: yandex_function.users}` (duplicate внутри вложенного mapping) → `MOV_INVALID` (parse-gate `uniqueKeys`), присутствуют `line`/`column`; duplicate на уровне entry или top-level → `MOV_INVALID`; несколько структурных ошибок сразу (не-список `moves` + bad from) → `kind:'invalid'` со ВСЕМИ errors (`errors.length >= 2`, collect-all; порядок diagnostics — file order) — FR-004, data-model Load Flow, quickstart Sc9 в `packages/pilot/test/unit/moves-yaml.spec.ts`.
- [x] T015 [P] [US8] Unit test no-op: entry c `from` полностью равным `to` (оба `{idl, idt}` совпадают) → `MOV_INVALID` — FR-004, US8 AC4, quickstart Sc9 в `packages/pilot/test/unit/moves-yaml.spec.ts`.

### validate.spec.ts — buildMoves validation-фаза (US4, US5, US8, FR-005/006/007/013, P1)

- [x] T016 [P] [US8] Unit test defensive MOV_INVALID (programmatic MovesYaml): грамматически невалидный endpoint (`idl: "functions"`, `idt: "yandex-Function.users"`), no-op entry, переданные напрямую в `buildMoves` (мимо loader, 020 check seam) → `kind:'invalid'`, errors содержит `MOV_INVALID` c `entry`/`endpoint`/`field` (location-поля undefined — чистый transform) — US8 AC3 (defensive), quickstart Sc10.3 в `packages/pilot/test/unit/validate.spec.ts` (RED: validate импортирует отсутствующие контракты/стаб).
- [x] T017 [P] [US4] Unit test type-change: `from: {idl: functions.users, idt: yandex_function.users}`, `to: {idl: functions.users, idt: yandex_container.users}` → `kind:'invalid'`, errors содержит `MOV_TYPE_CHANGE` c entry (первый сегмент `from.idt` ≠ первому сегменту `to.idt`; НЕ безопасный rename, fail-fast) — FR-005, US4 AC1, quickstart Sc4 в `packages/pilot/test/unit/validate.spec.ts`.
- [x] T018 [P] [US5] Unit test full duplicate: две миграции с одинаковыми `from` И `to` → `MOV_DUPLICATE` (redundant история; НЕ `MOV_CONTRADICTORY`) — FR-007, spec Edge Cases, quickstart Sc5 в `packages/pilot/test/unit/validate.spec.ts`.
- [x] T019 [P] [US5] Unit test contradictory bindings: (a) две миграции с одинаковым `from`, разным `to` → `MOV_CONTRADICTORY` (US5 AC1); (b) две миграции с одинаковым `to`, разным `from` → `MOV_CONTRADICTORY` (US5 AC2); результат order-independent (перестановка записей не меняет код) — FR-006, Constitution V, quickstart Sc5 в `packages/pilot/test/unit/validate.spec.ts`.

### chain.spec.ts — цепочки, циклы, terminal resolution (US3, US6, FR-008/009/010, P1)

- [x] T020 [P] [US3] Unit test chain building: две миграции, связанные точным совпадением пары `prev.to === next.from` (цепочка §35 `users→user_service→accounts`) → одна цепочка, entries хронологически (старый первым), `terminal = to` последней, `start = from` первой; связывание по ОБЕИМ компонентам: при совпадении только idt (разный idl) цепочка НЕ связывается — FR-009, US3, quickstart Sc3 в `packages/pilot/test/unit/chain.spec.ts` (RED: chain отсутствует/стаб).
- [x] T021 [P] [US3] Unit test cycle: граф `a→b`, `b→a` (полный круг пар) → `MOV_CYCLE`, ОДИН на цикл-компонент (message из адресов цикла); цикл не даёт live-цепочек — FR-008, spec Edge Cases, quickstart Sc10.1 в `packages/pilot/test/unit/chain.spec.ts`.
- [x] T022 [P] [US6] Unit test terminal resolution live/dangling: терминал совпадает с current парой (exact pair) → цепочка live, `current` заполнен; терминал НЕ в current → `MOV_TARGET_UNRESOLVED` (терминал + `available` — current идентичности алфавитно) И по одному `MOV_DANGLING` на каждый entry цепочки; для N-entry висячей цепочки — N+1 диагностик; частичное совпадение терминала (только idl или только idt) → unresolved, silent merge нет — FR-010, US6 AC1/AC2, quickstart Sc6 в `packages/pilot/test/unit/chain.spec.ts`.
- [x] T023 [P] [US9] Unit test canonical order + несколько цепочек: два независимых walk'а — `moved`-порядок канонический по `(start.idl, start.idt)` (НЕ порядок записей файла); каждая цепочка компилируется отдельно; повторный build с переставленными записями → тот же набор цепочек — FR-016, US9 AC4, US3 AC3 (неполная история), data-model Chain invariants, quickstart Sc3/Sc8.4/Sc10.4 в `packages/pilot/test/unit/chain.spec.ts`.

### build-moves.spec.ts — compile-семантика + buildMovedFile (US1, US2, US3, US7, FR-011/012/013, P1)

- [x] T024 [P] [US1] Unit test idt-only rename: current `[{functions.users, yandex_function.user_api}]`, moves `from{functions.users, yandex_function.users} → to{functions.users, yandex_function.user_api}` → `kind:'ok'`; `moved` ровно один `{kind:'moved', from:'yandex_function.users', to:'yandex_function.user_api'}` (тип — `TerraformMoved` contract 002, FR-015) — US1 AC1, quickstart Sc1 в `packages/pilot/test/unit/build-moves.spec.ts` (RED: buildMoves отсутствует/стаб).
- [x] T025 [P] [US2] Unit test full rename: current `[{functions.user_service, yandex_function.user_service}]`, moves `from{functions.users, yandex_function.users} → to{functions.user_service, yandex_function.user_service}` → `kind:'ok'`; `moved[0].from === 'yandex_function.users'`, `moved[0].to === 'yandex_function.user_service'` — `to` равен ТЕКУЩЕМУ адресу из currentResources (не из истории) — US2 AC1/AC2, quickstart Sc2 в `packages/pilot/test/unit/build-moves.spec.ts`.
- [x] T026 [P] [US3] Unit test multi-hop compile: цепочка §35 (`users→user_service→accounts`), current `[{functions.accounts, yandex_function.accounts}]` → `moved` = `[{from:'yandex_function.users', to:'yandex_function.accounts'}, {from:'yandex_function.user_service', to:'yandex_function.accounts'}]` (хронологический порядок — старый адрес раньше; оба с `to` = current) — FR-012, US3 AC1; цепочка с пропущенным промежуточным шагом (только `users→accounts`), терминал текущий → `ok`, компилируется что есть (US3 AC3); 3-шаговая цепочка `a→b→c→d` → по `moved` на `a`,`b`,`c` (US3 AC2) в `packages/pilot/test/unit/build-moves.spec.ts`.
- [x] T027 [P] [US7] Unit test idl-only: (a) current `[{functions.accounts, yandex_function.users}]`, moves `from{functions.users, yandex_function.users} → to{functions.accounts, yandex_function.users}` → `kind:'ok'`, `moved === []` (адрес не менялся, US7 AC1); (b) цепочка `users→accounts` (idl-only, адрес X) + `accounts→reports` (X→Y), current `reports/Y` → `ok`, `moved` = `[{from:X, to:Y}]` (блок только для реально сменившегося адреса, US7 AC2) — FR-011, quickstart Sc7 в `packages/pilot/test/unit/build-moves.spec.ts`.
- [x] T028 [P] [US4] Unit test all-or-nothing: type-change entry + валидный (moved-совместимый) шаг в том же файле → `kind:'invalid'`; НИ один `moved` не скомпилирован (валидный шаг не влияет); errors — collect-all (пер-entry порядок) — FR-013, US4 AC2, quickstart Sc4 в `packages/pilot/test/unit/build-moves.spec.ts`.
- [x] T029 [P] [US9] Unit test determinism + пустые входы: два вызова `buildMoves` с одинаковыми входами → `moved` глубоко равны (US9 AC3, SC-008); тот же набор цепочек в разном порядке записей → одинаковый `moved` (US9 AC4); `moves: []` + любые current → `ok`, `moved === []` (US9 AC2, FR-016); входы не мутируются (readonly invariant, FR-014) — quickstart Sc8.2/8.3/10.2 в `packages/pilot/test/unit/build-moves.spec.ts`.
- [x] T030 [P] [US1] Unit test buildMovedFile: `buildMovedFile([{kind:'moved', from:'yandex_function.users', to:'yandex_function.user_api'}])` → `{filename:'moved.ycsf.tf.json', content}`; `content` — валидный JSON `{"moved": [{"from": ..., "to": ...}]}` (~ 2-line prettified `serializeJson` 014, keys отсортированы — `from` < `to`); filename матчит `write.ts` FILENAME_RE `/^[A-Za-z0-9_-]+\.ycsf\.tf\.json$/` (C-owned); `buildMovedFile([])` → `null` (Sc10.5) — research 1/5, US1 AC2 serialization, quickstart Sc1/Sc10.5 в `packages/pilot/test/unit/build-moves.spec.ts`.

> ⚠️ **Note (migration на 014)**: `moved.ycsf.tf.json` implicit-собственность C через глоб `*.ycsf.tf.json` в `write.ts` (014) — stale-cleanup (строки 40-50) убирает старые C-owned файлы, не трогая user `.tf` и другие `.ycsf.tf.json` из current set. 017 НЕ изменяет `write.ts`; верификация «no write.ts/orphan changes needed» — тест/фикстура в T104.

### moves-loader.spec.ts — loadMoves (US9, FR-002/003/004, P1)

- [x] T031 [P] [US9] Unit test loader (mkdtemp): (a) `.ycsf/moved.yaml` отсутствует → `kind:'ok'`, `data.moves === []` (файл OPTIONAL, НЕ ошибка, FR-002, US9 AC1, Sc8.1; contrаст с 015 `EXT_MISSING_FILE`); (b) валидный файл → `{kind:'ok', data}` (MovesYaml); (c) структурно невалидный файл (version: 2 / bad структура / duplicate YAML keys) → `{kind:'invalid'}` с переиспользуемыми `ProjectModelDiagnostic` (file/line/column) — collect-all (FR-003/004, Sc8/Sc9); не-ENOENT ошибки fs (например, каталог вместо `.ycsf/moved.yaml`) → rethrow (catastrophic I/O) — data-model Load Flow in `packages/pilot/test/unit/moves-loader.spec.ts` (НЕ конфликтует с существующим `test/unit/loader.spec.ts` — это extensions loader 015; здесь отдельный файл для moves loader).

### type-level (RED)

- [x] T032 [P] [US8] Type-test `packages/pilot/test/types/moves.test-d.ts`: verify публичные contracts `MoveEndpoint` (`{readonly idl: string; readonly idt: string}`), `MoveEntry` (`{from, to}`), `MovesYaml` (`{version: 1, moves: readonly MoveEntry[]}`), `MovesDiagnostic` (code/message + optional `entry`/`endpoint`/`field`/`file`/`line`/`column`/`available`; location-поля optional — в buildMoves не заполняются), `MovesLoadResult` = `{kind:'ok', data: MovesYaml} | {kind:'invalid', errors: readonly ProjectModelDiagnostic[]}` (loader переиспользует 011 shape), `BuildMovesResult` = `{kind:'ok', moved: readonly TerraformMoved[]} | {kind:'invalid', errors: readonly MovesDiagnostic[]}` (дискриминированные union-ы; `TerraformMoved` из `src/contracts/terraform.ts`, FR-015); 8 `MOV_*` констант literal-типа (`MOV_VERSION`, `MOV_INVALID`, `MOV_DUPLICATE`, `MOV_TYPE_CHANGE`, `MOV_CONTRADICTORY`, `MOV_CYCLE`, `MOV_TARGET_UNRESOLVED`, `MOV_DANGLING` как `'MOV_...'`, Constitution V); сигнатуры `loadMoves(rootDir: string)`, `buildMoves(currentResources: readonly MoveEndpoint[], moves: MovesYaml)`, `buildMovedFile(moved: readonly TerraformMoved[]): GeneratedTfFile | null` — importable+type-usable из `src/contracts/index.js` и `src/index.js` (mirror `extensions.test-d.ts`; `expectTypeOf` для discriminated union) — RED до Phase 3 (контракты приходят в T050).

---

## Phase 3: Core — contracts + implementation (GREEN)

**Purpose**: Реализовать контракты и `src/moves/` модули, чтобы Phase-2/Phase-4 тесты стали GREEN. `src/contracts/` — zero-runtime-dep; fs — только в `loader.ts`, yaml — только в `moves-yaml.ts`; `validate`/`chain`/`build` — чистые без I/O (FR-014).

### Public type contracts

- [x] T050 Create `packages/pilot/src/contracts/moves.ts` — NEW type-only + pure public contracts, **byte-for-byte зеркало** `specs/017-moved/contracts/moves.ts` (source of truth): 8 `MOV_*` констант `as const`, `MoveEndpoint`/`MoveEntry`/`MovesYaml`/`MovesDiagnostic`, `MovesLoadResult`/`BuildMovesResult` (типы per data-model / `contracts/moves.json`); type-imports ТОЛЬКО `ProjectModelDiagnostic` из `./project-model.js` и `TerraformMoved` из `./terraform.js`; docs-комментарий со ссылкой на `specs/017-moved/contracts/moves.json` `#/errorCodes`. type-only/pure — никаких импортов fs/yaml (zero-dep) — depends on T032 (RED shape).
- [x] T051 [P] Re-export новых contracts из `packages/pilot/src/contracts/index.ts`: добавить `export * from './moves.js'` (барель `@ycforge/pilot/contracts`; stays zero-runtime-dep) — depends on T050.

### Runtime module implementation (fs — только в `loader.ts`)

- [x] T052 [P] Implement `packages/pilot/src/moves/errors.ts` — factory `mov(opts): MovesDiagnostic` для validate/chain/build фаз (`MOV_DUPLICATE`/`MOV_TYPE_CHANGE`/`MOV_CONTRADICTORY`/`MOV_CYCLE`/`MOV_TARGET_UNRESOLVED`/`MOV_DANGLING` + defensive `MOV_INVALID`; поля `entry`/`endpoint`/`field`/`available` заполняются по коду; file/line/column НЕ заполняются — чистый transform) + re-export `diag` из `src/model/errors.js` для loader-структурных диагностиков (единый `ProjectModelDiagnostic` shape, research 6); коды сравниваются через `MOV_*` константы, никогда string literal (Constitution V) — depends on T050.
- [x] T053 [P] [US8] Implement `packages/pilot/src/moves/moves-yaml.ts` — `parseMovesYaml(text: string, file: string): {kind:'ok', data: MovesYaml} | {kind:'invalid', errors: readonly ProjectModelDiagnostic[]}`: собственный `parseDocument(text, {uniqueKeys: true})` (паттерн 013/015, research 6) — YAML-синтаксис и DUPLICATE_KEY → `MOV_INVALID` (line из `error.linePos[0]` + `line + 1`); version short-circuit → `MOV_VERSION` (missing/unsupported); структурная валидация collect-all `MOV_INVALID` (FR-004): ровно 2 top-level ключа (`version`,`moves`), `moves` список, entry mapping ровно с `from`+`to`, `from`/`to` mapping ровно с `idl`+`idt`, idl — строка по двухсегментной грамматике (re-map через `parseResourceReference` из `src/contracts/resource-reference.js`: append сегмент → `ContractError` catch → `MOV_INVALID`), idt — строка по local RE `/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/` (pattern 014), `from === to` no-op → `MOV_INVALID`; неизвестные ключи → `MOV_INVALID` — depends on T010–T015, T050/T052.
- [x] T054 [P] Implement `packages/pilot/src/moves/validate.ts` — validation-фаза `buildMoves` (collect-all, first-wins maps): **пер-entry** (file order): defensive grammar/no-op `MOV_INVALID` (programmatic MovesYaml), type-change первого сегмента `from.idt`/`to.idt` → `MOV_TYPE_CHANGE`; **cross-entry** (file order): same-from-different-to OR same-to-different-from → `MOV_CONTRADICTORY`; полный дубликат (from AND to) → `MOV_DUPLICATE` (first-wins tokens); возвращает `moves` normalized граф + `errors[]`; НИКАКОГО fs — depends on T016–T019, T050/T052.
- [x] T055 [P] Implement `packages/pilot/src/moves/chain.ts` — chain building на degree≤1 графе: `outEdge`/`inEdge` maps по key `{idl, idt}` (serialized), стартовые узлы (без inEdge, порядок — по первому появлению entry в файле), walk по `outEdge` → цепочки (хронологически); циклы = узлы с outEdge вне стартовых обходов → ОДИН `MOV_CYCLE` на цикл; terminal resolution — `Map<key, currentEndpoint>` (first-wins), live или `MOV_TARGET_UNRESOLVED` (терминал + available алфавитно, как 015 availableIdls) + `MOV_DANGLING` на каждый entry; выходные цепочки упорядочены канонически по `(start.idl, start.idt)` для compile (FR-016), diagnostics — по file order — depends on T020–T023, T050/T052, T054.
- [x] T056 Implement `packages/pilot/src/moves/build.ts` — `buildMoves(currentResources: readonly MoveEndpoint[], moves: MovesYaml): BuildMovesResult` (ровно 2 аргумента; defensive assert на parsed MovesYaml): **фаза validation** (T054) + chain/resolve (T055); любая ошибка → `{kind:'invalid', errors: ВСЕ}` и НИ один `moved` не скомпилирован (FR-013); **фаза compile** (только live-цепочки, canonical order): для каждого дистинктного исторического адреса `n_i.idt` (skip смежных одинаковых — idl-only, skip `a === current.idt`) эмитится `{kind:'moved', from: a, to: current.idt}` (тип `TerraformMoved` contract 002, FR-015); результат — новый readonly массив, входы не мутируются; плюс `buildMovedFile(moved: readonly TerraformMoved[]): GeneratedTfFile | null` — wrapper над `serializeJson` из `src/materialize/serialize.js` (sorted keys, НЕ изменяется), `filename='moved.ycsf.tf.json'`, `null` при пустом. НЕТ fs (FR-014/SC-009) — depends on T054, T055, T050, T030.
- [x] T057 [P] [US9] Implement `packages/pilot/src/moves/loader.ts` — `loadMoves(rootDir: string): MovesLoadResult` (синхронный, как `loadProjectModel`/`loadExtensions`): `existsSync(join(rootDir, '.ycsf', 'moved.yaml'))` → отсутствует → `{kind:'ok', data: {version: 1, moves: []}}` (FR-002, OPTIONAL file; НЕ throw — в отличие от 015); `readFileSync` (не-ENOENT fs-ошибки → rethrow: catastrophic I/O) → `parseMovesYaml(text, '.ycsf/moved.yaml')` → `{kind:'ok', data} | {kind:'invalid', errors}` (ProjectModelDiagnostic collect-all). ЕДИНСТВЕННАЯ I/O-точка фичи — depends on T053, T031.
- [x] T058 Implement `packages/pilot/src/moves/index.ts` (внутренний barrel: `export *` из `./errors.js`, `./moves-yaml.js`, `./loader.js`, `./validate.js`, `./chain.js`, `./build.js`) и обновить `packages/pilot/src/index.ts`: `export { loadMoves, buildMoves, buildMovedFile } from './moves/index.js'` + type re-export `MoveEndpoint`, `MoveEntry`, `MovesYaml`, `MovesLoadResult`, `BuildMovesResult`, `MovesDiagnostic` из contracts (рядом с `loadProjectModel`/`loadExtensions`/`dispatch`); `parseMovesYaml`/`validateMoves`/`buildChains` — внутренние (тесты — внутренний путь); `buildMovedFile` — ПУБЛИЧНО. `src/contracts/terraform.ts`, `src/materialize/*`, `package.json`, `tsup.config.ts` НЕ трогаются — depends on T056, T057, T050–T051.

---

## Phase 4: Integration — quickstart scenarios (RED → GREEN)

**Purpose**: Прогнать quickstart Sc1–Sc10 против реальных `loadMoves`/`buildMoves`/`buildMovedFile` в `packages/pilot/test/moves/quickstart.spec.ts`. Тест пишется RED до Phase 3, GREEN после. Каждый сценарий — `it` block в одном файле; фикстуры — `test/helpers/moves-fixtures.ts` (T003) + `test/helpers/temp-project.ts` (mkdtemp for loader-сценарии). Current mapping подаётся напрямую (dispatch 014 вывод строится в 021 — вне scope).

### Quickstart scenarios (RED)

- [x] T080 [P] [US1] Integration test Sc1 (idt-only rename + сериализация): current `[{functions.users, yandex_function.user_api}]` + canonicalMovesYaml → `buildMoves` → `kind:'ok'`, `moved` ровно один `{kind:'moved', from:'yandex_function.users', to:'yandex_function.user_api'}`; `buildMovedFile(moved)` (US1 AC2) → `{filename:'moved.ycsf.tf.json', content: '{"moved": [{"from": "yandex_function.users", "to": "yandex_function.user_api"}]}'}` (валидный JSON, keys `from` < `to` отсортированы) — US1 AC1/AC2, FR-012/015, quickstart Sc1 в `packages/pilot/test/moves/quickstart.spec.ts` (RED: `src/index.js` экспорты до T058 «Cannot find export»).
- [x] T081 [P] [US2] Integration test Sc2 (полный rename): current `[{functions.user_service, yandex_function.user_service}]`, moves `from{f.users, yf.users} → to{f.user_service, yf.user_service}` → `kind:'ok'`; `moved[0]` = `{from:'yandex_function.users', to:'yandex_function.user_service'}`; `to` равен ТЕКУЩЕМУ адресу из project model (не из истории; US2 AC2) — US2 AC1/AC2, FR-012, quickstart Sc2 в `packages/pilot/test/moves/quickstart.spec.ts`.
- [x] T082 [P] [US3] Integration test Sc3 (multi-hop + детерминизм + неполная история): current `[{functions.accounts, yandex_function.accounts}]`, цепочка §35 из двух шагов → `moved` = `[{from:'yandex_function.users', to:'yandex_function.accounts'}, {from:'yandex_function.user_service', to:'yandex_function.accounts'}]` — хронологически (US3 AC1); переставленные записи файла (US9 AC4/FR-016) → тот же `moved`; только шаг `users→accounts` (пропущен промежуточный), терминал `accounts` текущий → `ok`, компилируется что есть (US3 AC3) — US3 AC1/AC2/AC3, FR-009/012/016, quickstart Sc3 в `packages/pilot/test/moves/quickstart.spec.ts`.
- [x] T083 [P] [US4] Integration test Sc4 (type-change fail-fast + all-or-nothing): current `[{containers.users, yandex_container.users}]`, moves `from{f.users, yf.users} → to{c.users, yandex_container.users}` → `kind:'invalid'`, errors содержит `MOV_TYPE_CHANGE`; тот же файл + валидный moved-совместимый шаг → НИ один `moved` не скомпилирован (collect-all + all-or-nothing, US4 AC2/FR-013) — US4 AC1/AC2, FR-005, quickstart Sc4 в `packages/pilot/test/moves/quickstart.spec.ts`.
- [x] T084 [P] [US5] Integration test Sc5 (contradictions + duplicates): (1) два entry с одинаковым `from` `{f.users, yf.users}`, разные `to` (`f.accounts/yf.accounts` и `f.analytics/yf.analytics`) → `invalid`, `MOV_CONTRADICTORY`; (2) два entry с одинаковым `to` `{f.accounts, yf.accounts}`, разные `from` → `invalid`, `MOV_CONTRADICTORY`; (3) полный дубликат (одинаковые from AND to) → `MOV_DUPLICATE` (НЕ `MOV_CONTRADICTORY`) — зависимость от порядка записей отсутствует (Constitution V) — US5 AC1/AC2, FR-006/007/016, quickstart Sc5 в `packages/pilot/test/moves/quickstart.spec.ts`.
- [x] T085 [P] [US6] Integration test Sc6 (dangling история): current `[{f.user_service, yf.user_service}]`, moves `from{f.users, yf.users} → to{f.analytics, yf.analytics}` (терминал не в current) → `kind:'invalid'`; errors содержит `MOV_TARGET_UNRESOLVED` (терминал + available алфавитно: `functions.user_service`) И `MOV_DANGLING` для каждого entry (здесь один); N-entry висячая цепочка → N `MOV_DANGLING` + 1 `MOV_TARGET_UNRESOLVED` — US6 AC1/AC2, FR-010, quickstart Sc6 в `packages/pilot/test/moves/quickstart.spec.ts`.
- [x] T086 [P] [US7] Integration test Sc7 (idl-only no-op): (1) current `[{f.accounts, yf.users}]`, moves `from{f.users, yf.users} → to{f.accounts, yf.users}` → `kind:'ok'`, `moved === []` (адрес не менялся, US7 AC1); (2) цепочка с idl-only шагом внутри (`users→accounts` X, `accounts→reports` X→Y), current `reports/Y` → `ok`, `moved` = `[{from:X, to:Y}]` (только реально сменившийся адрес, US7 AC2) — US7 AC1/AC2, FR-011, quickstart Sc7 в `packages/pilot/test/moves/quickstart.spec.ts`.
- [x] T087 [P] [US9] Integration test Sc8 (optional файл / пусто / детерминизм): (1) tmp project (`mkdtemp`) БЕЗ `.ycsf/moved.yaml` → `loadMoves(rootDir)` → `kind:'ok'`, `data.moves === []` (отсутствие файла — валидное состояние, НЕ ошибка; FR-002, US9 AC1); (2) `.ycsf/moved.yaml` c `moves: []` + любые current → `ok`, `moved === []` (US9 AC2); (3) два `buildMoves` с одинаковыми входами → глубоко равные результаты (US9 AC3, SC-008); (4) один и тот же набор цепочек в разном порядке записей → одинаковый `moved` (US9 AC4) — US9 AC1–AC4, FR-002/016, quickstart Sc8 в `packages/pilot/test/moves/quickstart.spec.ts`.
- [x] T088 [P] [US8] Integration test Sc9 (формат/грамматика через `loadMoves`/`parseMovesYaml`): tmp project'ы c файлами из таблицы Sc9 — `version: 2` → `invalid`, `MOV_VERSION`; `version: 1` без ключа `moves` → `MOV_INVALID` (missing 'moves'); `from: {idl: functions, ...}` (1 сегмент) / `idl: "functions.user_service.extra"` (3 сегмента) → `MOV_INVALID` (IDL-грамматика, re-map `ContractError`); `idt: "yandex-Function.users"` (дефис) → `MOV_INVALID` (IDT); entry с `from === to` (no-op) → `MOV_INVALID`; `from: {idl: A, idl: B, idt: Z}` (dup YAML key) → `MOV_INVALID` (parse-gate, line/column); top-level `chains:` → `MOV_INVALID`; несколько структурных ошибок сразу → ВСЕ собраны (collect-all) — US8 AC1–AC4, FR-003/004, quickstart Sc9 в `packages/pilot/test/moves/quickstart.spec.ts`.
- [x] T089 [P] [US9] Integration test Sc10 (defensive-проверки buildMoves): (1) цикл `a→b`, `b→a` → `invalid`, `MOV_CYCLE` (один на цикл, FR-008); (2) `moves: []` → `ok`, `moved === []`; (3) грамматически невалидный endpoint в programmatic `MovesYaml` (мимо loader, 020 check seam) → defensive `MOV_INVALID`; (4) несколько независимых цепочек → сериализация одним общим `moved.ycsf.tf.json`, порядок `moved` канонический по стартовому узлу (детерминирован); (5) `buildMovedFile([])` → `null` (файл не пишется; stale `moved.ycsf.tf.json` из прошлого прогона убирает `writeGeneratedTerraform` 014 при clean-прогоне — симметрия с outputs); (6) user `.tf` / provider state migrations: `buildMoves`/`buildMovedFile` не читают и не пишут файлы (рядом лежащий user `.tf` байт-в-байт не тронут, FR-014, Constitution IV) — FR-008/011/013/014/016, spec Edge Cases, quickstart Sc10 в `packages/pilot/test/moves/quickstart.spec.ts`.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Полный suite zero-regression 011–015, zero-dep инвариант контрактов, typecheck/build, консистентность MOV_*-каталога, write-ownership нота 014, детерминизм и покрытие FR/AC.

- [x] T100 Full suite green incl. 011/012/013/014/015 zero-regression: `pnpm --filter @ycforge/pilot test` — все `test/unit/*`, `test/materialize/*`, `test/extensions/*`, `test/moves/*`, и type-only `test/types/*.test-d.ts` (incl. новый `moves.test-d.ts`) через vitest typecheck; baseline (из T001) остаётся green и добавляются новые — vitest конфиг без изменений (typecheck include уже `test/types/**/*.test-d.ts`).
- [x] T101 Zero-dependency invariant: `pnpm --filter @ycforge/pilot test -- --run test/unit/zero-dependency.test.ts` — импорт-граф `src/contracts/` (включая новый `moves.ts`) только relative modules; `src/contracts/moves.ts` содержит НОЛЬ non-relative импортов (type-only + pure `MOV_*` константы); `fs`/`yaml` — только в `src/moves/loader.ts` и `moves-yaml.ts`, никогда в `src/contracts/` (research 6).
- [x] T102 Typecheck + build + wiring guard: `pnpm --filter @ycforge/pilot typecheck` — исправить все TS errors (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` на optional полях `MovesDiagnostic`, discriminated unions, `ReadonlyMap`); `pnpm --filter @ycforge/pilot build` — dist эмитит `index` + `contracts/index`, новый runtime + contracts включены (ESM + CJS + DTS); подтвердить `packages/pilot/tsup.config.ts` UNCHANGED (guard-задача: `git diff --name-only packages/pilot/tsup.config.ts packages/pilot/package.json` пусто) и `packages/pilot/package.json` UNCHANGED.
- [x] T103 MOV_* constants consistency + CPU-only audit: (1) статический guard: в `src/moves/validate.ts`/`chain.ts`/`build.ts` НЕТ `node:fs`/`node:path`/`node:fs/promises`/`yaml` импортов (CPU-only, FR-014/SC-009); `build.ts` использует `serializeJson` из `src/materialize/serialize.js` ТОЛЬКО как value-import; (2) 8 `MOV_*` констант в `src/contracts/moves.ts` совпадают byte-for-byte с `specs/017-moved/contracts/moves.ts` (source of truth) и с `specs/017-moved/contracts/moves.json` `#/errorCodes`; `MoveEndpoint`/`MoveEntry`/`MovesYaml`/`MovesDiagnostic`-поля соответствуют JSON-схеме (`additionalProperties: false`); НЕ создавать копию каталога в `packages/pilot/contracts/` (конвенция репо: каталоги живут в `specs/NNN-*/contracts/`).
- [x] T104 `moved.ycsf.tf.json` write-ownership verification (миграционная нота 014): тест/фикстура в `packages/pilot/test/moves/quickstart.spec.ts` (или `test/unit/write.spec.ts` inline): `moved.ycsf.tf.json` матчит `write.ts` `FILENAME_RE` → `writeGeneratedTerraform` (014) принимает его как C-owned и записывает; при последующем пустом прогоне (`buildMovedFile([])` → null) stale-cleanup (014) УДАЛЯЕТ старый `moved.ycsf.tf.json`, оставляя другие файлы `infraDir` нетронутыми (user `.tf` И другие `<app>.ycsf.tf.json` из current set intact) — подтверждает исследованное «no write.ts/orphan changes needed»: 017 НЕ вносит правок в `write.ts`/`serialize.ts`/`dispatch.ts` (014) или contract 002.
- [x] T105 Perf smoke + детерминизм cross-platform: inline в `packages/pilot/test/moves/quickstart.spec.ts` — `buildMoves` на ~50 записей × ~20 current resources + `buildMovedFile` → завершается < 5s (ms-scale; `toBeLessThan(5000)` для CI-безопасности, как 013/014/015) — SC-008 производительность, plan Performance Goals (O(n) validation, O(n) chain walk, Map-terminal lookup O(1)); повторные запуски дают byte-identical `content` из `buildMovedFile` (sorted keys детерминирован); grep-verify в `src/moves/` нет недетерминированных конструкций (`JSON.stringify` без sorted-key replacer, `Math.random`, `Date.now`, сортировки по mutable-порядку; canonical order — `(start.idl, start.idt)`).
- [x] T106 Final FR/AC traceability pass: подтвердить каждый FR-001..FR-016 → ≥1 тест (FR-001 формат — T010/T088; FR-002 missing→ok moves:[] — T031/T087; FR-003 `MOV_VERSION` — T011/T088; FR-004 `MOV_INVALID` collect-all — T012–T016/T088/T089; FR-005 `MOV_TYPE_CHANGE` — T017/T083; FR-006 `MOV_CONTRADICTORY` — T019/T084; FR-007 `MOV_DUPLICATE` — T018/T084; FR-008 `MOV_CYCLE` — T021/T089; FR-009 chain exact-pair — T020/T082; FR-010 terminal resolution — T022/T085; FR-011 idl-only no-block — T027/T086; FR-012 compile to current — T024–T026/T080–T082; FR-013 all-or-nothing — T028/T083; FR-014 чистый transform без I/O — T089/T103/T104; FR-015 reuse `TerraformMoved` — T024/T032; FR-016 детерминизм — T023/T029/T082/T087/T105); каждый US AC (US1..US9, 23 AC) → ≥1 тест; каждый quickstart Sc1–Sc10 → ≥1 сценарий Phase 4; SC-001..SC-010 покрыты (SC-001 safe rename — T024/T025/T080/T081; SC-002 chains — T026/T082; SC-003 type-change all-or-nothing — T017/T028/T083; SC-004 contradictions/duplicates/cycles order-independent — T018/T019/T021/T084; SC-005 dangling — T022/T085; SC-006 idl-only no-op — T027/T086; SC-007 контракт файла — T010–T015/T087/T088; SC-008 детерминизм — T023/T029/T082/T087/T105; SC-009 чистый transform — T089/T103; SC-010 100% AC — T106 сам); `specs/README.md` (`🚧 → ✅`) и `.specify/feature.json` обновляет main agent на PR (НЕ здесь).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 (baseline) → T002/T003 [P] (scaffold + fixture helper). T003 используется ВСЕМИ RED-тестами.
- **Tests (Phase 2)**: depends on T002/T003. RED only (падает с RED по отсутствию реализации соответствующего модуля / контрактов). T010–T015 (moves-yaml), T016–T019 (validate), T020–T023 (chain), T024–T030 (build-moves), T031 (moves-loader), T032 (types) — независимы друг от друга (разные файлы). Все [P]. Type-test T032 RED-частично «Cannot find export» до T050 (прецедент 015 A2).
- **Core (Phase 3)**: depends on Phase-2 тесты (GREEN-им их). T050 (contracts source-of-truth mirror — блокирует импорты контрактов во всех runtime-модулях), T051 (barrel) следом; затем T052, T053, T054, T055, T057 [P] — параллельны (независимые модули после contracts); T056 (build.ts оркестрация) зависит от T054 + T055 + T052/T050; T058 (`src/moves/index.ts` + `src/index.ts`) зависит от T056 + T057.
- **Integration (Phase 4)**: depends on Phase 3 (реальные `loadMoves`/`buildMoves`/`buildMovedFile` в `src/index.js`). T080–T089 [P] — один `quickstart.spec.ts`, разные `it` blocks (общий `let project`/`afterEach` cleanup).
- **Polish (Phase 5)**: depends on все фазы.

### Within Each Module

- Тесты (Phase 2/4) падают ДО реализации (RED), затем GREEN (Constitution II). RED-канал: стабы T002 бросают `not implemented`; contracts-импорты — «Cannot find export» до T050.
- Baseline T001 валидируется полным suite green на каждом шаге — observable поведение 011/012/013/014/015 не меняется (зафиксировано в T001).
- `loadMoves` — единственный модуль с fs; `buildMoves`/`buildMovedFile` — чистые (FR-014): кросс-проверка G-тестами и статическим guard T103.

### User Story Coverage & Independent Tests

| US | Priority | RED tests | Integration | Independent Test (mirror spec) |
|----|----------|-----------|-------------|-------------------------------|
| US1 idt-only rename | P1 | T024 | T080 | current `[functions.users / yandex_function.user_api]` + 1 move → `kind:'ok'`, ровно 1 `moved {from: yandex_function.users, to: yandex_function.user_api}` |
| US2 полный rename | P1 | T025 | T081 | current `[functions.user_service / yandex_function.user_service]` + move → `moved[0].to` = current адрес из project model |
| US3 chains multi-hop | P1 | T020, T026 | T082 | current `accounts` + 2-hop §35 → 2 `moved`-блока, хронологически, оба `to = accounts` |
| US4 type-change fail-fast | P1 | T017, T028 | T083 | `from.idt = yandex_function.users`, `to.idt = yandex_container.users` → `MOV_TYPE_CHANGE`, zero `moved` |
| US5 contradictory bindings | P1 | T019 | T084 | same-from-diff-to / same-to-diff-from → `MOV_CONTRADICTORY`, order-independent |
| US6 dangling | P1 | T022 | T085 | терминал не в current → `MOV_TARGET_UNRESOLVED` + `MOV_DANGLING` per entry (N+1) |
| US7 idl-only no-op | P1 | T027 | T086 | `to.idt === from.idt` + терминал current → `kind:'ok'`, `moved === []` |
| US8 формат/грамматика | P2 | T010–T016 | T088 | `version: 2` → `MOV_VERSION`; `moves`/структура/грамматика/no-op → `MOV_INVALID` collect-all |
| US9 optional/determinism | P1 | T023, T029, T031 | T087, T089 | missing file → ok `moves: []`; `moves: []` → `moved === []`; reorder → одинаковый `moved`; два вызова — deep-equal |

### Parallel Opportunities

- Setup: T002/T003 [P].
- Phase 2: все test-задачи [P] (разные `.spec.ts` / `.test-d.ts`).
- Phase 3: после T050/T051 — T052/T053/T054/T055/T057 параллельны; T056 зависит от T054/T055; T058 зависит от T056.
- Integration: T080–T089 [P] в одном файле, разные `it` блоки (общий `let project`/`afterEach` cleanup).
- Polish: T100–T106 — последовательно (T106 последний).

---

## Parallel Example: Phase 3 core modules

```bash
# После contracts (T050–T051) — запустить независимые модули вместе:
Task: "Implement errors.ts (T052), moves-yaml.ts (T053), validate.ts (T054), chain.ts (T055), loader.ts (T057)"
# затем оркестрация + экспорт:
Task: "Implement build.ts (T056), затем moves/index.ts + src/index.ts export (T058)"
```

---

## Implementation Strategy

### MVP First (US1 + US2 core path)

1. Phase 1 Setup — T001 baseline, T002 scaffold `src/moves/`, T003 fixtures (`test/helpers/moves-fixtures.ts`).
2. Phase 2 RED — build-moves (T024/T025), moves-yaml (T010/T011), validate (T016/T017), types (T032).
3. Phase 3 GREEN — contracts (T050–T051) → errors.ts (T052) + validate.ts (T054) + build.ts compile-фаза (US1/US2 emit).
4. **STOP and VALIDATE**: T024 + T025 green — safe rename (idt-only и full) скомпилирован в `moved` с `to` = current. **MVP reached** (US1 + US2, а также US7/FR-011 ядро — idl-only no-block).
5. Цепочки/циклы/terminal (US3/US6), fail-fast (US4/US5), loader/optional (US9), формат (US8 P2) — следующий инкремент.

### Incremental Delivery

1. Setup + 011/012/013/014/015 zero-regression (T001–T003) → foundation.
2. Public contracts + MOV_* (T050–T051).
3. Validation + chain + errors (T052, T054, T055) → resolution-ready.
4. Compile оркестрация build.ts (T056) + loader (T057) + export (T058).
5. Integration Sc1–Sc10 (T080–T089) + Polish (T100–T106).

### Parallel Team Strategy

1. Setup вместе (T001–T003).
2. Developer A: contracts (T050–T051) + validate.ts (T054) + build.ts (T056).
3. Developer B: moves-yaml.ts (T053) + loader.ts (T057).
4. Developer C: chain.ts (T055) + RED-тесты соответствующих модулей.
5. Интеграция + polish после land-а. Все PR в `dev`, ветка `017-moved`.

---

## Ambiguity Surface (surfaced during task decomposition; decisions locked as defaults where repo convention resolves them — VERBATIM, no silent decisions)

**A1 (locked per plan/research 6; оригинал 015 A1 не повторяется).** Каталог `packages/pilot/contracts/` НЕ существует — конвенция репо: каталоги ошибок в `specs/NNN-*/contracts/*.json`. Консистентность MOV_* проверяется против `specs/017-moved/contracts/moves.ts` (byte-for-byte source of truth для src-файла) и `specs/017-moved/contracts/moves.json` `#/errorCodes` (T103). Новый файл не создаётся.

**A2 (locked per 014/015 precedent).** RED-тесты Phase 2/4 импортируют контракты (`MoveEndpoint`, `MOV_*`, результат из `src/index.js`) до T050/T058 — часть RED из-за «Cannot find export»/typecheck-ошибок, не assert-провалов. **Locked**: scaffold (T002) создаёт только runtime-стабы `src/moves/`, контракты в Setup не создаются.

**A3 (locked per 013/015 pattern).** FR-004 требует collect-all для структурных `MOV_INVALID`, но version short-circuits в ОДИН `MOV_VERSION` (не собирая параллельные `MOV_INVALID`). quickstart Sc9 согласуется (строка `version: 2` → один `MOV_VERSION`; collect-all — про структурные `MOV_INVALID`). **Locked**: version short-circuit (013), структура — collect-all.

**A4 (locked per spec/data-model; в отличие от 015).** Missing-file канал loader-а — НЕ throw, а `{kind:'ok', data: {version:1, moves:[]}}`: `moved.yaml` OPTIONAL по FR-002/IDEA §35, `EXT_MISSING_FILE`-аналога НЕТ сознательно. loader-тесты ассертят `kind:'ok'` + `data.moves === []`, а не `toThrow`.

**A5 (locked per research 2/3).** Порядок двух видов: diagnostics — по file order (пер-entry → cross-entry → chain-level по первому появлению entry); compiled `moved` — канонический по `start.idl`/`start.idt` (FR-016: НЕ file order). Смешение — ошибка.

**A6 (locked per spec Assumption).** Связывание цепочек — точное совпадение пары `{idl, idt}`; частичное (только idt) НЕ связывает (research 2 rejected: «использовать только idt»). Terminal match — exact pair; частичное совпадение → unresolved.

**A7 (locked per research 3).** Дубликат пары в `currentResources` — first-wins Map, НОВОГО кода нет (список MOV_* закрыт spec, 8 кодов); дубликат в current — зона проекции 014/021 (open seam). Один current-identity от двух цепочек гарантированно ловится `MOV_CONTRADICTORY` (same to) на фазе validation — доп. проверка не нужна.

**A8 (locked per plan Risks / research 1).** `from`-адрес всё ещё объявлен текущим ресурсом в том же infraDir → Terraform-ambiguity на `plan` — зона deep-TF-валидации (Constitution IV), open seam; MOV_* кода в 017 нет (закрытый список). quickstart Sc10.6 фиксирует только отсутствие I/O/front-влияния.

**A9 (locked per plan).** IDL-грамматика — двухсегментная; «переиспользование» `parseResourceReference` (3 сегмента) — через append dummy-сегмента + `ContractError` catch → `MOV_INVALID`; НЕ конвертируется в 3-сегментный IDR (это другой контракт 009/§16, в 017 не в scope).

**A10 (locked — тест-файл loader).** plan.md test-layout перечисляет `test/unit/{moves-yaml,validate,chain,build-moves}.spec.ts`; loader I/O unit-тесты вынесены в отдельный `test/unit/moves-loader.spec.ts`, т.к. `test/unit/loader.spec.ts` уже занят под `loadExtensions` (015). quickstart Sc8.1 дублирует missing-file через `loadMoves` end-to-end.

---

## Guard Checklist

Before starting implementation, confirm:

1. **Baseline 011/012/013/014/015 green** (`pnpm --filter @ycforge/pilot test` — цифры из T001) до изменений и после каждого шага.
2. **`packages/pilot/package.json` UNCHANGED** — no new runtime deps; `yaml` уже есть (только `moves-yaml.ts`); `node:fs`/`node:path` — builtins.
3. **`packages/pilot/tsup.config.ts` UNCHANGED** — entry `index` + `contracts/index` уже баралируют новый `moves.ts`/`src/moves/` через `export *`.
4. **`test/helpers/moves-fixtures.ts` создан (T003)** — `endpoint()`/`entry()`, `canonicalCurrentResources()`, `movesYaml()`/`canonicalMovesYaml()`, `movesFrom()`, `writeMovedYaml`; механизм: inline-объекты + mkdtemp tmp dirs; process.env-фикстуры ОТВЕРГНУТЫ.
5. **Vitest picks up new paths** — `test/unit/moves-*.spec.ts`, `test/moves/*.spec.ts`, `test/types/moves.test-d.ts` (typecheck include уже `test/types/**/*.test-d.ts`; без правки конфига).
6. **CWD-independence** — ни один тест не зависит от `process.cwd()`; пути — абсолютные (`mkdtemp`), loader-тесты — mkdtemp tmp roots.
7. **tmp dirs cleanup** — каждый `mkdtempSync`/`createTempProject` очищен в `afterEach`/`finally` (`removeTempProject`/`rmSync`), вкл. loader/quickstart сценарии.
8. **Missing-file channel (017 != 015)** — `loadMoves` возвращает `kind:'ok'` c `data.moves === []`, НЕ бросает; тесты ассертят ok-результат, `toThrow` НЕ используется (A4).
9. **CPU-only validate/chain/build (FR-014/SC-009)** — `validate.ts`/`chain.ts`/`build.ts` не имеют fs и не читают/пишут файлы; fs — только в `loader.ts`, yaml — только в `moves-yaml.ts`; статический guard (T103) + integration Sc10.6 (T089) доказывают user `.tf` untouched.
10. **MOV_* constants cross-location** — 8 констант в `src/contracts/moves.ts` byte-identical `specs/017-moved/contracts/moves.ts` и `contracts/moves.json` `#/errorCodes`; сравнение через константы, без string literals (Constitution V); каталог в `packages/pilot/contracts/` НЕ создаётся (A1).
11. **Determinism** — canonical order цепочек `(start.idl, start.idt)` (НЕ file order, FR-016); diagnostics — file order; first-wins maps; два запуска с теми же входами — deep-equal + byte-identical `buildMovedFile` content (T105).
12. **014/002 untouched** — `src/contracts/terraform.ts` (`TerraformMoved`), `src/materialize/{serialize,write,dispatch}.ts` и контракт 002 НЕ изменяются; `moved.ycsf.tf.json` владеется через существующий глоб `*.ycsf.tf.json` (T104).
13. **No commits, no `specs/README.md` changes** — статус 017 🚧 и `.specify/feature.json` обновляет main agent на PR time; `/speckit.tasks` пишет только `specs/017-moved/tasks.md`.

---

## Notes

- [P] tasks = different files, no dependencies.
- Тесты RED → GREEN (Constitution II): RED подтверждается запуском ДО реализации соответствующего модуля; для контрактов RED частично «Cannot find export» до T050 (A2).
- `src/moves/` использует ТОЛЬКО Node builtins (`node:fs`, `node:path`) в `loader.ts` и `yaml` в `moves-yaml.ts`; `validate.ts`/`chain.ts`/`build.ts` — чистая логика над данными, без fs (FR-014).
- `MOV_*` — отдельная семья от `PML_*`/`BRG_*`/`MTL_*`/`EXT_*`; живут в `src/contracts/moves.ts`, зеркало — `specs/017-moved/contracts/moves.ts` + `contracts/moves.json` (T103).
- Публичный API: `loadMoves`, `buildMoves`, `buildMovedFile` через `src/index.ts`; контракты через `@ycforge/pilot/contracts`; `parseMovesYaml`/`validateMoves`/`buildChains` — внутренние (тесты — внутренний путь).
- Сериализация `moved` — переиспользуемый `serializeJson` 014 через wrapper `buildMovedFile`; 017 не вводит собственную сериализацию (research 1/5).
- Кода для «успешного no-op idl-only» и «missing file» НЕТ сознательно (spec Error Codes; FR-002/FR-011).
- Do NOT commit; all checkboxes остаются `- [ ]` до закрытия задач в implement.