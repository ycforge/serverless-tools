# Tasks: auth-config validation (`auth.yaml` + `security` references, Project B / composer)

**Input**: Design documents from `/specs/007-auth-config/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/auth-config.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. Test-first is mandated by Constitution II (https://constitution.md): acceptance criteria from the spec become tests BEFORE implementation; confirm RED, then GREEN.

## Format: `[ID] [P?] [Story] Description (FR-xxx; AC)`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3) — only for US-phase tasks
- **Tail**: every task ends with `(FR-xxx; spec AC)` references; test tasks additionally end with `— RED: <what the test observes before implementation>` (failure mode)
- Include exact file paths in descriptions
- Test-first per Constitution II: within each US phase, contract/acceptance tests come BEFORE the implementation task

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bundle the `yaml` v2 parser into `@ycforge/composer`'s dist while the published manifest keeps its zero-runtime-dependency property (research R1).

- [ ] T001 [P] Add `yaml` (v2) as a devDependency in `packages/composer/package.json` and refresh `pnpm-lock.yaml` (`pnpm install`); the published `dependencies` field stays empty (plan §Primary Dependencies; research R1)
- [ ] T002 [P] Add `noExternal: ['yaml']` to `packages/composer/tsup.config.ts` so `yaml` is bundled into `dist/index.js` at build time and NO runtime dependency appears for consumers (research R1; 006 zero-runtime-deps convention)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Public data types (`AuthScheme`, `AuthYamlDocument`, request/result) and the deterministic error taxonomy — the two primitives that BLOCK every user story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundational (write FIRST, confirm RED)

- [ ] T003 [P] Write `packages/composer/src/auth/auth-errors.spec.ts`: `AuthConfigError` is `instanceof Error` with `name: 'AuthConfigError'`; carries (a) a code from the 16-code union, (b) the contract context fields `path`/`schemeName`/`field`/`type`/`ref`/`route`/`keyPath`; messages are deterministic and built only from that context — document contents and secrets never appear in messages (contracts §Errors; FR-001..FR-009/FR-012; SC-003) — RED: `auth-errors.ts` does not exist

### Implementation for Foundational

- [ ] T004 [P] Create `packages/composer/src/auth/types.ts`: public data types `AuthScheme` (discriminated union `none`/`jwt`/`function`; jwt = `jwksUri`/`issuer`/`audience: string | readonly string[]`, R4/R7), `FunctionReference { ref; name }`, `AuthYamlDocument { version: 1; defaultScheme: string; schemes: Readonly<Record<string, AuthScheme>> }`, `AuthValidationRequest { appRoot; openApi: OpenApiDocument; functions?: readonly string[] }` (reuse `OpenApiDocument` from `src/errors.ts`), `AuthValidationResult { authYaml: AuthYamlDocument }` (contracts §Public API; FR-003/004/006/012)
- [ ] T005 [P] Create `packages/composer/src/auth/auth-errors.ts`: `AuthConfigErrorCode` union with all 16 codes from the contract table (`AUTH_FILE_MISSING` … `AUTH_SECURITY_PUBLIC_VIOLATION`) + `AuthConfigError extends Error` carrying `code` and optional context (`path`, `schemeName`, `field`, `type`, `ref`, `route`, `keyPath`); every fail-fast source (FR-001..FR-009/FR-012) maps to exactly one code (contracts §Errors; data-model §AuthConfigError) — GREEN T003

**Checkpoint**: foundational tests green; types + errors testable in isolation. User stories can begin.

---

## Phase 3: User Story 1 — Self-validation of `auth.yaml` (Priority: P1) 🎯 MVP

**Goal**: `validateAuthConfig({ appRoot, openApi, functions? })` reads `<appRoot>/auth.yaml`, parses with `yaml` v2 `uniqueKeys`, and runs the fixed self-validation pipeline (version → defaultScheme → schemes map → type → per-type fields), returning `AuthValidationResult { authYaml }`; every invalid state is a deterministic fail-fast error naming the offending field/scheme/type.

**Independent Test**: canonical fixture `test/fixtures/openapi-app/` resolves with the expected `authYaml`; each negative fixture (`no-auth`, `bad-version`, `missing-default`, `default-unresolved`, `empty-schemes`, `schemes-not-map`, `dup`, `unknown-type`, `missing-jwt-fields`, `missing-function`) rejects with its exact code + problem context.

### Tests for User Story 1 (write FIRST, confirm RED)

- [ ] T006 [P] [US1] Write `packages/composer/src/auth/auth-yaml.spec.ts` (inline YAML fixtures, no filesystem): (a) valid document with `none`+`jwt`+`function` schemes passes (SC-002; US1/AC1), `audience` accepted as scalar AND array; (b) each SC-003 variant → expected code + context — missing/foreign `version` (`AUTH_VERSION_UNSUPPORTED`), missing/unresolved `defaultScheme` (`AUTH_DEFAULT_MISSING`/`AUTH_DEFAULT_UNRESOLVED`), empty/non-map `schemes` (`AUTH_SCHEMES_EMPTY`/`AUTH_SCHEMES_NOT_MAP`), unknown type `oauth2` (`AUTH_UNKNOWN_SCHEME_TYPE` with scheme+type), missing per-type field incl. empty `audience: []` (`AUTH_MISSING_FIELD` with scheme+field), duplicate key outside `schemes` (`AUTH_DUPLICATE_KEY` with keyPath), duplicate scheme name (`AUTH_DUPLICATE_SCHEME` with schemeName) (FR-002..FR-007; US1/AC2..7; SC-003; R7) — RED: `auth-yaml.ts` does not exist
- [ ] T007 [P] [US1] Create canonical fixture `packages/composer/test/fixtures/openapi-app/`: valid `auth.yaml` (`version: 1`, `defaultScheme: user`, schemes `public`/`none`, `user`/`jwt` with `jwksUri`/`issuer`/`audience`, `internal`/`function` `functions.internal_authorizer`, plus a declared-but-unused scheme for US2/AC3) + extracted `openapi.json` with `security` refs on `user` (quickstart; US1/AC1; FR-009)
- [ ] T008 [P] [US1] Create negative fixtures under `packages/composer/test/fixtures/`: `openapi-app-no-auth/` (no file), `-bad-version/`, `-missing-default/`, `-default-unresolved/`, `-empty-schemes/`, `-schemes-not-map/`, `-dup/` (intentional collision `schemes.user` twice), `-unknown-type/`, `-missing-jwt-fields/`, `-missing-function/` — each with its `auth.yaml` per quickstart (quickstart; FR-002..FR-007; US1/AC2..7)
- [ ] T009 [P] [US1] Write US1 integration tests in `packages/composer/test/auth-config.integration.spec.ts` (resolves fixture roots via `fileURLToPath(new URL('./fixtures/…', import.meta.url))`, 006 pattern): canonical fixture → resolves `AuthValidationResult` with expected `authYaml`; parameterized negative fixtures → `AuthConfigError` with exact code + problem context (FR-001..FR-007; US1/AC1..7; SC-002/SC-003; quickstart §US1) — RED: `validateAuthConfig` not exported

### Implementation for User Story 1

- [ ] T010 [US1] Implement `packages/composer/src/auth/auth-yaml.ts`: `loadAuthYaml(appRoot)` resolves `<appRoot>/auth.yaml` (missing/unreadable → `AUTH_FILE_MISSING` with resolved path; research R2) and `parseAuthYaml(text, sourcePath)` via `yaml.parseDocument(text, { uniqueKeys: true })` (R1); `doc.errors` (incl. `DUPLICATE_KEY`) classified as `AUTH_FILE_INVALID_YAML` / `AUTH_DUPLICATE_KEY` (outside schemes, node keyPath) / `AUTH_DUPLICATE_SCHEME` (inside schemes, schemeName via AST walk); fixed pipeline version → defaultScheme → schemes as non-empty map → scheme type ∈ {none,jwt,function} → per-type required fields (jwt `jwksUri`/`issuer`/`audience`, empty `audience` array = missing; R7); never silent-merge and never normalize names (FR-002..FR-007; US1/AC2..7; SC-003; V) — GREEN T006
- [ ] T011 [US1] Create `packages/composer/src/auth/auth-config.ts`: implement `validateAuthConfig(request)` orchestrator with stages READ → PARSE → VERSION → DEFAULT → SCHEMES → TYPE → FIELDS, returning `AuthValidationResult { authYaml }`; `openApi` is carried but not yet scanned (SECURITY lands in US2); document and `openApi` are never mutated (FR-001..FR-007/FR-013; R5) — GREEN T009
- [ ] T012 [US1] Export the auth surface from `packages/composer/src/index.ts`: `validateAuthConfig`, `AuthValidationRequest`, `AuthValidationResult`, `AuthYamlDocument`, `AuthScheme`, `FunctionReference`, `AuthConfigError`, `AuthConfigErrorCode` (contracts §Public API; plan §Project Structure) — GREEN T009 (index import)

**Checkpoint**: US1 fully functional — `validateAuthConfig` MVP self-validation works for the explicit-path fixtures.

---

## Phase 4: User Story 2 — Cross-validation of OpenAPI `security` references (Priority: P1) 🎯 MVP

**Goal**: For every `security`-entry in the extracted OpenAPI (document root AND `paths[*][method].security`), the scheme name must be declared in the same composition's `auth.yaml`; `public` in a security entry is a contract violation; naked ops and declared-but-unused schemes are NOT errors on 007 (008 seam).

**Independent Test**: document whose refs are all declared passes (canonical fixture); `security: [{ admin: [] }]` on `GET /admin` → `AUTH_SECURITY_UNDECLARED` with `schemeName: 'admin'` + `route: 'GET /admin'`; `public` in a security entry → `AUTH_SECURITY_PUBLIC_VIOLATION`; naked ops and unused schemes pass.

### Tests for User Story 2 (write FIRST, confirm RED)

- [ ] T013 [P] [US2] Write `packages/composer/src/auth/auth-security.spec.ts` (inline OpenAPI docs): AC1 all-declared refs pass; AC2 undeclared `admin` at `GET /admin` → `AUTH_SECURITY_UNDECLARED` with schemeName + route; AC3 declared-but-unused scheme OK; AC4 naked op and `security: []` OK (defaultScheme application is 008); AC5 `public` in a security entry → `AUTH_SECURITY_PUBLIC_VIOLATION` with route; document-root `security` scanned with route `root`; `components.securitySchemes` of the doc is NOT a source and is ignored (R6); names matched case-sensitively (`Public` ≠ `public`) (FR-008/009/010/013; US2/AC1..5; SC-004) — RED: `auth-security.ts` does not exist

### Implementation for User Story 2

- [ ] T014 [P] [US2] Create fixtures under `packages/composer/test/fixtures/`: `openapi-app-undeclared-ref/` (valid auth.yaml + doc with `security: [{ admin: [] }]` on a GET route), `openapi-app-public-ref/` (doc with `public` in a security entry), `openapi-app-naked-ops/` (valid auth.yaml + doc with operations lacking `security`) (quickstart; FR-008/009; US2/AC2/AC4/AC5)
- [ ] T015 [US2] Implement `packages/composer/src/auth/auth-security.ts`: collect scheme names ONLY from root `security` and per-operation `paths[*][method].security` keys (FR-013; R6); route descriptor `root` | `METHOD /path`; per name → declared check → `AUTH_SECURITY_UNDECLARED` (schemeName+route), then `public` check → `AUTH_SECURITY_PUBLIC_VIOLATION` (route); `components.securitySchemes` and `ycsf:auth:*` metadata never read; naked ops and unused declared schemes pass on 007 (FR-008/009/010/013; SC-004; US2/AC4 — 008 seam) — GREEN T013
- [ ] T016 [P] [US2] Add US2 integration tests to `packages/composer/test/auth-config.integration.spec.ts`: canonical doc passes with all refs declared (AC1) and an unused declared scheme present (AC3); undeclared-ref fixture → `AUTH_SECURITY_UNDECLARED` schemeName `admin` + route `GET /admin` (AC2); public-ref fixture → `AUTH_SECURITY_PUBLIC_VIOLATION` with route (AC5); naked-ops fixture → success, application of defaultScheme is NOT done (AC4) (FR-008/009; SC-004; quickstart §US2) — RED: SECURITY stage not wired into `validateAuthConfig`
- [ ] T017 [US2] Extend `packages/composer/src/auth/auth-config.ts`: add the SECURITY stage to `validateAuthConfig`; implement and export `validateAuthReferences(openApi, authYaml)` → `AuthValidationResult` (standalone cross-validation against an already-validated auth, reusing `auth-security.ts`); export it from `packages/composer/src/index.ts` (contract; FR-008/009/013; R5) — GREEN T016

**Checkpoint**: US2 green — reference cross-validation works; MVP (US1+US2) is demonstrable end-to-end.

---

## Phase 5: User Story 3 — `function` reference validation & no provisioning (Priority: P2)

**Goal**: `function`-scheme refs are validated by grammar `functions.<name>` and resolved against the caller-provided function set; a missing function set when a function scheme is present is fail-fast; B never introspects function internals and never emits/provisions key-material, JWKS, Lockbox, Object Storage or the authorizer function (FR-011).

**Independent Test**: resolvable ref (`functions.internal_authorizer` + `functions: ['internal_authorizer']`) passes; `functions.nope` → `AUTH_FUNCTION_UNRESOLVED`; missing `functions` set → `AUTH_FUNCTION_SET_REQUIRED`; result contains ONLY `{ authYaml }` — no provisioning/key/JWKS/Lockbox artifacts.

### Tests for User Story 3 (write FIRST, confirm RED)

- [ ] T018 [P] [US3] Write `packages/composer/src/auth/function-ref.spec.ts`: grammar `functions.<name>` with segment `[a-z][a-z0-9_]*` resolves (AC1); `internal_authorizer` (no `functions.` prefix) → `AUTH_FUNCTION_INVALID_REF` (AC2); `functions.nope` outside the set → `AUTH_FUNCTION_UNRESOLVED` (AC2); function scheme present but `functions` absent from request → `AUTH_FUNCTION_SET_REQUIRED` (FR-012; V; data-model rule 13); resolvable ref passes with NO function introspection — validation takes only the set, not function internals (FR-012 SHALL NOT; R3) — RED: `function-ref.ts` does not exist

### Implementation for User Story 3

- [ ] T019 [P] [US3] Create fixtures under `packages/composer/test/fixtures/`: `openapi-app-no-functions/` (valid doc with function scheme), `openapi-app-bad-function-format/` (`function: internal_authorizer` without prefix), `openapi-app-unresolved-function/` (`function: functions.nope`) (quickstart; FR-012; US3/AC2)
- [ ] T020 [US3] Implement `packages/composer/src/auth/function-ref.ts`: `parseFunctionReference(ref)` — §12 two-segment grammar `functions.<name>`, segment `[a-z][a-z0-9_]*`, NOT the 3-segment pilot `ResourceReference` (R3) → `AUTH_FUNCTION_INVALID_REF`; `resolveFunctionReference(ref, functions)` — `name ∈ functions` (caller-provided set) else `AUTH_FUNCTION_UNRESOLVED`; no source reads besides the provided set, no introspection (FR-012; US3/AC1..2; R3) — GREEN T018
- [ ] T021 [P] [US3] Add US3 integration tests to `packages/composer/test/auth-config.integration.spec.ts`: canonical `functions.internal_authorizer` + `functions: ['internal_authorizer']` passes (AC1); unresolved-function fixture → `AUTH_FUNCTION_UNRESOLVED` with `ref` (AC2); no-functions fixture → `AUTH_FUNCTION_SET_REQUIRED`; FR-011 boundary: resolved result contains ONLY `{ authYaml }` — no key-pairs/JWKS publishing/Lockbox/Object Storage/authorizer-provisioning artifacts are produced or exposed (AC3; SC-006) — RED: FUNC-REF stage not in pipeline
- [ ] T022 [P] [US3] Write `packages/composer/src/auth/auth-config.spec.ts` (FSM / pipeline-order): with the fixed stage order version → defaultScheme → schemes → type → fields → function → security, a doc failing two stages reports the EARLIER stage's code (e.g. bad version wins over an undeclared security ref; unresolved function ref wins over a security ref); first failure stops the pipeline; stages never run past the failure (data-model §State transitions; SC-003) — RED: FUNC-REF stage missing so func-over-security ordering is not observable
- [ ] T023 [US3] Extend `packages/composer/src/auth/auth-config.ts`: insert the FUNC-REF stage between FIELDS and SECURITY per the fixed order (data-model §State transitions; FR-012); require the `functions` set only when at least one function scheme exists (`AUTH_FUNCTION_SET_REQUIRED`, never silently skip resolvability); finalize the full READ..SECURITY pipeline returning `AuthValidationResult { authYaml }` (FR-012; plan §Phase 1 fixed order) — GREEN T021/T022

**Checkpoint**: US3 green — full fixed pipeline (READ → … → FUNC-REF → SECURITY) behaves deterministically.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Extensibility regression, edge/boundary coverage, zero-dep verification, quickstart runthrough, docs parity.

- [ ] T024 [P] Add extensibility regression test in `packages/composer/src/auth/auth-config.spec.ts`: extend the per-type validator registry with a temporary extra scheme type and assert existing `none`/`jwt`/`function` validation is byte-for-byte unchanged and an unknown type still fails fail-fast (SC-005; FR-005; R4) — RED: registry has no extension seam yet
- [ ] T025 [P] Add edge tests in `packages/composer/src/auth/auth-yaml.spec.ts` + `auth-security.spec.ts`: `defaultScheme: public` and a declared `public`/`none` scheme are valid (FR-009; Edge cases); case-sensitive scheme names — `Public` is a normal scheme, NOT `public` (Edge cases); empty `auth.yaml` → `AUTH_FILE_INVALID_YAML`; input `openApi` is never mutated by any stage (R5); document-root `security` coverage (R6) (FR-002/003/009; Edge cases; R5/R6)
- [ ] T026 [P] Verify zero runtime dependencies: `packages/composer/package.json` `dependencies` is empty, `yaml` appears only in `devDependencies`; grep `src/auth/` imports — builtins + `yaml` only, no new published deps (research R1; 006 convention)
- [ ] T027 Run `specs/007-auth-config/quickstart.md` validation scenarios end-to-end (`pnpm --filter @ycforge/composer test`, all green) and record outcomes in `specs/007-auth-config/quickstart-outcomes.md` (quickstart; SC-001)
- [ ] T028 Run final gate: `pnpm --filter @ycforge/composer test` green + `pnpm --filter @ycforge/composer typecheck` clean + `pnpm lint` clean + no regressions elsewhere in the monorepo (`pnpm test` root); do NOT flip `specs/README.md` (status flip happens after merge)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3–5)**: All depend on Foundational. US2 depends on US1 (`auth-config.ts` orchestrator); US3 depends on US1 (function-scheme fields self-validated there) and shares `auth-config.ts` stage order with US2, so stories execute **sequentially** in priority order (US1 → US2 → US3), NOT in parallel (shared files `auth-config.ts`, `test/auth-config.integration.spec.ts`)
- **Polish (Phase 6)**: Depends on all stories complete

### User Story Dependencies

- **US1 (P1)**: foundational primitives only — MVP half
- **US2 (P1)**: foundational + US1 (validated `authYaml` from orchestrator)
- **US3 (P2)**: foundational + US1; FUNC-REF stage inserted into the US2-built pipeline (fixed order data-model §8/§9)

### Within Each User Story

- Contract/acceptance tests MUST be written and confirmed RED before implementation
- Fixtures before integration tests; integration before stage wiring
- Story complete before advancing to the next priority
- US1/2/3 all reuse `auth-config.integration.spec.ts` + `auth-config.ts` — sequential across stories, parallelizable only WITHIN a story

### Parallel Opportunities

- Within each phase: all `[P]` tasks run concurrently (different files: unit specs, fixture groups, integration spec, implementation files)
- Foundational: `auth-errors.spec.ts` ‖ `types.ts` ‖ `auth-errors.ts` (three different files)
- US1: `auth-yaml.spec.ts` ‖ canonical fixture ‖ negative fixtures ‖ US1 integration spec — then `auth-yaml.ts` → `auth-config.ts` → `index.ts`
- US2: `auth-security.spec.ts` ‖ US2 fixtures ‖ US2 integration spec — then `auth-security.ts` → stage wiring
- US3: `function-ref.spec.ts` ‖ US3 fixtures ‖ US3 integration spec ‖ `auth-config.spec.ts` — then `function-ref.ts` → pipeline insertion
- Polish: extensibility, edge, zero-dep tasks run concurrently

---

## Parallel Example: User Story 1 tests + fixtures

```bash
Task: "Write auth-yaml.spec.ts (inline YAML: SC-002 valid + SC-003 invalid variants) in packages/composer/src/auth/auth-yaml.spec.ts"
Task: "Create canonical fixture test/fixtures/openapi-app/ (valid auth.yaml + openapi.json)"
Task: "Create negative auth.yaml fixtures (openapi-app-{no-auth,bad-version,...,missing-function}/)"
```

## Parallel Example: User Story 3

```bash
Task: "Write function-ref.spec.ts (grammar, resolvability, missing-set, no-introspection) in packages/composer/src/auth/function-ref.spec.ts"
Task: "Create fixtures (no-functions, bad-function-format, unresolved-function) under test/fixtures/"
Task: "Write auth-config.spec.ts (FSM pipeline-order tests) in packages/composer/src/auth/auth-config.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 2 only)

1. Complete Phase 1: Setup (`yaml` bundled)
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 (self-validation) — standalone value: any invalid `auth.yaml` is rejected before composition
4. Complete Phase 4: US2 (security-reference cross-validation) — the roadmap's core "validation of links"
5. **STOP and VALIDATE**: US1+US2 integration tests green
6. MVP = self-valid + reference-safe `auth.yaml` source (the valid input seam to spec 008)

### Incremental Delivery

1. Setup + Foundational → primitives ready
2. US1 (self-validation) → valid-source guarantee → MVP half
3. US2 (security refs) → A→B boundary check → MVP complete
4. US3 (function refs) → full fixed pipeline (FUNC-REF before SECURITY)
5. Polish: extensibility regression + edge/boundary + zero-dep gate + quickstart

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to a user story for traceability; Setup/Foundational/Polish have no label
- Each user story is independently demonstrable: valid fixture passes / every invalid variant fails with exact code (US1), cross-validation of refs (US2), function resolvability + FR-011 boundary (US3)
- Constitution II: verify tests fail (RED) before implementing each story's behavior
- Fail-fast over magic (Constitution V): duplicates are collisions (`AUTH_DUPLICATE_KEY`/`AUTH_DUPLICATE_SCHEME`), never last-wins merges; unknown scheme type is an error, never "no security"
- `version: 1` is mandatory — a document without it or with a different value fails (Constitution III)
- Seam to 008: 007 never mutates `openApi`, never applies `defaultScheme`, never emits `securitySchemes`/authorizers; naked ops pass on 007
- Commit after each task or logical group; do not mix other spec work into branch `007-auth-config`

---

## Phase 7: Convergence

**Result**: appended by `/speckit-converge` 2026-09-05 after independent assessment against spec/plan/tasks/data-model/contracts/constitution (composer 114 tests, root 611, composer typecheck + lint clean). All three items are reconciliation gaps — no P1/P2 acceptance scenario is failing; existing task IDs are untouched.

- [ ] T029 Reconcile the fixed stage-order contract so the code, `specs/007-auth-config/data-model.md` §State transitions, rule 8, and the quickstart/SC-003 codes agree: `validateAuthConfig` currently validates the `schemes`-map shape/emptiness BEFORE `defaultScheme` resolvability (`packages/composer/src/auth/auth-yaml.ts` lines 195–207), whereas data-model §State transitions documents `defaultScheme ∈ schemes` (stage 4 DEFAULT) before the `schemes` non-empty-map check (stage 5) — yet rule 8 and the fixture codes `openapi-app-empty-schemes`→`AUTH_SCHEMES_EMPTY`, `openapi-app-schemes-not-map`→`AUTH_SCHEMES_NOT_MAP` (both fixtures carry `defaultScheme: user`) hold ONLY if map/emptiness checks precede resolvability, so the documented order self-contradicts. Decision (evidence-based): keep the code's coherent order and formalize the canonical pipeline as VERSION → DEFAULT-presence → SCHEMES-map/empty → DEFAULT-resolvability → TYPE → FIELDS → FUNC-REF → SECURITY; update `data-model.md` §State transitions accordingly; pin the order in `packages/composer/src/auth/auth-config.spec.ts` (which today enshrines "empty schemes wins over an unresolved defaultScheme") and add one cross-stage FSM case (e.g. an unresolved `defaultScheme` wins over an unknown scheme `type`); do NOT change any single-fault expected code from quickstart/SC-003 per `plan.md` «Порядок валидации фиксирован» and `tasks.md` T022 (contradicts)
- [ ] T030 Classify an empty `''` scheme-name key inside `schemes` deterministically per `data-model.md` §SchemeName (names = non-empty strings): today `validateSchemes` in `packages/composer/src/auth/auth-yaml.ts` (lines 145–148) raises `AUTH_FILE_INVALID_YAML` — a document-level code with message "not a valid YAML map" and NO `schemeName` context — for a semantically-invalid scheme name. Emit a scheme-level fail-fast that names the offending scheme (reuse the closest existing code or add a taxonomy entry in `contracts/auth-config.md` as an additive contract change) and add a regression case in `packages/composer/src/auth/auth-yaml.spec.ts` per `data-model.md` §SchemeName and `SC-003` (partial)
- [ ] T031 Fix `specs/007-auth-config/quickstart.md` line 42, which describes the canonical `user` jwt as «без обязательных полей», although the canonical fixture `packages/composer/test/fixtures/openapi-app/auth.yaml` and US1/AC1 carry the full required jwt fields (`jwksUri`/`issuer`/`audience`); align the description with the fixture, and while touching the docs correct the stale test-name references in `specs/007-auth-config/quickstart-outcomes.md` (e.g. `auth-yaml › parses and validates a valid document…` vs the actual test name) per AGENTS.md doc-consistency convention (partial)

---

## Phase 8: Convergence

**Result**: appended by `/speckit-converge` 2026-09-05 after a full re-assessment sweep (spec FR-001..FR-013 / SC-001..SC-006 / US1–US3 AC + Edge cases + plan decisions/R1–R7 + constitution I/II/III/V) of the post-T029–T031 implementation. Code behavior, fixtures, quickstart docs and contract are converged; one LOW documentation-parity gap remains. Existing task IDs untouched.

- [ ] T032 Add the missing `AUTH_INVALID_SCHEME_NAME` row to the canonical FR→rule→code mapping table (rules 1–17) in `specs/007-auth-config/data-model.md` §Validation rules, traced to FR-004 / §SchemeName (non-empty scheme-name invariant) and matching the taxonomy entry already present in `contracts/auth-config.md`; today the table's «каждый fail-fast из FR-001..FR-009/012 маппится ровно на один код (таблица ниже)» claim is not fully traceable in data-model.md because the actual taxonomy has 17 codes but the table lists only 15 rule rows + 2 prohibitions; optionally note in §State transitions where the empty-name check runs (inside the TYPE stage, before type extraction — `validateSchemes` in `packages/composer/src/auth/auth-yaml.ts`) (partial)