# Implementation Plan: materializer-dispatch — collision policy, TerraformResource → `.tf.json`

**Branch**: `014-materializer-dispatch` | **Date**: 2026-09-07 | **Spec**: [specs/014-materializer-dispatch/spec.md](./spec.md)

**Input**: Feature specification from `spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add to Project C (`@ycforge/pilot`, `packages/pilot`) the materializer dispatch + Terraform serialization layer that bridges the loaded plugin registry (spec 013) and the validated project model (spec 011) to generated `.tf.json` files. Two-phase dispatch: (1) **selection** — build an `ArtifactDescriptor` per app and call `supports(artifact, context)` on every registered materializer, collecting `MTL_COLLISION` (>1 supporter) and `MTL_UNHANDLED_ARTIFACT` (0 supporters) for ALL artifacts, all-or-nothing (no `materialize` call if any selection error); (2) **materialization** — call `materialize(artifact, context)` in deterministic project-model dependency order, abort-on-first-error → `MTL_MATERIALIZE_FAILED`. Serialize the returned `TerraformResource` into deterministic (`<app_id>.ycsf.tf.json`) and declared outputs into `00-ycsf-outputs.tf.json`, with a separate pure I/O `writeGeneratedTerraform(infraDir, files)` that only ever touches C-owned `*.ycsf.tf.json` (never user `*.tf`) and removes stale generated files on regeneration. Fail-fast collision semantics (Constitution V); zero runtime deps in `src/contracts/`.

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)

**Primary Dependencies**:
- No new runtime dependencies. `src/contracts/` stays zero-runtime-dependency (existing `zero-dependency.test.ts`); dispatch runtime lives in `src/materialize/` (uses only Node builtins `node:fs/promises`, `node:path` + contract types). `JSON.stringify` with a sorted-key replacer for deterministic serialization — no library.
- Type-only contracts from `@ycforge/pilot/contracts` (spec 002 `Materializer`/`TerraformResource`/`MaterializationContext`/`OutputBuilder`; spec 011 `ProjectModel`/`App`; spec 013 `PluginRegistry`/`PluginEntry`).

**Storage**: File system (`infra/*.ycsf.tf.json` generated; user `*.tf` untouched); in-memory `DispatchResult` structures.

**Testing**: Vitest (already configured) + `test/types/*.test-d.ts` type tests. Test-first per constitution; acceptance criteria / quickstart scenarios → tests (RED → GREEN). Hermetic: fixture materializers are inline plain objects (per spec Assumption) wrapped as registry `PluginEntry`; no filesystem needed for `dispatch` (pure+async); `writeGeneratedTerraform` tested against `mkdtemp` temp dirs.

**Target Platform**: Library module within `packages/pilot` (ESM+CJS via tsup); consumed by spec 021 `ycsf build`; upstream of real materializer packages (spec 019).

**Project Type**: Type-safe library runtime module (two-phase dispatch + deterministic JSON serializer + pure I/O writer) plus type-only public contracts + `MTL_*` constants.

**Performance Goals**: SC-003/SC-004 — deterministic byte-identical output across runs for identical input; dispatch over typical project (5–20 apps, 2–5 materializers) completes in ms (all in-memory, no I/O in the pure path).

**Constraints**:
- Two-phase all-or-nothing dispatch (FR-003/FR-017): any selection error → `invalid` with ALL selection errors; `materialize` NEVER called if any selection error.
- Deterministic ordering (FR-014): project-model `depends_on_graph.topologicalOrder`, ties alphabetical by `app_id`; registry materializer iteration order must be well-defined (research decision 2).
- `MaterializationContext` is **not** extended (spec 014 Assumption, spec 002 contract): dispatch consumes `{ output: OutputBuilder }` verbatim. Env wiring stays with spec 021.
- `supports` MUST be sequential & pure (spec 002: "Must stay pure and cheap"), I/O-free, so selection cannot fail — only `materialize` can throw (→ `MTL_MATERIALIZE_FAILED`).
- Serialization: deterministic JSON (sorted object keys, lexicographic); `<app_id>.ycsf.tf.json`; `{"resource":{type:{name:config}}}`; outputs → `00-ycsf-outputs.tf.json` `{"output":{name:{"value":"${...}"}}}`; validation of `type.name` against Terraform identifier grammar `[a-zA-Z_][a-zA-Z0-9_]*` → `MTL_INVALID_TERRAFORM_ADDRESS`; filename collision → `MTL_FILENAME_COLLISION`; duplicate output name → `MTL_OUTPUT_NAME_COLLISION`.
- Regeneration safety (FR-015/016): write/overwrite ONLY C-owned `*.ycsf.tf.json` (incl. `00-ycsf-outputs.tf.json`); never touch user `*.tf`; remove stale C-owned files on regeneration.
- Fail-fast (Constitution V): collision = error, never silent pick; unhandled = error, never warning.

**Scale/Scope**: Typical project 5–20 apps, 2–5 materializers; one app → one Artifact descriptor → one `TerraformResource` (multi-resource per app is spec 019). One infra dir per dispatch call.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Pure Project C dispatch+serialize in `packages/pilot/src/materialize/`; C does NOT execute builders (021), does NOT call Terraform CLI (021); C serializes opaque `configuration` only (Constitution IV); no provider schema modeling |
| II. Spec-First, Test-First | ✅ PASS | Every AC/scenario → test (RED → GREEN); `dispatch` pure+async testable without filesystem; `writeGeneratedTerraform` I/O tested hermetically via `mkdtemp` |
| III. Contracts Versioned | ✅ PASS | `MTL_*` constants in `src/contracts/materialize.ts` re-exported via `@ycforge/pilot/contracts` (semver); no new `.ycsf/*.yaml` files (version marker question — research). Generated file header: NOTE (research decision) |
| IV. Terraform Stays Terraform | ✅ PASS | **Central here**: deterministic minimal `.tf.json` per app + single outputs file; user `*.tf` untouched; C never validates provider schema |
| V. Explicit Over Magic | ✅ PASS | **Central here**: two materializers claiming `supports` → `MTL_COLLISION` (fail-fast error); no supporter → `MTL_UNHANDLED_ARTIFACT` (error, not warning); duplicate tf address → `MTL_FILENAME_COLLISION`/`MTL_INVALID_TERRAFORM_ADDRESS`; duplicate output name → `MTL_OUTPUT_NAME_COLLISION`; no silent resolution |
| VI. Ownership Model | ✅ PASS | apps = managed → C generates their resources; C-owned = `*.ycsf.tf.json` only; user `*.tf` external |
| Monorepo Tooling | ✅ PASS | `src/materialize/` runtime (Node builtins only), `src/contracts/materialize.ts` stays dependency-free; `MTL_*` constants pure; re-exported via `@ycforge/pilot/contracts`; runtime API via `src/index.ts` |
| Secrets | ✅ PASS | No credentials/env handling in dispatch; env wiring is 021 |
| OpenAPI Build Safe Mode | ✅ PASS | `openapi`/`yandex-api-gateway` app treated as an opaque artifact type matched to a materializer; C sets no OpenAPI semantics |
| Zero-dep contracts | ✅ PASS | New public type contracts + `MTL_*` constants are type-only/pure in `src/contracts/materialize.ts`; everything touching I/O (`fs`) lives in `src/materialize/`, never in `src/contracts/` |

**Gate Decision**: All gates PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/014-materializer-dispatch/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (materialize.json — MTL_* error catalog + .tf.json output schema)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/pilot/
├── package.json                     # UNCHANGED (no new deps; node builtins only for I/O)
├── tsup.config.ts                   # UNCHANGED (index + contracts entries already emitted)
└── src/
    ├── index.ts                     # UPDATE: export runtime API dispatch + writeGeneratedTerraform
    ├── materialize/                 # NEW: runtime module (dispatch + serialization + I/O; uses node:fs/promises, node:path)
    │   ├── dispatch.ts              #   two-phase: select (all-or-nothing) → materialize (abort-on-first); build ArtifactDescriptor
    │   ├── select.ts                #   phase-1: per-artifact supports iteration, count supporters, MTL_COLLISION / MTL_UNHANDLED_ARTIFACT
    │   ├── materialize.ts           #   phase-2: run chosen materializer, catch → MTL_MATERIALIZE_FAILED (abort-on-first)
    │   ├── serialize.ts             #   .tf.json content: sorted-key JSON, filename computation, address validation, outputs
    │   ├── write.ts                 #   writeGeneratedTerraform: owned-file I/O + stale cleanup
    │   ├── context.ts               #   MaterializationContext factory + OutputBuilder impl (+ output-name collision detection)
    │   ├── shape.ts                 #   narrow registry PluginEntry.module (kind materializer) → Materializer contract
    │   ├── errors.ts                #   dispatch diagnostic factory (reuses diag shape; MTL_* codes)
    │   └── index.ts                 #   entry: dispatch(); writeGeneratedTerraform()
    ├── contracts/                   # EXISTING: remains zero-runtime-dep; ADD type-only + pure additions
    │   ├── materialize.ts           #   NEW: public type contracts (ArtifactDescriptor, GeneratedTfFile, DispatchOptions,
    │   │                            #        DispatchResult, DispatchDiagnostic, MTL_* constants) — types + constants only
    │   └── index.ts                 #   UPDATE: re-export materialize types
    └── ...
```

**Structure Decision**: Runtime dispatch/serialization/write live in `src/materialize/` because serialization needs `node:fs/promises` for `writeGeneratedTerraform` and the dispatch is runtime orchestration over loaded registry entries; `src/contracts/` must stay dependency-free per `zero-dependency.test.ts` and Constitution. Public **type** contracts + pure `MTL_*` constants (what spec 021 CLI and downstream 019 materializers consume) are re-exported from `src/contracts/materialize.ts` via `@ycforge/pilot/contracts`. `MTL_*` constants live in `src/contracts/materialize.ts` (pure, like `BRG_*` in `src/contracts/registry.ts`), mirrored in the `contracts/materialize.json` catalog. `writeGeneratedTerraform` is a separate pure I/O function (spec FR-015), so `dispatch` itself stays filesystem-free and trivially testable; the only file in `src/materialize/` needing `fs` is `write.ts`.

## Complexity Tracking

No constitution violations — all gates pass as-is.

## Phase 0: Research (Generated Artifacts)

See `specs/014-materializer-dispatch/research.md`. Key decisions resolved there:
- Two-phase all-or-nothing selection (not stream) for consistency/atomacity (Constitution II/V).
- Determinism strategy: sort keys lexicographically in JSON; materializers iterated in registry records **insertion order** (map iteration order = insertion order, deterministic given identical builders.yaml), and artifacts in `topologicalOrder` with alphabetical ties; final ordering formalized.
- `supports` calls are sequential and I/O-free; `supports` MUST be pure per spec 002 — no errors surface from selection, so only `materialize` can throw.
- Materializer identity/address for `MTL_MATERIALIZE_FAILED` taken from the `PluginEntry.id` (registry record id) and the returned `TerraformResource` (`type.name`); how to narrow `PluginEntry.module: unknown` → `Materializer` via a shape guard.
- JSON serialization via `JSON.stringify` with a recursive sorted-key replacer; grouping one resource per file (one-per-app); opaque `configuration` passes through unchanged (arrays/objects preserved), no schema validation (Constitution IV).
- Filename generation `<app_id>.ycsf.tf.json`; ownership matching via glob `*.ycsf.tf.json` (incl. `00-ycsf-outputs.tf.json`); stale owned-file cleanup.
- Async/fs APIs: `node:fs/promises` (`writeFile`, `readdir`, `unlink`), `mkdtemp` for tests; write = list+write+cleanup over owned files.
- Materializer throw/reject → `MTL_MATERIALIZE_FAILED` mapping (abort-on-first, no crash).
- Context construction: `MaterializationContext` reuses spec 002 verbatim (`{ output }`), NOT extended; env snapshot wiring is spec 021 (spec 014 Assumption).
- Version marker on generated files: no `.tf.json` header version (Terraform JSON must be exact `{"resource":...}`; a version field would be invalid Terraform) — recorded decision.

## Phase 1: Design & Contracts (Generated Artifacts)

### Data Model (`data-model.md`)

Entities: `ArtifactDescriptor`, `MaterializerMatch`, `SelectedMaterialization`, `MaterializeResult` union, `GeneratedTfFile`, `DispatchResult` (ok/invalid), `DispatchDiagnostic`, `OutputBuilder`-collected outputs, `MTL_*` catalog — plus the dispatch flow (selection → materialize → serialize → write), data shapes, and validation/error tables.

### Contracts (`contracts/`)

- `materialize.json`: Catalog of `MTL_*` error codes + JSON output schema for `<app_id>.ycsf.tf.json` and `00-ycsf-outputs.tf.json` (the two generated Terraform JSON shapes).

### Quickstart (`quickstart.md`)

Validation scenarios Sc1..ScN (mirror 013 style): single app materialized → golden file content; two materializers → `MTL_COLLISION` (no `materialize`); unhandled → `MTL_UNHANDLED_ARTIFACT`; materializer throws → `MTL_MATERIALIZE_FAILED` (no crash, abort-on-first); filename collision / duplicate tf address; outputs file; regeneration removes stale file; determinism (two runs byte-identical); user `*.tf` untouched; empty registry. Reference project `user_service`/`analytics`/`frontend`/`openapi`.

## Post-Design Constitution Re-Check

All gates still PASS. No new violations introduced. In particular: dispatch/serialize/write stay in Project C only (I); `dispatch` remains pure+async and `writeGeneratedTerraform` is separated as pure I/O (I/II); `*_ycsf.tf.json` C-ownership respected, user `*.tf` untouched (IV/VI); all collisions fail-fast (V); `MTL_*` additive (III); `src/contracts/materialize.ts` stays dependency-free, `fs` only in `src/materialize/write.ts` (zero-dep); context not extended (I, matches spec 014 Assumption); no Terraform CLI, no provider-schema modeling (I/IV).

## Open Questions for /speckit.tasks

- Exact module split within `src/materialize/` (dispatch/select/materialize/serialize/write/context/shape/errors/index) and whether phase-1 selection is a private helper of dispatch or a separately exported function — task-ified in tasks.md.
- Naming of public entries (`dispatch`, `writeGeneratedTerraform`) and exact exported type names — confirm in data-model/contracts before task assignment.
- Whether the shape guard narrowing `PluginEntry.module` → `Materializer` lives in `src/materialize/shape.ts` (runtime) and whether `MTL_INVALID_TERRAFORM_ADDRESS` validation happens at serialize-time for both `type` and `name`.
