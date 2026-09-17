# Contract: `@ycforge/composer` — OpenAPI extraction (`extractOpenApi`)

**Version**: 1 — stable for `@ycforge/composer` semver (major = breaking).

Public API surface of Project B for the extraction phase. Consumed programmatically today and by the future `ycsf-api` CLI (spec 010). Type-only interoperability: no runtime dependency on any other serverless-tools package.

## `extractOpenApi(request: ExtractionRequest, options?: ExtractOptions): Promise<OpenApiDocument>`

Extracts a ready OpenAPI document for one application following the fixed source priority. Resolves with the document **unchanged** (FR-009); rejects with `OpenApiExtractError` on any failure.

```ts
interface ExtractionRequest {
  appRoot: string;         // app root: <app>/swagger.json, <app>/openapi.json, <app>/dist/main
  openapiEntry?: string;   // explicit file exporting buildYcsfOpenApi(): Promise<OpenApiDocument>
}

interface ExtractOptions {
  timeoutMs?: number;      // runner timeout, default 30000
}

interface OpenApiDocument {
  openapi: string;         // e.g. "3.0.0"
  info: unknown;           // not validated at extraction stage
  paths: Record<string, unknown>;
  components?: unknown;
  [key: string]: unknown;
}
```

## `buildYcsfOpenApi` (user contract, enforced by extraction)

```ts
export async function buildYcsfOpenApi(): Promise<OpenApiDocument>;
```

- Fixed name, zero-argument, returns `Promise<OpenApiDocument>`.
- Entry module must be Node-loadable (JS `.js`/`.mjs`/`.cjs`); TS source requires a prior build step (builder, spec 018) or use of a pre-built artifact.
- Called in the **runner subprocess** with `SERVERLESS_TOOLS_OPENAPI_BUILD=1` in its environment.

## Source priority (fixed, SC-003)

| Priority | Source | Executes user code |
|----------|--------|--------------------|
| 1 | `openapiEntry` (explicit) | yes — isolated runner (variant B) |
| 2 | `<appRoot>/swagger.json` | no |
| 3 | `<appRoot>/openapi.json` | no |
| 4 | `<appRoot>/dist/main` (convention `buildYcsfOpenApi`) | yes — isolated runner |
| 5 | none | → `NO_SOURCE` |

Broken-but-present source is fail-fast (`INVALID_ARTIFACT`, `ENTRY_*`), never a silent fall-through.

## Errors (`OpenApiExtractError`)

| code | Meaning | Spec source |
|------|---------|-------------|
| `NO_SOURCE` | no source available; message: "Specify openapi_entry in build_config.yaml or export buildYcsfOpenApi from your entry point." | FR-006 |
| `INVALID_ARTIFACT` | artifact exists but malformed (`sourcePath` holds the file) | FR-007 |
| `ENTRY_LOAD_FAILED` | entry/`dist/main` missing, unloadable, or missing `buildYcsfOpenApi` export | FR-008 |
| `ENTRY_EXECUTION_FAILED` | `buildYcsfOpenApi` threw inside runner | FR-008 |
| `ENTRY_RETURNED_INVALID` | resolved value is not an `OpenApiDocument` shape | FR-008 |
| `ENTRY_TIMEOUT` | runner did not complete within `timeoutMs`, killed | FR-011 |
| `RUNNER_SPAWN_FAILED` | runner process could not be started | FR-011 |

All errors expose `sourcePath?` where applicable. Extraction errors never contain user payload/token/header data: runner failure markers carry no detail, and error messages are deterministic (code + entry path) — application-provided `err.message`/`err.stack`/stderr text are never embedded in an `OpenApiExtractError`.

## Env contract

- `SERVERLESS_TOOLS_OPENAPI_BUILD=1` is set in the runner subprocess environment **before** the entry is loaded (FR-002); the parent process environment is untouched.
- The flag is advisory: primary safety is the metadata-only `openapi_entry` contract.