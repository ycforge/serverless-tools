# Implementation Plan: materializers-yandex — function/container/api-gateway/queue/bucket TF materializers

**Branch**: `019-materializers-yandex` | **Date**: 2026-09-10 | **Spec**: [specs/019-materializers-yandex/spec.md](./spec.md)

**Input**: Feature specification from `./spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

A new workspace package `packages/materializers-core` (`@ycforge/materializers-core`) implementing the five core Materializer plugins — registrable via the spec-005/014 mapping (`materializers.yaml`) under subpath specifiers `@ycforge/materializers-core/{yandex-function,yandex-serverless-container,yandex-api-gateway,yandex-message-queue,yandex-storage-bucket}`. Each module default-exports a spec-002 `Materializer` shape (`supports` + `materialize`), so dispatch (spec 014) selects it by `artifact.type` and the registry classifies it as `kind: 'materializer'`.

Mapping (catalog, FR-003 + two new forward-contract types D-3):

| Materializer subpath | `Artifact.type` | Terraform resource(s) |
|---|---|---|
| `/yandex-function` | `ycforge:function` (`{ archivePath, entryPoint }`, spec 018) | `yandex_function` (runtime default `nodejs22`, `user_hash` = SHA-256 of archive, `content.zip_filename` relative from `infra/`) |
| `/yandex-serverless-container` | `ycforge:docker-image` (`{ image }`, spec 018) | `yandex_serverless_container` (`image` as-is, `name` = app id) |
| `/yandex-api-gateway` | `ycforge:api-gateway` (`{ specPath, resourceReferences }`, **NEW**, D-3) | `yandex_api_gateway` (companion spec file via direct logical-ref replacement, D-RE-4) |
| `/yandex-message-queue` | `ycforge:queue` (`{ queueUrl }`, **NEW**, D-3) | `yandex_message_queue` (`queue_name`/`region` parsed from URL, `YMT_INVALID_QUEUE_URL` on failure) |
| `/yandex-storage-bucket` | `ycforge:frontend` (`{ directory }`, spec 018) | `yandex_storage_bucket` + N×`yandex_storage_object` (multi-resource per artifact, D-5, research D-RE-5) |

The package ships the machine-readable `materializer-id → artifactType` catalog (FR-003, forward contract for dispatch 014/021), the `YMT_*` diagnostics catalog (constitution V constants), standalone structural contract replicas with zero `@ycforge/pilot` imports (D-2, Constitution I), and each materializer declares its primary resource output via `context.output.declare(...)` (FR-005).

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` — tsconfig mirror of pilot/builders-core).

**Primary Dependencies**:
- **ZERO new runtime dependencies**: materializers are pure translations artifact → `TerraformResource`. `node:crypto` (SHA-256 for `user_hash`), `node:url` (queue URL parse), `node:fs`/`node:path` (archive read, spec read/write, directory listing) are built-in modules.
- **ZERO dependency on `@ycforge/pilot`** (neither runtime nor dev/peer/types): materializers-core re-declares standalone structural `Materializer`/`MaterializationContext`/`OutputBuilder`/`TerraformResource`/`Artifact` types (research D-RE-2); structural conformance is pinned by a compile-time type test living in **pilot** (`test/types/materializers-core-contract.test-d.ts`) — mirror of spec 018 D-RE-4/5.

**Storage**: File system — read-only for artifacts: archive bytes (function hash), spec file (api-gateway), directory listing (bucket). One write: api-gateway companion spec `<infraDir>/generated/<app_id>-openapi.yaml`. No outputDir management (materializers produce TF resources, not build outputs).

**Testing**: Vitest (`vitest.config.ts` with `typecheck` include → `test/types/**/*.test-d.ts`). Hermetic unit tests with fixture artifacts and `mkdtemp` temp files/dirs (zip file, spec file, static dir). Dispatch/loading integration (SC-002) + structural conformance live in **pilot** `test/` (research D-RE-10, mirror of spec 018 US4). `test` script = `tsup && vitest run` (self-referential subpath imports need built dist; nest-bridge/builders-core pattern).

**Target Platform**: Node 22+ library package published as `@ycforge/materializers-core` (ESM+CJS via tsup, six subpath exports); consumed by pilot's dispatch (014) at materialize time (021) and by the two new artifact types (D-3) as forward contract.

**Project Type**: Multi-entry runtime library package (5 materializer plugins) + type-only public contracts + `YMT_*` constants + artifact catalog.

**Performance Goals**: SC-006 — deterministic: identical artifact → byte-identical `TerraformResource` configuration (stable key order, sorted directory listing for bucket objects, deterministic SHA-256). `supports()` must stay pure and cheap (dispatch phase 1 calls it for every materializer per artifact — spec 014).

**Constraints**:
- Materializer API = `supports(artifact, context): boolean` + `materialize(artifact, context): Promise<TerraformResource | readonly TerraformResource[]>` only (spec 002); no knowledge of pilot internals (Constitution I); no value-position import of `@ycforge/pilot` anywhere in `src/` (FR-002, verified by a structural test).
- Materializers do NOT validate file existence (trust builder output / spec 018). Exception: computing `user_hash` reads the archive, so a missing archive surfaces as a **raw fs error (ENOENT) at `materialize()`** — NOT a `MaterializerError`/YMT diagnostic; dispatch (014) wraps it as `MTL_MATERIALIZE_FAILED` (abort-on-first). Invalid artifact VALUE shape (missing required field) → `YMT_INVALID_ARTIFACT_VALUE`; invalid `queueUrl` → `YMT_INVALID_QUEUE_URL` (fail-fast, Constitution V).
- Minimal generated resources (Constitution IV / IDEA §27): only the base fields the provider requires; service account, env, secrets, mounts, scaling — extensions (spec 015) or user `.tf`.
- Multi-resource return (D-5): `yandex-storage-bucket` returns `TerraformResource[]`; dispatch 014 fixture-level remains one-resource-per-app; real dispatch (021) flattens arrays (spec 019 Assumption; additive contract extension, research D-RE-5).
- TF address grammar `[a-zA-Z_][a-zA-Z0-9_]*` enforced on resource type/name; bucket object names sanitized (`[a-zA-Z0-9_]`, original name preserved in `key`) (FR-025).
- Deterministic ordering for bucket objects: alphabetical (sorted) file listing (SC-006).
- `@ycforge/materializers-core/*` subpath modules must load via `import()` from the pilot registry without `BRG_*`/load errors (SC-002); node_modules resolution anchored at pilot → pilot devDeps materializers-core (research D-RE-10).

**Scale/Scope**: Five plugin modules, two default configurations (`runtime: nodejs22`, `acl: public-read`), one catalog + one diagnostics family (`YMT_*`, 3 codes); monorepo `packages/*` pnpm workspace. Consumers: pilot dispatch (014) at materialization, 021 build/materialize execution, Project B (008) — api-gateway artifact producer (forward contract), explicit config (021) — queue artifact producer.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Materializers are standalone plugin packages invoked by C (dispatch 014/021); they know only `Artifact` + `MaterializationContext` (zero pilot imports, D-2, research D-RE-2). Materializers own provider schema knowledge; C orchestrates; Terraform resolves actual IDs. Bucket multi-resource (D-5) stays in materializer — dispatch flattens |
| II. Spec-First, Test-First | ✅ PASS | Every US/AC → test (US1..US3, 9 scenarios); unit tests hermetic with fixture artifacts + `mkdtemp` temp files; SC-007 — 100% AC coverage, RED → GREEN. No constitution-II exception needed (no thin CLI wrapper) |
| III. Contracts Versioned | ✅ PASS | **NEW** artifact types `ycforge:api-gateway` + `ycforge:queue` + their value shapes fixed here as forward contract (D-3); `YMT_*` (3 codes, spec FR-026/027) machine-readable catalog with constants (never literals); materializer API = spec-002 structural; **multi-resource return is additive** (`TerraformResource \| readonly TerraformResource[]`) — pilot contracts unchanged, existing plugin-ы stay green (research D-RE-5); `contracts/materializers-core.json` `$id`-документирован |
| IV. Terraform Stays Terraform | ✅ PASS | Materializers generate minimal real `TerraformResource` shapes (IDEA §27): `yandex_function` (runtime/entrypoint/user_hash/content), `yandex_serverless_container` (image/name), `yandex_api_gateway` (spec via `file()`), `yandex_message_queue` (queue_name/region), bucket+objects. Provider fields beyond minimal — extensions (015)/user `.tf`. No serverless-tools DSL over provider schema |
| V. Explicit Over Magic | ✅ PASS | **Central**: `supports()` — pure sync boolean per artifact type; fail-fast `YMT_INVALID_QUEUE_URL` (FR-026) and `YMT_INVALID_ARTIFACT_VALUE` on invalid inputs; `YMT_*` compared via constants, never string literals (FR-027); logical→TF ref replacement (api-gateway) — explicit `ResourceReference[]`, no template magic (research D-RE-4); deterministic naming (bucket sanitization, multi-`YMT_EMPTY_DIRECTORY` warning); no auto-discovery, no silent merges |
| VI. Ownership Model | ✅ PASS | Materializers translate app artifacts → app Terraform resources; resources stay external reference-only; identity `name = app_id` stable, renames → moved.yaml (017) |
| Monorepo Tooling | ✅ PASS | New package `packages/materializers-core` (pnpm workspaces `packages/*`); builds with tsup multi-entry, follows builders-core `test: tsup && vitest run`; **zero runtime deps** (no allowBuilds change); **no new dep cycles** — materializers-core has no pilot dep, pilot devDeps materializers-core (+ buildess-core, один направление) |
| Secrets | ✅ PASS | Materializers touch no secrets: no credentials in artifact values, no auth code; queue URL is a public config value; bucket `acl: public-read` is a policy field, not a secret |
| OpenAPI Build Safe Mode | ✅ PASS | api-gateway materializer consumes B-produced spec as-is (only ref replacement); never compiles OpenAPI itself; no `openapi_entry` handling (that's B/composer zone) |
| Zero-dep contracts surface | ✅ PASS | materializers-core root exports (catalog + types) are data/type-only; five subpath modules carry no runtime deps beyond node builtins; `YMT_*` constants pure; `contracts/materializers-core.json` standalone machine-readable |

**Gate Decision**: All gates PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/019-materializers-yandex/
├── plan.md              # This file
├── research.md          # Phase 0 output (decisions D-RE-1..10 + consolidated facts)
├── data-model.md        # Phase 1 output (types, catalog, value shapes, YMT_*, subpath map)
├── quickstart.md        # Phase 1 output (validation scenarios Sc1..Sc6)
├── contracts/           # Phase 1 output (materializers-core.json — YMT_* catalog + artifact value schemas)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/materializers-core/
├── package.json                     # NEW: name/exports (6 subpaths), zero runtime deps, devDeps: tsup/typescript/vitest/@types/node
├── tsconfig.json                    # NEW: strict, NodeNext, exactOptionalPropertyTypes, noUncheckedIndexedAccess (mirror pilot/builders-core)
├── tsup.config.ts                   # NEW: entry { index, yandex-function/index, yandex-serverless-container/index, yandex-api-gateway/index, yandex-message-queue/index, yandex-storage-bucket/index }, esm+cjs, dts
├── vitest.config.ts                 # NEW: typecheck include test/types/**/*.test-d.ts
└── src/
    ├── index.ts                     # re-export catalog + types (FR-003 root surface)
    ├── types.ts                     # standalone structural Materializer/MaterializationContext/OutputBuilder/TerraformResource/Artifact + value shapes + ResourceReference
    ├── catalog.ts                   # MATERIALIZER_IDS / ARTIFACT_CATALOG / ARTIFACT_TYPES / ArtifactType (FR-003, D-3)
    ├── diagnostics.ts               # YMT_* constants + MaterializerError (extends Error, code)
    ├── helpers/
    │   ├── output-builder.ts        # OutputBuilder implementation (collector; duplicate declare → error, never silent merge)
    │   └── filename.ts              # TF address sanitization (bucket objects: [a-zA-Z0-9_], dedup/trim underscore)
    ├── yandex-function/
    │   ├── index.ts                 # default export Materializer: supports ycforge:function → yandex_function config
    │   └── hash.ts                  # sha256Hex(filePath) — deterministic hash of archive bytes (FR-009, research D-RE-6)
    ├── yandex-serverless-container/
    │   └── index.ts                 # default export Materializer: supports ycforge:docker-image → yandex_serverless_container config
    ├── yandex-api-gateway/
    │   ├── index.ts                 # default export Materializer: supports ycforge:api-gateway → read spec → replace refs → write companion → yandex_api_gateway config
    │   └── ref-resolver.ts          # replaceResourceRefs(spec, references) — `${resources.<logical>.id}` → `${<terraformType>.<name>.id}` (research D-RE-4)
    ├── yandex-message-queue/
    │   └── index.ts                 # default export Materializer: supports ycforge:queue → parse queueUrl (YMT_INVALID_QUEUE_URL) → config
    └── yandex-storage-bucket/
        └── index.ts                 # default export Materializer: supports ycforge:frontend → list dir (sorted) → bucket + N×objects → TerraformResource[]
test/
├── unit/
│   ├── yandex-function.spec.ts      # US1 AC1-3, SC-006 determinism, user_hash stable, zip_filename relative
│   ├── yandex-serverless-container.spec.ts  # US2 AC1, image as-is, supports=false for other types
│   ├── yandex-api-gateway.spec.ts   # US3 AC1-2, ref replacement in companion, file() expression, empty refs copy
│   ├── yandex-message-queue.spec.ts # FR-018..020, queue_name/region extraction, YMT_INVALID_QUEUE_URL fail-fast
│   ├── yandex-storage-bucket.spec.ts# US2 AC2-3, N→N objects, empty dir → bucket only, name sanitization, key=original
│   ├── catalog.test.ts              # FR-003 mapping (5 entries), ARTIFACT_TYPES union, isArtifactType grammar conformance
│   ├── diagnostics.test.ts          # YMT_* constants vs contracts/materializers-core.json
│   └── zero-pilot-import.test.ts    # FR-002: no value-position import of '@ycforge/pilot' in src/
├── types/
│   └── materializers-core.test-d.ts # standalone shapes; artifact type literals; multi-resource return type
└── helpers/
    └── fixtures.ts                  # mkdtemp: zip file, spec file with ${resources...}, static dir tree, queue URL helpers
packages/pilot/                      # (test-infra only; NO production change)
├── package.json                     # UPDATE: devDependencies += @ycforge/materializers-core (workspace:*);
│                                    #   scripts += pretest: pnpm --filter @ycforge/materializers-core build
└── test/
    ├── materializers-core/
    │   └── dispatch-loading.spec.ts # SC-002: loadRegistry with five @ycforge/materializers-core/* subpath specifiers;
    │                                #   dispatch on canonical project → 0× MTL_COLLISION / 0× MTL_UNHANDLED_ARTIFACT
    └── types/
        └── materializers-core-contract.test-d.ts  # structural conformance: pilot contracts ↔ materializers-core types
```

**Structure Decision**: The plugin package follows the repository's subpath-exports convention (`@ycforge/builders-core/*`, `@ycforge/pilot/contracts`) with a multi-entry tsup build. Shared materializer infrastructure (standalone types, diagnostics, output-builder, filename sanitization) is private (`src/`), while the five subpath entry modules + root catalog are the only public surface (FR-001/FR-003). Zero runtime deps keep the package weightless (unlike builders-core's esbuild). The dispatch-loading + conformance tests intentionally live in pilot's `test/` (registry resolves bare specifiers from pilot's node_modules — research D-RE-10, mirror of spec 018 US4 layout); pilot gains only a devDependency + pretest.

## Complexity Tracking

No constitution violations introduced — all gates pass. The only "new" package is mandated by the spec (D-1 single package); no overrulings (D-1..D-5 all re-validated as KEEP — research D-RE-1/2/3; D-4 refined to direct replacement, D-RE-4).

## Phase 0: Research (Generated Artifacts)

See `specs/019-materializers-yandex/research.md`. Key decisions resolved there:

- **D-1 re-validation → KEEP** single package `@ycforge/materializers-core` (mirror of spec 018 D-1); zero runtime deps.
- **D-2 re-validation → KEEP** standalone structural types (zero pilot imports) + conformance test in pilot (mirror of spec 018 D-RE-4).
- **D-3 re-validation → KEEP** `ycforge:api-gateway` + `ycforge:queue` as forward contract; both pass pilot `ARTIFACT_TYPE_PATTERN`.
- **D-4 refinement → DIRECT REPLACEMENT** (not `templatefile()`): materializer replaces `${resources.<logical>.id}` → `${<terraformType>.<name>.id}` in the B-produced spec and writes a companion file; resource uses `file("${path.module}/generated/<app_id>-openapi.yaml")`. Simpler, deterministic, avoids `templatefile()` escaping issues (research D-RE-4).
- **D-5 refinement → multi-resource return type**: bucket materializer returns `readonly TerraformResource[]`; `materialize()` return type additive-extended to `TerraformResource | readonly TerraformResource[]`; dispatch 014 fixture-level untouched (research D-RE-5).
- **user_hash**: SHA-256 hex of archive bytes (`node:crypto`), deterministic per FR-009 (research D-RE-6).
- **queue parsing**: `new URL()` + last path segment after `/queues/` for queue_name; default region `ru-central1`; fail-fast `YMT_INVALID_QUEUE_URL` (research D-RE-7).
- **filename sanitization**: `[a-zA-Z0-9_]` with underscore dedup/trim; original preserved in `key` (research D-RE-8). Nested files: `key` = POSIX relative path, TF `name` = sanitize over the FULL relative path (`assets/logo.png` → `assets_logo_png`) — collision-free across dirs (T116).
- **warning channel `YMT_EMPTY_DIRECTORY` (DQ-5, T121)**: empty frontend dir → bucket created, NOT a throw; the warning is emitted via `output.declare('<name>_bucket_id', { value, description: YMT_EMPTY_DIRECTORY })` and 021 must strip/route such YMT-code `description`s BEFORE writing `outputs.yaml`. Documented in data-model.md §5.5.
- **Package conventions**: `type: module`, engines node>=22, `files: [dist]`, `sideEffects: false`, multi-entry tsup, vitest typecheck include, `test: tsup && vitest run`, tsconfig mirror of pilot/builders-core (research D-RE-9).
- **Pilot test infra**: devDep `@ycforge/materializers-core: workspace:*` + `pretest` + `test/materializers-core/` + conformance test-d.ts; no pilot production changes (research D-RE-10).

## Phase 1: Design & Contracts (Generated Artifacts)

### Data Model (`data-model.md`)

Entities: standalone structural `Materializer`/`MaterializationContext`/`OutputBuilder`/`TerraformResource`/`Artifact` replicas (incl. additive multi-resource return), five `Artifact.value` shapes (three from 018 + two new forward-contract types D-3), `ResourceReference`, `ARTIFACT_CATALOG`/`MATERIALIZER_IDS`/`ArtifactType` (5 values), `YMT_*` family (3 codes) + `MaterializerError`, package.json/exports shape (6 subpaths), five materializer module specs with output declarations, execution invariants, and the pilot test-infra delta.

### Contracts (`contracts/`)

- `materializers-core.json`: machine-readable materializer-id → artifact-type catalog (FR-003), the five Artifact.value JSON Schemas (incl. the two new forward-contract types), the standalone structural replicas, and the three `YMT_*` codes with messages.

### Quickstart (`quickstart.md`)

Validation scenarios Sc1..Sc6: function materialization (SHA-256 user_hash + entrypoint + zip_filename + output declare), serverless container (image as-is), static bucket (N files → N objects, empty dir → bucket only, name sanitization), API Gateway (logical refs → TF expressions in companion file, `file()` spec), message queue (URL parse + `YMT_INVALID_QUEUE_URL` fail-fast), dispatch loading of all five subpaths with zero MTL errors on the canonical project. Each scenario maps to hermetic tests and SC-001..007.

### FR → Design Element Coverage

| FR | Design element | Test |
|----|----------------|------|
| FR-001 | `package.json` `exports` six subpaths; five `src/<subpath>/index.ts` default-export `Materializer` (`supports` + `materialize`) | pilot `test/materializers-core/dispatch-loading.spec.ts`, `test/types/materializers-core.test-d.ts` |
| FR-002 | `src/types.ts` standalone structural types (zero `@ycforge/pilot` imports) | `test/unit/zero-pilot-import.test.ts` (static), pilot `test/types/materializers-core-contract.test-d.ts` |
| FR-003 | `src/catalog.ts` + `src/index.ts` re-export `ARTIFACT_CATALOG` / `ARTIFACT_TYPES` (5 типов) | `test/unit/catalog.test.ts` + `contracts/materializers-core.json` schema |
| FR-004 | per-materializer index.ts: `TerraformResource { kind, type, name, configuration }` with `type`/`name` matching TF grammar | all `test/unit/*.spec.ts` (structural assertions) |
| FR-005 | per-materializer `context.output.declare('<name>_<x>_id', { value: '...<type>.<name>.id' })` | all `test/unit/*.spec.ts` (output assertions) |
| FR-006 | `yandex-function`: supports only `ycforge:function` | `test/unit/yandex-function.spec.ts` (AC2) |
| FR-007 | `yandex-function`: `{ type: 'yandex_function', name: <app_id>, configuration: { runtime, entrypoint, user_hash, content: { zip_filename } } }` | `test/unit/yandex-function.spec.ts` (AC1) |
| FR-008 | runtime default `nodejs22` | `test/unit/yandex-function.spec.ts` |
| FR-009 | `user_hash` = SHA-256 of archive content (deterministic) | `test/unit/yandex-function.spec.ts` (SC-006) |
| FR-010 | `content.zip_filename` relative (from `infra/`), not absolute | `test/unit/yandex-function.spec.ts` |
| FR-011 | `yandex-serverless-container`: supports only `ycforge:docker-image` | `test/unit/yandex-serverless-container.spec.ts` |
| FR-012 | `{ type: 'yandex_serverless_container', name: <app_id>, configuration: { image, name } }` | `test/unit/yandex-serverless-container.spec.ts` (US2 AC1) |
| FR-013 | `image` passed as-is (digest-form, immutable) | `test/unit/yandex-serverless-container.spec.ts` |
| FR-014 | `yandex-api-gateway`: supports only `ycforge:api-gateway` | `test/unit/yandex-api-gateway.spec.ts` |
| FR-015 | replace `${resources.<logical>.id}` → `${<terraformType>.<name>.id}` and write companion file | `test/unit/yandex-api-gateway.spec.ts` (US3 AC1) |
| FR-016 | `configuration.spec` = `file("${path.module}/generated/<app_id>-openapi.yaml")` | `test/unit/yandex-api-gateway.spec.ts` |
| FR-017 | empty `resourceReferences` → companion copied as-is | `test/unit/yandex-api-gateway.spec.ts` (US3 AC2) |
| FR-018 | `yandex-message-queue`: supports only `ycforge:queue` | `test/unit/yandex-message-queue.spec.ts` |
| FR-019 | `{ type: 'yandex_message_queue', name: <app_id>, configuration: { queue_name, region } }` | `test/unit/yandex-message-queue.spec.ts` |
| FR-020 | `queue_name`/`region` from `queueUrl`; invalid → `YMT_INVALID_QUEUE_URL` | `test/unit/yandex-message-queue.spec.ts` (fail-fast) |
| FR-021 | `yandex-storage-bucket`: supports only `ycforge:frontend` | `test/unit/yandex-storage-bucket.spec.ts` |
| FR-022 | 1× `yandex_storage_bucket` (name/bucket = `<app_id>`, acl `public-read`) | `test/unit/yandex-storage-bucket.spec.ts` (AC2/AC3) |
| FR-023 | 1× `yandex_storage_object` per file: name `<app_id>_<sanitized>`, bucket ref, key original, source abs path | `test/unit/yandex-storage-bucket.spec.ts` |
| FR-024 | empty dir → only bucket | `test/unit/yandex-storage-bucket.spec.ts` (AC3) |
| FR-025 | filename sanitized `[a-zA-Z0-9_]`, original in `key` | `test/unit/yandex-storage-bucket.spec.ts` (name sanitization case) |
| FR-026 | fail-fast `YMT_INVALID_QUEUE_URL` on invalid queueUrl | `test/unit/yandex-message-queue.spec.ts` |
| FR-027 | `YMT_*` used as constants, never literals | `test/unit/diagnostics.test.ts` (constants vs JSON) |

CON = covered by the Constraints/Constitution sections above.

## Post-Design Constitution Re-Check

All gates still PASS; no new violations. In particular: materializers stay confined to `supports`/`materialize` and never touch pilot internals (I); hermetic tests, no constitution-II exception needed (II); two new additive forward-contract types + `YMT_*` constants + additive multi-resource return, pilot contracts unchanged (III); minimal real TF resources only, provider extras delegated to extensions (IV); fail-fast `YMT_INVALID_QUEUE_URL`/`YMT_INVALID_ARTIFACT_VALUE`, constant-compared `YMT_*`, explicit ref-replacement, no silent merges (V); identity `name = <app_id>` stable, no identity handling (VI); zero runtime deps, no new dep cycle — pilot→(dev)materializers-core one-directional (monorepo tooling); no secrets touched (secrets); api-gateway consumes B specs as-is, no OpenAPI compilation (safe mode); root exports data/type-only (zero-dep surface).

## Open Questions for /speckit.tasks

- Whether api-gateway `spec` attribute should reference the companion file with a `file()` + `${path.module}` expression verbatim as in IDEA §32, or the materializer should return the absolute/relative path resolved by dispatch (021) — recommended: `file("${path.module}/generated/<app_id>-openapi.yaml")` as documented, but confirm the exact `path.module` handling in dispatch 021 (module dir = `infra/`).
- Exact relative-path computation for `content.zip_filename` (from `infra/`): whether the materializer receives `infraDir` via context (currently context = `{ output }` only per spec 002 clarification) or the archive path is already project-relative — decision may require a lightweight additive context field or defer to dispatch 021 path rewriting.
- Multi-resource dispatch integration: whether spec 014 `dispatch(projectModel, registry)` should be extended now (additive `TerraformResource[]` flattening) to make SC-002 testable with the real bucket materializer, or kept fixture-level with 021 handling arrays — recommended: extend dispatch additively in 021; spec 014 tests remain untouched.
- Whether `YMT_EMPTY_DIRECTORY` should surface as a warning through the diagnostics channel or only as a benign log (it does not fail materialization per FR-024). — **RESOLVED (DQ-5, T121)**: warning через `output.declare(..., { description: YMT_EMPTY_DIRECTORY })`; 021 strips/routes it before `outputs.yaml`.
- Type test placement duplication: materializers-core `test/types/materializers-core.test-d.ts` (standalone literal assertions) vs pilot `test/types/materializers-core-contract.test-d.ts` (conformance) — confirm whether both are kept in tasks.md or folded into the conformance file.
- Whether the `yandex_message_queue.region` default `ru-central1` should be extracted from the queueUrl host instead (research D-RE-7 default chosen; extracting from host adds fragility for no benefit).