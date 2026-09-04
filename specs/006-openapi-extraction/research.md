# Research: safe OpenAPI extraction (Project B)

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## R1 — Loading user entry points (`openapi_entry`, `dist/main`)

- **Decision**: The runner subprocess loads the entry path with a dynamic `import()` (works uniformly for Node CJS and ESM modules). `openapi_entry` and `dist/main` must resolve to a Node-loadable module. If the module cannot be loaded (missing file, syntax error, no buildYcsfOpenApi export), the runner reports a classifiable failure (`ENTRY_LOAD_FAILED`).
- **Rationale**: dynamic `import()` handles both module systems with one code path, executes in the isolated runner (variant B), and the entry is a user-declared artifact, not arbitrary code discovery. Node 22+ (repo engine) supports dynamic import of CJS natively.
- **Alternatives considered**: `require()` — blocked for ESM `.mjs`; child `node -e` inline script — unscalable quoting/error surfaces; bundling the entry — belongs to the builder (spec 018), out of scope for 006.
- **TS-source limitation**: IDEA §10 illustrates `openapi_entry` as `src/openapi.entry.ts`, but transpiling TS is a builder concern (spec 018). v1 loads only Node-loadable JS (`openapi_entry` referencing source TS is rejected with `ENTRY_LOAD_FAILED` + guidance "compile the entry or use a pre-built swagger.json/openapi.json artifact"). Node 22.6+ type-stripping may be used opportunistically if activation is feasible in the runner env, but it is NOT relied upon (no dependency on experimental flags).

## R2 — Runner spawn + result transport

- **Decision**: `child_process.spawn(process.execPath, [runnerPath, entryPath, mode], { env: { ...process.env, SERVERLESS_TOOLS_OPENAPI_BUILD: "1" }, cwd: appRoot })` with no shell. The runner prints exactly one JSON object (the OpenAPI document) to stdout and exits 0; all diagnostics go to stderr; any non-zero exit, malformed stdout JSON, or timeout (default 30 s, configurable) is a classified error.
- **Rationale**: stdout-JSON is the least-state transport (no temp files, no IPC channel licensing); spawn-with-array-cwd-env avoids shell injection; the timeout kill protects the main process from a hanging bootstrap (FR-011). `SERVERLESS_TOOLS_OPENAPI_BUILD=1` is injected into the runner env only (FR-002), parent env untouched.
- **Alternatives considered**: temp file + marker — leaves debris on crash; `fork`/IPC — couples child to parent module graph (we want the child isolated); passing env vars only via CLI args — risks leaking into error logs.

## R3 — Artifact validation (`swagger.json`/`openapi.json`)

- **Decision**: Minimal structural validation — parsed value must be an object with a non-empty string `openapi` and an object `paths`. Unparseable JSON, non-object shape, or missing fields ⇒ fail-fast `INVALID_ARTIFACT` with the file path (FR-007).
- **Rationale**: keeps extraction free of full OpenAPI schema validation (that is composition-time concern, spec 008); the check is strong enough to catch "binary or wrong document" mistakes and avoids silent fall-through to a later source.
- **Alternatives considered**: full OpenAPI 3.x schema validation — heavyweight, out of scope; accepting any JSON — silently feeds garbage downstream, violates fail-fast.

## R4 — Error taxonomy

- **Decision**: A single public error type `OpenApiExtractError extends Error` with a `code` field. Codes: `NO_SOURCE` (terminal chain message, FR-006), `INVALID_ARTIFACT`, `ENTRY_LOAD_FAILED`, `ENTRY_EXECUTION_FAILED`, `ENTRY_RETURNED_INVALID`, `ENTRY_TIMEOUT`, `RUNNER_SPAWN_FAILED`. Every failure carries the failing source path where applicable.
- **Rationale**: deterministic, machine-readable failures for downstream consumers (later `ycsf-api` CLI, spec 010) and for human-readable terminal guidance; each spec FR-006/007/008/011 maps to exactly one code.
- **Alternatives considered**: stringly errors — untestable; silent `undefined` — violates fail-fast and FR-006.

## R5 — Safe-mode env semantics

- **Decision**: `SERVERLESS_TOOLS_OPENAPI_BUILD=1` is set in the runner subprocess environment before spawn (FR-002). It is an advisory contract flag, not a sandbox: the primary defense is the safe `openapi_entry` contract (metadata-only generation, no `app.init()`/`app.listen()`), documented as a limitation in the spec (US1, assumptions).
- **Rationale**: matches the constitution addendum ("B всегда ставит `SERVERLESS_TOOLS_OPENAPI_BUILD=1`") and IDEA §10, without over-claiming isolation (runner subprocess cannot block network).
- **Alternatives considered**: setting the env in the parent process — leaks the flag into composer's whole process lifetime; not setting it at all — violates FR-002.