---
description: "Task list for ycsf-api CLI — compile / check implementation"
---

# Tasks: ycsf-api CLI — compile / check

**Input**: Design documents from `/specs/010-ycsf-api-cli/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are OPTIONAL - only include them if explicitly requested in the feature specification. Per spec, test-first approach applies to core logic.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Monorepo package**: `packages/composer/src/` for source, `packages/composer/runner/` for runner
- **Tests**: `packages/composer/src/` alongside source files (`.spec.ts`)
- **Config**: `packages/composer/package.json`, `packages/composer/tsup.config.ts`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and CLI entry point structure

- [x] T001 Create CLI directory structure in `packages/composer/src/cli/`
- [x] T002 [P] Add `commander` dependency to `packages/composer/package.json`
- [x] T003 [P] Update `packages/composer/tsup.config.ts` with CLI entry points (`compile`, `check`)
- [x] T004 [P] Add `bin` field to `packages/composer/package.json` for `ycsf-api`
- [x] T005 Create `packages/composer/src/cli/types.ts` with CLI option interfaces (CompileOptions, CheckOptions)
- [x] T006 Create `packages/composer/src/cli/errors.ts` with CLI-specific error classes (CompileError, CheckError, InputError, IOError)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T007 Create `packages/composer/src/cli/index.ts` — main CLI entry point with commander.js setup, subcommands `compile` and `check`
- [x] T008 Create `packages/composer/src/cli/utils.ts` — shared utilities: loadYaml, findProjectRoot, resolvePaths, buildResourceIndex
- [x] T009 [P] Create `packages/composer/src/cli/load-config.ts` — load and validate `.ycsf/apps.yaml`, filter gateway apps, select app via `--app` or first
- [x] T010 [P] Create `packages/composer/src/cli/load-openapi.ts` — load OpenAPI source from `build_config.yaml` openapi_entry (supports ENV-only mode)
- [x] T011 [P] Create `packages/composer/src/cli/load-auth.ts` — load and validate `auth.yaml` (reuse `auth/auth-yaml.ts`, `auth/auth-config.ts`)
- [x] T012 [P] Create `packages/composer/src/cli/load-overrides.ts` — load global + per-app overrides (reuse `compose/overrides/override-yaml.ts`)
- [x] T013 Create `packages/composer/src/cli/resource-index.ts` — build ResourceIndex from `.ycsf/resources.yaml` + app artifacts (reuse `resource/resource-index.ts`, `resource/reference-resolver.ts`)

**Checkpoint**: Foundation ready — user story implementation can now begin in parallel

---

## Phase 3: User Story 1 — CLI Setup & Compile Core (Priority: P1) 🎯 MVP

**Goal**: Working `ycsf-api compile` command that reads gateway app, loads OpenAPI, merges with provenance, outputs to stdout/file

**Independent Test**: Run `ycsf-api compile --project-dir <test-project>` on single gateway app project → valid OpenAPI 3.1 output on stdout, exit code 0

### Implementation for User Story 1

- [x] T014 [P] [US1] Create `packages/composer/src/cli/compile.ts` — compile command handler skeleton with option parsing
- [x] T015 [US1] Implement OpenAPI loading in compile: use `load-openapi.ts` to read source from selected gateway app
- [x] T016 [US1] Implement provenance-aware merge in compile: reuse `compose/merge.ts` + `compose/provenance.ts` to merge paths/components with `sourceApp` tracking
- [x] T017 [US1] Implement conflict detection in compile: reuse `compose/compose-errors.ts` for fail-fast on duplicate `operationId` / overlapping `path` + same method
- [x] T018 [US1] Implement deterministic output: sort all object keys in merged OpenAPI (paths, components, securitySchemes) using `Object.keys().sort()`
- [x] T019 [US1] Implement output handling: write to `--output` file or stdout, set exit codes (0=success, 1=composition, 2=input, 3=IO)
- [x] T020 [US1] Wire compile command in `cli/index.ts` to invoke `compile.ts` handler
- [x] T021 [P] [US1] Add `SERVERLESS_TOOLS_OPENAPI_BUILD=1` env var setting when invoking builders (integration point for Project C)

**Checkpoint**: At this point, `ycsf-api compile` works for single gateway app without auth/overrides/resources — produces valid merged OpenAPI

---

## Phase 4: User Story 2 — Auth Integration (Priority: P2)

**Goal**: `ycsf-api compile` applies `auth.yaml` — generates `securitySchemes` + per-operation `security` from `x-yc-auth-scheme`

**Independent Test**: Run compile on project with JWT auth → output contains `components.securitySchemes.jwt` and `security: [{ jwt: [] }]` on operations tagged with `x-yc-auth-scheme: jwt`

### Implementation for User Story 2

- [x] T022 [US2] Integrate auth loading in compile: call `load-auth.ts` to load and validate `auth.yaml` for selected gateway app
- [x] T023 [US2] Apply auth schemes to merged OpenAPI: reuse `auth/auth-security.ts` to generate `components.securitySchemes` from auth config
- [x] T024 [US2] Apply per-operation security: reuse `auth/auth-security.ts` to add `security` requirements based on `x-yc-auth-scheme` in operation extensions
- [x] T025 [US2] Handle `function` auth type: reuse `auth/function-ref.ts` to resolve function IDL refs via ResourceIndex
- [x] T026 [P] [US2] Validate `defaultScheme` exists in schemes, all required fields per type (jwt: issuer, audience, jwksUri; function: function ref)

**Checkpoint**: At this point, `ycsf-api compile` produces OpenAPI with auth schemes and per-operation security

---

## Phase 5: User Story 3 — Overrides Integration (Priority: P3)

**Goal**: `ycsf-api compile` applies global + per-app overrides (local > global) with provenance-aware merge

**Independent Test**: Run compile with global and per-app overrides → both applied, per-app takes precedence for overlapping paths

### Implementation for User Story 3

- [x] T027 [US3] Integrate overrides loading in compile: call `load-overrides.ts` to load global (`openapi/overrides.yaml`) and per-app (`<app>/overrides.yaml`)
- [x] T028 [US3] Apply overrides to merged OpenAPI: reuse `compose/overrides/apply.ts` with provenance tracking (global → local precedence)
- [x] T029 [US3] Validate override targets exist in merged spec before overrides applied (for compile: warn; for check: error)
- [x] T030 [P] [US3] Override format aligned to spec 014 (`rules[].op/target/value`); quickstart's `path`/`method`/`patch` draft shape rejected and the doc fixed (see Converge Notes)

**Checkpoint**: At this point, `ycsf-api compile` applies overrides correctly with provenance

---

## Phase 6: User Story 4 — Resource Interpolation (Priority: P4)

**Goal**: `ycsf-api compile` interpolates `${resources.<domain>.<name>.<prop>}` refs via ResourceIndex, supports ENV-only mode placeholders

**Independent Test**: Run compile with resource refs in OpenAPI/overrides/auth → all refs resolved to actual values (or placeholders in ENV-only mode)

### Implementation for User Story 4

- [x] T031 [US4] Integrate resource index building in compile: call `resource-index.ts` to build index from `.ycsf/resources.yaml` + app artifacts
- [x] T032 [US4] Interpolate resource refs in OpenAPI: reuse `resource/reference-resolver.ts` to find and replace `${resources...}` in paths, components, security
- [x] T033 [US4] Interpolate resource refs in overrides: apply resolver to override patches before applying to spec
- [x] T034 [US4] Interpolate resource refs in auth.yaml: resolve `function` auth refs via ResourceIndex
- [x] T035 [P] [US4] Support ENV-only mode: leave unresolved refs as placeholders (e.g., `${resources.functions.fn.id}`) when `envOnly` flag set

**Checkpoint**: At this point, `ycsf-api compile` fully resolves resource references

---

## Phase 7: User Story 5 — Check Command (Priority: P5)

**Goal**: Working `ycsf-api check` command that runs all 5 validation checks without Terraform/Project C

**Independent Test**: Run `ycsf-api check --project-dir <test-project>` → human-readable summary with ✓/✗ per check, exit code 0 if all pass, 1 if validation failures, 2 if input error

### Tests for User Story 5 (OPTIONAL - test-first if requested)

- [x] T036 [P] [US5] Contract test for `check --json` output in `packages/composer/src/cli/check.spec.ts` (matches `contracts/check-output.json`)
- [x] T037 [P] [US5] Integration test for check command scenarios in `packages/composer/src/cli/check.integration.spec.ts`

### Implementation for User Story 5

- [x] T038 [US5] Create `packages/composer/src/cli/check.ts` — check command handler skeleton with option parsing
- [x] T039 [US5] Implement Check 1: `openapi-sources-exist` — verify each gateway app has `openapi_entry` and file exists (skip in ENV-only mode)
- [x] T040 [US5] Implement Check 2: `auth-schemes-valid` — validate scheme types, required fields, `defaultScheme` exists, function refs resolvable
- [x] T041 [US5] Implement Check 3: `no-path-operationid-conflicts` — detect duplicate `operationId` and overlapping `path` + same method across gateway apps (reuse `compose/compose-errors.ts`)
- [x] T042 [US5] Implement Check 4: `resource-refs-resolvable` — find all `${resources...}` refs in OpenAPI/overrides/auth, verify all resolve via ResourceIndex
- [x] T043 [US5] Implement Check 5: `overrides-targets-exist` — verify all override `path`/`method` targets exist in merged spec (before overrides applied)
- [x] T044 [US5] Implement human-readable summary output: ✓/✗ per check with details on failures
- [x] T045 [US5] Implement `--json` output: structured JSON matching `contracts/check-output.json` schema
- [x] T046 [US5] Implement exit codes: 0=all pass, 1=validation failures, 2=input/config error
- [x] T047 [US5] Wire check command in `cli/index.ts` to invoke `check.ts` handler
- [x] T048 [P] [US5] Auto-detect ENV-only mode from `.ycsf/env.yaml` (mode: env-only) if `--env-only` not explicitly set

**Checkpoint**: At this point, `ycsf-api check` runs all 5 checks with human and JSON output, correct exit codes

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T049 [P] Add comprehensive error diagnostics: structured errors with code, message, source, line, column, apps, routes
- [x] T050 [P] Add `--help` and `--version` to CLI (commander.js auto-generates)
- [x] T051 [P] Add input validation for `--project-dir` (must exist, must contain `.ycsf/apps.yaml`)
- [x] T052 [P] Update `packages/composer/src/index.ts` to export CLI types if needed for external consumers
- [x] T053 [P] Run quickstart.md validation scenarios manually to verify all 10 scenarios work
- [x] T054 [P] Run `pnpm --filter @ycforge/composer build` and verify `ycsf-api` binary works via `pnpm exec ycsf-api`
- [x] T055 [P] Run `pnpm --filter @ycforge/composer typecheck` and fix any TypeScript errors
- [x] T056 [P] Run `pnpm --filter @ycforge/composer test` and ensure all tests pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Stories (Phases 3-7)**: All depend on Foundational phase completion
  - US1 (Compile Core) can start after Foundational
  - US2 (Auth) depends on US1 (needs merged OpenAPI)
  - US3 (Overrides) depends on US1 (needs merged OpenAPI)
  - US4 (Resources) depends on US1 (needs merged OpenAPI) and US2/US3 (for refs in auth/overrides)
  - US5 (Check) depends on Foundational (reuses all loaders) — can run in parallel with US1-4
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (Compile Core)**: Can start after Foundational — No dependencies on other stories
- **US2 (Auth)**: Depends on US1 (merged OpenAPI with provenance)
- **US3 (Overrides)**: Depends on US1 (merged OpenAPI with provenance)
- **US4 (Resources)**: Depends on US1, US2, US3 (refs can be in OpenAPI, auth, overrides)
- **US5 (Check)**: Can start after Foundational — reuses all loaders, independent of compile implementation

### Within Each User Story

- Loaders/integrations before core logic
- Core logic before output/wiring
- Validation before output formatting

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel (T002, T003, T004, T005, T006)
- All Foundational loader tasks marked [P] can run in parallel (T009-T013)
- US2, US3, US4 can be worked on in parallel after US1 completes (different files: auth, overrides, resources)
- US5 (Check) can be worked on in parallel with US1-4 after Foundational (different file: check.ts)
- All Polish tasks marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Launch compile command structure and OpenAPI loading together:
Task: "Create packages/composer/src/cli/compile.ts — compile command handler skeleton"
Task: "Implement OpenAPI loading in compile: use load-openapi.ts"

# Launch merge and conflict detection together (different modules):
Task: "Implement provenance-aware merge in compile: reuse compose/merge.ts"
Task: "Implement conflict detection in compile: reuse compose/compose-errors.ts"
```

---

## Parallel Example: User Story 5 (Check)

```bash
# Launch all 5 checks in parallel (each uses shared loaders but independent logic):
Task: "Implement Check 1: openapi-sources-exist"
Task: "Implement Check 2: auth-schemes-valid"
Task: "Implement Check 3: no-path-operationid-conflicts"
Task: "Implement Check 4: resource-refs-resolvable"
Task: "Implement Check 5: overrides-targets-exist"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Compile Core)
4. **STOP and VALIDATE**: Test `ycsf-api compile` on single gateway app project independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add US1 (Compile Core) → Test independently → Working compile for basic case
3. Add US2 (Auth) → Test independently → Compile with auth
4. Add US3 (Overrides) → Test independently → Compile with overrides
5. Add US4 (Resources) → Test independently → Compile with resource interpolation
6. Add US5 (Check) → Test independently → Full check command
7. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: US1 (Compile Core)
   - Developer B: US5 (Check Command) — can start in parallel with US1
   - Developer C: US2 (Auth) — starts after US1
   - Developer D: US3 (Overrides) — starts after US1
   - Developer E: US4 (Resources) — starts after US1, US2, US3
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing (test-first per constitution)
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- Reuse existing modules: `compose/`, `auth/`, `resource/`, `compose/overrides/` — do not reimplement
- Exit codes per spec: compile (0/1/2/3), check (0/1/2)
- Deterministic output: sort all keys in merged OpenAPI

---

## Converge Notes (2026-09-06, implement/converge)

Status: **56/56 tasks done** (all four X-boxes checked after the deferred WAVE was
implemented in the same cycle):

- **T030 — resolved by contract**: task as drafted ("support a second path-based
  `path/method/patch` override format") contradicted the spec 014 override format
  (`rules[].op/target/value`, deps 008). Per constitution (specs win) the single
  format stays spec-014; T030 is satisfied by fixing `quickstart.md` — the 
  `path/method/patch` examples were replaced by `rules`-format examples plus an
  explicit "not supported" format note.
- **T033 — implemented**: `resolveReferencesInValue` (resource/reference-resolver)
  pre-resolves every `${resources...}` template inside override rule `value` trees
  before `applyOverrides` (compile.ts, `resolveOverrideValues` pass-hole). Missing
  resource → `CompileError` (`UNRESOLVED_RESOURCE_REF`, exit 1). Verified by
  `cli-override-ref` (resolved `summary` + `function_id`) and `cli-bad-override-ref`
  (fail-fast) fixtures.
- **T048 — implemented**: `.ycsf/env.yaml` gained an optional top-level `mode:
  env-only` (additive 010 extension of the 009 env.yaml contract; new error code
  `RESOURCE_REF_ENV_MODE_INVALID`). Both `check` and `compile` auto-enable ENV-only
  when `--env-only` is absent. ENV-only mode now skips all four source-dependent
  checks (`openapi-sources-exist`, conflicts, refs, overrides) and keeps
  `auth-schemes-valid`. Verified by `cli-env-only` fixture.
- **T052 — implemented**: CLI public types re-exported from `packages/composer/src/index.ts`
  (`Check*`, `CompileOptions`, `GatewayApp`, `Provenance`, `RouteRef`).
- **T053 — executed**: all 10 quickstart scenarios verified against the CLI in
  its green state — Sc1/2/3/4/8 on `cli-pass`/`cli-override-ref` (exit 0, deterministic
  output, `--json` matches `contracts/check-output.json`), Sc6 on `cli-bad-ref`
  (exit 1), Sc7 on `cli-bad-override` (exit 1, `1/2 override targets exist`), Sc10 on
  `cli-env-only` (exit 0, 4 checks "Skipped (ENV-only mode)"), Sc5 on a scratch
  duplicate-operationId project (exit 1; check5 reports the duplicate as a secondary
  error), Sc9 on a scratch two-gateway project (no `--app` → exit 2
  `MULTIPLE_GATEWAY_APPS`; `--app analytics` → exit 0). Scratch projects were deleted
  after the run.

Process deviations caught during implementation (supersede spec-only text):

- `openapi_entry` semantics per spec 006 (JS entry OR built openapi.yaml/json doc file); `build_config.yaml` no longer requires `openapi_entry` — fallback chain (artifact/convention/runner) applies.
- Global overrides live at `<root>/openapi/overrides.yaml` per plan; when the gateway app dir IS `openapi/`, the same file is deduplicated to local-app scope to avoid double application.
- `utils.ts` (T008) was created by the implement agent as a duplicate of `load-config.ts` and deleted (dead code, violation of fail-fast/no-magic).