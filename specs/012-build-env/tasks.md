---
description: "Task list for build-env — {{$ENV}} runtime interpolation, build_env resolution, ENV runtime validation"
---

# Tasks: build-env — `{{$ENV}}` интерполяция, `build_env` resolution, ENV runtime validation

**Input**: Design documents from `/specs/012-build-env/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/build-env.json, quickstart.md

**Tests**: Test-first per constitution (II). Every acceptance criterion, every FR, and every quickstart scenario Sc1–Sc10 maps to at least one test task (RED → GREEN). Tests are written and confirmed failing BEFORE their implementation task. 011 must stay zero-regression through every step.

**Organization**: Tasks are grouped into Setup / Tests / Core / Integration / Polish phases so each module is implemented test-first and the whole quickstart suite is validated at the end.

## Format: `[ID] [P?] [P1/P2/P3] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[P1]/[P2]/[P3]**: Priority of the user story this task serves (from spec.md). `/speckit.plan` open questions are resolved inline as decided behavior + dedicated test cases.
- Include exact file paths in descriptions.

## Design decisions locked in from plan/research (open questions resolved)

- **Module split (plan Q1)**: `src/build-env/` = `interpolate.ts`, `resolve.ts`, `errors.ts`, `index.ts` (per plan project structure).
- **Shared walk helper location (plan Q1)**: extract the string-leaf traversal into a **neutral shared location** `packages/pilot/src/model/string-leaves.ts` (not re-exported from `env-requirements.ts`), exporting `forEachStringLeaf(value, visit)` per research decision 1 — a generic leaf mapper where `visit(leaf, setLeaf)` can read the leaf (011 collection) or call `setLeaf(next)` to write a replacement into a **fresh** (non-mutating) deep tree (012 interpolation). 011's private `collectStringLeaves` becomes a thin `forEachStringLeaf` consumer; **011 tests must keep passing**.
- **Public entry (plan Q2)**: confirm `prepareBuildEnv(appId: string, buildConfig: BuildConfig, envSnapshot?: Readonly<Record<string, string | undefined>>): BuildEnvResolutionResult` in `src/build-env/index.ts`, exported from `src/index.ts`. Types `EnvValue`, `BuildEnvResolutionResult`, `PreparedBuildEnv` (+ `EnvUnresolvedError`) in `src/contracts/build-env.ts` per data-model.md / `contracts/build-env.json`.
- **Cross-spec contract (additive, Constitution III)**: `PML_ENV_UNRESOLVED` constant is ADDED to BOTH `src/contracts/project-model.ts` (canonical PML_* catalog location) AND `specs/011-project-model/contracts/project-model.json` `#/errorCodes`. `src/contracts/build-env.ts` re-exports it. No `.ycsf` `version` bump.

## Path Conventions

- **Monorepo package**: `packages/pilot/src/` for source, `packages/pilot/test/` for tests
- **Runtime build-env module** (string-only, NO `yaml`, pure Project C): `packages/pilot/src/build-env/`
- **Shared string-leaf walk helper**: `packages/pilot/src/model/string-leaves.ts` (consumed by both `src/model/env-requirements.ts` and `src/build-env/interpolate.ts`)
- **Public type contracts**: `packages/pilot/src/contracts/build-env.ts` re-exported from `src/contracts/index.ts` (`@ycforge/pilot/contracts`)
- **Unit tests**: `packages/pilot/test/unit/`
- **Integration / quickstart scenarios**: `packages/pilot/test/build-env/quickstart.spec.ts`
- **Type tests**: `packages/pilot/test/types/build-env.test-d.ts` (`.test-d.ts`, picked up by vitest typecheck)

⚠️ **No new runtime deps (confirmed)**: interpolation is pure string work; `src/build-env/` imports NOTHING from composer and does NOT import `yaml` (it operates on the already-loaded model). `packages/pilot/package.json` stays unchanged. The existing `isEnvRef` pure predicate (`src/contracts/project-model.ts`) is reused for the final residual-`{{$` guard (SC-004); the capturing global `ENV_REF_RE` grammar (`/\{\{\$([A-Z0-9_]+)\}\}/g`, as in `src/model/env-requirements.ts`) is reused for substitution (research decision 4) — note it lives at `src/model/env-requirements.ts:18`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Package wiring check and the shared string-leaf infrastructure so that both the 011 collection path and the 012 interpolation path share one canonical walk (no semantic drift, research decision 1).

- [x] T001 Verify no new package wiring is needed for 012: confirm `packages/pilot/package.json` stays UNCHANGED (no new runtime deps — interpolation is string-only, reuses existing `yaml` only via the model loader it consumes, `src/build-env/` never imports `yaml`), and `packages/pilot/tsup.config.ts` still emits `index` + `contracts/index` (no config change expected). Run `pnpm --filter @ycforge/pilot test` to confirm the 011 baseline is green BEFORE any changes.
- [x] T002 [P2] Refactor the private `collectStringLeaves` traversal out of `packages/pilot/src/model/env-requirements.ts` into a shared, exported helper `forEachStringLeaf(value: unknown, visit: (leaf: string, setLeaf: (next: string) => void) => void): unknown` in NEW `packages/pilot/src/model/string-leaves.ts`, and make `env-requirements.ts` a thin `forEachStringLeaf` consumer that only *reads* leaves (never calls `setLeaf`) — producing a fresh tree per research decision 1 (an interpolator may call `setLeaf` to write back into a new tree; the 011 collector must not mutate). **Semantic-drift guard**: the refactor must keep 011 behavior identical — run `pnpm --filter @ycforge/pilot test` and confirm `test/unit/env-requirements.spec.ts` and `test/project-model/quickstart.spec.ts` (Sc7/Sc8) still pass unchanged.
- [x] T003 [P2] Scaffold `packages/pilot/src/build-env/` with empty module stubs `interpolate.ts`, `resolve.ts`, `errors.ts`, `index.ts` (function/class signatures per data-model.md) so subsequent test/impl tasks have concrete files; do NOT yet implement logic. No imports from composer; no `yaml` import.

---

## Phase 2: Tests — unit (RED)

**Purpose**: Write failing unit tests for each `src/build-env/` module and the runtime entry, mapping every acceptance criterion / FR and every runtime edge to a concrete case. All RED here; GREEN comes in Phase 3.

### interpolate.ts — `{{$NAME}}` substitution (US-1, P1/P2)

- [x] T010 [P] [P1] Unit test `interpolate.ts`: interpolates `{{$NAME}}` in `build_config` **deep leaves** (nested objects + arrays, non-string scalars skipped) — FR-001, US-1 AC1 in `packages/pilot/test/unit/interpolate.spec.ts`
- [x] T011 [P] [P2] Unit test `interpolate.ts`: substitutes `{{$NAME}}` in `build_env` string values — FR-002, US-2 in `packages/pilot/test/unit/interpolate.spec.ts`
- [x] T012 [P] [P1] Unit test `interpolate.ts`: zero-to-more occurrences per line; a literal (no `{{$...}}`) string passes through unchanged — FR-003, US-1 AC2/AC3 in `packages/pilot/test/unit/interpolate.spec.ts`
- [x] T013 [P] [P1] Unit test `interpolate.ts` cross-namespace (**plan Q on FR-010 / SC-006**): a string containing `${terraform...}` and `${resources.functions.fn.id}` is left **untouched** (only `{{$NAME}}` matched, never `${...}`, per IDEA §19 / research decision 4) in `packages/pilot/test/unit/interpolate.spec.ts`
- [x] T014 [P] [P1] Unit test `interpolate.ts` residual guard (US-3, FR-007/008): when a `{{$NAME}}` maps to an empty/unset snapshot value it is NOT silently substituted — the result surfaces a `PML_ENV_UNRESOLVED` diagnostic carrying `app`, `field` (`build_config`/`build_env`/ENV_NAME), and `var` name; no `{{$` leaks into output (SC-004); fail-fast in `packages/pilot/test/unit/interpolate.spec.ts`

### resolve.ts — build_env resolution (US-2, P1)

- [x] T015 [P] [P1] Unit test `resolve.ts`: `null` build_env entry resolves from the snapshot; unset or empty-string (`''`, per 011 `isSet`) → `PML_ENV_UNRESOLVED` (FR-004, US-2 AC2); literal entry passed as-is, no requirement (FR-005); interpolated entry substituted (FR-002) — all three modes, `Record<string,string>`, no `null` (FR-006), in declaration order (research decision 3) in `packages/pilot/test/unit/resolve.spec.ts`
- [x] T016 [P] [P3] Unit test `resolve.ts`: empty `build_config` / `build_env` → trivial empty resolved env, not an error (FR-015) in `packages/pilot/test/unit/resolve.spec.ts`
- [x] T017 [P] [P2] Unit test `resolve.ts` per-app isolation: two apps resolving their own `BuildConfig` produce independent results, no cross-app contamination, the loaded model (input `build_config`) stays read-only/unchanged (FR-014, research decision 6/1) in `packages/pilot/test/unit/resolve.spec.ts`

### index.ts — prepareBuildEnv runtime entry (US-3/US-4, all)

- [x] T018 [P] [P1] Unit test `prepareBuildEnv` (entry): success `{ kind:'ok', resolvedEnv, buildConfig }` for a valid mixed config; failure `{ kind:'invalid', errors }` (with `ProjectModelDiagnostic[]`, code `PML_ENV_UNRESOLVED`) — success and failure mutually exclusive, never mixed (spec `BuildEnvResolutionResult` invariant / research decision 7) in `packages/pilot/test/unit/prepare-build-env.spec.ts`
- [x] T019 [P] [P2] Unit test `prepareBuildEnv` snapshot semantics (research decision 2 / spec Assumption, SC-002): env values read once via an injected snapshot (hermetic, parallel-safe, no host mutation); PLUS at least one test using the real `process.env` default with `vi.stubEnv`/`vi.unstubAllEnvs` (confirm the default `{ ...process.env }` path works) — determinism: same inputs → binary identical output across two calls in `packages/pilot/test/unit/prepare-build-env.spec.ts`

### errors.ts — EnvUnresolvedError (FR-015)

- [x] T020 [P] [P1] Unit test `errors.ts`: `EnvUnresolvedError` aggregates one or more `PML_ENV_UNRESOLVED` diagnostics, each carrying `code`/`message`/`file`/`app`/`field` per `contracts/build-env.json` `#/definitions/unresolvedDiagnostic`, reusing the 011 `diag` factory shape (FR-015) in `packages/pilot/test/unit/build-env-errors.spec.ts`

### type-level (RED)

- [x] T021 [P] [P2] Type-test `test/types/build-env.test-d.ts`: verify the new public contracts `EnvValue`, `BuildEnvResolutionResult`, `PreparedBuildEnv`, the `PML_ENV_UNRESOLVED` constant, and the `prepareBuildEnv` signature are importable + type-usable from `@ycforge/pilot/contracts` (mirrors `test/types/project-model.test-d.ts` pattern; `expectTypeOf<...>()` for the discriminated union shapes per `contracts/build-env.json`) — RED until Phase 3 contracts land in `packages/pilot/test/types/build-env.test-d.ts`

---

## Phase 3: Core — contracts + implementation (GREEN)

**Purpose**: Implement the contracts and `src/build-env/` modules to turn the Phase 2 tests GREEN. `src/contracts/` stays dependency-free; `src/build-env/` stays pure Project C (no composer, no `yaml`).

### Cross-spec contract — additive `PML_ENV_UNRESOLVED`

- [x] T030 [P1] Add `export const PML_ENV_UNRESOLVED = 'PML_ENV_UNRESOLVED'` to the PML_* constant set in `packages/pilot/src/contracts/project-model.ts`, AND add `"PML_ENV_UNRESOLVED"` to `#/errorCodes` (`properties` + `required`, `additionalProperties: false`) in `specs/011-project-model/contracts/project-model.json` — additive, no existing code removed/re-keyed, no `.ycsf` `version` bump (research decision 5, FR-008, Constitution III). Keep TS constants == JSON `#/errorCodes` (Constitution V).

### Public type contracts

- [x] T031 [P] [P1] Create `packages/pilot/src/contracts/build-env.ts` — NEW type-only + pure public contracts per data-model.md / `contracts/build-env.json`: `EnvValue` (`{kind:'null'} | {kind:'literal';value:string} | {kind:'interpolated';refs:string[]}`), `BuildEnvResolutionResult` (`{kind:'ok';resolvedEnv:Record<string,string>;buildConfig:unknown} | {kind:'invalid';errors:ProjectModelDiagnostic[]}`), `PreparedBuildEnv` (`appId/resolvedEnv/buildConfig`), `EnvUnresolvedError` (type mirror, `code:'PML_ENV_UNRESOLVED'`, `diagnostics`, extends Error) and re-export/use `PML_ENV_UNRESOLVED` from `./project-model.js` (depends on T030)
- [x] T032 [P] [P1] Re-export the new build-env contracts from `packages/pilot/src/contracts/index.ts`: add `export * from './build-env.js'` (the contracts barrel, `@ycforge/pilot/contracts`; stays zero-runtime-dep — no `yaml`) (depends on T031)

### Runtime module implementation

- [x] T033 [P] [P2] Implement `packages/pilot/src/build-env/interpolate.ts` — `{{$NAME}}` substitution over build_config string leaves using the shared `forEachStringLeaf` from `src/model/string-leaves.ts` (T002), producing a FRESH interpolated tree (never mutates the loaded model, research decision 1); uses the capturing `ENV_REF_RE` grammar (`/\{\{\$([A-Z0-9_]+)\}\}/g`) for substitution and `isEnvRef` (`src/contracts/project-model.ts`) for the residual guard; no writes for `${...}`/`${resources...}` (research decision 4); report unresolved as `PML_ENV_UNRESOLVED` (depends on T002, T010–T014)
- [x] T034 [P] [P2] Implement `packages/pilot/src/build-env/resolve.ts` — build_env resolution (null → snapshot value / empty-unset → `PML_ENV_UNRESOLVED`; literal → as-is; interpolated → substitute via interpolate.ts), in declaration order, → `Record<string,string>` no-null invariant (FR-004/005/006, research decision 3) (depends on T015–T017, T033)
- [x] T035 [P] [P2] Implement `packages/pilot/src/build-env/errors.ts` — `EnvUnresolvedError extends Error` aggregating one or more `PML_ENV_UNRESOLVED` diagnostics, built via the shared `diag()` factory from `src/model/errors.ts` (FR-015) (depends on T020, T031)
- [x] T036 [P1] Implement `packages/pilot/src/build-env/index.ts` — `prepareBuildEnv(appId: string, buildConfig: BuildConfig, envSnapshot?: Readonly<Record<string, string | undefined>>): BuildEnvResolutionResult`: capture env snapshot once (research decision 2), interpolate build_config (T033) + resolve build_env (T034) per app, then a final residual-`{{$` guard (SC-004) using `isEnvRef`; return `{ kind:'ok' }` or `{ kind:'invalid', errors }` — never throws for an unresolved var, never mixed state (research decision 7). Does NOT construct a `BuildContext` (boundary mapping = spec 021, FR-009) (depends on T018, T019, T033–T035)
- [x] T037 [P1] Export the runtime entry from `packages/pilot/src/index.ts`: `export { prepareBuildEnv }` (plus type re-export of `BuildEnvResolutionResult`) alongside `loadProjectModel` (internal-use entry; `@ycforge/pilot/contracts` types stay separate) (depends on T036, T031–T032)

---

## Phase 4: Integration — quickstart scenarios (RED → GREEN)

**Purpose**: Run all quickstart scenarios against the real `prepareBuildEnv` in `packages/pilot/test/build-env/quickstart.spec.ts` (hermetic — `prepareBuildEnv` takes a `BuildConfig` object + optional snapshot, so most Sc need no temp project; Sc10 uses a `.env` fixture + `vi.stubEnv`). Each maps to the listed US/AC + FR. Write the integration test first (RED), then GREEN after Phase 3.

- [x] T040 [P1] Integration test Sc1 (valid mixed build_env + build_config interpolation): reference project apps (user_service/analytics/frontend/openapi via their `BuildConfig`s) — `analytics` with `build_env` null/literal/interpolated + `build_config` `{{$ANALYTICS_IMAGE_TAG}}`/`{{$ANALYTICS_DOCKERFILE}}`/`https://{{$REG}}/{{$REPO}}` → `{ kind:'ok' }`, resolvedEnv all-string, build_config fully interpolated (US-1/2, FR-001/002/003/006) in `packages/pilot/test/build-env/quickstart.spec.ts`
- [x] T041 [P1] Integration test Sc2 (null build_env): `build_env:{ NPM_TOKEN:null }` with snapshot `{ NPM_TOKEN:'s3cr3t' }` → `{ kind:'ok' }`, `resolvedEnv.NPM_TOKEN === 's3cr3t'` (US-2, FR-004) in `packages/pilot/test/build-env/quickstart.spec.ts`
- [x] T042 [P1] Integration test Sc3 (literal passthrough): `HELLO_TEXT:'привет, мир!'` with empty snapshot → unchanged, no requirement (US-1 AC3, FR-005) in `packages/pilot/test/build-env/quickstart.spec.ts`
- [x] T043 [P1] Integration test Sc4 (interpolated build_env): `REGISTRY:'{{$DOCKER_REGISTRY}}'` → substituted (US-2, FR-002) in `packages/pilot/test/build-env/quickstart.spec.ts`
- [x] T044 [P1] Integration test Sc5 (unresolved-after-load fail-fast): `dockerfile:'{{$ANALYTICS_DOCKERFILE}}'` with snapshot `''` → `{ kind:'invalid' }`, diagnostic `code:PML_ENV_UNRESOLVED`, `app:'analytics'`, `field:'build_config'`, message names `ANALYTICS_DOCKERFILE`; builder never invoked (invalid branch returns errors) (US-3, FR-007/008) in `packages/pilot/test/build-env/quickstart.spec.ts`
- [x] T045 [P2] Integration test Sc6 (cross-namespace splice): `build_config:{ cmd:'run ${TFO_VAR} --port {{$PORT}} ${resources.functions.fn.id}' }` with `PORT` set → only `{{$PORT}}` substituted, `${TFO_VAR}` and `${resources.functions.fn.id}` untouched, no error (FR-010 / SC-006) in `packages/pilot/test/build-env/quickstart.spec.ts`
- [x] T046 [P3] Integration test Sc7 (empty build_config / build_env): `frontend` `{ build_config:{}, build_env:{} }` → `{ kind:'ok' }`, `resolvedEnv === {}`, `buildConfig === {}` (FR-015) in `packages/pilot/test/build-env/quickstart.spec.ts`
- [x] T047 [P1] Integration test Sc8 (per-app isolation): `prepareBuildEnv('appA',{X:'{{$A}}'})` and `prepareBuildEnv('appB',{X:'{{$B}}'})` with snapshot `{A:'a',B:'b'}` → each resolves only its own config, model unchanged (FR-014) in `packages/pilot/test/build-env/quickstart.spec.ts`
- [x] T048 [P1] Integration test Sc9 (multiple refs per line + duplicate ref): `url:'https://{{$REG}}/{{$REPO}}?token={{$TOKEN}}'` → all substituted; duplicate `{{$TOKEN}}` resolves to the same value (US-1 AC2, Edge Case) in `packages/pilot/test/build-env/quickstart.spec.ts`
- [x] T049 [P2] Integration test Sc10 (deterministic snapshot, no `.env`, no defaults): run same `prepareBuildEnv` twice with same snapshot + a written `.env` fixture with `FOO=from_file` → runs binary identical (SC-002), resolved value from snapshot `FOO:'bar'` NOT from `.env`, no default injected (FR-012/013) in `packages/pilot/test/build-env/quickstart.spec.ts`
- [x] T050 [P1] Integration edge — both PML codes distinct (FR-008 clarify): assert `PML_ENV_NOT_SET` (011 load-phase) and `PML_ENV_UNRESOLVED` (012 runtime-prep) are distinct constants and not equal; an unresolved runtime var yields `PML_ENV_UNRESOLVED` (not `PML_ENV_NOT_SET`) in `packages/pilot/test/build-env/quickstart.spec.ts`

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Verify the package/pipeline surface end-to-end and confirm zero regression on spec 011.

- [x] T060 [P1] Full suite green incl. 011 zero-regression: `pnpm --filter @ycforge/pilot test` — confirm all `test/unit/*`, `test/build-env/*` and `test/project-model/*` scenarios pass (011 unchanged) and type-only `test/types/*.test-d.ts` (incl. new `build-env.test-d.ts`) run via vitest typecheck
- [x] T061 [P1] `src/contracts/` zero-dependency invariant intact: run `pnpm --filter @ycforge/pilot test -- --run test/unit/zero-dependency.test.ts` — contract import graph only relative modules; `src/build-env/` and `src/contracts/build-env.ts` contain NO `yaml` import and no composer import (pure Project C; interpolation is string-only)
- [x] T062 [P1] Typecheck: `pnpm --filter @ycforge/pilot typecheck` — fix any TS errors (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` strictness on the new discriminated unions / `ResolvedBuildEnv`)
- [x] T063 [P1] tsup build: `pnpm --filter @ycforge/pilot build` — confirm dist emits `index` + `contracts/index` entries including the new build-env runtime + contracts (`packages/pilot/tsup.config.ts` unchanged unless needed)
- [x] T064 [P1] Verify `PML_ENV_UNRESOLVED` consistency in BOTH canonical locations: present as a constant in `src/contracts/project-model.ts` AND in `#/errorCodes` of `specs/011-project-model/contracts/project-model.json` (Constitution III/V)
- [x] T065 [P2] Perf smoke (SC-005, optional-but-nice): in `packages/pilot/test/build-env/quickstart.spec.ts`, interpolate/resolve a 10-ENV project (~5 apps) and assert `prepareBuildEnv` completes well under 50ms (added to load); no optimization beyond the single-pass design
- [x] T066 [P1] Final consistency pass: confirm every FR-001..FR-015 maps to ≥1 test and every quickstart Sc1–Sc10 maps to a Phase-4 scenario; confirm `isEnvRef` (contracts) is reused for the residual guard and the capturing `ENV_REF_RE` is imported/reused, not re-declared; note `.specify/feature.json` should point to `specs/012-build-env` and the README roadmap update are BOTH handled by the main agent at PR time (NOT this spec — no task here)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — starts immediately. T001 confirms the 011 baseline; T002 (shared walk helper) must land before any interpolate work; T003 scaffolds `src/build-env/`.
- **Tests (Phase 2)**: Depends on Setup (T001 baseline, T002/T003 for imports/stubs). RED only.
- **Core (Phase 3)**: Depends on Phase 2 tests existing (GREEN turns them). Order: T030 (PML constant) + T031/T032 (contracts) first (blocks interpolate/resolve imports), then T033–T035 (runtime modules, parallel), then T036 (entry), then T037 (index export).
- **Integration (Phase 4)**: Depends on Phase 3 (real `prepareBuildEnv` + contracts). RED written first, GREEN after Phase 3.
- **Polish (Phase 5)**: Depends on all phases complete.

### Within Each User Story / Module

- Tests (Phase 2 / Phase 4 integration) MUST fail before implementation (Phase 3) — RED then GREEN (Constitution II).
- The 011 refactor (T002) is validated by existing `env-requirements.spec.ts` + quickstart Sc7/Sc8 staying green — it must NOT change observable 011 behavior.

### Parallel Opportunities

- All Setup tasks marked [P] (T002, T003) — T002 is the only cross-cutting infra; T003 scaffolds build-env stubs (independent files).
- All Phase 2 test tasks marked [P] — different `.spec.ts` files, no interdependencies.
- Phase 3 implementation: T030, T031, T032 sequential-ish (contracts first); T033/T034/T035 parallel (independent modules after contracts); T036/T037 depend on those.
- Integration scenarios T040–T050 all [P] — same `quickstart.spec.ts` file, distinct `it` blocks; can be authored in one pass.

---

## Parallel Example: Phase 3 core modules

```bash
# After PML_ENV_UNRESOLVED + contracts (T030–T032) land, launch the three
# runtime modules together (each after its own RED unit test):
Task: "Implement interpolate.ts (depends T010-T014)"
Task: "Implement resolve.ts (depends T015-T017)"
Task: "Implement errors.ts (depends T020)"
# then the entry + export:
Task: "Implement prepareBuildEnv (T036) + src/index.ts export (T037)"
```

---

## Implementation Strategy

### MVP First (US-1 + US-2 core path)

1. Phase 1 Setup — T001 baseline, T002 shared walk helper, T003 stubs.
2. Phase 2 RED — interpolation + resolution unit tests (T010–T020) + type test (T021).
3. Phase 3 GREEN — PML constant (T030) → contracts (T031–T032) → interpolate/resolve/errors (T033–T035) → `prepareBuildEnv` entry + index export (T036–T037).
4. **STOP and VALIDATE**: Sc1 (mixed build_env + interpolation) integration + typecheck + build.
5. **MVP reached**: runtime-build-env prepare produces resolved/interpolated input from a valid loaded model.

### Incremental Delivery

1. Shared walk helper + 011 refactor zero-regression (T002) → foundation
2. `PML_ENV_UNRESOLVED` additive code (T030) + public contracts (T031–T032)
3. Interpolation (US-1, T033) → resolution (US-2, T034) → fail-fast (US-3, T035–T036)
4. `.env`-free determinism (US-4) via snapshot semantics (T019, T049/Sc10)
5. Integration Sc1–Sc10 + Polish (Phases 4–5)

### Parallel Team Strategy

1. Setup together (T001–T003).
2. Developer A: contracts (T030–T032) + entry (T036–T037).
3. Developer B: interpolate.ts (+ its RED tests).
4. Developer C: resolve.ts (+ its RED tests).
5. Developer D: errors.ts + EnvUnresolvedError (+ RED tests).
6. Integration + polish after all land. All PRs target `dev`, branch `012-build-env`.

---

## Notes

- [P] tasks = different files, no dependencies.
- Tests written RED first; confirm failing, then GREEN (Constitution II).
- `src/build-env/` is pure Project C runtime: NO composer import, NO `yaml` import (string-only interpolation over the already-loaded model); zero-runtime-dep contract invariant holds for `src/contracts/` (T061).
- Reuse `isEnvRef` (pure predicate, `src/contracts/project-model.ts`) for the residual-`{{$` guard and the capturing `ENV_REF_RE` grammar for substitution (research decision 4) — do not re-declare (T066).
- `prepareBuildEnv` returns `{ kind:'ok' } | { kind:'invalid', errors }` and never throws for an unresolved variable; only catastrophic I/O throws (N/A here). Boundary mapping into `BuildContext` (spec 002) is spec 021's job, NOT this module (FR-009).
- `PML_ENV_UNRESOLVED` is added BOTH to `src/contracts/project-model.ts` AND `specs/011-project-model/contracts/project-model.json` `#/errorCodes` (additive, semver-compatible, Constitution III) — T030 + T064.
- Do NOT update `.specify/feature.json` or `specs/README.md` here — the main agent handles both at PR time.
- Do NOT commit. All checkboxes start `- [ ]` until implementation marks them done.

---

# Converge Notes (spec 012)

## Verification summary (observed)

Ran from repo root on `packages/pilot`:

- `pnpm --filter @ycforge/pilot test` → **28 files / 161 tests passed, 0 type errors**. Includes type-level tests (`test/types/**/*.test-d.ts`, incl. `build-env.test-d.ts` 7 tests) via vitest tsc typecheck.
- `pnpm --filter @ycforge/pilot typecheck` (`tsc --noEmit`) → **clean**.
- `pnpm --filter @ycforge/pilot build` (tsup) → ESM+CJS+DTS success; emits `index` + `contracts/index` entries including new build-env runtime + contracts.

Zero-dependency invariant re-verified in the full-suite run (`zero-dependency.test.ts`, 2 tests): `src/contracts/` imports only relative modules; `src/build-env/` contains no `yaml` import and no composer import; interpolation is string-only.

## FR → code → test traceability

| FR | Code | Test |
|----|------|------|
| FR-001 interpolate `{{$NAME}}` in build_config deep leaves | `src/build-env/interpolate.ts:83` (`interpolateBuildConfig`) using `forEachStringLeaf` | `test/unit/interpolate.spec.ts` (deep leaves + arrays); quickstart Sc1 |
| FR-002 interpolate `{{$NAME}}` in build_env values | `src/build-env/interpolate.ts:40` (`interpolateString`) + `src/build-env/resolve.ts:50` | `test/unit/interpolate.spec.ts`; `test/unit/resolve.spec.ts`; quickstart Sc1/Sc3/Sc4 |
| FR-003 zero-to-more occurrences per line; literal unchanged | `src/build-env/interpolate.ts:48` (regex `ENV_REF_RE` global replace) | `test/unit/interpolate.spec.ts`; quickstart Sc1/Sc3 |
| FR-004 null build_env → snapshot value | `src/build-env/resolve.ts:32-47` | `test/unit/resolve.spec.ts`; quickstart Sc2 |
| FR-005 literal build_env → as-is | `src/build-env/resolve.ts:50-53` (interpolateString passthrough) | `test/unit/resolve.spec.ts`; quickstart Sc3 |
| FR-006 resolved buildEnv `Record<string,string>` no null | `src/build-env/resolve.ts:27` (`resolvedEnv` accumulator) | `test/unit/resolve.spec.ts`; type test `build-env.test-d.ts`; quickstart Sc1 |
| FR-007 fail-fast: residual `{{$` or unresolved null/empty | `src/build-env/interpolate.ts:46-67` + `src/build-env/resolve.ts:32-48` + `src/build-env/index.ts:67-97` (`assertNoResidual`) | `test/unit/interpolate.spec.ts`; `test/unit/resolve.spec.ts`; quickstart Sc5 |
| FR-008 diagnostic with app/field/var + `PML_ENV_UNRESOLVED` | `src/build-env/interpolate.ts:56-65`; `src/build-env/resolve.ts:36-44` (uses `diag()` factory) | `test/unit/interpolate.spec.ts`; `test/unit/resolve.spec.ts`; `test/unit/build-env-errors.spec.ts`; quickstart Sc5/edge |
| FR-009 reuse `BuildContext` shapes, no new builder API | `src/build-env/index.ts:7-8` (does NOT construct `BuildContext`); boundary = spec 021 | quickstart (returns `BuildEnvResolutionResult`, not `BuildContext`) |
| FR-010 only `{{$NAME}}`; `${...}`/`${resources...}` untouched | `src/build-env/interpolate.ts:13` (imports `ENV_REF_RE` = `/\{\{\$([A-Z0-9_]+)\}\}/g`); `${...}` never matches by construction | `test/unit/interpolate.spec.ts` (cross-namespace); quickstart Sc6 |
| FR-011 runtime-prep after load-time validation | `src/build-env/index.ts:1-13` (doc: "AFTER load-time validation") | quickstart Sc5 (empty string = runtime-not-load) |
| FR-012 no `.env` file loading | `src/build-env/index.ts:33-34` (snapshot = `{ ...process.env }` or injected) | quickstart Sc10 |
| FR-013 no default values | By construction: empty/unset → `PML_ENV_UNRESOLVED`, never default | quickstart Sc10; `test/unit/prepare-build-env.spec.ts` |
| FR-014 per-app isolation | `src/build-env/index.ts:28` (`appId` parameter); stateless per call | `test/unit/resolve.spec.ts`; quickstart Sc8 |
| FR-015 empty build_config/build_env → trivial empty | `src/build-env/interpolate.ts:90` (forEachStringLeaf on `{}`) + `src/build-env/resolve.ts:31` (Object.entries on `{}`) | quickstart Sc7 |

## Acceptance coverage

- US-1 (AC1/AC2/AC3) → `interpolate.spec.ts` (deep leaves, multi-refs, literal); quickstart Sc1/Sc3/Sc9
- US-2 (AC1/AC2/AC3) → `resolve.spec.ts` (null/literal/interpolated, empty/unset, unresolved ref); quickstart Sc2/Sc3/Sc4
- US-3 (AC1/AC2/AC3) → `interpolate.spec.ts` (residual guard); `prepare-build-env.spec.ts` (never throws); quickstart Sc5
- US-4 (AC1/AC2) → quickstart Sc10 (`.env` fixture ignored, only snapshot)
- Quickstart Sc1–Sc10 + edge → `quickstart.spec.ts` all 12 tests pass
- SC-001 (100% AC coverage) — checked
- SC-002 (determinism) — `prepare-build-env.spec.ts` + quickstart Sc10
- SC-003 (fail-fast always) — `interpolate.spec.ts` + `resolve.spec.ts`
- SC-004 (no residual `{{$`) — `assertNoResidual` in `src/build-env/index.ts:67-97` + quickstart Sc5
- SC-005 (perf < 50ms) — `quickstart.spec.ts` perf smoke
- SC-006 (namespace safety) — `interpolate.spec.ts` + quickstart Sc6

## Cross-spec contract verification

- `PML_ENV_UNRESOLVED` present in BOTH:
  - `packages/pilot/src/contracts/project-model.ts:135` — `export const PML_ENV_UNRESOLVED = 'PML_ENV_UNRESOLVED';`
  - `specs/011-project-model/contracts/project-model.json:120` — in `#/errorCodes.properties` and `#/errorCodes.required` (12 codes total, additive)
- JSON Schema valid (`project-model.json` validates; `additionalProperties: false` respected)
- 011 test suite green: `test/project-model/quickstart.spec.ts` (14 tests) + `test/unit/env-requirements.spec.ts` (6 tests) + all 011 unit tests pass — zero regression

## Constitution gates — ALL PASS

- **I** separation: pure Project C in `src/build-env/`; no composer import; no builder execution; no Terraform; no materializer
- **II** test-first: acceptance criteria → tests (RED → GREEN phases in tasks.md); all tasks completed
- **III** `version: 1` unchanged; additive `PML_ENV_UNRESOLVED` (semver-compatible); contracts via `@ycforge/pilot/contracts` subpath
- **IV** Terraform untouched: `${...}` namespace never matched
- **V** fail-fast: `PML_ENV_UNRESOLVED` with app/field/var; no `.env`; no defaults; no implicit env; `isEnvRef` + `ENV_REF_RE` reused (not re-declared)
- **VI** ownership: per-app keyed by `app_id`; resources untouched
- **Zero-dep**: `src/contracts/build-env.ts` — type-only/pure; `src/build-env/` — no `yaml` import, no composer import (verified via grep)
- **Secrets**: no credentials modeled; only existing `process.env` interpolated

## IDEA.md divergence

None. §6 (build_config ENV interpolation, mandatory ENV, no defaults, error before builder) and §19 (three interpolation namespaces — `{{$NAME}}`, `${...}`, `${resources...}`) are fully aligned with implementation.

## Deviations made during implement

1. **Internal `unresolved: string[]` returns**: `InterpolatedBuildConfig`, `InterpolatedString`, and `ResolvedBuildEnv` interfaces carry a non-exported `unresolved: string[]` field used internally for deduplication of diagnostics and the residual guard (`assertNoResidual`). This is NOT part of the public contract (`BuildEnvResolutionResult` returns only `errors: ProjectModelDiagnostic[]`) — implementation detail only.

2. **Shared walk helper location**: `forEachStringLeaf` lives in `src/model/string-leaves.ts` (research decision 1). Both 011 `env-requirements.ts` and 012 `interpolate.ts` import from it. `env-requirements.ts` was refactored to consume `forEachStringLeaf` as a thin read-only collector (012 can call `setLeaf` for fresh-tree production). 011 behavior unchanged — verified by `env-requirements.spec.ts` + quickstart Sc7/Sc8 passing.

3. **Sc10 fixture approach**: Sc10 creates a `.env` file via `TempProject` (`createTempProject()` / `removeTempProject()`) to confirm it is NOT read. The `prepareBuildEnv` function does not interact with the filesystem at all; the `.env` fixture is a no-op test proving the spec's "no `.env` loading" requirement by construction.

4. **`ENV_REF_RE` imported, not re-declared**: The capturing global regex `/\{\{\$([A-Z0-9_]+)\}\}/g` is defined once in `src/model/env-requirements.ts:18` and imported by both `interpolate.ts` and `index.ts`. The `isEnvRef` predicate (`src/contracts/project-model.ts:141`) is used for the residual guard. Neither is re-declared anywhere in `src/build-env/`.

## Follow-up items

None blocking.

## Readiness verdict

**CONVERGED** — the implementation satisfies the spec, plan, and tasks. All 161 tests pass, typecheck is clean, build succeeds, cross-spec `PML_ENV_UNRESOLVED` is consistent in both locations, 011 zero-regression confirmed, all constitution gates pass, and no IDEA.md divergence exists.
