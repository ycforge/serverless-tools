# Research: ycsf-api CLI — compile / check

## Decisions & Rationale

### 1. CLI Framework: commander.js

**Decision**: Use `commander.js` v12+ for CLI implementation.

**Rationale**:
- Lightweight, single-file, zero-dependency (except TypeScript types)
- Native subcommand support (`compile`, `check`)
- TypeScript-first with strong typing for options
- Auto-generated help, version flags
- Already familiar in Node.js ecosystem; no additional runtime cost
- `oclif` rejected: heavier, requires build step, overkill for 2 commands

**Alternatives Considered**:
- `oclif`: Full framework, good for large CLIs, but adds complexity and build requirements
- `yargs`: Similar to commander but less TypeScript-friendly API
- Custom argument parsing: Rejected — reinventing wheel, error-prone

### 2. OpenAPI Composition Engine: Reuse Existing `compose/`

**Decision**: Reuse `@ycforge/composer`'s existing `compose.ts`, `merge.ts`, `provenance.ts`, `compose-errors.ts`.

**Rationale**:
- Already implements provenance-aware merge (AC-02)
- Already implements fail-fast conflict detection with diagnostics (AC-06)
- Already handles `x-yc-*` extensions for Yandex API Gateway
- No external library provides Yandex-specific semantics + provenance tracking

**Alternatives Considered**:
- `openapi-merge` / `@apidevtools/swagger-merger`: Generic merge, no provenance, no Yandex extensions, no fail-fast on operationId conflicts
- Custom implementation: Rejected — already exists and tested

### 3. Resource Interpolation: Reuse Existing `resource/reference-resolver.ts`

**Decision**: Reuse `resource/reference-resolver.ts` + `resource/resource-index.ts` for `${resources...}` resolution.

**Rationale**:
- Already implements IDL/IDT/IDR resolution per spec 009
- Handles `.ycsf/resources.yaml` + app-generated artifacts (functions.*, containers.*, etc.)
- Supports ENV-only mode placeholders (spec 018)

### 4. Auth Scheme Handling: Reuse Existing `auth/`

**Decision**: Reuse `auth/auth-yaml.ts`, `auth/auth-config.ts`, `auth/auth-security.ts`, `auth/function-ref.ts`.

**Rationale**:
- Already validates scheme types (none|jwt|function) and required fields (AC-09)
- Already resolves function refs via resource index (AC-09)
- Already generates `securitySchemes` + per-operation `security` from `x-yc-auth-scheme` (AC-03, AC-04)

### 5. Overrides Application: Reuse Existing `compose/overrides/`

**Decision**: Reuse `compose/overrides/apply.ts` + `compose/overrides/override-yaml.ts`.

**Rationale**:
- Already implements custom path-based override format (not JSON Pointer/Patch)
- Already handles global → local precedence with provenance
- Already validates override targets exist in merged spec (AC-12)

### 6. Multiple Gateway Apps Selection

**Decision**: MVP supports one gateway app per project.
- Default: first `builder: yandex-api-gateway` in `apps.yaml` (error if multiple)
- `--app <appId>` flag: explicit selection
- Future: multiple gateways = multiple project dirs or repeated runs

**Rationale**:
- Simplifies MVP scope (spec 010 Out of Scope: "Multiple gateway support в одной команде — MVP: один yandex-api-gateway app на проект")
- Explicit `--app` avoids ambiguity
- Fail-fast on ambiguity aligns with constitution V (explicit over magic)

### 7. ENV-only Mode in `check`

**Decision**: If `.ycsf/env.yaml` exists with `mode: env-only`, skip OpenAPI file existence check (Check 1). All other checks run.

**Rationale**:
- Builder generates OpenAPI in safe mode (`SERVERLESS_TOOLS_OPENAPI_BUILD=1`)
- `check` should validate contracts even before build
- Consistent with spec 018 (ENV-only mode)

### 8. Output Format: Always Yandex API Gateway Extensions

**Decision**: Always include `x-yc-*` extensions. No plain OpenAPI option.

**Rationale**:
- Primary consumer is Yandex API Gateway (Terraform provider expects these)
- Spec says "Yandex API Gateway compatible" — extensions are required for integrations
- Simplifies CLI (no flag needed)

### 9. Scheme Mapping: Explicit via `x-yc-auth-scheme`

**Decision**: `@RequireAuth` decorator (NestJS, Project A) adds `x-yc-auth-scheme: <schemeName>` to operation extensions. `auth.yaml` scheme names must match exactly.

**Rationale**:
- Explicit mapping — no inference, no defaults (constitution V)
- Decouples NestJS decorator from auth.yaml structure
- Allows multiple schemes per project, selected per-operation

### 10. Overrides Syntax: Custom Path-Based Format

**Decision**: Per spec 014 — custom format:
```yaml
overrides:
  - path: "/users"
    method: "get"           # optional; if absent, applies to all methods
    patch:
      summary: "List users"
      x-yc-apigateway-integration:
        type: "dummy"
```

Applied in order: global `openapi/overrides.yaml` → per-app `<app>/overrides.yaml`. Provenance tracked per route for local > global precedence.

### 11. Deterministic Output

**Decision**: Sort all object keys in merged OpenAPI (paths, components.schemas, components.securitySchemes, etc.) using `Object.keys().sort()`.

**Rationale**: Requirement: "Determinism: одинаковые inputs → бинарно идентичный OpenAPI output"

### 12. Error Diagnostics Format

**Decision**: Structured errors with:
- `code`: machine-readable (e.g., `DUPLICATE_OPERATION_ID`, `UNRESOLVED_RESOURCE_REF`)
- `message`: human-readable
- `source`: file path
- `line`/`column`: where applicable (YAML parse errors)
- `apps`: affected app IDs
- `routes`: affected path/method/operationId

Used by both `compile` (stderr) and `check` (summary + `--json`).

## Dependencies to Add

```json
{
  "commander": "^12.0.0",
  "@types/commander": "^2.12.0"  // if needed for types
}
```

Note: `commander` v12+ has built-in types, no separate `@types` needed.

## Performance Considerations

- Lazy-load OpenAPI sources only when needed
- Resource index built once, reused for all interpolations
- Parallel loading of app OpenAPI sources (Promise.all)
- `check` mode: skip OpenAPI file reads in ENV-only; only validate structure from `build_config.yaml` paths