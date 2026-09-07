# Implementation Plan: outputs — `.ycsf/outputs.yaml`, auto-generated outputs, `ycsf_` prefix, `99-ycsf-outputs.tf.json`

**Branch**: `016-outputs` | **Date**: 2026-09-07 | **Spec**: [specs/016-outputs/spec.md](./spec.md)

**Input**: Feature specification from `spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add to Project C (`@ycforge/pilot`, `packages/pilot`) a **pure build layer** that merges user-declared outputs (`.ycsf/outputs.yaml`) with auto-generated outputs from materializers (spec 014) into a single deterministic file `99-ycsf-outputs.tf.json`. The layer consists of (1) `loadOutputs(rootDir)` — loader/parser of the file (missing file -> throw `OUT_MISSING_FILE`, symmetric with `EXT_MISSING_FILE`/`BRG_MISSING_FILE`), (2) **IDL resolution** — each user output `value` is a 3-segment IDL reference `domain.name.property` resolved via the C-owned reverse side-table `DOMAIN_TO_TF_TYPE` (derived from `IDL_DOMAIN_BY_TF_TYPE`, spec 015) against the IDL index built from dispatch output `TerraformResource[]`, producing `${terraform_type.name.property}`, and (3) **assembly** — resolved user outputs + auto-generated outputs (with `ycsf_` prefix enforcement) merged into a single `{ "output": { ... } }` block, keys sorted lexicographically, `${...}` wrapping applied. `buildOutputs` is two-phase: **validate-first collect-all** (`OUT_RESERVED_PREFIX` + `OUT_UNRESOLVED_IDL` + `OUT_DUPLICATE_NAME` + `OUT_INVALID_VALUE` + `OUT_INVALID_AUTO_PREFIX`, all-or-nothing) then deterministic assembly. The `00-ycsf-outputs.tf.json` from spec 014 is replaced by `99-ycsf-outputs.tf.json` (section 26 normative; spec-vs-code divergence resolved). CLI wiring and `ycsf check` integration are explicitly out of scope (021/020).

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)

**Primary Dependencies**:
- No new runtime dependencies. `.ycsf/outputs.yaml` parsing reuses the existing `yaml` dependency (already in `packages/pilot`) with `parseDocument(text, { uniqueKeys: true })` — the spec 013/015 `parseBuildersYaml`/`parseExtensionsYaml` pattern. `src/contracts/` stays zero-runtime-dependency (existing `zero-dependency.test.ts`).
- Type-only contracts from `@ycforge/pilot/contracts`: `TerraformResource` (spec 002), `GeneratedTfFile` (spec 014), `OutputValue` (spec 014 serialize.ts), `IdlIndex`/`createIdlIndex`/`IDL_DOMAIN_BY_TF_TYPE` (spec 015 extensions/idl.ts), `parseResourceReference`/`ContractError` (contract 002).

**Storage**: File system — `loadOutputs` reads `.ycsf/outputs.yaml` (single I/O point); `buildOutputs` and `resolveIdlReference` are **pure in-memory transforms with no I/O** (FR-018/SC-003: user `*.tf` never read, never touched).

**Testing**: Vitest (already configured) + `test/types/*.test-d.ts` type tests. Test-first per constitution; every acceptance criterion / quickstart scenario -> test (RED -> GREEN, crucial for SC-001 determinism). `buildOutputs`/`resolveIdlReference` are pure -> hermetic, no filesystem; `loadOutputs` tested against `mkdtemp` temp dirs (fixture projects) + missing-file throw. Fixture materializers inline (as 014).

**Target Platform**: Library module within `packages/pilot` (ESM+CJS via tsup); consumed by spec 021 `ycsf build` orchestration and spec 020 `ycsf check` (which reuses `buildOutputs` as the validation function); `DOMAIN_TO_TF_TYPE` grows additively with real materializer packages (spec 019).

**Project Type**: Pure transform + loader runtime module (`src/outputs/`) plus type-only public contracts + `OUT_*` constants in `src/contracts/outputs.ts`.

**Performance Goals**: SC-001 — deterministic byte-identical output for identical input across runs; `buildOutputs` over a typical project (5-20 resources, 1-10 user outputs) completes in ms — O(resources) index build + O(userOutputs) resolution + O(totalOutputs) assembly.

**Constraints**:
- **Validate-first collect-all, all-or-nothing** (FR-015/FR-009): `buildOutputs` builds the IDL index, collects all errors (`OUT_RESERVED_PREFIX` + `OUT_INVALID_VALUE` + `OUT_UNRESOLVED_IDL` + `OUT_DUPLICATE_NAME` + `OUT_INVALID_AUTO_PREFIX`); any error -> `{ kind: 'invalid', errors: ALL }`; no file generated. Assembly runs only when validation is clean (Constitution V; mirrors 014 select-then-materialize, 015 validate-first).
- **Deterministic assembly** (FR-012/FR-019): resolved user outputs + auto-generated outputs merged into single record; keys sorted lexicographically; `serializeJson` from spec 014.
- **`${...}` wrapping** (FR-011): user outputs wrapped during resolution (`${resolved_idl}`); auto-generated outputs wrapped during assembly (`${raw_tf_expr}`); in `.tf.json` the value is always in `${...}`.
- **Description omit** (FR-013): `undefined` -> omit from JSON; `""` -> preserve as `""` (section 26).
- **Boundaries** (spec Scope): no CLI wiring (021); no `ycsf check` integration (020); no user `*.tf` I/O (Constitution IV); no provider-schema validation of output values (FR-018, Constitution IV); no outputs in `*.tf` (Constitution IV); no moved blocks (spec 017).
- **Fail-fast** (Constitution V): duplicate name -> `OUT_DUPLICATE_NAME` (error, not merge); reserved prefix -> `OUT_RESERVED_PREFIX` (error, not silent fix); unknown YAML keys -> `OUT_INVALID`. All `OUT_*` constants compared via constants, never string literals.

**Scale/Scope**: Typical project 5-20 generated resources, 1-10 user outputs, 0-5 auto-generated outputs; `IDL_DOMAIN_BY_TF_TYPE` currently two domains, grows additively (019).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | PASS | Pure Project C transform+loader in `packages/pilot/src/outputs/`; C does not execute builders, does not call Terraform CLI (021); C does not model provider schema (FR-018); outputs build applies only to dispatch output + parsed YAML |
| II. Spec-First, Test-First | PASS | Every AC/scenario -> test (RED -> GREEN); `buildOutputs`/`resolveIdlReference` pure -> hermetic; `loadOutputs` I/O tested via `mkdtemp` |
| III. Contracts Versioned | PASS | `.ycsf/outputs.yaml` carries `version: 1` (`OUT_VERSION` otherwise); `OUT_*` constants in `src/contracts/outputs.ts` re-exported via `@ycforge/pilot/contracts` (semver), mirrored in `contracts/outputs.json` |
| IV. Terraform Stays Terraform | PASS | `buildOutputs` produces standard JSON `output` block consumed by Terraform; C reads no `*.tf`, no provider-schema validation (FR-018); `${...}` passthrough for auto-generated values |
| V. Explicit Over Magic | PASS | Duplicate name -> `OUT_DUPLICATE_NAME` (error, not merge); reserved prefix -> `OUT_RESERVED_PREFIX` (error, not silent fix); auto prefix -> `OUT_INVALID_AUTO_PREFIX` (error, not auto-add); side-table `DOMAIN_TO_TF_TYPE` is explicit C-owned, derived from single source; unknown YAML keys -> `OUT_INVALID` |
| VI. Ownership Model | PASS | External resources not in IDL index (Constitution VI); user outputs reference only generated resources; `resource.name` = stable identity |
| Monorepo Tooling | PASS | `src/outputs/` runtime (yaml + Node builtins `node:fs`/`node:path` only for loader), `src/contracts/outputs.ts` stays dependency-free; `OUT_*` constants pure; re-exported via `@ycforge/pilot/contracts`; runtime API via `src/index.ts` |
| Secrets | PASS | No credentials/env handling; values are Terraform expression strings passed through |
| Zero-dep contracts | PASS | New public type contracts + `OUT_*` constants are type-only/pure in `src/contracts/outputs.ts`; everything touching I/O (`fs`) lives in `src/outputs/loader.ts`, never in `src/contracts/` |

**Gate Decision**: All gates PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/016-outputs/
  plan.md              # This file
  research.md          # Phase 0 output
  data-model.md        # Phase 1 output
  quickstart.md        # Phase 1 output
  contracts/           # Phase 1 output (outputs.ts — type-only contracts + OUT_* error catalog)
    outputs.ts
  tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/pilot/
  package.json                     # UNCHANGED (yaml already a dependency; no new deps)
  tsup.config.ts                   # UNCHANGED (index + contracts entries already emitted)
  src/
    index.ts                       # UPDATE: export runtime API loadOutputs + buildOutputs
    contracts/
      outputs.ts                   # NEW: type-only public contracts + pure OUT_* constants (zero-dep)
      index.ts                     # UPDATE: re-export outputs contracts
    outputs/                       # NEW: runtime module (loader + resolver + build; pure except loader I/O)
      outputs-yaml.ts              #   parseOutputsYaml: parseDocument(uniqueKeys:true) + version + structure (OUT_*)
      loader.ts                    #   loadOutputs: existsSync/readFileSync + parse; OUT_MISSING_FILE throw
      resolver.ts                  #   resolveIdlReference: parseResourceReference + DOMAIN_TO_TF_TYPE + IDL index check
      build.ts                     #   buildOutputs: validate-first collect-all -> deterministic assembly -> serializeJson
      errors.ts                    #   out() diagnostic factory (OutputsDiagnostic) + re-export diag for loader
      index.ts                     #   internal barrel: loadOutputs, buildOutputs, resolveIdlReference
    materialize/
      dispatch.ts                  # UPDATE (spec-vs-code divergence): remove lines 70-75 (serializeOutputs / 00-ycsf-outputs.tf.json)
      serialize.ts                 # UPDATE: serializeOutputs + outputCollisionDiagnostics superseded (remove or deprecate)
```

**Structure Decision**: Runtime lives in `src/outputs/` following the 015 `src/extensions/` precedent: the loader needs `node:fs`/`node:path` (only file), the resolver and build are pure. Public **type** contracts + pure `OUT_*` constants (consumed by 021/020 and check) are re-exported from `src/contracts/outputs.ts` via `@ycforge/pilot/contracts`. `OUT_*` constants live in `src/contracts/outputs.ts` (pure, like `EXT_*` in `contracts/extensions.ts` and `MTL_*` in `contracts/materialize.ts`), mirrored in `contracts/outputs.json`. `buildOutputs` takes a **parsed** `OutputsYaml` (like `applyExtensions` takes a loaded `ExtensionsYaml`) — 021 calls `loadOutputs` then wires `buildOutputs` into the pipeline; a standalone `loadOutputs`+`buildOutputs` composition is exactly the 020 check seam.

## Complexity Tracking

No constitution violations — all gates pass as-is.

## Phase 0: Research (Generated Artifacts)

See `specs/016-outputs/research.md`. Key decisions resolved there:
- **IDL resolution**: reverse lookup `DOMAIN_TO_TF_TYPE` derived from `IDL_DOMAIN_BY_TF_TYPE`; `parseResourceReference` for grammar; IDL index for existence check; property not validated.
- **Merged file**: `99-ycsf-outputs.tf.json` replaces `00-ycsf-outputs.tf.json`; `serializeOutputs` superseded; orphan mechanism handles migration.
- **Three-level collision control**: `MTL_OUTPUT_NAME_COLLISION` (dispatch, stays) + `OUT_DUPLICATE_NAME` (merge) + prefix enforcement (`OUT_RESERVED_PREFIX`/`OUT_INVALID_AUTO_PREFIX`).
- **OutputsDiagnostic**: mirrors `ExtensionsDiagnostic` with `name` replacing `target`; `OUT_*` constants in `src/contracts/outputs.ts`.
- **Loader**: pattern `loadExtensions` (parse-gate `uniqueKeys:true`, `OUT_VERSION`/`OUT_INVALID`); missing file -> throw `OUT_MISSING_FILE`.
- **Determinism**: `serializeJson` from spec 014; `${...}` wrapping in resolution and assembly; description omit when absent.
- **Empty outputs**: `{ "output": {} }` stable file.
- **Write integration**: `99-ycsf-outputs.tf.json` matches existing `FILENAME_RE`; no changes to `write.ts`.
- **Module layout**: `src/outputs/` with 6 files; `src/contracts/outputs.ts` zero-dep.
- **Input shape**: `ReadonlyMap<string, OutputValue>` for `materializerOutputs` (direct from `OutputBuilder.declared`).

## Phase 1: Design & Contracts (Generated Artifacts)

### Data Model (`data-model.md`)

Entities: `OutputsYaml`, `UserOutput`, `AutoGeneratedOutput`, `OutputsDiagnostic`, `BuildOutputsInput`/`Result`, `OutputsLoadResult`, `OutputValue` (reused), `GeneratedTfFile` (reused), merged `99-ycsf-outputs.tf.json` structure, validation rules mapping to FR-, buildOutputs two-phase pipeline (validation collect-all -> assembly), OUT_* error code catalog.

### Contracts (`contracts/`)

- `contracts/outputs.ts`: Type-only TypeScript contracts for the outputs feature — `OUT_*` error code constants, `OutputsYaml`, `OutputsDiagnostic`, `BuildOutputsInput`/`Result`, `OutputsLoadResult` interfaces. Mirrors `contracts/extensions.ts` (spec 015) pattern. Zero runtime dependencies; consumes only type imports from `../../src/contracts/terraform.js` and `materialize.js`.

### Quickstart (`quickstart.md`)

Validation scenarios Sc1..Sc15 (pattern 014/015): happy path IDL resolution (Sc1), description omit (Sc2), auto-generated merge with ycsf_ prefix (Sc3), invalid auto prefix (Sc4), empty outputs stable file (Sc5), duplicate name (Sc6), reserved prefix (Sc7), unresolved IDL with available IDLs (Sc8), invalid grammar (Sc9), version/structural errors via loader (Sc10), missing file throw (Sc11), external resource unresolved (Sc12), determinism (Sc13), mixed errors collect-all (Sc14), dispatch.ts migration (Sc15). Reference project `user_service`/`analytics`/`frontend`/`openapi`.

## Post-Design Constitution Re-Check

All gates still PASS. No new violations introduced. In particular: transform+loader stay in Project C only (I); `buildOutputs`/`resolveIdlReference` remain pure with all-or-nothing validation and no partial output (I/II/V); `loadOutputs` is the only I/O (IV — user `*.tf` never touched); `OUT_*` codes additive and `version: 1` enforced (III); duplicate/reserved/prefix errors fail-fast, available-IDL listing is explicit (V); resource name preserved as the stable IDL name (VI); `src/contracts/outputs.ts` stays dependency-free, `fs` only in the loader (zero-dep); no provider-schema modeling, `${...}` passthrough (I/IV/FR-018).

## Open Questions for /speckit.tasks

- **Exact module split + export surface**: `src/outputs/{outputs-yaml,loader,resolver,build,errors,index}.ts` vs fewer files; whether `resolveIdlReference` is re-exported publicly or kept as internal helper (tests import via internal paths) — task-ified in tasks.md.
- **`DOMAIN_TO_TF_TYPE` derivation location**: in `src/outputs/resolver.ts` (importing from `src/extensions/idl.ts`) vs a shared utility — minimal-diff default is `resolver.ts` since it is the only consumer.
- **`serializeOutputs` removal scope**: whether to delete `serializeOutputs`/`outputCollisionDiagnostics` from `serialize.ts` in spec 016 or defer to 021 (removing dead code vs minimizing diff) — recommend removal in 016 (dead code is a maintenance burden).
- **Diagnostic field population**: for `OUT_DUPLICATE_NAME`/`OUT_RESERVED_PREFIX`/`OUT_INVALID_AUTO_PREFIX`/`OUT_UNRESOLVED_IDL`/`OUT_INVALID_VALUE`, `file`/`line`/`column` are undefined at buildOutputs time (pure transform) — confirm `OutputsDiagnostic` keeps them optional and loader-style population stays only in `loadOutputs`/`OUT_INVALID` structural errors.
- **Export of `createIdlIndex`/`DOMAIN_TO_TF_TYPE` for direct testing**: whether resolver helpers are exported from `src/outputs/index.ts` for 020 check reuse vs private to `resolver.ts`.
