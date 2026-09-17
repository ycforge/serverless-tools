# Implementation Plan: extensions — `.ycsf/extensions.yaml`, IDL-адресация таргетов, deep merge

**Branch**: `015-extensions` | **Date**: 2026-09-07 | **Spec**: [specs/015-extensions/spec.md](./spec.md)

**Input**: Feature specification from `spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Add to Project C (`@ycforge/pilot`, `packages/pilot`) a **pure transform layer** between materializer dispatch (014) and `.tf.json` serialization (014): the user can declaratively extend generated resources through `.ycsf/extensions.yaml` (`version: 1`, `extensions: [{target, patch}]`). The layer consists of (1) `loadExtensions(rootDir)` — loader/parser of the file (missing file → throw `EXT_MISSING_FILE`, symmetric with 011/013), (2) **IDL-адресация** — each `target` is a stable logical identity `domain.name` resolved via the C-owned side-table `IDL_DOMAIN_BY_TF_TYPE` (`yandex_function`→`functions`, `yandex_api_gateway`→`gateways`) against the IDL index built from the dispatch output `TerraformResource[]`, and (3) **deep merge** — `patch` recursively merges into `resource.configuration` (§25.2: object+object recurse, array/scalar/null replace, non-mutating). `applyExtensions(resources, extensionsYaml)` is two-phase: **validate-first collect-all** (`EXT_DUPLICATE_TARGET` + `EXT_UNRESOLVED_TARGET` with available IDLs, all-or-nothing) then deterministic file-order apply. `*_override.tf` semantics, `{{$ENV}}`/`${...}` processing, provider-schema validation, user `*.tf` I/O and CLI wiring are explicitly out of scope (021/020/012).

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`)

**Primary Dependencies**:
- No new runtime dependencies. `.ycsf/extensions.yaml` parsing reuses the existing `yaml` dependency (already in `packages/pilot`) with `parseDocument(text, { uniqueKeys: true })` — the spec 013 `parseBuildersYaml` pattern. `src/contracts/` stays zero-runtime-dependency (existing `zero-dependency.test.ts`); deep merge is plain-JS ~20 lines.
- Type-only contracts from `@ycforge/pilot/contracts`: `TerraformResource` (spec 002), `ProjectModelDiagnostic` (spec 011), re-used `isVersion` predicate (011). No extension of contract 002/014 (spec Assumption, FR-012/FR-014).

**Storage**: File system — `loadExtensions` reads `.ycsf/extensions.yaml` (single I/O point); `applyExtensions` and `deepMerge` are **pure in-memory transforms with no I/O** (FR-014/SC-003: user `*.tf` never read, never touched). Serialization of merged resources reuses 014 serializer unchanged.

**Testing**: Vitest (already configured) + `test/types/*.test-d.ts` type tests. Test-first per constitution; every acceptance criterion / quickstart scenario → test (RED → GREEN, crucial for US6 determinism: two runs byte-identical). `applyExtensions`/`deepMerge` are pure → hermetic, no filesystem; `loadExtensions` tested against `mkdtemp` temp dirs (fixture projects) + missing-file throw. Fixture materializers inline (as 014).

**Target Platform**: Library module within `packages/pilot` (ESM+CJS via tsup); consumed by spec 021 `ycsf build` orchestration and spec 020 `ycsf check` (which reuses `applyExtensions` itself as the validation function); `IDL_DOMAIN_BY_TF_TYPE` grows additively with real materializer packages (spec 019).

**Project Type**: Pure transform + loader runtime module (`src/extensions/`) plus type-only public contracts + `EXT_*` constants in `src/contracts/extensions.ts`.

**Performance Goals**: SC-001 — deterministic byte-identical output for identical input (resources + extensions.yaml) across runs; `applyExtensions` over a typical project (5–20 resources, 1–10 rules) completes in ms — O(resources) index build + O(rules) resolution + O(rules × touched-configuration-node) merge.

**Constraints**:
- **Validate-first collect-all, all-or-nothing** (FR-007/FR-005): `applyExtensions` builds the IDL index, collects `EXT_DUPLICATE_TARGET` (in order of appearance) + `EXT_UNRESOLVED_TARGET` (in file order, each with available IDLs) + defensive `EXT_INVALID` (duplicate IDL in index; targeted resource's `configuration` not a plain object). Any error → `{ kind: 'invalid', errors: ALL }`; **no patch applied**. Apply phase runs only when validation is clean (Constitution II/V; mirrors 014 select-then-materialize).
- **Deterministic apply** (FR-009): rules applied in file order; each target exactly once (guaranteed by banned duplicates); available-IDL listing in alphabetical order (FR-007).
- **Deep merge per §25.2 exactly** (FR-008): recurse iff both sides plain objects; patch array/scalar/null → replace; base non-plain-object → replace; new keys added; inputs `readonly`, **non-mutating** (return new object; shared untouched subtrees kept by reference — immutable-safe). No `EXT_MERGE_ERROR` code (merge is total on JSON trees; spec Error Codes).
- **Payload passthrough** (FR-010/FR-011): `${...}` and `{{$ENV}}` strings pass byte-for-byte; C does not parse or validate either (FR-010 — Terraform owns `${...}`; FR-011 — `{{$ENV}}` is spec 012 build-time concept, not applicable to extensions).
- **Boundaries** (spec Scope): no `*_override.tf` reading/semantics; no user `*.tf` I/O (Constitution IV); no provider-schema validation of `patch` values (FR-015, Constitution IV); no `version` other than `1` (EXT_VERSION, Constitution III); no outputs (016), no CLI wiring (021), no change to contract 002 or 014.
- **Fail-fast** (Constitution V): duplicate target → error (`EXT_DUPLICATE_TARGET`, precedent `MTL_COLLISION`/`PML_DUPLICATE_APP_ID`/`BRG_KEY_COLLISION`), never sequential merge; unknown YAML keys → `EXT_INVALID`, never ignored.

**Scale/Scope**: Typical project 5–20 generated resources, 1–10 extension rules; one app → one resource (014) → IDL uniqueness by construction; `IDL_DOMAIN_BY_TF_TYPE` currently two domains, grows additively (019).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Pure Project C transform+loader in `packages/pilot/src/extensions/`; C does not execute builders, does not call Terraform CLI (021); C does not model provider schema (FR-015); extensions apply only to dispatch output (FR-014), never builders, never user `.tf` |
| II. Spec-First, Test-First | ✅ PASS | Every AC/scenario → test (RED → GREEN); `applyExtensions`/`deepMerge` pure → hermetic; `loadExtensions` I/O tested via `mkdtemp` |
| III. Contracts Versioned | ✅ PASS | `.ycsf/extensions.yaml` carries `version: 1` (EXT_VERSION otherwise); `EXT_*` constants in `src/contracts/extensions.ts` re-exported via `@ycforge/pilot/contracts` (semver), mirrored in `contracts/extensions.json` |
| IV. Terraform Stays Terraform | ✅ PASS | **Central**: merge produces ordinary JSON `configuration` consumed by 014 serializer unchanged (FR-009 sorted keys); C reads no `*.tf`, no `*_override.tf`, no provider-schema validation (FR-014/FR-015; Constitution IV); `${...}` passthrough |
| V. Explicit Over Magic | ✅ PASS | **Central**: duplicate target → `EXT_DUPLICATE_TARGET` (error, not merge — precedent `MTL_COLLISION`/`PML_DUPLICATE_APP_ID`/`BRG_KEY_COLLISION`); unresolved target → `EXT_UNRESOLVED_TARGET` with available IDLs (C validates target — the core advantage over `*_override.tf`); unknown YAML keys → `EXT_INVALID`; side-table `IDL_DOMAIN_BY_TF_TYPE` is explicit C-owned, exactly one normative mapping; merge semantics pinned to §25.2 (array replace, no magic append) |
| VI. Ownership Model | ✅ PASS | `resource.name` = stable logical identity (Constitution VI) reused as IDL name segment; extensions touch only generated `TerraformResource` objects in memory; user `.tf` external and untouched |
| Monorepo Tooling | ✅ PASS | `src/extensions/` runtime (yaml + Node builtins `node:fs`/`node:path` only for loader), `src/contracts/extensions.ts` stays dependency-free; `EXT_*` constants pure; re-exported via `@ycforge/pilot/contracts`; runtime API via `src/index.ts` |
| Secrets | ✅ PASS | No credentials/env handling in the transform; values are opaque JSON passed through |
| OpenAPI Build Safe Mode | ✅ PASS | `gateways.*` is just an IDL domain resolved via the side-table; no OpenAPI semantics in C |
| Zero-dep contracts | ✅ PASS | New public type contracts + `EXT_*` constants are type-only/pure in `src/contracts/extensions.ts`; everything touching I/O (`fs`) lives in `src/extensions/extensions-yaml.ts`/loader, never in `src/contracts/` |

**Gate Decision**: All gates PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/015-extensions/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (extensions.json — .ycsf/extensions.yaml schema + EXT_* error catalog)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/pilot/
├── package.json                     # UNCHANGED (yaml already a dependency; no new deps)
├── tsup.config.ts                   # UNCHANGED (index + contracts entries already emitted)
└── src/
    ├── index.ts                     # UPDATE: export runtime API loadExtensions + applyExtensions (+ deepMerge)
    ├── contracts/
    │   ├── extensions.ts            # NEW: type-only public contracts + pure EXT_* constants (zero-dep)
    │   └── index.ts                 # UPDATE: re-export extensions contracts
    └── extensions/                  # NEW: runtime module (loader + resolver + deep merge; pure except loader I/O)
        ├── extensions-yaml.ts       #   parseExtensionsYaml: parseDocument(uniqueKeys:true) + version + structure (diag reuse; EXT_*)
        ├── loader.ts                #   loadExtensions: existsSync/readFileSync + parse; EXT_MISSING_FILE throw
        ├── idl.ts                   #   IDL_DOMAIN_BY_TF_TYPE side-table + IDL_SEGMENT_RE + resolve/buildIndex helpers
        ├── deep-merge.ts            #   isPlainObject + deepMerge(base, patch) — pure, non-mutating
        ├── apply.ts                 #   applyExtensions: validate-first collect-all → deterministic file-order apply
        ├── errors.ts                #   ext() diagnostic factory (ExtensionsDiagnostic) + re-export diag for loader
        └── index.ts                 #   internal barrel: loadExtensions, applyExtensions, deepMerge
```

**Structure Decision**: Runtime lives in `src/extensions/` following the 013 `src/registry/` and 014 `src/materialize/` precedent: the loader needs `node:fs`/`node:path` (only file), the resolver and deep merge are pure. Public **type** contracts + pure `EXT_*` constants (consumed by 021/020 and check) are re-exported from `src/contracts/extensions.ts` via `@ycforge/pilot/contracts`. `EXT_*` constants live in `src/contracts/extensions.ts` (pure, like `BRG_*` in `registry.ts` and `MTL_*` in `materialize.ts`), mirrored in the `contracts/extensions.json` catalog. `applyExtensions` takes a **parsed** `ExtensionsYaml` (like `dispatch` takes a loaded `ProjectModel`) — 021 calls `loadExtensions` then wires `applyExtensions` into the pipeline; a standalone `loadExtensions`+`applyExtensions` composition is exactly the 020 check seam.

## Complexity Tracking

No constitution violations — all gates pass as-is.

## Phase 0: Research (Generated Artifacts)

See `specs/015-extensions/research.md`. Key decisions resolved there:
- **IDL side-table placement/extensibility**: hardcoded, C-owned `IDL_DOMAIN_BY_TF_TYPE` in `src/extensions/idl.ts` (frozen `Readonly<Record<string,string>>`), grown additively by 019; plugin-registered/config-driven tables rejected.
- **Deep-merge recurrence**: `isPlainObject` guard on both values — recurse iff both plain objects, else replace by patch (spec §25.2 exact).
- **Parse gate**: dedicated `parseExtensionsYaml` mirroring 013 `parseBuildersYaml` (own `parseDocument(uniqueKeys:true)` emitting `EXT_INVALID` for syntax/dup-keys, `EXT_VERSION` for version), reusing the `diag()` factory from `src/model/errors.ts`; does NOT reuse `parseYaml` (that bakes in `PML_*` codes).
- **Duplicate target**: error `EXT_DUPLICATE_TARGET` (FR-005), never sequential merge.
- **Two-phase validate-first collect-all** (duplicates by appearance, then unresolved in file order with alphabetical available-IDL list), then deterministic file-order apply; all-or-nothing.
- **Immutability**: `applyExtensions` returns a NEW array; targeted resources get new objects (same kind/type/name, new configuration); untouched resources re-shared by reference; inputs never mutated.
- **Unknown top-level/rule keys** → fail-fast `EXT_INVALID` (Constitution V), never ignored.
- **`patch` non-object** → `EXT_INVALID` (FR-004).
- **Zero-dep contracts + catalog**: `src/contracts/extensions.ts` + `contracts/extensions.json`.

## Phase 1: Design & Contracts (Generated Artifacts)

### Data Model (`data-model.md`)

Entities: `ExtensionsYaml`, `ExtensionRule`, `IDL` (two-segment `domain.name`, grammar `[a-z][a-z0-9_]*`), `IDL_DOMAIN_BY_TF_TYPE`, `IdlIndex`, `IDLError{target, availableIdls}`, `ExtensionsDiagnostic`, `ExtensionsLoadResult`, `ApplyExtensionsResult`, deep-merge control flow, apply flow (validate → apply), IDL resolution table, validation/error tables.

### Contracts (`contracts/`)

- `extensions.json`: JSON Schema for `.ycsf/extensions.yaml` + `ExtensionRule` + `ExtensionsDiagnostic` + catalog of `EXT_*` error codes (mirror `plugin-registry.json`/`materialize.json` convention).

### Quickstart (`quickstart.md`)

Validation scenarios Sc1..ScN (mirror 014 style): env patch on `yandex_function.user_service`; array replace on `gateways.openapi`; unresolved target → available IDLs + all-or-nothing; duplicate target → error + no other patch applied; user `.tf` untouched (no I/O in `applyExtensions`); determinism (two runs deep-equal + byte-identical serialization); loader error paths (version/missing `extensions`/bad `patch`/target grammar); empty patch/no-op/empty list/new top-level key; missing file → `EXT_MISSING_FILE` throw; nested array replace; `${...}`/`{{$ENV}}` passthrough. Reference project `user_service`/`analytics`/`frontend`/`openapi`.

## Post-Design Constitution Re-Check

All gates still PASS. No new violations introduced. In particular: transform+loader stay in Project C only (I); `applyExtensions`/`deepMerge` remain pure with all-or-nothing validation and no partial apply (I/II/V); `loadExtensions` is the only I/O (IV — user `*.tf` never touched, no `*_override.tf`); `EXT_*` codes additive and `version: 1` enforced (III); duplicate/unresolved targets and unknown keys fail-fast, available-IDL listing is explicit (V); resource name preserved as the stable IDL name (VI); `src/contracts/extensions.ts` stays dependency-free, `fs` only in the loader (zero-dep); no provider-schema modeling, `${...}`/`{{$ENV}}` passthrough (I/IV/FR-010/FR-011).

## Open Questions for /speckit.tasks

- **Exact module split + export surface**: `src/extensions/{extensions-yaml,loader,idl,deep-merge,apply,errors,index}.ts` vs fewer files; whether `deepMerge` and `parseExtensionsYaml` are re-exported publicly or kept as internal helpers (tests import via internal paths) — task-ified in tasks.md.
- **`IDL_SEGMENT_RE` duplication**: local 2-segment regex in `src/extensions/idl.ts` mirroring the spec-002 `ResourceReference` segment grammar (`[a-z][a-z0-9_]*`) vs exporting a shared segment predicate from `src/contracts/resource-reference.ts` (additive, non-breaking) — decide before implementation; minimal-diff default is the local constant.
- **Defensive checks in `applyExtensions`** (malformed `target` on a programmatically built `ExtensionsYaml`, duplicate IDL in index, targeted `configuration` non-object): instanceof/plain-object guard semantics to formalize for `isPlainObject` (`Object.getPrototypeOf === Object.prototype || null`).
- **Diagnostic field population**: for `EXT_DUPLICATE_TARGET`/`EXT_UNRESOLVED_TARGET` `file`/`line`/`column` are undefined at apply time (pure transform) — confirm `ExtensionsDiagnostic` keeps them optional and loader-style population stays only in `loadExtensions`/`EXT_INVALID` structural errors.
- **Export of `createIdlIndex`/resolution helpers** for direct testing and 020 reuse vs private to `apply.ts`.