# Tasks: api-composition — merge нескольких OpenAPI в единый API Gateway (Project B / composer)

**Input**: Design documents from `/specs/008-api-composition/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-composition.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. Test-first is mandated by Constitution II: acceptance criteria from the spec become tests BEFORE implementation; confirm RED, then GREEN.

## Format: `[ID] [P?] [Story] Description (FR-xxx; AC)`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4) — only for US-phase tasks
- **Tail**: every task ends with `(FR-xxx; spec AC)` references; test tasks additionally end with `— RED: <what the test observes before implementation>` (failure mode)
- Include exact file paths in descriptions
- Test-first per Constitution II: within each US phase, contract/acceptance tests come BEFORE the implementation task

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Nothing new to bundle (compose reuses the already-bundled `yaml` from 007); verify the module scaffolding exists and fixtures can be placed. `src/index.ts` export extension is structural for the public API.

- [x] T001 [P] Verify `yaml` v2 is already a devDependency with `noExternal: ['yaml']` in `packages/composer/tsup.config.ts` (007 convention); no new published runtime dependencies are needed for `src/compose/` (plan §Primary Dependencies; research R1; 006/007 zero-runtime-deps convention)
- [x] T002 [P] Create the `packages/composer/src/compose/` directory skeleton with `overrides/` subdirectory and a placeholder `index.ts` (empty module to be filled across US phases) (plan §Project Structure; research R7)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Public composition data types, the `ComposeError` taxonomy with deterministic codes, and the `compose` orchestrator pipeline skeleton — the primitives that BLOCK every user story. Pipeline order is FIXED (data-model §State transitions): READ → EXTRACT (006) → AUTH (007) → VERSION → MERGE → AUTH-APPLY → OVERRIDES → FINALIZE.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundational (write FIRST, confirm RED)

- [x] T003 [P] Write `packages/composer/src/compose/compose-errors.spec.ts`: `ComposeError` is `instanceof Error` with `name: 'ComposeError'`; carries a code from the contract union (all `COMPOSE_*` + `OVERRIDE_*` codes) and its contract context fields (`app`, `path`, `method`, `operationId`, `componentName`, `target`, `op`, `ruleIndex`, `filePath`, `schemeName`, `route`, `versions`, `apps`); messages are deterministic, built ONLY from context — never from document contents, rules, or secrets (contracts §Errors; FR-004/005/006/015/016; SC-003) — RED: `compose-errors.ts` does not exist — RED confirmed (module missing), GREEN T005

### Implementation for Foundational

- [x] T004 [P] Create `packages/composer/src/compose/types.ts`: public data types `ComposeApp { appRoot: string }`, `ComposeRequest { compositionRoot: string; apps: readonly ComposeApp[]; functions?: readonly string[] }`, `RouteOwner` (`string` — participant appId or literal `'global'`), `ComposeResult { document: GatewayDocument; provenance: ReadonlyMap<string, RouteOwner> }`, `GatewayDocument` (openapi/info/security?/paths/components? with index signature; reuse `OpenApiDocument` from `src/errors.ts` for the per-app extracted input) (contracts §Public API; FR-001/002/003/017; research R1)
- [x] T005 [P] Create `packages/composer/src/compose/compose-errors.ts`: `ComposeErrorCode` union with all codes from the contract table (`COMPOSE_NO_PARTICIPANTS`, `COMPOSE_OPENAPI_VERSION_MISMATCH`, `COMPOSE_PATH_COLLISION`, `COMPOSE_OPERATIONID_COLLISION`, `COMPOSE_COMPONENT_COLLISION`, `COMPOSE_SECURITY_REF_NONE_SCHEME`, `COMPOSE_INFO_MISSING`, `OVERRIDE_FILE_UNREADABLE`, `OVERRIDE_FILE_INVALID_YAML`, `OVERRIDE_VERSION_UNSUPPORTED`, `OVERRIDE_RULES_NOT_LIST`, `OVERRIDE_RULES_EMPTY`, `OVERRIDE_UNKNOWN_OP`, `OVERRIDE_INVALID_TARGET`, `OVERRIDE_VALUE_REQUIRED`, `OVERRIDE_VALUE_FORBIDDEN`, `OVERRIDE_METHOD_INVALID`, `OVERRIDE_TARGET_MISSING`, `OVERRIDE_TARGET_ALREADY_EXISTS`, `OVERRIDE_OUT_OF_SCOPE`) + `ComposeError extends Error` carrying `code` and optional context fields; every fail-fast source (FD-notes: data-model rules 1,4,5,6,7,8,9,10,11,12,13,14) maps to exactly one code (contracts §Errors; data-model §ComposeError) — GREEN T003
- [x] T006 Create `packages/composer/src/compose/compose.ts`: implement the `compose(request)` orchestrator as the fixed pipeline skeleton READ → EXTRACT → AUTH → VERSION → MERGE → AUTH-APPLY → OVERRIDES → FINALIZE, delegating to (not-yet-implemented stage modules) `extractOpenApi` (006), `validateAuthConfig`/`validateAuthReferences` (007), with `OpenApiExtractError`/`AuthConfigError` surfacing UNtransformed (no re-map; FR-015); first failing invariant aborts — no partial results (data-model §State transitions; research R7) — GREEN (structure only; stages filled by US phases) — READ/EXTRACT/AUTH wired; MERGE..FINALIZE filled in US1–US4

**Checkpoint**: foundational types + error taxonomy + pipeline skeleton green; user stories can now begin sequentially.

---

## Phase 3: User Story 1 — Merge нескольких приложений в один API Gateway (Priority: P1) 🎯 MVP

**Goal**: For each participant, READ+EXTRACT via `extractOpenApi` (006), AUTH-validate via `validateAuthConfig`/`validateAuthReferences` (007), then VERSION-consensus; merge all `paths` and `components` into one `GatewayDocument` with internal `PathOwnership` provenance (route→app, never in the artifact); determinism via canonical key sorting regardless of participant order; inputs never mutated (byte-parity).

**Independent Test**: canonical fixture `compose-app/` (two non-overlapping participants) compiles to one gateway document containing every operation/component of both; artifact has zero provenance traces; order-swap produces byte-identical document; single-participant composition is a valid gateway.

### Tests for User Story 1 (write FIRST, confirm RED)

- [x] T007 [P] [US1] Write `packages/composer/src/compose/provenance.spec.ts` (inline OpenAPI doc + inline owner map): PathOwnership built with `path → owner` for each path; a global-override-added path maps to `'global'`; operationId index resolves `{ path, appId }`; provenance NEVER leaks into a serialized `GatewayDocument` — walking all JSON keys finds no `app`/`owner`/ownership metadata (FR-003/017; US1/AC3; SC-004; research R2) — RED: `provenance.ts` does not exist
- [x] T008 [P] [US1] Write `packages/composer/src/compose/merge.spec.ts` (inline OpenAPI docs): merge of two non-overlapping docs yields union of paths/components (US1/AC1; FR-002); empty-app contributes empty set, not an error (FR-002; Edge cases); version mismatch between docs → `COMPOSE_OPENAPI_VERSION_MISMATCH` (FR-016); merged paths/components keys are canonically sorted (FR-017; SC-002; research R4) — RED: `merge.ts` does not exist
- [x] T009 [P] [US1] Write `packages/composer/src/compose/compose.spec.ts` (pipeline-order / determinism / delegation / byte-parity, inline docs): fixed stage order observable — a doc failing EXTRACT (006 `NO_SOURCE`) stops before AUTH; an auth config failure (007) stops before VERSION/MERGE; inputs are never mutated (deep-freeze then deep-compare, byte-parity per FR-014/SC-007); delegation: 006/007 errors surface as their OWN error types, NOT `ComposeError` (FR-001/015; research R7; quickstart §US5) — RED: `compose.ts` stages not wired

### Implementation for User Story 1

- [x] T010 [US1] Implement `packages/composer/src/compose/provenance.ts`: `PathOwnership` — `ownerByPath: Map<path, owner>` (owner = appId | `'global'`) and `operationIdIndex: Map<operationId, { path; appId }>`; strict path-partition makes the whole pathItem single-owned (FR-004); builds only during merge/overrides; NO serialization into the gateway document (FR-003/017; research R2) — GREEN T007
- [x] T011 [US1] Implement `packages/composer/src/compose/merge.ts`: per participant in input order, EXTRACT via `extractOpenApi` (006) — no reimplementation; then VERSION consensus (all `openapi` fields equal, else `COMPOSE_OPENAPI_VERSION_MISMATCH`); merge `paths` + `components` copies (inputs never mutated — deep copy, FR-014); canonical key normalization (lexicographic sort of paths/components, research R2/R4); build `PathOwnership` (FR-002/003/016/017; US1/AC1..4) — GREEN T008
- [x] T012 [US1] Wire pipeline stages into `packages/composer/src/compose/compose.ts` (EXTRACT→AUTH→VERSION→MERGE): `compose(request)` delegates extraction per app, auth-validation via `validateAuthConfig({ appRoot: compositionRoot, openApi: doc[0], functions })` (007) then `validateAuthReferences(doc[i], authYaml)`; then merge; return `ComposeResult { document, provenance }` — provenance NEVER inside document (FR-001/002/003/015/017; US1/AC1..4; research R7) — GREEN T009
- [x] T013 [P] [US1] Create canonical fixture `packages/composer/test/fixtures/compose-app/`: `auth.yaml` (007-valid; `defaultScheme: user` jwt + schemes public/none, user/jwt, internal/function, frontend/none unused) + `overrides.yaml` (global: replace info + add `GET /_health`) + `participants/user_service/` (`openapi.json` with `/users`, `/users/{id}`, `/legacy`; local `overrides.yaml` remove `/legacy` + replace `GET /users`) + `participants/analytics/` (`openapi.json` with `/analytics/{id}`) — per quickstart; the canonical positive fixture for US1/US3/US4 (quickstart; US1/AC1; FR-001/002)
- [x] T014 [P] [US1] Create single-participant variant fixture `packages/composer/test/fixtures/compose-app-single/` (only `user_service`, no analytics) to cover trivial-merge AC4 (quickstart US1/AC4; FR-002)
- [x] T015 [P] [US1] Write US1 integration tests in `packages/composer/test/compose.integration.spec.ts` (resolves fixture roots via `fileURLToPath(new URL('./fixtures/…', import.meta.url))`, 006/007 pattern): canonical fixture → `ComposeResult` with every path/operation/component of both participants (AC1); reverse participant order → byte-identical `document` (serialize JSON with deterministic key order, revert participant order, compare — AC2/FR-017); artifact has no provenance keys (AC3, SC-004); single-participant fixture → valid gateway (AC4); inputs byte-identical to input (SC-002/SC-007, FR-014) (quickstart §US1; US1/AC1..4) — RED: `compose` returns wrong/absent document

**Checkpoint**: US1 green — merge + determinism + provenance-absence + byte-parity hold. MVP half complete.

---

## Phase 4: User Story 2 — Конфликты между приложениями, fail-fast с диагностикой (Priority: P1) 🎯 MVP

**Goal**: fail-fast on every collision — string path collision (incl. same path, different methods, and self-collision within one app), `operationId` duplicate (across and within apps), `components` name collision (incl. `securitySchemes` vs auth-emission, handled at AUTH-APPLY), `openapi` version mismatch. Deterministic messages with type + offending value + both apps (paths for operationId).

**Independent Test**: conflict fixtures (`path-collision`, `opid-collision`, `opid-self-collision`, `component-collision`, `version-mismatch`) each reject with `ComposeError` carrying the offending value and both appIds; same diagnostics in standalone and pipeline modes (single code path).

### Tests for User Story 2 (write FIRST, confirm RED)

- [x] T016 [P] [US2] Extend `packages/composer/src/compose/merge.spec.ts` with conflict matrix (inline docs): two apps declare same path string → `COMPOSE_PATH_COLLISION` with `path` + both `app` ids (US2/AC1; FR-004); same path, DIFFERENT methods → STILL a collision (strict path-partition, Edge cases; FR-004); same `operationId` on different paths across apps → `COMPOSE_OPERATIONID_COLLISION` with `operationId` + both `paths` + both `apps` (US2/AC2; FR-005); same `operationId` twice WITHIN one app (self-collision) → same code (Edge cases; FR-005); same component name in two apps → `COMPOSE_COMPONENT_COLLISION` with `componentName` + both `apps` (US2/AC3; FR-006) — RED: `merge.ts` merge does not fail-fast
- [x] T017 [P] [US2] Extend `packages/composer/src/compose/merge.spec.ts` with order-independence: the same conflict with participants in either order reports the same code and context (FR-017; V) — RED: conflict resolution depends on input order

### Implementation for User Story 2

- [x] T018 [P] [US2] Create conflict fixtures under `packages/composer/test/fixtures/`: `compose-app-path-collision/` (both declare `GET /users`), `compose-app-opid-collision/` (same operationId on different paths of two apps), `compose-app-opid-self-collision/` (duplicate operationId within one app), `compose-app-component-collision/` (shared `UserDto`), `compose-app-version-mismatch/` (`openapi: 3.0.0` vs `3.1.0`), `compose-app-no-participants/` (`apps: []` → `COMPOSE_NO_PARTICIPANTS`) (quickstart; US2/AC1..3; FR-004/005/006/016)
- [x] T019 [US2] Implement conflict detection in `packages/composer/src/compose/merge.ts`: path-partition collision (string equality, any methods; research R4) → `COMPOSE_PATH_COLLISION` (path + both apps); duplicate operationId across and within apps → `COMPOSE_OPERATIONID_COLLISION` (operationId + both paths + apps); duplicate component name → `COMPOSE_COMPONENT_COLLISION` (componentName + apps); order-independent — first-detection order does not depend on participant sequence (FR-004/005/006/016/017; US2/AC1..3; V) — GREEN T016/T017
- [x] T020 [US2] Wire VERSION-consensus + conflict detection into `packages/composer/src/compose/compose.ts` before any auth-emission/overrides (conflicts at stage 5, before AUTH-APPLY stage 6; data-model §State transitions); support the `COMPOSE_NO_PARTICIPANTS` guard in READ stage (apps empty → fail-fast before any extraction) (FR-001/004/005/006/016/015; US2/AC1..4; research R7) — GREEN (compose spec RED for conflicts)

**Checkpoint**: US2 green — fail-fast conflict taxonomy holds; MVP (US1+US2) demonstrable end-to-end.

---

## Phase 5: User Story 3 — Global/local overrides с приоритетом local > global (Priority: P2)

**Goal**: parse `<compositionRoot>/overrides.yaml` (global) + `<appRoot>/overrides.yaml` (local) — grammar `version: 1` + flat `rules[]` of `{ op: replace|add|remove, target: {kind: info|path|operation|operationId|component, ...}, value? }`; apply sequentially global before local (local > global priority); each rule is an explicit address + atomic op, NEVER deep merge; local override touches only its own path-space (or adds new paths); incompatible targets & scope violations fail-fast; added paths get provenance owner (global/app).

**Independent Test**: fixtures per atomic op and both levels; global+local targeting one op → local wins, no error; local out-of-scope (`compose-app-ov-local-out-of-scope`, `compose-app-ov-local-info`) → `OVERRIDE_OUT_OF_SCOPE`; missing/added target → `OVERRIDE_TARGET_MISSING`/`OVERRIDE_TARGET_ALREADY_EXISTS`; grammar negatives → `OVERRIDE_*`.

### Tests for User Story 3 (write FIRST, confirm RED)

- [x] T021 [P] [US3] Write `packages/composer/src/compose/overrides/override-yaml.spec.ts` (inline YAML, no filesystem): parsable `version: 1` + `rules[]` map to typed rules; each grammar negative → exact code — missing/foreign `version` (`OVERRIDE_VERSION_UNSUPPORTED`), `rules` not a list / empty (`OVERRIDE_RULES_NOT_LIST`/`OVERRIDE_RULES_EMPTY`), unknown `op` (`OVERRIDE_UNKNOWN_OP`), invalid/unknown `target.kind` (`OVERRIDE_INVALID_TARGET`), `replace`/`add` without `value` (`OVERRIDE_VALUE_REQUIRED`), `remove` with `value` (`OVERRIDE_VALUE_FORBIDDEN`), `kind: operation` non-HTTP method (`OVERRIDE_METHOD_INVALID`) (FR-007/010; US3/AC6; V) — RED: `override-yaml.ts` does not exist
- [x] T022 [P] [US3] Write `packages/composer/src/compose/overrides/apply.spec.ts` (inline docs + ownership): `replace` on existing target atomic-replaces whole value, no deep merge (US3/AC3; FR-010); `add` inserts missing target (US3/AC2); `remove` deletes target; `replace`/`remove` on missing target → `OVERRIDE_TARGET_MISSING`, `add` on existing → `OVERRIDE_TARGET_ALREADY_EXISTS` (US3/AC6; FR-007); local override addressing a foreign path → `OVERRIDE_OUT_OF_SCOPE`, addressing `kind: info`/`component` from local → `OVERRIDE_OUT_OF_SCOPE` (US3/AC5; FR-008); global then local on same target → local wins, NO error (US3/AC4; FR-009); `info` rule applied → `document.info` exactly the override value (US3/AC1; FR-007); added path gets owner `'global'`/app in provenance (US3/AC2; FR-008/R2); two rules in one file addressing same target follow sequential semantics, not collision (research R3) — RED: `apply.ts` does not exist
- [x] T023 [P] [US3] Write overrides integration/edge tests in `packages/composer/test/compose.integration.spec.ts` (or `overrides/apply.spec.ts`): absence of override files (global and local) succeeds — no rules, not an error (data-model §Не ошибки; US3) — RED: missing-file handling not wired

### Implementation for User Story 3

- [x] T024 [US3] Implement `packages/composer/src/compose/overrides/override-yaml.ts`: `loadOverrideFile(root)` resolves `<root>/overrides.yaml` (missing file → null, not an error); `parseOverrideFile(text, sourcePath)` via `yaml` v2 with duplicate-key detection; validate `version === 1` (`OVERRIDE_VERSION_UNSUPPORTED`), `rules` non-empty list (`OVERRIDE_RULES_NOT_LIST`/`OVERRIDE_RULES_EMPTY`); per-rule `op`/`target`/`value` grammar checks → all `OVERRIDE_*` grammar codes; `method` lowercase from `{get,put,post,delete,options,head,patch,trace}` (`OVERRIDE_METHOD_INVALID`); `value` opaque (presence-only) (FR-007/010; US3/AC6; research R3) — GREEN T021
- [x] T025 [US3] Implement `packages/composer/src/compose/overrides/apply.ts`: `applyOverrides(document, ownership, globalRules, localByApp)` — deterministic: for each file, rules applied in file order; global file applied before all local files; local > global priority via application order (never a conflict, FR-009); atomic `replace`/`add`/`remove` with target checks → `OVERRIDE_TARGET_MISSING`/`OVERRIDE_TARGET_ALREADY_EXISTS`; local scope enforcement via `PathOwnership` → `OVERRIDE_OUT_OF_SCOPE` (foreign path / `kind: info` / `kind: component` from local); added paths get owner `'global'` (global file) or the app id (local file) in provenance; NEVER deep merge (FR-007/008/009/010; US3/AC1..6; research R3) — GREEN T022
- [x] T026 [US3] Wire OVERRIDES stage into `packages/composer/src/compose/compose.ts` AFTER AUTH-APPLY (stage 7; data-model §State transitions): global `<compositionRoot>/overrides.yaml` then per-app local `<appRoot>/overrides.yaml` in input order; propagate provenance updates (FR-007/008/009/017; US3; research R7) — GREEN T023
- [x] T027 [P] [US3] Create override fixtures under `packages/composer/test/fixtures/`: `compose-app-ov-bad-version/`, `-ov-rules-empty/`, `-ov-value-missing/`, `-ov-target-missing/`, `-ov-add-existing/`, `-ov-local-out-of-scope/`, `-ov-local-info/` (each its own negative `overrides.yaml` per quickstart; FR-007/008; US3/AC5/AC6)
- [x] T028 [US3] Add US3 integration tests to `packages/composer/test/compose.integration.spec.ts`: canonical fixture global override → `document.info` exactly from override + `/_health` present + provenance has `/_health → 'global'` (US3/AC1/AC2); local remove `/legacy` + replace `/users` → applied atomically (US3/AC3); global+local on one op → local value (US3/AC4); the negative override fixtures → expected `OVERRIDE_*` codes (US3/AC5/AC6; quickstart §US3) — RED: OVERRIDES stage missing

**Checkpoint**: US3 green — overrides grammar + apply + scope + priority hold.

---

## Phase 6: User Story 4 — Auth-применение (шов 007): defaultScheme, securitySchemes, authorizers (Priority: P2)

**Goal**: apply the 007-validated auth config: root `security: [{<defaultScheme>: []}]` when defaultScheme type != `none` (bare ops inherit; explicit op-security preserved); emit `components.securitySchemes` + authorizers for EVERY non-none scheme — jwt = `{ type: openIdConnect, openIdConnectUrl: <issuer>/.well-known/openid-configuration, x-yc-apigateway-authorizer: { type: jwt, jwksUri, issuers, audiences, identitySource } }`; function = `{ type: http, scheme: bearer, x-yc-apigateway-authorizer: { type: function, function_id: functions.<name> } }` (logical ref); none = no emission; `none`-reference invariant fail-fast; securitySchemes-vs-emission collision → `COMPOSE_COMPONENT_COLLISION`.

**Independent Test**: `defaultScheme: user` (jwt) with bare ops → root `security: [{user: []}]`; `defaultScheme` type none → no root `security`; schemes emit securitySchemes+authorizers (jwt/function forms exact); none-scheme has no entry; no-provisioning/`${resources...}` absence.

### Tests for User Story 4 (write FIRST, confirm RED)

- [x] T029 [P] [US4] Write `packages/composer/src/compose/auth-apply.spec.ts` (inline authYaml + inline merged doc): `defaultScheme` non-none → root `security: [{user: []}]`, bare ops inherit, op with explicit `security` keeps its own, `security: []` preserved (US4/AC1; FR-011); `defaultScheme` type `none` → NO root `security` (US4/AC2; FR-011); jwt scheme emits exact `{ type: openIdConnect, openIdConnectUrl: <issuer>/.well-known/openid-configuration, x-yc-apigateway-authorizer: { type: jwt, jwksUri, issuers: [<issuer>], audiences: [<audience>], identitySource: { in: header, name: Authorization, prefix: "Bearer " } } }` (Variant A — US4/AC3; FR-012/013; research R5; contract §Auth-применение); function scheme emits `{ type: http, scheme: bearer, x-yc-apigateway-authorizer: { type: function, function_id: functions.<name> } }` — logical ref, NO `${resources...}`/key/JWKS/Lockbox/OS artifacts and no `service_account_id`/`tag` (US4/AC3; FR-013; Constitution I); none scheme → NO securitySchemes entry, NO authorizer (US4/AC4; FR-012); op with `security` referencing a none-type scheme → `COMPOSE_SECURITY_REF_NONE_SCHEME` with route+schemeName (data-model rule 9; FR-011/012; V) — RED: `auth-apply.ts` does not exist
- [x] T030 [P] [US4] Extend `packages/composer/src/compose/merge.spec.ts` (or `auth-apply.spec.ts`): a participant `components.securitySchemes` name colliding with a scheme B must emit from `auth.yaml` → `COMPOSE_COMPONENT_COLLISION` (FR-006; quickstart US4) — RED: securitySchemes-vs-emission collision not detected

### Implementation for User Story 4

- [x] T031 [US4] Implement `packages/composer/src/compose/auth-apply.ts`: `applyAuth(document, authYaml)` — defaultScheme root `security` (non-none) per FR-011; emit `components.securitySchemes` (order of `auth.yaml` map `schemes`) for every non-none scheme per FR-012/013 with the exact jwt (Variant A) and function forms (contract §Auth-применение; research R5); none-scheme reference invariant → `COMPOSE_SECURITY_REF_NONE_SCHEME`; securitySchemes-vs-emission name collision → `COMPOSE_COMPONENT_COLLISION`; NO provisioning artifacts / `${resources...}` / IAM fields (FR-011/012/013; US4/AC1..4; Constitution I) — GREEN T029/T030
- [x] T032 [US4] Wire AUTH-APPLY into `packages/composer/src/compose/compose.ts` after MERGE (stage 6), before OVERRIDES (stage 7); `compose(request)` already holds `authYaml` from the AUTH stage — pass to apply (data-model §State transitions; FR-011/012/013; research R6/R7) — GREEN (compose spec RED for auth on public API)
- [x] T033 [P] [US4] Create auth-emission fixtures under `packages/composer/test/fixtures/`: `compose-app-none-ref/` (op with `security: [{ anon: [] }]`, scheme `anon: {type: none}` → `COMPOSE_SECURITY_REF_NONE_SCHEME`), and a variant fixture with `defaultScheme: public` (type `none`) to assert no root security is emitted (quickstart §US4; US4/AC2/AC4; FR-011/012)
- [x] T034 [US4] Add US4 integration tests to `packages/composer/test/compose.integration.spec.ts`: canonical fixture (`defaultScheme: user` jwt + schemes user/internal/frontend-none) → root `security: [{user: []}]` + `securitySchemes` with exact jwt/function records (AC1/AC3); explicit-op-security preserved, bare ops inherit (AC1); `defaultScheme: public` variant → no root security (AC2); `frontend` none-scheme → no entry/authorizer (AC4); none-ref fixture → `COMPOSE_SECURITY_REF_NONE_SCHEME`; output has NO `${resources...}`/key/jwks-runtime/provisioning artifacts (AC3; SC-006) (quickstart §US4; US4/AC1..4) — RED: AUTH-APPLY not producing expected document

**Checkpoint**: US4 green — auth seam applied; all four stories functional.

---

## Phase 7: Polish & Cross-Cutting Concerns (Delegation, boundaries, gates)

**Purpose**: verify delegation (compose CALLS 006/007, never reimplements), no-provisioning boundary, no-MVP scope (integrations/resource-refs), quickstart runthrough, and final gates.

- [ ] T035 [P] Add delegation/boundary regression tests in `packages/composer/src/compose/compose.spec.ts`: `compose` never reimplements extraction/auth — it CALLS `extractOpenApi` and `validateAuthConfig`/`validateAuthReferences` (spy/mock on the 006/007 exports); 006/007 errors surface untransformed as their own error types (FR-001/015; research R7; quickstart §US5) — RED: delegation not asserted
- [ ] T036 [P] Create delegation fixtures under `packages/composer/test/fixtures/`: `compose-app-bad-auth/` (no `auth.yaml` → `AUTH_FILE_MISSING`, 007 code), `compose-app-bad-extract/` (participant without source → `NO_SOURCE`, 006 code); add integration tests asserting these surface as `AuthConfigError`/`OpenApiExtractError` (NOT `ComposeError`) (FR-015; SC-007; quickstart §US5)
- [ ] T037 [P] Add edge tests in `packages/composer/src/compose/compose.spec.ts` + `merge.spec.ts`: single-participant composition is a valid gateway with same override/auth rules (US1/AC4); empty-app participant (no paths) contributes empty set, not an error but other participants complete (FR-002; Edge cases); duplicate `appRoot` in `apps` → fail-fast (data-model §Не ошибки); path-template differences (`/users/{id}` vs `/users/{name}`) are NOT detected as collision (documented limitation, Edge cases) (FR-002/004; Edge cases)
- [ ] T038 [US4] [P] Add no-provisioning / no-MVP scope regression in `packages/composer/src/compose/auth-apply.spec.ts`: emitted document contains NO `x-yc-apigateway-integration`, NO `service_account_id`/`tag`, NO key-pair/JWKS-publishing/Lockbox/Object Storage artifacts, NO `${resources...}` syntax anywhere (FR-013/018; Constitution I; quickstart §US4; SC-006)
- [ ] T039 [P] Verify zero runtime dependencies & import hygiene: `packages/composer/package.json` `dependencies` is empty; grep `src/compose/` imports — builtins + `yaml` only, reusing `src/extract.ts` + `src/auth/*` public surface; no new published deps (plan §Constraints; research R1)
- [ ] T040 Run `specs/008-api-composition/quickstart.md` validation scenarios end-to-end (`pnpm --filter @ycforge/composer test`, all green) and record outcomes in `specs/008-api-composition/quickstart-outcomes.md` (quickstart; SC-001)
- [ ] T041 Run final gate: `pnpm --filter @ycforge/composer test` (baseline 117, now + compose suite) green + `pnpm --filter @ycforge/composer typecheck` clean + `pnpm lint` clean + no regressions elsewhere in monorepo (`pnpm test` root, baseline 614); do NOT flip `specs/README.md` (status flip happens after merge)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3–6)**: All depend on Foundational; they share the single orchestrator `compose.ts` + integration file `test/compose.integration.spec.ts` + `compose.spec.ts`, so stories execute **sequentially** in priority order (US1 → US2 → US3 → US4), NOT in parallel across stories (shared files enforce the fixed pipeline — data-model §State transitions). Parallelism is WITHIN each story only.
- **Polish (Phase 7)**: Depends on all stories complete

### User Story Dependencies

- **US1 (P1)**: foundational primitives (types, errors, pipeline skeleton) only — MVP half (merge + internal provenance + determinism)
- **US2 (P1)**: foundational + US1 (`compose.ts` MERGE stage); conflicts are detected AT merge, before auth/overrides (data-model stages 4–5)
- **US3 (P2)**: foundational + US1 (+ US2 merge built); OVERRIDES stage runs AFTER MERGE/AUTH-APPLY — needs merged + ownership; local scope needs `PathOwnership` from US1
- **US4 (P2)**: foundational + US1 (+ US2 merge); AUTH-APPLY runs between MERGE and OVERRIDES — needs merged document + authYaml from AUTH stage (007); securitySchemes-vs-emission collision needs merged components from US1/US2

### Within Each User Story

- Contract/acceptance tests MUST be written and confirmed RED before implementation
- Unit specs (+ fixtures for integration) BEFORE stage wiring into `compose.ts`
- Story complete before moving to next priority
- All US phases touch `compose.ts`/`compose.spec.ts`/`compose.integration.spec.ts` — sequential across stories; only `[P]` sub-tasks within a story are parallel

### Parallel Opportunities

- Within each phase: all `[P]` tasks run concurrently (different files: unit specs, fixture groups, implementation files)
- Foundational: `compose-errors.spec.ts` ‖ `types.ts` ‖ `compose-errors.ts` (three different files)
- US1: `provenance.spec.ts` ‖ `merge.spec.ts` ‖ `compose.spec.ts` (pipeline) — then `provenance.ts` → `merge.ts` → stage wiring → canonical/single fixtures ‖ US1 integration spec
- US2: conflict matrix unit spec ‖ order-independence unit spec ‖ conflict fixtures — then merge conflict impl → `compose.ts` wiring
- US3: `override-yaml.spec.ts` ‖ `apply.spec.ts` ‖ integration/edge test — then `override-yaml.ts` → `apply.ts` → wire OVERRIDES → override fixtures ‖ US3 integration
- US4: `auth-apply.spec.ts` ‖ securitySchemes-collision spec — then `auth-apply.ts` → wire AUTH-APPLY → auth-emission fixtures ‖ US4 integration
- Polish: delegation ‖ delegation fixtures/integration ‖ edge cases ‖ no-provisioning ‖ zero-dep — run concurrently

---

## Parallel Example: User Story 1 tests + fixtures

```bash
Task: "Write provenance.spec.ts (ownership, global-owner, no-leak) in packages/composer/src/compose/provenance.spec.ts"
Task: "Write merge.spec.ts (union, empty-app, version, sort) in packages/composer/src/compose/merge.spec.ts"
Task: "Write compose.spec.ts (pipeline order, delegation, byte-parity) in packages/composer/src/compose/compose.spec.ts"
Task: "Create canonical fixture test/fixtures/compose-app/ (auth.yaml + global overrides + participants)"
```

## Parallel Example: User Story 4

```bash
Task: "Write auth-apply.spec.ts (defaultScheme, securitySchemes+jwt/function forms, none) in packages/composer/src/compose/auth-apply.spec.ts"
Task: "Extend merge.spec.ts with securitySchemes-vs-emission collision case"
Task: "Create auth-emission fixtures (compose-app-none-ref/, compose-app-default-public/)"
```

---

## Implementation Strategy

### MVP First (User Story 1 + User Story 2 only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 (merge + internal provenance + determinism)
4. Complete Phase 4: US2 (fail-fast conflict taxonomy: path/operationId/components/version)
5. **STOP and VALIDATE**: US1+US2 integration tests green (`compose.integration.spec.ts`)
6. MVP = deterministic gate: multiple per-app documents merge into ONE gateway artifact with no provenance leak, every collision fail-fast — the spine of the roadmap row
7. CLI frontend (`ycsf-api compile`, spec 010) consumes `compose` after MVP

### Incremental Delivery

1. Setup + Foundational → types + errors + pipeline skeleton ready
2. US1 (merge + provenance + determinism) → valid multi-app gateway → **MVP half**
3. US2 (fail-fast conflicts) → deterministic collision diagnostics → **MVP complete**
4. US3 (overrides global/local, atomic, local>global) → spec 008 §14 half
5. US4 (auth-application seam 007) → complete 008 (data-model pipeline fully fixed)
6. Polish: delegation/boundary + no-provisioning + zero-dep gate + quickstart + final gates

### Parallel Team Strategy

Across stories NOT parallel (shared `compose.ts` + shared integration spec + fixed pipeline order). Within a story, parallelize the `[P]` test/fixture tasks, then sequence the implementation that greens them.

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to a user story for traceability; Setup/Foundational/Polish have no label
- Each story independently demonstrable: US1 merge/determinism/provenance-absence; US2 conflict fail-fast taxonomy; US3 override grammar+apply+scope+priority; US4 auth-application forms
- Constitution II: verify tests fail (RED) before implementing each story's behavior
- Fail-fast over magic (Constitution V): every collision is an error, never last-wins/never silent merge; unknown override grammar / target mismatch / scope violation / none-ref / version mismatch all deterministic-coded
- `version: 1` is mandatory for override files (Constitution III); `apps` non-empty (`COMPOSE_NO_PARTICIPANTS`)
- Delegation not reimplementation (research R1/R7): `compose` CALLS `extractOpenApi`/`validateAuthConfig`/`validateAuthReferences`; 006/007 errors surface untransformed (FR-015)
- Inputs immutable: per-app docs, auth.yaml, override files never mutated (FR-014; deep-copy merging, byte-parity tests)
- No provisioning: no `${resources...}`, no key/JWKS/Lockbox/OS artifacts, no `service_account_id`/`tag`; authorizer refs are logical `functions.<name>` (seam 009/019; FR-013, Constitution I)
- Commit after each task or logical group; do not mix other spec work into branch `008-api-composition`
