---

description: "Task list for spec 002 — @ycforge/pilot/contracts"

---

# Tasks: `@ycforge/pilot/contracts` — контракты экосистемы serverless-tools

**Input**: Design documents from `/specs/002-pilot-contracts/` (spec.md после clarify 2026-09-03, plan.md, research.md, data-model.md, contracts/public-api.md, quickstart.md)

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: INCLUDED (Constitution II, test-first). Каждый test-task пишется ДО реализации и подтверждается RED (type-тесты падают компиляцией, unit-тесты — импортом отсутствующего модуля).

**Organization**: Tasks grouped by user story (US1–US5 из spec.md) для независимой реализуемости и проверяемости.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1…US5 — user story из spec.md
- Include exact file paths in descriptions

## Path Conventions

Монорепа (см. plan.md → Project Structure): исходники контрактов — `packages/pilot/src/contracts/`, тесты — `packages/pilot/test/`, example-пакет — `examples/third-party-contracts-plugin/`. Все пути ниже от корня репозитория.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Инициализация pnpm-воркспейса и скелета пакета `@ycforge/pilot` (кода в репозитории ещё нет — greenfield).

- [X] T001 Create root `package.json` (private, `packageManager: pnpm@11.22.0`, scripts-делегирование `test`/`build` в пакеты через `pnpm -r`) и `pnpm-workspace.yaml` (`packages/*`, `examples/*`); проверить, что `.gitignore` покрывает `node_modules/`, `dist/`, `coverage/`
- [X] T002 [P] Create `packages/pilot/package.json`: имя `@ycforge/pilot`, версия `1.0.0`, `"type": "module"`, exports `{ ".": ..., "./contracts": ... }` (types+import+require на dist), devDependencies `typescript`, `tsup`, `vitest`; НИКАКИХ runtime `dependencies`/`peerDependencies` (FR-019)
- [X] T003 [P] Create `packages/pilot/tsconfig.json` (strict, `module`/`moduleResolution: NodeNext`, `target: ES2022`, `noEmit`, `resolveJsonModule` для version-теста) и `packages/pilot/vitest.config.ts` с `typecheck: { enabled: true, include: ['test/types/**/*.test-d.ts'] }`; тесты пакета импортируют контракты ОТНОСИТЕЛЬНЫМ путём `../../src/contracts/index.js` (dist не требуется; честный subpath-resolution проверяет SC-003 через example-пакет)
- [X] T004 [P] Create `packages/pilot/tsup.config.ts`: entry `src/index.ts` и `src/contracts/index.ts`, format ESM+CJS, dts, clean; создать `packages/pilot/src/index.ts` — placeholder (внутренний entry C, не публичный контракт; `export {}`)
- [X] T005 Run `pnpm install` из корня; проверить резолв воркспейса (`pnpm -r exec node -e "console.log(process.env.npm_package_name)"` или эквивалент)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: diagnostics и версия — зависимость всех остальных контрактов (парсер и predicates бросают `ContractError`).

**⚠️ CRITICAL**: ни одна user story не начинается, пока не завершены T006–T011.

- [X] T006 [P] Write FAILING unit test `packages/pilot/test/unit/contract-error.test.ts` (RED, импорт относительным путём `../../src/contracts/index.js` согласно T003): `ContractError instanceof Error`, `name === 'ContractError'`, поля `code`/`message`, код `Diagnostics.InvalidResourceReference` — на данный момент barrel не экспортирует → RED
- [X] T007 [P] Write FAILING unit test `packages/pilot/test/unit/version.test.ts` (RED): `CONTRACT_VERSION === 1`, экспортируется из barrel
- [X] T008 Create `packages/pilot/src/contracts/diagnostic.ts` (GREEN для T006): `interface Diagnostic { code, message }`, `class ContractError extends Error implements Diagnostic`, namespace-константы кодов `Diagnostics` (GREEN)
- [X] T009 Create `packages/pilot/src/contracts/version.ts` (GREEN для T007): `export const CONTRACT_VERSION = 1 as const`
- [X] T010 Create `packages/pilot/src/contracts/index.ts` — barrel, реэкспорт `diagnostic.ts` и `version.ts` (FR-020: единственная публичная точка входа); запустить `pnpm --filter @ycforge/pilot test` — foundational тесты GREEN
- [X] T011 Write guard test `packages/pilot/test/unit/zero-dependency.test.ts` (SC-001, FR-019): сканирование `src/contracts/**/*.ts` на отсутствие non-relative импортов + assertion, что `package.json` не содержит `dependencies`/`peerDependencies`; GREEN сразу, охраняет на будущее

**Checkpoint**: barrel экспортирует diagnostics + version, foundational тесты зелёные.

---

## Phase 3: User Story 1 — Сторонний разработчик пишет Builder (Priority: P1) 🎯 MVP

**Goal**: type-контракты `Builder`, `BuildContext`, `Artifact` доступны стороннему пакету через единственный subpath import (FR-001…FR-003, FR-015, FR-020); example builder компилируется только от contracts.

**Independent Test**: `pnpm --filter @ycforge/pilot test` (type-тесты fr-001-003 зелёные) + `pnpm --filter @ycforge-example/contracts-plugin test` (tsc --noEmit example builder'а, SC-003 builder-часть).

### Tests for User Story 1 ⚠️ (RED first)

- [X] T012 [US1] Write FAILING type tests `packages/pilot/test/types/fr-001-003-builder.test-d.ts` (RED): сигнатуры `Builder.build(context): Promise<Artifact>` (ровно один Artifact на invocation), `BuildContext` с полями `projectRoot`/`sourcePath?`/`buildConfig: unknown`/`buildEnv`/`outputDir` (FR-002), `Artifact<T>` с `type: string`/`value: T` (FR-003); type-only import только из `@ycforge/pilot/contracts`; `expectTypeOf`-проверки по acceptance scenarios US1 (компилируется без других пакетов, `sourcePath?` опционален)

### Implementation for User Story 1

- [X] T013 [US1] Create `packages/pilot/src/contracts/builder.ts`: `interface Builder`, `interface BuildContext`, `interface Artifact<T = unknown>` строго по data-model.md; документирующие TSDoc (конвенция `type` — `<package-scope>:<kind>`, ссылка на predicate)
- [X] T014 [US1] Update `packages/pilot/src/contracts/index.ts` (реэкспорт builder.ts); `pnpm --filter @ycforge/pilot test` — type-тесты GREEN (SC-002: traceability FR-001…FR-003 → этот файл)
- [X] T015 [US1] Create example-пакет: `examples/third-party-contracts-plugin/package.json` (`@ycforge-example/contracts-plugin`, peer+dev `@ycforge/pilot: workspace:*`, script `test: tsc --noEmit`) и `examples/third-party-contracts-plugin/tsconfig.json` (NodeNext, strict)
- [X] T016 [US1] Write `examples/third-party-contracts-plugin/src/builder.ts`: reference builder `ycforge:function` (type-only import из `@ycforge/pilot/contracts`, `build()` возвращает `Artifact<{archivePath, entryPoint}>`); run `pnpm --filter @ycforge/pilot build` затем `pnpm --filter @ycforge-example/contracts-plugin test` — компиляция успешна (SC-003, builder-часть; GREEN)

**Checkpoint**: US1 самодостаточна: контракты Builder компилируются из внешнего пакета, type-тесты ломаются при смене сигнатуры.

---

## Phase 4: User Story 2 — Materializer и outputs (Priority: P1)

**Goal**: `Materializer`, `MaterializationContext` (только `output`), `OutputBuilder` (FR-005…FR-007), Terraform model `TerraformResource` + `TerraformBlock` (FR-008, FR-009); example materializer декларирует output.

**Independent Test**: type-тесты fr-005-009 зелёные; example materializer компилируется и в type-тестах его `supports`/`materialize` вызываются с mock-контекстом (US2 independent test из spec.md).

### Tests for User Story 2 ⚠️ (RED first)

- [X] T017 [US2] Write FAILING type tests `packages/pilot/test/types/fr-005-009-terraform.test-d.ts` (RED): `Materializer<A>` с синхронным `supports(...): boolean` и `materialize(...): Promise<TerraformResource>`; `MaterializationContext` — ровно `{ output: OutputBuilder }` (FR-006, лишние поля = type error); `OutputBuilder.declare(name, { value, description? }): void` (FR-007); `TerraformResource<T>` `{ kind: 'resource', type, name, configuration }`; `TerraformBlock` — дискриминированный union 5 блоков (FR-009); сужение union по `kind`

### Implementation for User Story 2

- [X] T018 [P] [US2] Create `packages/pilot/src/contracts/terraform.ts`: `TerraformResource` (с `kind: 'resource'`, решение R-05 research.md), `TerraformMoved`/`TerraformVariable`/`TerraformData`/`TerraformOutput`, `type TerraformBlock` — поля строго по data-model.md
- [X] T019 [P] [US2] Create `packages/pilot/src/contracts/materializer.ts`: `Materializer<A extends Artifact = Artifact>`, `MaterializationContext`, `OutputBuilder` с TSDoc (value без `${...}`, duplicate declare = error — семантика из FR-007)
- [X] T020 [US2] Update `packages/pilot/src/contracts/index.ts` (реэкспорт terraform.ts + materializer.ts); type-тесты GREEN
- [X] T021 [US2] Write unit test `packages/pilot/test/unit/materializer-example.test.ts` (US2 Independent Test): локальный reference materializer (self-contained, без импорта example-пакета) вызывается с mock `MaterializationContext`/mock `OutputBuilder`; `supports === true` только для своего `artifact.type`, `false` для чужого; `materialize` резолвится в `TerraformResource` с `kind: 'resource'` и непустыми `type`/`name`; захваченные `output.declare`-вызовы содержат `value` без обёртки `${...}` (FR-007)
- [X] T022 [US2] Write `examples/third-party-contracts-plugin/src/materializer.ts`: reference materializer `ycforge:function` (`supports` по `artifact.type`, `materialize` → `TerraformResource`, `context.output.declare('ycsf_function_user_service_id', { value: 'yandex_function.user_service.id', ... })` — value без `${...}`); `pnpm --filter @ycforge-example/contracts-plugin test` — SC-003 полностью GREEN

**Checkpoint**: US1+US2 работают независимо; example-пакет компилируется целиком (SC-003).

---

## Phase 5: User Story 3 — Диспетчеризация artifact → materializer (Priority: P2)

**Goal**: контрактные предпосылки однозначной диспетчеризации (FR-014): строковый `Artifact.type`, синхронный boolean `supports` + predicate формата типа (FR-004). Сама диспетчеризация и коллизии — зона C (вне scope).

**Independent Test**: type-тесты fr-014/016 и unit-тест artifact-type зелёные; детекция коллизий «по `supports` до `materialize`» демонстрируется type-тестом.

### Tests for User Story 3 ⚠️

- [X] T023 [US3] Write FAILING tests `packages/pilot/test/types/fr-014-dispatch.test-d.ts` (RED): `Artifact['type']` — `string`; `Materializer.supports` — синхронная чистая `(artifact, context) => boolean` (не Promise); type-уровневые сценарии: два materializer-а с `supports === true` для одного типа типобезопасно перебираются до вызова `materialize`; type-assertions `ContractError implements Diagnostic` (FR-016, SC-002 traceability)

### Implementation for User Story 3

- [X] T024 [US3] Create `packages/pilot/src/contracts/artifact-type.ts`: `ARTIFACT_TYPE_PATTERN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/` (frozen), `isArtifactType(value: string): boolean` — pure (FR-004)
- [X] T025 [US3] Write unit test `packages/pilot/test/unit/artifact-type.test.ts`: `true` для `ycforge:function`, `ycforge:api-gateway`; `false` для `function`, `Ycforge:function`, `ycforge:`, `:function`, `ycforge:api_gateway` (underscore в kind не допускается по data-model.md); pure (нет throws/эффектов)
- [X] T026 [US3] Update `packages/pilot/src/contracts/index.ts` (реэкспорт artifact-type.ts); type-тесты + unit-тесты GREEN; `pnpm --filter @ycforge/pilot test` полностью зелёный

**Checkpoint**: контракты допускают диспетчеризацию по `type` с pairwise-детекцией коллизий со стороны C (FR-014); predicate формата типа доступен C для `ycsf check` (зона C).

---

## Phase 6: User Story 4 — ResourceReference и парсер (Priority: P2)

**Goal**: `ResourceReference` (FR-010), canonical парсер/форматтер `domain.name.property` (FR-011, FR-012), round-trip, типизированные отказы; IDL/IDT/IDR фиксация в типах (FR-013).

**Independent Test**: unit-тесты парсера зелёные: 100% канонических примеров IDEA §15 проходят round-trip, 100% невалидных входов отклоняются `ContractError` (SC-004).

### Tests for User Story 4 ⚠️ (RED first)

- [X] T027 [US4] Write FAILING unit tests `packages/pilot/test/unit/resource-reference.test.ts` (RED) и `packages/pilot/test/examples/acceptance-canonicals.test.ts` (SC-004): round-trip `functions.user_service.id`, `containers.analytics.id`, `queues.events.qurl`, `buckets.frontend.name`; разбор на `{domain, name, property}`; невалидные: `functions.user_service` (двухсегментная — clarify 2026-09-03), `functions..id`, `Functions.user_service.id`, `functions.user-service.id` (hyphen в name), `functions.user_service.id.extra`, пустая строка — все бросают `ContractError` с `code === Diagnostics.InvalidResourceReference`; молчаливый `undefined` не допускается

### Implementation for User Story 4

- [X] T028 [US4] Create `packages/pilot/src/contracts/resource-reference.ts`: `interface ResourceReference { ref: string }`, `interface ParsedResourceReference { domain, name, property }`, `parseResourceReference(ref): ParsedResourceReference` (бросает `ContractError`, грамматика сегмента `[a-z][a-z0-9_]*`, ровно 3 сегмента), `formatResourceReference(parsed): string` — чистые функции по data-model.md
- [X] T029 [US4] Write type tests `packages/pilot/test/types/fr-010-013-reference.test-d.ts` (SC-002): `ResourceReference` — единственное поле `ref: string`; сигнатуры парсера/форматтера; update `packages/pilot/src/contracts/index.ts`; все тесты US4 GREEN

**Checkpoint**: парсер canonical reference работает, отказы типизированы, round-trip без потерь (SC-004).

---

## Phase 7: User Story 5 — Совместимость версий (Priority: P3)

**Goal**: `CONTRACT_VERSION` как носитель версии plugin API, проверка соответствия semver major пакета (FR-017, FR-018, SC-005).

**Independent Test**: `version.test.ts` зелёный: `CONTRACT_VERSION === semver.major(version пакета)`; правило migration guide на major > 1 зафиксировано.

### Tests for User Story 5 ⚠️

- [X] T030 [US5] Extend `packages/pilot/test/unit/version.test.ts`: читает `packages/pilot/package.json`, утверждает `CONTRACT_VERSION === Number(pkg.version.split('.')[0])` (SC-005); process-check: если major > 1 — существует `packages/pilot/MIGRATION.md` (на v1 тривиально истинен, правило закреплено)

### Implementation for User Story 5

- [X] T031 [US5] Document versioning rules in `packages/pilot/README.md`: две независимые линии (plugin API = semver major пакета; `.ycsf/*.yaml` `version` — отдельная линия, clarify 2026-09-03), breaking change → major + `MIGRATION.md`; ссылка на spec и IDEA §43

**Checkpoint**: версия контракта проверяема тестом; релизные правила задокументированы.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: сквозная проверка со spec/plan/quickstart.

- [X] T032 [P] Run quickstart validation end-to-end: сценарии 1–4 из `specs/002-pilot-contracts/quickstart.md` (test, example gate, zero-dep, build) — все GREEN
- [X] T033 [P] Sweep TSDoc/комментарии `packages/pilot/src/contracts/**` на соответствие финальному поведению (семантика duplicate declare, value без `${...}`, грамматика ref, kind-дискриминант)
- [X] T034 Full clean verification: удалить `dist/` и `node_modules/.cache`, `pnpm install && pnpm -r test && pnpm --filter @ycforge/pilot build` — всё зелёное с чистого состояния

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — старт сразу
- **Foundational (Phase 2)**: зависит от Setup; BLOCKS все user stories
- **User Stories (Phase 3–7)**: зависят от Foundational; US1 → US2 → US3 → US4 → US5 (US3–US5 формально независимы друг от друга после Foundational и могут идти параллельно; порядок выбран по приоритетам P1→P3)
- **Polish (Phase 8)**: зависит от всех story-фаз

### User Story Dependencies

- **US1 (P1)**: после Foundational; независима от остальных stories
- **US2 (P1)**: после Foundational + US1 barrel-структуры (по сути shared package, интеграция через barrel)
- **US3 (P2)**: после Foundational; type-тесты опираются на US1/US2-контракты, но story самостоятельна
- **US4 (P2)**: после Foundational (нужен `ContractError` из Phase 2); независима от US1–US3
- **US5 (P3)**: после Foundational (нужен `CONTRACT_VERSION` из Phase 2); независима

### Within Each User Story

- Test-task пишется и подтверждается RED ДО implementation tasks
- Barrel update (`src/contracts/index.ts`) — последним шагом story (единственный shared-файл, конфликты [P]-задач недопустимы)
- Story checkpoint перед переходом к следующей

### Parallel Opportunities

- Phase 1: T002, T003, T004 параллельны; T006, T007 параллельны
- Phase 2: T018↔T019 (разные файлы) — после T017
- Phase 6: unit-тесты (T027) пишутся ДО реализации T028 (RED); type-тесты + barrel (T029) — после T028; T027 и T029 — разные файлы
- Barrel-update задачи (T010, T014, T020, T025, T029) — всегда последовательно, не [P]

---

## Parallel Example: User Story 4

```bash
# После T027 (реализация парсера):
Task: "type tests fr-010-013-reference.test-d.ts + barrel update" (T028)
Task: "run full pilot test suite" (часть T028)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup) → Phase 2 (Foundational)
2. Phase 3 (US1: Builder-контракты + example builder)
3. **STOP and VALIDATE**: type-тесты fr-001-003 зелёные, example builder компилируется (SC-003 builder-часть)

### Incremental Delivery

1. Setup + Foundational → barrel с diagnostics/version
2. US1 → Builder контракты + example builder → validate
3. US2 → Materializer/Terraform + example materializer → SC-003 полный → validate
4. US3 → dispatch-контракты + artifact-type predicate → validate
5. US4 → ResourceReference парсер → SC-004 → validate
6. US5 → version checks + docs → validate
7. Polish → quickstart end-to-end

### Traceability Map (SC-002)

| FR | Тест-файл |
|---|---|
| FR-001…FR-003 | `test/types/fr-001-003-builder.test-d.ts` |
| FR-004 | `test/unit/artifact-type.test.ts` + `test/types/fr-004-artifact-type.test-d.ts` |
| FR-005…FR-009 | `test/types/fr-005-009-terraform.test-d.ts` |
| FR-010…FR-013 | `test/types/fr-010-013-reference.test-d.ts` + `test/unit/resource-reference.test.ts` |
| FR-014, FR-016 | `test/types/fr-014-dispatch.test-d.ts` + `test/unit/contract-error.test.ts` |
| FR-017, FR-018 | `test/unit/version.test.ts` |
| SC-001 | `test/unit/zero-dependency.test.ts` |
| SC-003 | `examples/third-party-contracts-plugin` (tsc --noEmit gate) + `test/unit/example-imports.test.ts` |
| SC-004 | `test/examples/acceptance-canonicals.test.ts` |

---

## Notes

- [P] tasks = different files, no dependencies; barrel (`src/contracts/index.ts`) — исключение, всегда последовательно
- Каждый test-task: сначала RED (компиляция/импорт падает), затем implementation → GREEN
- Commit после каждой story-phase (checkpoint), не раньше
- Остановка на любом checkpoint для независимой валидации story
- Избегать: задач без файлов, [P] на одном файле, импортов вне barrel в example-пакете

---

## Phase 9: Convergence

**Purpose**: закрытие gaps, найденных converge-прогоном после implement.

- [X] T035 Add type test `packages/pilot/test/types/fr-004-artifact-type.test-d.ts`: сигнатуры `isArtifactType(value: string): boolean` и `ARTIFACT_TYPE_PATTERN: RegExp` (SC-002 — compile-time coverage для FR-004; missing)
- [X] T036 Add guard test `packages/pilot/test/unit/example-imports.test.ts`: сканирование `examples/third-party-contracts-plugin/src/**/*.ts` — все import-specifier'ы начинаются с `@ycforge/pilot/contracts`; любой другой источник (внутренние пути pilot, другие пакеты монорепы) — fail (SC-003 / US1 Independent Test; missing)
- [X] T037 Update `specs/002-pilot-contracts/quickstart.md`: сценарий 2 (example gate) теперь самостоятельен благодаря `pretest`-сборке pilot — убрать устаревшую зависимость от сценария 4, указать фактический порядок (quickstart сценарии 2↔4; partial)
