# Quickstart: OpenAPI extraction validation scenarios

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contract**: [contracts/openapi-extraction.md](./contracts/openapi-extraction.md)

This is a runnable validation guide proving spec 006 end-to-end. Implementation details live in `tasks.md` and the implementation phase.

## Prerequisites

- Node.js >= 22, pnpm workspace
- First run: `pnpm install`

## Setup

Fixture apps live under `packages/composer/test/fixtures/`:

- `app-safe-entry/` — a fake "NestJS-like" app with `buildYcsfOpenApi` that would fail loudly if providers were initialized (simulates metadata-only safe mode)
- `app-convention/` — `dist/main` exporting `buildYcsfOpenApi`
- `app-artifact/` — no entry, a pre-built `swagger.json`
- `app-broken-artifact/` — no entry, a malformed `swagger.json`
- `app-nothing/` — no entry, no artifacts, no dist

## Validation scenarios

Run: `pnpm --filter @ycforge/composer test`

### US1 — explicit `openapi_entry`, safe mode

**Given** `openapiEntry: <fixtures>/app-safe-entry/src/openapi.entry.js` whose module would crash on provider init,
**When** `extractOpenApi({ appRoot, openapiEntry })`,
**Then** resolves with the document matching the expected OpenAPI fixture; provider init never ran (fixture would throw in `onModuleInit`).

Expected: pass — `extractOpenApi.success › openapi_entry (explicit)` + env test asserting the entry saw `SERVERLESS_TOOLS_OPENAPI_BUILD=1`.

### US2 — artifact fallback, no user code executed

**Given** `app-artifact/swagger.json` (valid OpenAPI),
**When** `extractOpenApi({ appRoot })` with no `openapiEntry`,
**Then** resolves with the artifact content; a spy confirms no entry/dist module was imported.

Expected: pass — `artifacts › uses swagger.json before openapi.json`; priority test.

### US3 — convention fallback via `dist/main`

**Given** `app-convention/dist/main` exporting `buildYcsfOpenApi`,
**When** `extractOpenApi({ appRoot })` with no entry and no artifacts,
**Then** resolves via the runner; env flag visible inside the function.

Expected: pass — `extractOpenApi.success › dist/main convention`.

### US4 — no source → deterministic error

**Given** `app-nothing/`,
**When** `extractOpenApi({ appRoot })`,
**Then** rejects with `OpenApiExtractError` code `NO_SOURCE` and message `Specify openapi_entry in build_config.yaml or export buildYcsfOpenApi from your entry point.`

Expected: pass — `errors › NO_SOURCE terminal message`.

### Edge — broken artifact is fail-fast

**Given** `app-broken-artifact/swagger.json` (malformed),
**When** `extractOpenApi({ appRoot })`,
**Then** rejects with `INVALID_ARTIFACT` (path included), and does **not** fall through to `openapi.json`.

Expected: pass — `errors › INVALID_ARTIFACT`.

### Edge — runner timeout isolation

**Given** an entry that never resolves and `timeoutMs: 250`,
**When** `extractOpenApi(...)`,
**Then** rejects with `ENTRY_TIMEOUT`; the main process remains alive (test continues after rejection).

Expected: pass — `spawn-runner › timeout kills runner`.

### Edge — crashed entry point

**Given** an entry whose `buildYcsfOpenApi` rejects,
**When** `extractOpenApi(...)`,
**Then** rejects with `ENTRY_EXECUTION_FAILED` naming the source; no partial document.

Expected: pass — `spawn-runner › crash exit`.

## Outcome

All scenarios green = extraction contract holds (source priority, safe mode env, fail-fast taxonomy, runner isolation, document parity). See `contracts/openapi-extraction.md` for error codes and the env contract.