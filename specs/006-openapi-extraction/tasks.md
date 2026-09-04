# Tasks: safe OpenAPI extraction (Project B / composer)

**Input**: Design documents from `/specs/006-openapi-extraction/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/openapi-extraction.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. Test-first is mandated by Constitution II (https://constitution.md): acceptance criteria from the spec become tests BEFORE implementation; confirm RED, then GREEN.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New `@ycforge/composer` package scaffold (Project B) mirroring `packages/nest-bridge` conventions (ESM, TS 5.x, vitest, tsup).

- [ ] T001 Create `packages/composer/package.json` name=`@ycforge/composer`, `type: module`, `engines.node >=22`, `files: [dist, runner]`, `exports` → `./dist/index.js` (+types), `sideEffects: false`; and `packages/composer/tsconfig.json` (ESM, ES2022 target, strict, declaration: true) — mirror `packages/nest-bridge`
- [ ] T002 [P] Add placeholder export in `packages/composer/src/index.ts` and `packages/composer/tsup.config.ts` (mirror `packages/nest-bridge/tsup.config.ts`) so `pnpm exec tsc --noEmit` and `pnpm exec vitest run` pass from `packages/composer`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core primitives that BLOCK all user stories — public types, deterministic error taxonomy, runner subprocess (variant B), artifact reader.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for Foundational (write FIRST, confirm RED)

- [ ] T003 [P] Write `packages/composer/src/artifacts.spec.ts`: (a) valid `swagger.json` read OK; (b) `swagger.json` beats `openapi.json` when both exist; (c) neither exists → returns null; (d) broken JSON → `INVALID_ARTIFACT` with file path; (e) JSON object lacking `openapi` (string) / `paths` (object) → `INVALID_ARTIFACT` with path (FR-004/FR-007, R3)
- [ ] T004 [P] Write `packages/composer/src/runner/spawn-runner.spec.ts` driving a real `node` child with fixture entry modules: (a) successful doc returned with correct parity; (b) entry throws → `ENTRY_EXECUTION_FAILED`; (c) entry never resolves + `timeoutMs: 250` → `ENTRY_TIMEOUT` and main process stays alive; (d) malformed stdout JSON → `ENTRY_RETURNED_INVALID`; (e) env snapshot shows `SERVERLESS_TOOLS_OPENAPI_BUILD === '1'` inside the child (FR-002/FR-008/FR-011, R2/R4)

### Implementation for Foundational

- [ ] T005 Create `packages/composer/src/errors.ts`: `ExtractErrorCode` union (`NO_SOURCE`, `INVALID_ARTIFACT`, `ENTRY_LOAD_FAILED`, `ENTRY_EXECUTION_FAILED`, `ENTRY_RETURNED_INVALID`, `ENTRY_TIMEOUT`, `RUNNER_SPAWN_FAILED`), `OpenApiExtractError extends Error` (`code`, `sourcePath?`, `cause?`), public types `ExtractionRequest { appRoot: string; openapiEntry?: string }`, `ExtractOptions { timeoutMs?: number }`, `OpenApiDocument { openapi: string; info: unknown; paths: Record<string, unknown>; components?: unknown; [key: string]: unknown }` (contract `contracts/openapi-extraction.md`)
- [ ] T006 [P] Create `packages/composer/runner/runner.mjs` (steady child script): args `[entryPath]`; dynamic `import()`; call exported `buildYcsfOpenApi()`; print exactly ONE JSON object (the document) to stdout and exit 0; ALL diagnostics/throws → stderr + exit 1; never write non-JSON to stdout (R1/R2)
- [ ] T007 Create `packages/composer/src/artifacts.ts`: `readOpenApiArtifact(appRoot)` — check `<app>/swagger.json` then `<app>/openapi.json`; minimal validation (object, string `openapi`, object `paths`); none → null; malformed → `INVALID_ARTIFACT` with path; NO user code involved (FR-004/FR-007, R3)
- [ ] T008 Create `packages/composer/src/runner/spawn-runner.ts`: `spawnRunner(appRoot, entryPath, timeoutMs)` — `child_process.spawn(process.execPath, [runnerPath, entryPath], { env: { ...process.env, SERVERLESS_TOOLS_OPENAPI_BUILD: '1' }, cwd: appRoot })`, no shell; resolve runner path via `fileURLToPath(new URL('../../runner/runner.mjs', import.meta.url))` (stable from `src/runner` and `dist/runner`); stdout size guard + JSON parse; classify failures → `ENTRY_LOAD_FAILED`/`ENTRY_EXECUTION_FAILED`/`ENTRY_TIMEOUT` (kill on timeout, default 30000)/`RUNNER_SPAWN_FAILED` (FR-002/FR-011, R2/R4)

**Checkpoint**: Foundational tests green; primitives testable in isolation. User stories can begin.

---

## Phase 3: User Story 1 — Explicit `openapi_entry`, safe mode (Priority: P1) 🎯 MVP

**Goal**: `extractOpenApi({ appRoot, openapiEntry })` loads and calls `buildYcsfOpenApi` in the isolated runner with `SERVERLESS_TOOLS_OPENAPI_BUILD=1`, returns the document unchanged, and never triggers app-side effects (metadata-only safe mode).

**Independent Test**: `packages/composer/test/extraction.integration.spec.ts` against fixture `test/fixtures/app-safe-entry/` — extraction succeeds where provider init would fail loudly; document parity holds; entry saw the env flag.

### Tests for User Story 1 (write FIRST, confirm RED)

- [ ] T009 [P] [US1] Create fixture `packages/composer/test/fixtures/app-safe-entry/`: a module exporting `buildYcsfOpenApi()` (returns an expected OpenAPI doc) plus a module whose initialization would throw (simulating DB connect / `onModuleInit`); the entry records `process.env.SERVERLESS_TOOLS_OPENAPI_BUILD` and asserts the doc (expected.json fixture)
- [ ] T010 [P] [US1] Write integration tests in `packages/composer/test/extraction.integration.spec.ts`: (a) `extractOpenApi({ appRoot, openapiEntry })` resolves with doc deep-equal to expected.json (parity, FR-009); (b) entry observed `SERVERLESS_TOOLS_OPENAPI_BUILD === '1'` (FR-002); (c) the init-throwing module was never initialized (US1/AC1, SC-002) — RED (extract does not exist yet)

### Implementation for User Story 1

- [ ] T011 [US1] Implement `packages/composer/src/extract.ts` entry source: when `openapiEntry` present → resolve it under `appRoot` and dispatch via `spawnRunner`; return the document unchanged (FR-001/FR-003/FR-009); for the absent-entry case return/throw placeholder `NO_SOURCE` (replaced in US2/US3)
- [ ] T012 [US1] Update `packages/composer/src/index.ts`: export `extractOpenApi`, `ExtractionRequest`, `ExtractOptions`, `OpenApiDocument`, `OpenApiExtractError`, `ExtractErrorCode` per `contracts/openapi-extraction.md`

**Checkpoint**: US1 fully functional — `extractOpenApi` MVP works for the explicit-entry path.

---

## Phase 4: User Story 2 — Artifact fallback `swagger.json`/`openapi.json` (Priority: P2)

**Goal**: Without `openapiEntry`, `extractOpenApi` uses the pre-built artifact at `<app>/swagger.json` (then `<app>/openapi.json`) with NO user code execution; broken-but-present artifact is fail-fast.

**Independent Test**: Integration test against fixture `app-artifact/` (no entry) — doc equals the artifact file; no `node` child process is spawned.

### Tests for User Story 2 (write FIRST, confirm RED)

- [ ] T013 [P] [US2] Add integration tests in `packages/composer/test/extraction.integration.spec.ts`: (a) without entry, `swagger.json` used and doc parity holds (US2/AC1); (b) both artifacts present → `swagger.json` wins (US2/AC2); (c) extraction of artifact path spawns NO child node process (US2/AC1 — user code never executed); (d) broken `swagger.json` → `INVALID_ARTIFACT`, does NOT fall through to `openapi.json` (US2/AC3, FR-007) — RED (chain currently `NO_SOURCE`)

### Implementation for User Story 2

- [ ] T014 [P] [US2] Create fixture `packages/composer/test/fixtures/app-artifact/` with a valid `swagger.json` and a variant with both `swagger.json` + `openapi.json` (priority), and a broken-`swagger.json` variant
- [ ] T015 [US2] Extend `packages/composer/src/extract.ts`: absent `openapiEntry` → `readOpenApiArtifact(appRoot)`; on document → return; on malformed broken artifact → throw `INVALID_ARTIFACT` (no fall-through); on null → continue to placeholder `NO_SOURCE` (replaced in US3) (FR-004/FR-007)

**Checkpoint**: US2 green — artifact path works with no user code execution.

---

## Phase 5: User Story 3 — Convention fallback `dist/main` (Priority: P2)

**Goal**: Without entry and artifacts, `extractOpenApi` loads `<app>/dist/main` and calls `buildYcsfOpenApi` via the runner (convention), same contract and env as US1.

**Independent Test**: Integration test against fixture `app-convention/` (`dist/main.js` exporting `buildYcsfOpenApi`) — resolves via runner; env visible inside.

### Tests for User Story 3 (write FIRST, confirm RED)

- [ ] T016 [P] [US3] Add integration test in `packages/composer/test/extraction.integration.spec.ts`: `dist/main` convention resolves with doc parity and `SERVERLESS_TOOLS_OPENAPI_BUILD === '1'` inside (US3/AC1) — RED (chain still `NO_SOURCE` at this point)

### Implementation for User Story 3

- [ ] T017 [P] [US3] Create fixture `packages/composer/test/fixtures/app-convention/dist/main.js` exporting `buildYcsfOpenApi()` (expected doc fixture)
- [ ] T018 [US3] Extend `packages/composer/src/extract.ts`: absent entry + artifacts → `spawnRunner(appRoot, <appRoot>/dist/main, timeoutMs)`; conventions identical to US1 (FR-005/FR-002)

**Checkpoint**: US3 green — full fallback chain works.

---

## Phase 6: User Story 4 — No source → deterministic terminal error (Priority: P2)

**Goal**: Empty app (no entry, no artifacts, no usable `dist/main`) produces the fixed error message; broken-but-present sources never silently fall through.

**Independent Test**: Integration test against fixture `app-nothing/` — rejects with `OpenApiExtractError` `NO_SOURCE` and the exact message from FR-006.

### Tests for User Story 4 (write FIRST, confirm RED)

- [ ] T019 [US4] Add integration tests in `packages/composer/test/extraction.integration.spec.ts`: (a) `app-nothing/` → `NO_SOURCE` with message `Specify openapi_entry in build_config.yaml or export buildYcsfOpenApi from your entry point.` (FR-006, US4/AC1); (b) `dist/main` exists but does not export `buildYcsfOpenApi` → `ENTRY_LOAD_FAILED` (US3/AC2, FR-008) — asserts fail-fast, no fall-through past a broken source

### Implementation for User Story 4

- [ ] T020 [US4] Finalize `packages/composer/src/extract.ts` terminal branch: emit `OpenApiExtractError` `NO_SOURCE` with the exact FR-006 message; verify dist/main-without-export is classified `ENTRY_LOAD_FAILED` (spawn-runner T008); verify broken sources never fall through (FR-006/FR-007/FR-008)

**Checkpoint**: US4 green — entire fixed chain behaves deterministically.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Edge-case coverage, zero-dep verification, quickstart runthrough, docs parity.

- [ ] T021 [P] Add integration edge tests in `packages/composer/test/extraction.integration.spec.ts`: entry returns non-object / non-`OpenApiDocument` → `ENTRY_RETURNED_INVALID` (FR-008 edge); `Runner` spawn failure (invalid `appRoot`) → `RUNNER_SPAWN_FAILED` (FR-011)
- [ ] T022 Run `packages/composer/quickstart.md` validation scenarios end-to-end (all 7 green) and record outcomes in the spec dir
- [ ] T023 [P] Verify zero runtime dependencies: `packages/composer/package.json` has no `dependencies`; builtins only (`node:child_process`, `node:fs`, `node:path`, `node:url`) — grep the imports
- [ ] T024 Verify document parity invariant (FR-009): assert deep-equality of returned doc vs source in at least one test per source (entry, artifact, dist/main) — extend existing tests if any source is missing
- [ ] T025 Run final gate: `pnpm --filter @ycforge/composer test` green + `pnpm --filter @ycforge/composer typecheck` clean + no regressions elsewhere in the monorepo (`pnpm test` root); update `specs/README.md` if needed (no — status flip happens after merge)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3–6)**: All depend on Foundational. Chain sources are added incrementally: US1 (entry) → US2 (artifact) → US3 (dist/main) → US4 (terminal) — each extends `extract.ts`, so they execute **sequentially** in priority order, NOT in parallel (shared file `src/extract.ts`)
- **Polish (Phase 7)**: Depends on all stories complete

### User Story Dependencies

- **US1 (P1)**: foundational primitives only — MVP
- **US2 (P2)**: foundational + US1 (`extract.ts`)
- **US3 (P2)**: foundational + US1 + US2 (`extract.ts` chain position)
- **US4 (P2)**: foundational + US1–US3 (terminal branch of same chain)

### Within Each User Story

- Tests MUST be written and confirmed RED before implementation
- Fixtures before integration tests; integration before chain wiring
- Story complete before advancing to the next priority

### Parallel Opportunities

- Within each phase/phase-tests: all `[P]` tasks run in parallel (different files: `errors.ts`, `runner.mjs`, `artifacts.ts`, spec files, fixtures)
- Foundational unit specs (`artifacts.spec.ts`, `spawn-runner.spec.ts`) in parallel
- Each story's fixture task ([P]) parallels its integration-test task

---

## Parallel Example: Foundational tests

```bash
Task: "Write artifacts.spec.ts (valid/missing/broken/priority cases) in packages/composer/src/artifacts.spec.ts"
Task: "Write spawn-runner.spec.ts (ok/crash/timeout/bad-json cases) in packages/composer/src/runner/spawn-runner.spec.ts"
```

## Parallel Example: User Story 1

```bash
Task: "Create fixture test/fixtures/app-safe-entry/ (entry + init-throwing module + expected.json)"
Task: "Write integration tests (parity, env, no-init) in packages/composer/test/extraction.integration.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 (explicit `openapi_entry` via runner)
4. **STOP and VALIDATE**: US1 integration tests green
5. MVP = explicit-entry safe extraction (the core value of IDEA §10 safe mode)

### Incremental Delivery

1. Setup + Foundational → primitives ready
2. US1 (entry source) → safe explicit path works → MVP
3. US2 (artifact fallback) → no-execution path works
4. US3 (dist/main convention) → convention path works
5. US4 (terminal error) → full deterministic chain
6. Polish: edge cases + quickstart + zero-dep gate

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to a user story for traceability
- Each user story is independently deployable/demonstrable: entry-only (MVP), artifact-only, convention-only
- Constitution II: verify tests fail (RED) before implementing each story's behavior
- Commit after each task or logical group; do not mix spec 007 (`auth-config`) work into this branch
- The extracted document is NEVER mutated (FR-009) — any normalization/merge belongs to spec 008