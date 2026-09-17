# Implementation Plan: ycsf-api CLI — compile / check

**Branch**: `010-ycsf-api-cli` | **Date**: 2026-09-06 | **Spec**: specs/010-ycsf-api-cli/spec.md

**Input**: Feature specification from `specs/010-ycsf-api-cli/spec.md`

## Summary

Build a standalone CLI (`ycsf-api`) for Project B (`@ycforge/composer`) with two commands:
- `ycsf-api compile`: composes a unified Yandex API Gateway OpenAPI spec from gateway apps, applying auth, overrides, and resource interpolation
- `ycsf-api check`: lightweight validation of API composition contracts without Terraform/Project C

The CLI will be implemented as a new entry point in `@ycforge/composer` using `commander.js` for argument parsing, reusing existing composition engines (`compose/`, `auth/`, `resource/`, `overrides/`).

## Technical Context

**Language/Version**: TypeScript 5.9 / Node.js 22+ (ESM)

**Primary Dependencies**:
- `commander.js` — CLI framework
- `yaml` — YAML parsing (already in devDependencies)
- Existing internal modules: `@ycforge/composer` (compose, auth, resource, overrides), `@ycforge/pilot/contracts` (Artifact types, ResourceReference)

**Storage**: File system (`.ycsf/` configs, OpenAPI sources, output files)

**Testing**: Vitest (already configured); test-first per constitution

**Target Platform**: CLI binary (Node.js), runnable via `npx ycsf-api` or compiled standalone

**Project Type**: CLI tool (npm package entry point)

**Performance Goals**: `check` < 2s (10 apps, 200 routes); `compile` < 5s

**Constraints**:
- Must work without Project C / Terraform (standalone)
- Fail-fast on conflicts (provenance-aware)
- Deterministic output (same inputs → binary identical output)
- No side effects in `check` (no file writes, no external processes)
- Exit codes per spec: compile (0/1/2/3), check (0/1/2)

**Scale/Scope**: Typical project: 1–10 gateway apps, ~200 routes, ~50 resource refs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation A/B/C/Terraform | ✅ PASS | CLI is pure Project B (API composition); no Terraform, no runtime, no deployment |
| II. Spec-First, Test-First | ✅ PASS | Acceptance criteria → tests before implementation |
| III. Contracts Versioned | ✅ PASS | Uses `@ycforge/pilot/contracts` (semver); `.ycsf/*.yaml` have `version: 1` |
| IV. Terraform Stays Terraform | ✅ PASS | CLI doesn't generate/validate Terraform |
| V. Explicit Over Magic | ✅ PASS | Explicit `--project-dir`, `--app` flags; fail-fast on collisions |
| VI. Ownership Model | ✅ PASS | Apps = managed (buildable), resources = external (reference only) |
| Monorepo Tooling | ✅ PASS | New CLI entry in `@ycforge/composer` package |
| Secrets | ✅ PASS | No secrets in build config |
| OpenAPI Build Safe Mode | ✅ PASS | Sets `SERVERLESS_TOOLS_OPENAPI_BUILD=1` |
| Canonical Examples | ✅ PASS | Consistent with `user_service`, `analytics`, `frontend`, `openapi` |

**Gate Decision**: All gates PASS — proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/010-ycsf-api-cli/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (CLI command schemas, JSON output schema for check)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/composer/
├── src/
│   ├── cli/                    # NEW: CLI entry point
│   │   ├── index.ts            # Main CLI setup (commander.js)
│   │   ├── compile.ts          # compile command implementation
│   │   ├── check.ts            # check command implementation
│   │   ├── types.ts            # CLI option types, shared types
│   │   └── errors.ts           # CLI-specific error classes
│   ├── compose/                # Existing: composition engine
│   ├── auth/                   # Existing: auth handling
│   ├── resource/               # Existing: resource references
│   ├── overrides/              # Existing: overrides logic
│   ├── runner/                 # Existing: OpenAPI extraction runner
│   ├── index.ts                # Existing: public API exports
│   └── ...
├── runner/
│   └── runner.mjs              # Existing: isolated runner for OpenAPI extraction
├── package.json                # UPDATE: add "bin" entry for ycsf-api
└── tsup.config.ts              # UPDATE: add CLI entry point to build
```

**Structure Decision**: Add `src/cli/` directory in `@ycforge/composer` for the new CLI commands. This keeps Project B self-contained (constitution I). The CLI reuses existing composition/auth/resource/overrides modules — no new packages.

## Complexity Tracking

No constitution violations — all gates pass.

## Phase 0: Research (Generated Artifacts)

### Open Questions from Spec (NEEDS CLARIFICATION)

1. **Multiple gateway apps in one project** (Spec Q1): MVP supports only one gateway app. Selection: first `builder: yandex-api-gateway` in `apps.yaml`; error if multiple found without `--app` flag. Flag `--app <appId>` allows explicit selection.
2. **ENV-only mode in `check`** (Spec Q2): If `.ycsf/env.yaml` has `mode: env-only`, skip OpenAPI file existence check (builder will generate later). Other checks still run.
3. **Output format** (Spec Q3): Always include `x-yc-*` extensions (Yandex API Gateway compatible). No plain OpenAPI option in MVP.
4. **Scheme mapping** (Spec Q4): `@RequireAuth` decorator adds `x-yc-auth-scheme: <schemeName>` to operation extensions. `auth.yaml` scheme names must match. Mapping is explicit, not inferred.
4. **Overrides syntax** (Spec Q5): Per spec 014 — custom path-based override format (not JSON Pointer/Patch). Each override entry: `path`, `method?`, `patch` (object to deep-merge). Applied in order: global → per-app. Provenance tracked per route.

### Research Tasks

| Unknown | Research Task |
|---------|---------------|
| CLI framework choice | Compare `commander.js` vs `oclif` for standalone CLI in monorepo; `commander.js` chosen (lighter, single file, already in ecosystem) |
| OpenAPI merge library | Use existing `compose.ts` (custom, provenance-aware) — no external lib needed |
| Resource interpolation | Reuse `resource/reference-resolver.ts` (IDL/IDT/IDR resolution) |
| Auth scheme validation | Reuse `auth/auth-yaml.ts` + `auth/auth-config.ts` |
| Conflict detection | Reuse `compose/compose-errors.ts` (fail-fast with diagnostics) |
| Overrides apply | Reuse `compose/overrides/apply.ts` |

### Dependencies Best Practices

- `commander.js` v12+: TypeScript-first, subcommand support, auto-help
- Exit codes: follow POSIX conventions (0=success, 1=general error, 2=usage/config error, 3=IO error)
- JSON output for `check --json`: structured for CI/CD parsing
- Determinism: sort keys in merged OpenAPI (paths, components, securitySchemes)

### Integration Patterns

- Load `.ycsf/apps.yaml` → filter `builder: yandex-api-gateway`
- For each app: read `build_config.yaml` → `openapi_entry` → load OpenAPI via existing extraction (runner) or direct file read
- Merge with provenance (`sourceApp` per path/operationId)
- Apply auth: generate `securitySchemes` + per-operation `security` from `x-yc-auth-scheme`
- Apply overrides: global → local, provenance-aware
- Interpolate resources: `${resources.<domain>.<name>.<prop>}` via resource index

**Output**: `research.md` (to be generated)

## Phase 1: Design & Contracts (Generated Artifacts)

### Data Model (`data-model.md`)

Entities:
- **GatewayApp**: `id`, `name`, `openapiEntry`, `authPath`, `overridesPath`, `provenance`
- **AuthScheme**: `name`, `type` (none|jwt|function), `config` (issuer/audience/jwksUri or functionRef)
- **ResourceRef**: `domain`, `name`, `property`, `resolvedValue` (or placeholder)
- **OverrideEntry**: `path`, `method?`, `patch`, `source` (global|app:<id>)
- **CompiledOpenAPI**: merged document with `x-yc-*` extensions, provenance metadata
- **CheckResult**: `{ check: string, passed: boolean, details?: string }[]`

### Contracts (`contracts/`)

- `cli-options.json`: JSON Schema for CLI options (compile, check)
- `check-output.json`: JSON Schema for `ycsf-api check --json` output
- `compile-output.json`: Not needed (output is OpenAPI document)

### Quickstart (`quickstart.md`)

Validation scenarios:
1. Single gateway app → `ycsf-api compile` → valid OpenAPI with auth/overrides/resources
2. Multiple gateway apps without `--app` → error (fail-fast)
3. `ycsf-api check` on valid project → exit 0, summary ✓
4. `ycsf-api check` with duplicate operationId → exit 1, details
5. `ycsf-api check --json` → machine-readable JSON
6. ENV-only mode → skips OpenAPI file existence check

## Post-Design Constitution Re-Check

All gates still PASS. No new violations introduced.