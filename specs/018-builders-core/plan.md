# Implementation Plan: builders-core — nestjs-function (bundling), docker, vite builders

**Branch**: `018-builders-core` | **Date**: 2026-09-08 | **Spec**: [specs/018-builders-core/spec.md](./spec.md)

**Input**: Feature specification from `./spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

A new workspace package `packages/builders-core` (`@ycforge/builders-core`) implementing the three core Builder plugins registered via the spec-013 explicit mapping (`builders.yaml`) under subpath specifiers `@ycforge/builders-core/{nestjs-function,docker,vite}`. Each module default-exports a spec-002 `Builder` shape (`build: Function`) so the registry classifies it as `kind: 'builder'`. `nestjs-function` bundles a NestJS app with esbuild into one self-contained CJS file (platform node, target from `runtime`), copies declared `external` native modules, zips into a deterministic dependency-free archive, and returns `Artifact<ycforge:function, {archivePath, entryPoint}>`. `docker` shells out to the Docker CLI (build → push → digest via push-output parse with `docker image inspect` fallback) and returns the immutable digest-form image `cr.yandex/…@sha256:…`. `vite` runs the configured `command` (default `vite build`) inside the app root with `buildEnv` overlaid, then copies the static output into `outputDir` and returns `Artifact<ycforge:frontend, {directory}>`. The package also ships a machine-readable `builder-id → artifactType` catalog (FR-003, forward contract for 019/021), the `BLC_*` diagnostics catalog, and a strict D-3 fail-fast guard: any residual `{{$...}}` in `buildConfig`/`buildEnv` → `BLC_ENV_NOT_RESOLVED`, arithmetic is never called with raw references.

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM, strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` — tsconfig mirror of pilot).

**Primary Dependencies**:
- **NEW runtime dependency**: `esbuild@^0.27.7` (bundling engine of `nestjs-function`; already in the workspace lockfile transitively via tsup with `allowBuilds: esbuild: true` — research D-RE-6). No other new runtime deps: zip is a dependency-free writer over `node:zlib` (no archiver in the lockfile — D-RE-7); docker/vite are child_process wrappers.
- **ZERO dependency on `@ycforge/pilot`** (neither runtime nor dev/peer/types): builders-core re-declares standalone structural `Builder`/`BuildContext`/`Artifact` types; structural conformance to spec-002 contracts is pinned by a compile-time type test living in **pilot** (`test/types/builders-core-contract.test-d.ts`), which already devDeps builders-core for US4 (research D-RE-4/D-RE-5).

**Storage**: File system only — `outputDir` (recursively created) receives `function.zip` (nestjs-function), copied `dist/` (vite), or nothing (docker; artifact is the registry reference). Staging for esbuild used via `mkdtemp` and cleaned up.

**Testing**: Vitest (`vitest.config.ts` with `typecheck` include → `test/types/**/*.test-d.ts`). Builder unit tests run hermetically: NestJS fixtures in `mkdtemp`, fake `docker`/`vite` executables in `test/fixtures/bin` (deterministic output, arg capture) — docker CLI wrapper is a thin orchestration layer, characterization-tested post-hoc (Constitution II exception). US4 registry loading + type conformance live in **pilot** `test/` (research D-RE-4/5). `test` script = `tsup && vitest run` (nest-bridge pattern — self-referential subpath imports need the built dist); pilot gets `pretest: pnpm --filter @ycforge/builders-core build`.

**Target Platform**: Node 22+ library package published as `@ycforge/builders-core` (ESM+CJS via tsup, subpath exports); consumed by pilot's registry (013) at build time (021) and by materializers (019) through the artifact catalog.

**Project Type**: Multi-entry runtime library package (3 builder plugins) + type-only public contracts + `BLC_*` constants + artifact catalog.

**Performance Goals**: SC-003 — deterministic byte-identical artifact for identical inputs (fixed zip timestamps, stable ordering, unminified deterministic bundle); nestjs-function bundle of a typical NestJS app completes in seconds (esbuild) and yields SC-006 self-contained zip (no unbundled runtime refs outside `external`).

**Constraints**:
- Build interface = `Builder.build(context: BuildContext)` only — no knowledge of pilot internals (Constitution I); no value-position import of `@ycforge/pilot` anywhere in `src/` (FR-002, verified by a structural test).
- `buildConfig`/`buildEnv` arrive already interpolated (spec 012); builders never interpolate; residual `{{$` → `BLC_ENV_NOT_RESOLVED` (FR-018/019). Other interpolation namespaces (`${...}`, `${resources...}`) are untouched (012 §boundary).
- Unknown top-level `build_config` keys are ignored (coexistence with B-shared fields like `openapi_entry`, FR-004/008); incorrect type of a **known** field → `BLC_INVALID_CONFIG`.
- Immutable image reference (FR-011): `Artifact.value.image` is always `…@sha256:<hex64>`, never a mutable tag; unresolvable digest → `BLC_IMAGE_DIGEST_UNAVAILABLE`.
- Credentials never part of build_config/buildEnv usage: docker auth is strictly Docker CLI/CI environment (FR-012); vite gets only `buildEnv` as build variables (FR-015), base `process.env` is inherited solely as the execution environment — no dotenv, no implicit env sources (Constitution V).
- One builder invocation = one Artifact; builders stateless; partial artifacts never returned; `sourcePath` absent → `BLC_MISSING_SOURCE` (spec Edge Cases).
- `@ycforge/builders-core/*` subpath modules must load via `import()` from the pilot registry without `BRG_*` errors (US4); node_modules resolution anchored at pilot → pilot devDeps builders-core (research D-RE-5).

**Scale/Scope**: Three plugin modules, three build_config schemas, one catalog + one diagnostics family; monorepo `packages/*` pnpm workspace. Consumers: pilot registry (013) at load/validation, 021 build execution, 019 materializers (forward contract only).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | Builders are standalone plugin packages invoked by C (021); they know only `BuildContext` (no pilot internals, zero pilot imports run-time/type). C stays the orchestrator; builders do NOT provision (no Terraform). bundling/zip/digest = builder zone (IDEA §21/§37) |
| II. Spec-First, Test-First | ✅ PASS | Every AC → test; unit tests hermetic with fixtures + fake docker/vite binaries; docker CLI wrapper covered by characterization tests post-hoc (documented Constitution II exception) |
| III. Contracts Versioned | ✅ PASS | **NEW** artifact types `ycforge:function/docker-image/frontend` + value shapes fixed here as forward contract (D-2); `BLC_*` (7 codes) machine-readable catalog with constants (never literals); `<app>/build_config.yaml` remains versionless (spec 011); pilot contracts UNCHANGED; builder API = spec-002 structural |
| IV. Terraform Stays Terraform | ✅ PASS | Builders never model Terraform/provider schema; digest-immutable image is a build-side contract consumed by 019; no generator/validation of Terraform |
| V. Explicit Over Magic | ✅ PASS | **Central**: residual `{{$…}}` → fail-fast `BLC_ENV_NOT_RESOLVED` (D-3, no self-interpolation); unknown top-level keys ignored (documented), invalid known-field type → `BLC_INVALID_CONFIG`; tangible `external`, digest fallback, unoverridable defaults; no auto-discovery, no dotenv, no `npx` (registry fetch) — vite uses the app's own binary resolution; collisions/ambiguous states are errors, never silent |
| VI. Ownership Model | ✅ PASS | Builders produce artifacts from app source units; resources stay external reference-only; no identity handling |
| Monorepo Tooling | ✅ PASS | New package `packages/builders-core` (pnpm workspaces `packages/*`); builds with tsup multi-entry, follows nest-bridge `test: tsup && vitest run`; allowBuilds.esbuild already present; **no new peer/dev/peer cycles** — builders-core has no pilot dep, pilot devDeps builders-core (one direction) |
| Secrets | ✅ PASS | No credentials in build_config/buildEnv use; docker auth = CLI/CI env only; none written into artifacts |
| OpenAPI Build Safe Mode | ✅ PASS | `openapi_entry` (B-shared field) is ignored by nestjs-function (FR-008); vite never emits buildEnv into metadata/artifacts beyond the built bundle |
| Zero-dep contracts surface | ✅ PASS | builders-core root exports (catalog + types) are data/type-only; the three subpath modules each import esbuild (runtime) but carry no pilot runtime import; `BLC_*` constants pure |

**Gate Decision**: All gates PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/018-builders-core/
├── plan.md              # This file
├── research.md          # Phase 0 output (decisions D-RE-1..12 + consolidated facts)
├── data-model.md        # Phase 1 output (types, configs, catalog, BLC_*, subpath map)
├── quickstart.md        # Phase 1 output (validation scenarios Sc1..Sc8)
├── contracts/           # Phase 1 output (builders-core.json — BLC_* catalog + build_config/artifact schemas; builders-core.draft.ts — mockup types)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/builders-core/
├── package.json                     # NEW: name/version/exports (subpaths), deps: esbuild, devDeps: tsup/typescript/vitest/@types/node
├── tsconfig.json                    # NEW: strict, NodeNext, exactOptionalPropertyTypes, noUncheckedIndexedAccess (mirror pilot)
├── tsup.config.ts                   # NEW: entry { index, nestjs-function/index, docker/index, vite/index }, esm+cjs, dts
├── vitest.config.ts                 # NEW: typecheck include test/types/**/*.test-d.ts
└── src/
    ├── index.ts                     # re-export catalog + types (FR-003 root surface)
    ├── types.ts                     # standalone structural Builder/BuildContext/Artifact + value shapes + BuildConfig types
    ├── catalog.ts                   # BUILDER_IDS / ARTIFACT_CATALOG / ArtifactType (FR-003)
    ├── diagnostics.ts               # BLC_* constants + BuilderError (extends Error, code)
    ├── env.ts                       # residual {{$...}} scan of buildConfig string leaves + buildEnv (D-3, FR-018/019)
    ├── config.ts                    # known-field validation helpers, ignore-unknown top-level, BLC_INVALID_CONFIG
    ├── nestjs-function/
    │   ├── index.ts                 # default export Builder: validate → bundle → external copy → zip → Artifact
    │   ├── config.ts                # NestjsFunctionBuildConfig parse/defaults (entry src/main.ts, runtime nodejs20,
    │   │                            #   external [], out_filename function.zip)
    │   └── bundle.ts                # esbuild.build (platform/node, format cjs, target from runtime map, external),
    │                                #   staging via mkdtemp, entry-existence check (BLC_ENTRY_NOT_FOUND),
    │                                #   external node_modules copy, zip into outputDir (BLC_ARCHIVE_FAILED),
    │                                #   entryPoint = "<basename>.handler"
    ├── docker/
    │   ├── index.ts                 # default export Builder: validate → build/push via cli.ts → digest → Artifact
    │   ├── config.ts                # DockerBuildConfig parse/defaults (image.repository required → BLC_INVALID_CONFIG,
    │   │                            #   tag default latest, dockerfile default Dockerfile; tag safety regex)
    │   └── cli.ts                   # spawn docker build/push (arg array, no shell), digest parse from push output,
    │                                #   docker image inspect '{{index .RepoDigests 0}}' fallback → BLC_IMAGE_DIGEST_UNAVAILABLE
    ├── vite/
    │   ├── index.ts                 # default export Builder: validate → spawn command → copy out_dir → Artifact
    │   ├── config.ts                # ViteBuildConfig parse/defaults (out_dir dist, root ., command "vite build")
    │   └── run.ts                   # spawn(shell) in viteRoot, env { ...process.env, ...buildEnv }, PATH +=.bin,
    │                                #   post-build copy {viteRoot}/{out_dir} → outputDir, BLC_BUILD_FAILED on failure
    └── zip/
        ├── writer.ts                # dependency-free deterministic ZIP (node:zlib deflateRaw; fixed timestamps;
        │                            #   local headers + central directory + CRC-32)
        └── collect.ts               # recursive directory collect (staging → zip entries)
test/
├── unit/
│   ├── nestjs-function.spec.ts      # US1 AC1-4, US5, zip determinism/layout, external handling, entryPoint
│   ├── docker.spec.ts               # US2 AC1-4: fake docker bin (arg capture, digest/no-digest, non-zero), FR-012
│   ├── vite.spec.ts                 # US3 AC1-4: fake vite bin (env capture, dist copy, exit codes), US5
│   ├── zip-writer.spec.ts           # round-trip unzip assertions (system unzip), determinism
│   ├── catalog.test.ts              # FR-003 mapping + isArtifactType grammar conformance
│   ├── diagnostics.test.ts          # BLC_* constants vs catalog JSON
│   └── zero-pilot-import.test.ts    # FR-002: no value-position import of '@ycforge/pilot' in src/
├── types/
│   └── builders-core.test-d.ts      # standalone shapes; artifact type literals
└── helpers/
    ├── fixture-project.ts           # mkdtemp NestJS/vite fixture scaffolding
    └── fake-bins.ts                 # write fake docker/vite executables into PATH dir
packages/pilot/                      # (test-infra only; NO production change)
├── package.json                     # UPDATE: devDependencies += @ycforge/builders-core (workspace:*);
│                                    #   scripts += pretest: pnpm --filter @ycforge/builders-core build
└── test/
    ├── builders-core/
    │   └── registry-loading.spec.ts # US4 AC1-3: loadRegistry/loadProjectModel/validateBuilders + loadPlugins
    │                                #   with @ycforge/builders-core/* subpath specifiers; direct subpath import shape
    └── types/
        └── builders-core-contract.test-d.ts  # structural conformance: pilot contracts ↔ builders-core types
```

**Structure Decision**: The plugin package follows the repository's subpath-exports convention (pilot/contracts, nest-connector/auth|queue|context|logger) with a multi-entry tsup build. Shared builder infrastructure (env scan, config validation, diagnostics, zip) is private (`src/`), while the three subpath entry modules + root catalog are the only public surface (FR-003/FR-001). Runtime deps are minimized to esbuild alone; `@ycforge/pilot` has zero presence in builders-core so the package builds stand-alone (breaks the would-be dev cycle caused by US4's bare-subpath registry test, research D-RE-4). The US4 integration test intentionally lives in pilot's `test/` because the registry resolves bare specifiers from pilot's node_modules (research D-RE-5); pilot gains only a devDependency + pretest, mirroring composer's `pretest: pnpm --filter @ycforge/pilot build` pattern.

## Complexity Tracking

No constitution violations introduced — all gates pass. The only "new" package is mandated by the spec (D-1 single package); no overrulings (D-1/D-2/D-3 all re-validated as KEEP — research D-RE-1..3).

## Phase 0: Research (Generated Artifacts)

See `specs/018-builders-core/research.md`. Key decisions resolved there:

- **D-1 re-validation → KEEP** single package; split trigger recorded (install-size > ~30% for one builder, or independent release cadence).
- **D-2 re-validation → KEEP** artifact types as forward contract; all three strings pass pilot's `isArtifactType` grammar.
- **D-3 re-validation → KEEP** fail-fast `BLC_ENV_NOT_RESOLVED` on residual `{{$` scan (defensive second ring after spec 012).
- **Type strategy**: standalone structural `Builder`/`BuildContext`/`Artifact` in builders-core (zero pilot presence) + conformance type-test in pilot — breaks the `pilot ↔ builders-core` dev cycle that US4's bare-subpath test would otherwise create.
- **US4 test location**: pilot `test/builders-core/` — `import('@ycforge/builders-core/*')` inside `registry/load.ts` is anchored at pilot's module, so the bare specifier must resolve from `packages/pilot/node_modules` (devDep + pretest build, composer pattern).
- **esbuild**: only new runtime dep `^0.27.7` (already transitive via tsup; `allowBuilds` open); used for bundling, platform=node, format=cjs, target from `runtime` map `{nodejs20→node20 default, nodejs22→node22}`.
- **Zip**: dependency-free deterministic writer over `node:zlib` (no archiver in lockfile; fixed timestamps for SC-003 byte-determinism); archive holds the CJS bundle + copied `node_modules/<external>` for declared externals (reverse of unbundled native addons).
- **entryPoint contract**: `"<bundleBasename>.handler"` — Yandex Function format `<file>.<export>`; canonical nest-bridge export is `handler`; spec schema has no export-name field, so it's a fixed documented contract.
- **docker**: spawn (no shell, arg-array) `build -f <dockerfile> -t <repo>:<tag> <sourcePath>` → `push <repo>:<tag>` → digest regex from push output → fallback `docker image inspect --format '{{index .RepoDigests 0}}'` → else `BLC_IMAGE_DIGEST_UNAVAILABLE`. Credentials never touch the wrapper (CLI/CI env only).
- **vite**: NO vite dependency in the monorepo; run configurable `command` (default `vite build`) via spawn(shell) in `viteRoot = resolve(sourcePath, root)`, PATH prefixed with the app's `node_modules/.bin` (own binary, never `npx`), `env = { ...process.env, ...buildEnv }`; copy `{viteRoot}/{out_dir}` → `outputDir`; `value.directory = outputDir`.
- **Catalog (FR-003)**: `src/catalog.ts` plain-data `ARTIFACT_CATALOG` exported from root; typed `BuilderId`/`ArtifactType`.
- **Package conventions**: `type: module`, engines node>=22, `files: [dist]`, `sideEffects: false`, multi-entry tsup, vitest typecheck include, `test: tsup && vitest run`, tsconfig = pilot mirror.
- **Config files**: `<app>/build_config.yaml` is versionless (confirmed spec 011) — no `version` field for builder configs; `build_env` map is spec 011's `ENV_NAME → string|null` resolved by pilot 012 into `Record<string,string>`.

## Phase 1: Design & Contracts (Generated Artifacts)

### Data Model (`data-model.md`)

Entities: `BuildContext`/`Artifact`/`Builder` (structural replicas), `FunctionArtifactValue`/`DockerArtifactValue`/`FrontendArtifactValue`, three `BuildConfig` schemas with defaults+validation, `ARTIFACT_CATALOG`/`BuilderId`/`ArtifactType`, `BLC_*` family + `BuilderDiagnostic`/`BuilderError`, package.json/exports shape, module layout, state-transition invariant of a build invocation, and the pilot test-infra delta.

### Contracts (`contracts/`)

- `builders-core.json`: machine-readable artifact catalog + the three build_config JSON Schemas (versionless) + the three Artifact.value shapes + the seven `BLC_*` codes with messages/module origin.
- `builders-core.draft.ts`: type mockup mirroring `src/types.ts`/`src/catalog.ts`/`src/diagnostics.ts` (plan-phase reference; not wired into src).

### Quickstart (`quickstart.md`)

Validation scenarios Sc1..Sc8: NestJS function happy path (zip + entryPoint), external+`openapi_entry` coexistence, `BLC_ENTRY_NOT_FOUND`, docker digest-immutable artifact (fake docker), digest-unavailable & docker-error fail-fasts, vite build with `YANDEX_ID_APP_ID` + defaults + missing-vite failure, registry subpath loading + `validateBuilders` (US4), residual `{{$ENV}}` fail-fast across all three builders (US5). Each scenario maps to hermetic tests and SC-001..007.

### FR → Design Element Coverage

Every functional requirement is traceable to a design element (module/function) and a test; CON = covered by constitution/constraints section rather than a single module.

| FR | Design element | Test |
|----|----------------|------|
| FR-001 | `package.json` `exports` subpaths `/nestjs-function` `/docker` `/vite`; three `src/<builder>/index.ts` default-export `Builder` (field `build`) | pilot `test/builders-core/registry-loading.spec.ts` (kind='builder', loadPlugins), `test/types/builders-core.test-d.ts` |
| FR-002 | `src/types.ts` standalone structural types (zero `@ycforge/pilot` imports) | `test/unit/zero-pilot-import.test.ts` (static), pilot `test/types/builders-core-contract.test-d.ts` (structural conformance) |
| FR-003 | `src/catalog.ts` + `src/index.ts` re-export → `ARTIFACT_CATALOG` (`nestjs-function→ycforge:function`, `docker→ycforge:docker-image`, `vite→ycforge:frontend`) | `test/unit/catalog.test.ts` + `contracts/builders-core.json` schema |
| FR-004 | `src/config.ts` known-field validation helpers + `src/nestjs-function/config.ts` defaults (`entry: src/main.ts`, `runtime: nodejs20`, `external: []`, `out_filename: function.zip`), ignore-unknown top-level | `test/unit/nestjs-function.spec.ts` (US1 AC1/AC3), config unit cases |
| FR-005 | `src/nestjs-function/bundle.ts` esbuild bundling (no in-place build; `external` not bundled) | `test/unit/nestjs-function.spec.ts` (SC-006 layout, external copy) |
| FR-006 | `src/zip/*` + `src/nestjs-function/bundle.ts` → `ycforge:function` artifact | `test/unit/nestjs-function.spec.ts` (SC-003 determinism), `zip-writer.spec.ts` |
| FR-007 | `src/nestjs-function/bundle.ts` entry-existence check + esbuild error → fail-fast | `test/unit/nestjs-function.spec.ts` (US1 AC4) |
| FR-008 | `src/config.ts` ignore-unknown top-level (by construction, FR-004) | nestjs-function fixture with `openapi_entry` (Sc2) |
| FR-009 | `src/docker/config.ts` (`image.repository` required → `BLC_INVALID_CONFIG`, `tag`/`dockerfile` defaults, tag safety regex) | `test/unit/docker.spec.ts` |
| FR-010 | `src/docker/cli.ts` spawn(docker build -f … -t … `<sourcePath>`; push `<repository>:<tag>`) | `test/unit/docker.spec.ts` fake-docker arg capture (characterization, Constitution II exception) |
| FR-011 | `src/docker/cli.ts` digest parse / `docker image inspect` fallback; `src/docker/index.ts` returns immutable `@sha256` image only | `test/unit/docker.spec.ts` (digest/no-digest → `BLC_IMAGE_DIGEST_UNAVAILABLE`) |
| FR-012 | CON — docker wrapper passes no config/buildEnv-derived auth; credentials from CLI/CI env only | `test/unit/docker.spec.ts` assert no auth args/env beyond build/push/inspect (Sc5) |
| FR-013 | `src/docker/cli.ts` nonzero exit / missing CLI → `BLC_BUILD_FAILED`, no partial artifact | `test/unit/docker.spec.ts` (fake docker nonzero) |
| FR-014 | `src/vite/config.ts` defaults (`out_dir: dist`, `root: .`, `command: vite build`), invalid type → `BLC_INVALID_CONFIG` | `test/unit/vite.spec.ts` |
| FR-015 | `src/vite/run.ts` spawn in `viteRoot`, `env = { ...process.env, ...buildEnv }`, PATH += app `node_modules/.bin` | `test/unit/vite.spec.ts` fake-vite env capture |
| FR-016 | `src/vite/run.ts` copy `{viteRoot}/{out_dir}` → `outputDir`; `value.directory = outputDir` | `test/unit/vite.spec.ts` (US3 AC1/AC4) |
| FR-017 | `src/vite/run.ts` command failure / missing output → `BLC_BUILD_FAILED` | `test/unit/vite.spec.ts` (fake vite exit 1) |
| FR-018 | CON — builders never interpolate; only the residual-`{{$` guard lives in `src/env.ts` (`scanBuildInput`) | `test/unit/env-residual.test.ts` |
| FR-019 | `src/env.ts` recursive string-leaf scan of `buildConfig` + all `buildEnv` values → `BLC_ENV_NOT_RESOLVED` before any build | `test/unit/env-residual.test.ts` + per-builder reject tests (Sc8) |
| FR-020 | `src/<builder>/index.ts` reads env values strictly from `buildContext.buildEnv` (never `process.env` directly) | `test/unit/vite.spec.ts` (buildEnv injection), nestjs-function (no env) |

CON = covered by the Constraints/Constitution sections above (FR-012/FR-018 have no single module; FR-008 delegates to FR-004's ignore-unknown rule).

## Post-Design Constitution Re-Check

All gates still PASS; no new violations. In particular: builders stay confined to `Builder.build` and never touch pilot internals (I); hermetic unit tests + characterization exception documented for the docker CLI wrapper (II); new artifact types + `BLC_*` are additive and machine-readable, pilot contracts unchanged, `build_config.yaml` versionless (III); no Terraform modeling (IV); D-3 fail-fast + constant-compared `BLC_*` + no dotenv/npx (V); builders are plugins over app source units with no identity handling (VI); no new dependency cycles — pilot→(dev)builders-core is one-directional and builders-core builds standalone (monorepo tooling); secrets stay in CI/Docker env (secrets); `openapi_entry` ignored (OpenAPI safe mode); root exports remain data/type-only (zero-dep surface).

## Open Questions for /speckit.tasks

- Exact content of the dependency-free ZIP writer (STORE vs deflate per entry; fixed-timestamp constant value) and whether CRC-32 is hand-rolled or delegated to `node:zlib` (implementation detail; determinism is the contract).
- Handling of `sourcePath` semantics for `docker`/`vite` when apps sit in `projectRoot` — whether `projectRoot === sourcePath` defaulting is builder-specific (edge-case: `BLC_MISSING_SOURCE` for all three; docker build context = sourcePath).
- `runtime` → esbuild-target supported set (`nodejs20`/`nodejs22` only?) and whether an extra Yandex runtime (`nodejs18`?) is allowed in this wave.
- Whether `external` copy uses the resolved realpath of `node_modules/<id>` (pnpm isolated node_modules vs hoisted) — needs `createRequire.resolve` + copy of the resolved directory; exact copy strategy (directory vs node_modules subtree with install) for tasking.
- Type test placement duplication risk: builders-core `test/types/builders-core.test-d.ts` (standalone) vs pilot `test/types/builders-core-contract.test-d.ts` (conformance) — confirm both are kept in tasks.md, or fold standalone literal-assertions into the conformance file.
- Whether docker's `BLC_BUILD_FAILED` should carry the docker CLI's stderr tail verbatim (diagnostic payload) or a truncated preview — decide in tasks to keep messages deterministic for RED/GREEN.