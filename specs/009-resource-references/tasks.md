# Tasks: resource-references — IDL/IDT/IDR, `${resources...}` template, ENV-only (Project B / composer)

**Input**: Design documents from `/specs/009-resource-references/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/resource-references.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. Test-first is mandated by Constitution II: acceptance criteria from the spec become tests BEFORE implementation; confirm RED, then GREEN. Spec 009 depends on spec 002 (`parseResourceReference` from `@ycforge/pilot/contracts`) and retargets spec 008 authorizer emission.

## Format: `[ID] [P?] [Story] Description (FR-xxx; AC)`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4) — only for US-phase tasks
- **Tail**: every task ends with `(FR-xxx; spec AC)` references; test tasks additionally end with `— RED: <what the test observes before implementation>` (failure mode)
- Include exact file paths in descriptions
- Test-first per Constitution II: within each US phase, contract/acceptance tests come BEFORE the implementation task

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the `@ycforge/pilot` workspace devDependency and extend `noExternal` bundling (mirror 007's `yaml` noExternal) so composer can reuse the spec 002 `parseResourceReference` runtime function while keeping zero *published* runtime deps; scaffold the `src/resource/` module skeleton and fixtures directory.

- [ ] T001 [P] Add `@ycforge/pilot`: `"workspace:*"` as a `devDependencies` entry in `packages/composer/package.json` and extend `noExternal: ['yaml', '@ycforge/pilot']` in `packages/composer/tsup.config.ts` (007 yaml convention — zero published runtime deps preserved; plan §Source Layout; research R5/R7; FR-005; 002 re-export seam) — RED: `@ycforge/composer` build leaves `@ycforge/pilot` external → published manifest gains a runtime dep
- [ ] T002 [P] Create the `packages/composer/src/resource/` directory skeleton with `refs/` subdirectory and a placeholder `index.ts` (empty module to be filled across US phases); create empty `packages/composer/test/fixtures/resource-valid/` fixture root marker to confirm fixtures land tracked (plan §Source Layout; research R7)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `ResourceRefError` taxonomy with deterministic codes, the resource domain model (`ResourceDomain` + `DOMAIN_PROPERTIES` fixed map), and the `ResourceIndex`/`EnvMapping` container types + `REFERENCE_BEARER_FIELDS` contract list — the primitives that BLOCK every user story. Project-root resolution: `.ycsf/` files are resolved from `compositionRoot` (assumption: `resources.yaml`/`env.yaml` live at `<compositionRoot>/.ycsf/`); missing file → empty construct (FR-001/FR-010).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundational (write FIRST, confirm RED)

- [ ] T003 [P] Write `packages/composer/src/resource/errors.spec.ts`: `ResourceRefError` is `instanceof Error` with `name: 'ResourceRefError'`; carries a code from the contract union (all `RESOURCE_REF_*` codes, incl. `RESOURCE_REF_COLLISION_APPS_RESOURCES` defined but NOT thrown by B — seam 009→011) and its contract context fields (`filePath`, `version`, `domain`, `name`, `property`, `allowedProperties`, `input`, `reason`, `reference`, `envVar`); messages are English, deterministic, built ONLY from context (contracts §Error Taxonomy; FR-001..020; SC-002/003) — RED: `resource/errors.ts` does not exist

### Implementation for Foundational

- [ ] T004 [P] Create `packages/composer/src/resource/types.ts`: `ResourceDomain = 'functions'|'queues'|'buckets'|'containers'|'gateways'`; `DOMAIN_PROPERTIES: ReadonlyMap<ResourceDomain, ReadonlySet<string>>` with `functions{id}`, `queues{qurl}`, `buckets{name}`, `containers{id}`, `gateways{id}` (data-model §ResourceDomain; FR-004; clarify Q1 → Variant A); `ResourceIndex { entries: ReadonlyMap<ResourceDomain, ReadonlyMap<string, ReadonlySet<string>>>; has(); getProperties(); validateProperty() }`; `EnvMapping { entries: ReadonlyMap<ResourceDomain, ReadonlyMap<string, ReadonlyMap<string, string>>>; getEnvVar(); hasEntry() }`; `ReferenceBearerField { path; domain; property }` and `REFERENCE_BEARER_FIELDS` with the single 009 field `['components','securitySchemes','*','x-yc-apigateway-authorizer','function_id']` `domain: 'functions'`, `property: 'id'` (contracts §Public API; FR-019; clarify Q3 → Variant B) — GREEN T003
- [ ] T005 [P] Create `packages/composer/src/resource/errors.ts`: `ResourceRefErrorCode` union with all codes from the contract table (`RESOURCE_REF_VERSION_UNSUPPORTED`, `RESOURCE_REF_INVALID_YAML`, `RESOURCE_REF_DOMAIN_UNKNOWN`, `RESOURCE_REF_PROPERTY_INVALID`, `RESOURCE_REF_IDENTITY_COLLISION`, `RESOURCE_REF_NOT_DECLARED`, `RESOURCE_REF_SYNTAX_INVALID`, `RESOURCE_REF_ENV_NOT_SET`, `RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED`, `RESOURCE_REF_ENV_UNDECLARED_RESOURCE`, `RESOURCE_REF_COLLISION_APPS_RESOURCES`) + `ResourceRefError extends Error` carrying `code` and `context`; every fail-fast source (data-model rules FR-001..020) maps to exactly one code; `RESOURCE_REF_COLLISION_APPS_RESOURCES` defined but never thrown (documented seam 009→011, FR-016) (contracts §Error Taxonomy; data-model §Validation Rules; FR-016) — GREEN T003
- [ ] T006 Create `packages/composer/src/resource/refs/parser.ts`: re-export `parseResourceReference` + `formatResourceReference` + types from `@ycforge/pilot/contracts` (spec 002) — single canonical parser, no reimplementation (FR-005; Constitution I; research R5); assert `format(parse(x)) === x` round-trip in a tiny spec in `parser.spec.ts` (SC-003; data-model §ResourceReference) — GREEN (parser re-export exists)
- [ ] T007 Create `packages/composer/src/resource/refs/template.ts`: template-syntax constants + a `TEMPLATE_RE` matching `^\$\{resources\.([a-z][a-z0-9_]*)\\.([a-z][a-z0-9_]*)\\.([a-z][a-z0-9_]*)\}$` and a `makeTemplate(parsed)` helper producing `${resources.<domain>.<name>.<property>}`; malformed template → no match (FR-005/007; clarify Q1/Q3; research R2) — GREEN (template helpers)

**Checkpoint**: error taxonomy + domain model + index/mapping types + parser re-export green; user stories can now begin sequentially.

---

## Phase 3: User Story 1 — Автор объявляет external-ресурсы в `resources.yaml`, B валидирует декларацию (Priority: P1) 🎯 MVP

**Goal**: read `<compositionRoot>/.ycsf/resources.yaml` (`version: 1`); validate structure — known domains (fixed 5), allowed property per domain, unique identity per `domain.name`, resource value is an object; build an immutable `ResourceIndex` (missing file → empty index, FR-001). Every invalid state is a deterministic fail-fast with domain/name/field; input YAML never mutated.

**Independent Test**: canonical fixture `resource-valid/` (all 5 domains) loads without error and reads references; each broken fixture (`bad-version`, `unknown-domain`, `invalid-property`, `duplicate-identity`, `malformed-yaml`) rejects with `ResourceRefError` naming the offending value.

### Tests for User Story 1 (write FIRST, confirm RED)

- [ ] T008 [P] [US1] Write `packages/composer/src/resource/resource-index.spec.ts` (inline YAML documents via `yaml` parse): canonical `resources.yaml` with all 5 domains → `ResourceIndex` built, `has('queues','events')` true, `getProperties('functions','legacy_authorizer')` = `{id}`, `validateProperty('queues','events','name')` false (US1/AC1; FR-001/004; SC-002); empty/absent file → empty index, NO error (FR-001; Edge cases); `version: 2` → `RESOURCE_REF_VERSION_UNSUPPORTED` with `filePath` + `version` (US1/AC2; FR-002); duplicate `domain.name` → `RESOURCE_REF_IDENTITY_COLLISION` with domain+name (US1/AC3; FR-003); `databases: {...}` → `RESOURCE_REF_DOMAIN_UNKNOWN` (US1/AC5; FR-004); `queues.events` with property `name` (invalid for queues) → `RESOURCE_REF_PROPERTY_INVALID` with domain/name/property/allowed (US1/AC4; FR-004); non-object resource value → fail-fast (FR-001) — RED: `resource-index.ts` does not exist
- [ ] T009 [P] [US1] Write `packages/composer/src/resource/resource-index.spec.ts` (byte-parity): after loading a fixture the source YAML file bytes are identical to before (input never mutated, FR-001; SC-002) — RED: loader mutates input

### Implementation for User Story 1

- [ ] T010 [US1] Implement `packages/composer/src/resource/resource-index.ts`: `loadResourceIndex(compositionRoot)` — read `<compositionRoot>/.ycsf/resources.yaml` via `yaml` v2 (`uniqueKeys` for duplicate-key detection, 007 convention); missing file → empty `ResourceIndex` (NOT error, FR-001); validate `version === 1`; top-level keys ⊆ fixed `DOMAIN_PROPERTIES` keys; per domain name-uniqueness; resource value must be object (empty object = all domain properties valid); explicit property list validated against `DOMAIN_PROPERTIES`; build immutable index (deep-freeze or read-only) (US1/AC1..5; FR-001..004; data-model §ResourceIndex) — GREEN T008/T009

**Checkpoint**: US1 green — index build + fail-fast taxonomy for `resources.yaml` holds. MVP half complete.

---

## Phase 4: User Story 2 — Композиция ссылается на ресурс; B валидирует ссылку по индексу (Priority: P1) 🎯 MVP

**Goal**: parse logical template strings `${resources.<domain>.<name>.<property>}` via 002 `parseResourceReference`; validate the reference against the `ResourceIndex` — unknown domain/name/property → deterministic fail-fast naming the reference; malformed-string → fail-fast with syntax reason. B never resolves real IDR.

**Independent Test**: validate fixture refs — existing resource passes; `nonexistent` name / unknown domain / invalid property each reject with the referencing template in the message.

### Tests for User Story 2 (write FIRST, confirm RED)

- [ ] T011 [P] [US2] Write `packages/composer/src/resource/reference-resolver.spec.ts` (inline index + refs): `${resources.functions.legacy_authorizer.id}` → `{valid: true, parsed: {domain:'functions', name:'legacy_authorizer', property:'id'}}` (US2/AC1; FR-005/006); `${resources.functions.nonexistent.id}` → `RESOURCE_REF_NOT_DECLARED` with domain+name+reference (US2/AC2; FR-006); `${resources.databases.events.id}` → `RESOURCE_REF_DOMAIN_UNKNOWN` with reference (US2/AC3; FR-006); `${resources.queues.events.name}` (name invalid for queues) → `RESOURCE_REF_PROPERTY_INVALID` with reference (US2/AC4; FR-006); malformed `${resources.functions.legacy_id}` (3 segments required) → `RESOURCE_REF_SYNTAX_INVALID` with input+reason (FR-005; Edge cases §strict form) — RED: `reference-resolver.ts` does not exist
- [ ] T012 [P] [US2] Write `packages/composer/src/resource/reference-resolver.spec.ts` (foreign interpolation namespaces): `${var.foo}` (APIGW), `${yandex_function.x.id}` (Terraform), `{{$ENV}}` (build ENV) are NOT 009 references — validator returns `valid: false` with `RESOURCE_REF_SYNTAX_INVALID` OR is skipped by callers because they don't match `TEMPLATE_RE` (caller-level guard; FR-014/019; Edge cases) — RED: resolver treats non-`resources` interpolations as refs

### Implementation for User Story 2

- [ ] T013 [US2] Implement `packages/composer/src/resource/reference-resolver.ts`: `validateResourceReference(ref, index)` — if `TEMPLATE_RE` doesn't match the whole string → not a 009 reference (return a typed `notAReference` result for FR-014); else extract `domain.name.property` (strip `${resources.` prefix / `}` suffix), call 002 `parseResourceReference` on the inner `domain.name.property` (malformed → `RESOURCE_REF_SYNTAX_INVALID` with reason), then validate domain in `DOMAIN_PROPERTIES` → name in index → property in domain's allowed set; each miss → the mapped code + `reference` context (US2/AC1..4; FR-005/006; data-model §Validation Rules; research R2) — GREEN T011/T012

**Checkpoint**: US2 green — reference validation taxonomy holds; MVP (US1+US2) demonstrable end-to-end.

---

## Phase 5: User Story 3 — B эмитит logical template-синтаксис в артефакт (шов к 008) (Priority: P1) 🎯 MVP

**Goal**: retarget 008 authorizer emission — the function-authorizer `function_id` in `auth-apply.ts:45` changes from `scheme.function.ref` (bare `functions.<name>`) to template form `${resources.functions.<name>.id}` (FR-013), validated against the resource index (undeclared function name → fail-fast `RESOURCE_REF_NOT_DECLARED`, FR-008). Additive contract change (Constitution III): 008 contract v1 unchanged, field semantics preserved (logical ref, not IDR). Determinism: order-independent result (FR-018).

**Independent Test**: compose fixture with a `function` authorizer scheme + `resources.yaml` declaring the referenced function → `function_id` equals `${resources.functions.<name>.id}`; undeclared variant → `RESOURCE_REF_NOT_DECLARED`; artifact contains no IDR / `$${...}` / provisioning traces; reorder participants → byte-identical.

### Tests for User Story 3 (write FIRST, confirm RED)

- [ ] T014 [P] [US3] Extend `packages/composer/src/compose/auth-apply.spec.ts` (inline authYaml + index): retarget — given a `function` scheme `functions.internal_authorizer` declared in the index, `applyAuth`/the retarget hook emits `function_id: '${resources.functions.internal_authorizer.id}'` NOT `functions.internal_authorizer` (US3/AC1; FR-007/013); undeclared function name → `RESOURCE_REF_NOT_DECLARED` with name (US3/AC2; FR-008); jwt emission UNCHANGED (openIdConnect form per 008 Variant A — untouched) (US3/AC1; FR-012/013); no `$${...}` / IDR / `service_account_id` in output (US3/AC3; FR-015; Constitution I/IV) — RED: `auth-apply.ts` emits bare `functions.<name>`
- [ ] T015 [P] [US3] Extend `packages/composer/src/compose/compose.spec.ts` (inline docs + inline index): deterministic emission — same inputs & resource index → byte-identical `document`; participant reorder → byte-identical template references (US3/AC4; FR-018) — RED: emission depends on input order

### Implementation for User Story 3

- [ ] T016 [US3] Modify `packages/composer/src/compose/auth-apply.ts`: `applyAuth(document, authYaml, resourceIndex?, functions?)` — pass the `ResourceIndex` from compose; in `functionSchemeRecord`, replace `function_id: scheme.function.ref` with `function_id: makeTemplate({domain:'functions', name: <funcNameFromRef>, property:'id'})`; before emitting, `validateResourceReference`-equivalent check that `functions.<name>` exists in the index → else `RESOURCE_REF_NOT_DECLARED`; jwt path untouched (US3/AC1..3; FR-007/008/013; research R6) — GREEN T014
- [ ] T017 [US3] Modify `packages/composer/src/compose/compose.ts`: build `ResourceIndex` via `loadResourceIndex(request.compositionRoot)` in the READ stage and thread it through `applyAuth`; keep ENV-resolution out of this stage (US4 wires it after compose; data-model §State transitions stage order) (FR-007/008/013/018; US3; research R7) — GREEN T015
- [ ] T018 [P] [US3] Create fixtures under `packages/composer/test/fixtures/`: `resource-valid/` canonical (all 5 domains per plan §Source Layout); `resource-bad-version/`, `resource-unknown-domain/`, `resource-invalid-property/`, `resource-duplicate-identity/`, `resource-malformed-yaml/` (each one broken declaration per quickstart US1); `resource-collision/` documented seam marker (no B behavior asserted — FR-016/SC-006) (quickstart; US1/AC2..5; FR-001..004)
- [ ] T019 [P] [US3] Create the compose-integration fixture `packages/composer/test/fixtures/compose-resource/`: reuse the 008-style `compose-app/` canonical shape as participants (`user_service` + `analytics` OpenAPI docs) + composition-root `.ycsf/resources.yaml` declaring `functions.internal_authorizer` so the retarget has a valid target (quickstart; US3/AC1; FR-013) — a positive fixture for end-to-end template emission

**Checkpoint**: US3 green — retarget holds: template emission + index validation + no-provisioning-traces + determinism. MVP complete.

---

## Phase 6: User Story 4 — ENV-only режим: B подставляет реальные значения (Priority: P2)

**Goal**: at compose-time, for each reference-bearing field (contract list — 009 has only authorizer `function_id`, FR-019) with an `env: VAR` declaration in `<compositionRoot>/.ycsf/env.yaml`, read `process.env[VAR]` and write the ACTUAL value into the field (fully materialized spec, no `${VAR}` strings); missing/empty env → fail-fast `RESOURCE_REF_ENV_NOT_SET` naming VAR + reference; `default:` field → fail-fast `RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED`; env.yaml referencing undeclared resource → fail-fast `RESOURCE_REF_ENV_UNDECLARED_RESOURCE`; no env declaration for a field → template preserved (not an error). Targeted resolution ONLY (fields from `REFERENCE_BEARER_FIELDS`); other `${resources...}` strings pass verbatim.

**Independent Test**: fixture with env.yaml + env set → real value in `function_id`; env unset/empty → `RESOURCE_REF_ENV_NOT_SET`; `default:` → `RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED`; env.yaml absent / entry absent → template preserved; unused env entries → no error; non-`function_id` `${resources...}` untouched.

### Tests for User Story 4 (write FIRST, confirm RED)

- [ ] T020 [P] [US4] Write `packages/composer/src/resource/env-mapping.spec.ts` (inline YAML): `env.yaml` with `functions.legacy_authorizer.id: {env: LEGACY_AUTHORIZER_ID}` → `EnvMapping.getEnvVar('functions','legacy_authorizer','id')` = `LEGACY_AUTHORIZER_ID` (US4/AC1; FR-009); absent file → empty mapping, no error (FR-010); `default:` field → `RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED` (US4/AC5; FR-020); entry for undeclared resource (not in index) → `RESOURCE_REF_ENV_UNDECLARED_RESOURCE` with domain/name/property (FR-012); unused entries → allowed, no error (Edge cases; FR-019); malformed leaf (not an object / non-string env) → fail-fast (FR-009; data-model) — RED: `env-mapping.ts` does not exist
- [ ] T021 [P] [US4] Extend `packages/composer/src/resource/reference-resolver.spec.ts` (inline document + mapping + `process.env` stub): resolveReferences resolves ONLY the `function_id` field (targeted, FR-019): entry + env set → field becomes actual value, NO `${...}` remains anywhere in document (US4/AC1; FR-009; SC-005); entry + env unset/empty (sandbox `delete process.env[VAR]`) → `RESOURCE_REF_ENV_NOT_SET` with envVar+reference (US4/AC3; FR-011); entry absent for the field / no env.yaml → `function_id` keeps `${resources...}` template, no error (US4/AC2/AC4; FR-010); a `${resources...}` in a NON-reference field (e.g. `description`) → untouched verbatim (FR-019; clarify Q3) — RED: `resolveReferences` does not exist
- [ ] T022 [P] [US4] Extend `packages/composer/src/resource/reference-resolver.spec.ts` (determinism): same document + env (with env set) twice → byte-identical output (FR-018; contract §Determinism) — RED: resolution is stateful/order-dependent

### Implementation for User Story 4

- [ ] T023 [US4] Implement `packages/composer/src/resource/env-mapping.ts`: `loadEnvMapping(compositionRoot, resourceIndex)` — read `<compositionRoot>/.ycsf/env.yaml` (missing → empty `EnvMapping`); validate `version === 1`; structure mirrors `DOMAIN_PROPERTIES`; every leaf `{ env: <non-empty string> }`; `default:` → `RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED`; every `domain.name.property` MUST exist in the index → else `RESOURCE_REF_ENV_UNDECLARED_RESOURCE`; unused entries allowed (US4/AC5; FR-009/010/012/020; data-model §EnvMapping) — GREEN T020
- [ ] T024 [US4] Implement `packages/composer/src/resource/reference-resolver.ts` `resolveReferences(document, envMapping, fields)`:
  - worker: walk the document following each `field.path` (support `*` segment for the securityScheme name); for every matched string value, if it matches `TEMPLATE_RE` → parse; if `envMapping.hasEntry(...)` AND `process.env[var]` is non-empty → write actual value; if entry present but env unset/empty → throw `RESOURCE_REF_ENV_NOT_SET`; if entry absent → leave template verbatim; 
  - targeted: only fields listed in `REFERENCE_BEARER_FIELDS` are processed — other strings never touched (FR-019);
  - retarget-input compatibility: this stage accepts either the already-retargeted `${resources...}` form or (for the transition) bare `functions.<name>` — resolves the same (research R6);
  - pure + deterministic: no order dependence, stable field order (FR-018; contract §Determinism) (US4/AC1..6; FR-009..012; SC-005) — GREEN T021/T022
- [ ] T025 [US4] Modify `packages/composer/src/compose/compose.ts`: after `applyOverrides` + final `sortRecordKeys`, if `request.envOnly === true` (or when env.yaml exists — decide per plan §Open Decisions 1: default = process env.yaml whenever present; `envOnly` flag NOT part of the 009 contract surface) load `EnvMapping` and call `resolveReferences(document, envMapping, REFERENCE_BEARER_FIELDS)` on the final `document`; provenance unchanged; compose returns `ComposeResult` as before (US4/AC1/AC6; FR-009/010/019; data-model §State transitions final stage) — GREEN (compose spec RED for env resolution)
- [ ] T026 [P] [US4] Create ENV fixtures under `packages/composer/test/fixtures/`: `resource-env/` (canonical env.yaml + resources.yaml; env var values read from test `process.env` — set per test, scoped + restored in afterEach), `resource-no-env/` (resources.yaml only), `resource-env-not-set/` (env.yaml declaring a var the test deliberately does not set), `resource-env-default/` (`default:` present), `resource-env-undeclared/` (env.yaml referencing a resource absent from resources.yaml) (quickstart US4; FR-009..012/020)

**Checkpoint**: US4 green — ENV-only fully materialized path + targeted resolution + fail-fast taxonomy holds.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: integration test coverage for all US scenarios end-to-end, delegation/byte-parity and foreign-interpolation guarantees, quickstart validation, gates.

- [ ] T027 [P] Write `packages/composer/test/resource-references.integration.spec.ts` (resolves fixture roots via `fileURLToPath(new URL('./fixtures/…', import.meta.url))`, 006/007 pattern): US1 canonical `resource-valid/` → index built + read refs (SC-002); each broken fixture rejects with the mapped `RESOURCE_REF_*` code + context (SC-002/003); US2 validate refs against index (SC-003); US3 `compose-resource/` → `function_id: '${resources.functions.internal_authorizer.id}'` end-to-end + NO provisioning traces + determinism under participant reorder (SC-004/FR-018); US4 ENV fixtures → real value / fail-fast / template-preserved / default-rejected / targeted-only (SC-005); foreign interpolation `resource-*` fixture with `${var.foo}` and `{{$ENV}}` inside a non-reference field → passes verbatim, no error (SC-006/FR-014); seam `resource-collision/` documents app-vs-resource NOT handled (SC-006/FR-016) — RED: integration scenarios fail (module missing/misbehavior)
- [ ] T028 [P] Add `packages/composer/src/resource/errors.spec.ts` coverage: `RESOURCE_REF_COLLISION_APPS_RESOURCES` exists in the code union but `loadResourceIndex` NEVER throws it (FR-016; seam 009→011 documented — Constitution I/VI) — RED: B throws the collision code
- [ ] T029 [P] Zero-runtime-deps guard: assert `packages/composer/package.json` `dependencies` is empty/absent and `@ycforge/pilot` is in `devDependencies` only; assert `tsup.config.ts` keeps `noExternal` covering `@ycforge/pilot` (007 convention; research R5; SC-004) — RED: composer gain a published runtime dep
- [ ] T030 [P] Foreign-interpolation unit coverage in `reference-resolver.spec.ts`: `${var.foo}`, `yandex_function.*`, `{{$ENV}}` inside reference-bearing FIELD → NOT a 009 reference → template preserved verbatim (no crash, no resolution attempt) (FR-014; Edge cases) — RED: resolver crashes on non-resources interpolations
- [ ] T031 Run `specs/009-resource-references/quickstart.md` validation scenarios end-to-end (`pnpm --filter @ycforge/composer test`, all green) and record outcomes in `specs/009-resource-references/quickstart-outcomes.md` (quickstart; SC-001)
- [ ] T032 Gates: `pnpm --filter @ycforge/composer test` green (baseline 207 + new suites), `pnpm --filter @ycforge/composer typecheck` 0 errors, root `pnpm lint` clean, root `pnpm test` (baseline 704) green, `pnpm build` ok (SC-001; gates)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: adds `@ycforge/pilot` workspace devDep + `noExternal` — no dependencies
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3+)**: all depend on Foundational completion
  - Stories run SEQUENTIALLY (shared `resource/resource-index.ts`, `reference-resolver.ts`, `compose/compose.ts`, `auth-apply.ts`)
  - Within each story: tests FIRST (RED), then implementation (GREEN)
- **Polish (Final Phase)**: depends on all user stories complete

### User Story Dependencies

- **US1 (P1)**: after Foundational — index build + resources.yaml validation
- **US2 (P1)**: after Foundational — reference validation against the index
- **US3 (P1)**: after US2 (retarget validation requires `validateResourceReference`); modifies `compose.ts` READ stage + `auth-apply.ts`
- **US4 (P2)**: after US2 + US3 (env mapping validates against index; resolution runs after compose retarget); modifies `compose.ts` final stage

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Types/errors before services; services before pipeline integration
- Story complete before moving to next priority

### Parallel Opportunities

- Setup tasks T001/T002 in parallel
- Foundational tests T003; implementations T004/T005/T006/T007 in parallel (distinct files)
- US1: T008 (index spec) ‖ T009 (byte-parity spec) → T010 sequential
- US2: T011 ‖ T012 → T013 sequential
- US3: T014 (auth-apply spec) ‖ T015 (compose determinism spec) → T016/T017 sequential; fixtures T018/T019 parallel
- US4: T020 (env-mapping spec) ‖ T021/T022 (resolver specs) → T023/T024 sequential → T025 compose wiring; fixtures T026 parallel
- Polish: T027/T028/T029/T030 parallel → T031/T032 gates sequential

---

## Parallel Example: User Story 4

```bash
# Launch all US4 test tasks together (RED phase):
Task: "T020 [P] [US4] env-mapping.spec.ts — canonical env.yaml, default:, undeclared, unused entries (RED)"
Task: "T021 [P] [US4] reference-resolver.spec.ts — targeted resolve, ENV_NOT_SET, template preserved, non-reference untouched (RED)"
Task: "T022 [P] [US4] reference-resolver.spec.ts — determinism byte-identical (RED)"

# Launch all US4 fixtures together (after implementation green):
Task: "T026 [P] [US4] fixtures resource-env/, resource-no-env/, resource-env-not-set/, resource-env-default/, resource-env-undeclared/"
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1 (index build + resources.yaml fail-fast)
4. Complete Phase 4: User Story 2 (reference validation)
5. Complete Phase 5: User Story 3 (008 retarget — template emission + determinism) → **MVP complete**
6. STOP and VALIDATE: quickstart US1–US3 scenarios green

### Incremental Delivery

1. Setup + Foundational → module scaffold + error taxonomy
2. US1 → ResourceIndex + resources.yaml validation → Test independently
3. US2 → reference validation → Test independently
4. US3 → 008 retarget (template emission) → Test independently (MVP)
5. US4 → ENV-only mode → Test independently
6. Polish → integration matrix + gates

### Parallel Team Strategy

- Developer A: Foundational types/errors (T004/T005) while B does parser/template (T006/T007)
- Developer A: US1+US2 (index + validation); Developer B: US3 (auth-apply + compose wiring) after T013
- Developer B: US4 env mapping + resolution after T024 (US3 merges first)
- All fixtures can be authored in parallel once design is final

---

## Notes

- **Dependency mechanism (Setup)**: composer must reuse spec 002 `parseResourceReference` (FR-005) while keeping zero published runtime deps — the `@ycforge/pilot` workspace package is a `devDependency` bundled via tsup `noExternal: ['@ycforge/pilot']` (identical to 007's `yaml` convention). The published `@ycforge/composer` manifest stays runtime-dep-free.
- **Seam 009→011**: `RESOURCE_REF_COLLISION_APPS_RESOURCES` code is DEFINED but NEVER thrown by B (B doesn't read apps.yaml — Constitution I); ownership captured in spec 011/`ycsf check`.
- **Seam 009→019**: template `${resources...}` stays in artifact for materializer translation; B emits no `$${...}`, no IDR, no `service_account_id`/provising (FR-015).
- **Addivity of 008 retarget (FR-013)**: contract 008 v1 unchanged; only the value form of `function_id` changes; auth-apply jwt path untouched.
- **`env.yaml` resolution default**: whenever env.yaml is present (US4); no new `envOnly` flag in the contract surface. `process.env` snapshots at compile time (US4 note).
- `[P]` tasks = different files, no dependencies; `[Story]` label maps to user story for traceability.
- Commit after each task or logical group with English message; do not mix other spec work into branch `009-resource-references`.
- Verify tests fail before implementing (RED→GREEN) per Constitution II.