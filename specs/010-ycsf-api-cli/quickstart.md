# Quickstart: ycsf-api CLI Validation Guide

## Prerequisites

- Node.js 22+
- Project with `@ycforge/composer` installed (or run from monorepo root)
- `.ycsf/apps.yaml` with at least one `builder: yandex-api-gateway` app
- OpenAPI sources generated (or `env.yaml` with `mode: env-only` for pre-build validation)

## Installation

```bash
# From monorepo root (development)
pnpm --filter @ycforge/composer build
pnpm exec ycsf-api --help

# Or from published package
npx @ycforge/composer ycsf-api --help
```

## Validation Scenarios

### Scenario 1: Successful Compile (Single Gateway App)

**Setup**: Project with one gateway app (`user_service`)

```yaml
# .ycsf/apps.yaml
version: 1
apps:
  - id: user_service
    name: User Service
    builder: yandex-api-gateway
    path: ./apps/user_service
```

```yaml
# apps/user_service/build_config.yaml
openapi_entry: ./build/openapi.yaml
```

```yaml
# apps/user_service/auth.yaml
version: 1
defaultScheme: jwt
schemes:
  jwt:
    type: jwt
    issuer: "https://auth.example.com"
    audience: ["api.example.com"]
    jwksUri: "https://auth.example.com/.well-known/jwks.json"
```

**Run**:
```bash
ycsf-api compile --project-dir .
```

**Expected**:
- Exit code: 0
- Stdout: Valid OpenAPI 3.1 document with:
  - Merged paths from user_service
  - `components.securitySchemes.jwt` with JWT config
  - `security: [{ jwt: [] }]` on operations with `x-yc-auth-scheme: jwt`
  - `x-yc-apigateway` extensions

### Scenario 2: Compile with Overrides

Overrides use the `version: 1` + `rules[]` format defined by spec 014
(`op` is `replace`/`add`/`remove`, `target` selects a path/operation/operationId/
component/info; `replace` swaps the whole target, `add` inserts a new target).

**Additional Setup**:
```yaml
# openapi/overrides.yaml (global)
version: 1
rules:
  - op: replace
    target:
      kind: operation
      path: /users
      method: get
    value:
      summary: "List all users"
      operationId: listUsers
      x-yc-apigateway-integration:
        type: "dummy"
        statusCode: 200
```

```yaml
# apps/user_service/overrides.yaml (per-app)
version: 1
rules:
  - op: replace
    target:
      kind: operation
      path: /users/{id}
      method: get
    value:
      summary: "Get user by id"
      operationId: getUser
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
```

**Run**:
```bash
ycsf-api compile --project-dir . --output compiled.yaml
```

**Expected**:
- Exit code: 0
- `compiled.yaml` contains both global and per-app overrides applied
- Per-app overrides are applied after global ones; a matching target in a
  per-app file wins (same target → locally replaced value takes effect)

> Format note: earlier drafts of this document showed the `path`/`method`/`patch`
> shape. That shape is NOT supported: overrides.yaml follows spec 014
> (`rules[].op/target/value`), see `packages/composer/src/compose/overrides/override-yaml.ts`.

### Scenario 3: Compile with Resource Interpolation

**Additional Setup**:
```yaml
# .ycsf/resources.yaml
version: 1
functions:
  internal_authorizer:
    id: "fn-12345"
```

```yaml
# apps/user_service/auth.yaml (with function auth)
version: 1
defaultScheme: internal
schemes:
  internal:
    type: function
    function: "functions.internal_authorizer"
```

**Run**:
```bash
ycsf-api compile --project-dir .
```

**Expected**:
- Exit code: 0
- Output contains resolved function ID in `x-yc-apigateway-authorizer` extension

### Scenario 4: Check — All Pass

**Run**:
```bash
ycsf-api check --project-dir .
```

**Expected**:
- Exit code: 0
- Stdout:
  ```
  ✓ openapi-sources-exist: All OpenAPI sources exist
  ✓ auth-schemes-valid: All auth schemes valid
  ✓ no-path-operationid-conflicts: No conflicts found
  ✓ resource-refs-resolvable: 1/1 refs resolved
  ✓ overrides-targets-exist: 2/2 override targets exist

  All 5 checks passed.
  ```

### Scenario 5: Check — Duplicate OperationId Conflict (within an app)

**Setup**: A single gateway app whose OpenAPI defines the same `operationId`
more than once (e.g. `paths./users.get` and `paths./users/get-all` both have
`operationId: "getUsers"`).

**Run**:
```bash
ycsf-api check --project-dir .
```

**Expected**:
- Exit code: 1
- Stdout:
  ```
  ✓ openapi-sources-exist: All OpenAPI sources exist
  ✓ auth-schemes-valid: All auth schemes valid
  ✗ no-path-operationid-conflicts
    DUPLICATE_OPERATION_ID: Duplicate operationId "getUsers"
    Route: get /users (getUsers)
    Route: get /users/all (getUsers)
  ✓ resource-refs-resolvable: 0/0 refs resolved
  ✗ overrides-targets-exist: 0/0 override targets exist
    OVERRIDES_CHECK_ERROR: Failed to check overrides: operationId getUsers is declared by more than one operation (/users, /users/all)

  2 check(s) failed.
  ```

> `overrides-targets-exist` reports the same root cause as a secondary error
> because the operation-index built for `operationId` targets cannot resolve
> ambiguous identities (provenance fail-fast). Fix the duplicate first.

> Note: `no-path-operationid-conflicts` validates one app's merged source per
> run. CLI `compile` targets a single app (see Scenario 9); cross-app duplicate
> operationIds are rejected by the library merge (`mergeDocuments`, fail-fast
> per spec 008).

### Scenario 6: Check — Unresolved Resource Reference

**Setup**: OpenAPI contains `${resources.functions.unknown.id}`

**Run**:
```bash
ycsf-api check --project-dir .
```

**Expected**:
- Exit code: 1
- Stdout:
  ```
  ✓ openapi-sources-exist: All OpenAPI sources exist
  ✓ auth-schemes-valid: All auth schemes valid
  ✓ no-path-operationid-conflicts: No conflicts found
  ✗ resource-refs-resolvable: 0/1 refs resolved
    UNRESOLVED_RESOURCE_REF: resource "functions.unknown.id" is not declared in resources.yaml (reference: ${resources.functions.unknown.id})
    Source: paths./users.get.security[0].x-yc-function-ref
  ✓ overrides-targets-exist: 0/0 override targets exist
  
  1 check(s) failed.
  ```

### Scenario 7: Check — Override Target Missing

**Setup**: Override references non-existent path

```yaml
# apps/user_service/overrides.yaml
version: 1
rules:
  - op: replace
    target:
      kind: path
      path: /nonexistent
    value:
      summary: "This path doesn't exist"
```

**Run**:
```bash
ycsf-api check --project-dir .
```

**Expected**:
- Exit code: 1
- Stdout:
  ```
  ✓ openapi-sources-exist: All OpenAPI sources exist
  ✓ auth-schemes-valid: All auth schemes valid
  ✓ no-path-operationid-conflicts: No conflicts found
  ✓ resource-refs-resolvable: 0/0 refs resolved
  ✗ overrides-targets-exist: 0/1 override targets exist
    OVERRIDE_TARGET_MISSING: App override target not found: PATH /nonexistent
    Source: /path/to/project/apps/user_service/overrides.yaml
  
  1 check(s) failed.
  ```

### Scenario 8: Check — JSON Output

**Run**:
```bash
ycsf-api check --project-dir . --json
```

**Expected**:
- Exit code: 0 (or 1 if failures)
- Stdout: Valid JSON matching `contracts/check-output.json`
```json
{
  "projectDir": "/path/to/project",
  "timestamp": "2026-09-06T12:34:56.789Z",
  "results": [
    { "check": "openapi-sources-exist", "passed": true },
    { "check": "auth-schemes-valid", "passed": true },
    { "check": "no-path-operationid-conflicts", "passed": true },
    { "check": "resource-refs-resolvable", "passed": true },
    { "check": "overrides-targets-exist", "passed": true }
  ],
  "summary": { "passed": 5, "failed": 0, "total": 5 },
  "exitCode": 0
}
```

### Scenario 9: Multiple Gateway Apps — Explicit Selection

**Setup**: Two gateway apps in one project

```yaml
# .ycsf/apps.yaml
apps:
  - id: user_service
    builder: yandex-api-gateway
  - id: admin_service
    builder: yandex-api-gateway
```

**Run without --app** (should fail):
```bash
ycsf-api compile --project-dir .
# Error: Multiple gateway apps found: user_service, admin_service. Use --app <appId> to select one.
# Exit code: 2
```

**Run with --app** (should succeed):
```bash
ycsf-api compile --project-dir . --app user_service
# Success: compiles only user_service
```

### Scenario 10: ENV-only Mode

**Setup**: `.ycsf/env.yaml` with `mode: env-only`, OpenAPI files not yet generated

```yaml
# .ycsf/env.yaml
mode: env-only
```

**Run**:
```bash
ycsf-api check --project-dir . --env-only
# or (auto-detected from env.yaml)
ycsf-api check --project-dir .
```

**Expected**:
- Exit code: 0 (if other checks pass)
- `--env-only` (either explicit, or auto-detected when `.ycsf/env.yaml` has
  `mode: env-only`) switches the four source-dependent checks to an explicit
  "skipped" state; `auth-schemes-valid` still runs:
  ```
  ✓ openapi-sources-exist: Skipped (ENV-only mode)
  ✓ auth-schemes-valid: All auth schemes valid
  ✓ no-path-operationid-conflicts: Skipped (ENV-only mode)
  ✓ resource-refs-resolvable: Skipped (ENV-only mode)
  ✓ overrides-targets-exist: Skipped (ENV-only mode)

  All 5 checks passed.
  ```

## Exit Codes Reference

### Compile
| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Composition error (conflicts, unresolved refs, etc.) |
| 2 | Input/config error (missing files, invalid YAML, etc.) |
| 3 | I/O error (cannot read/write files) |

### Check
| Code | Meaning |
|------|---------|
| 0 | All checks passed |
| 1 | One or more validation checks failed |
| 2 | Input/config error (missing files, invalid YAML, etc.) |

## CI/CD Integration Example

```yaml
# .github/workflows/api-check.yml
name: API Contract Check
on: [pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @ycforge/composer build
      - run: pnpm exec ycsf-api check --project-dir . --json > check-results.json
      - name: Upload check results
        uses: actions/upload-artifact@v4
        with:
          name: api-check-results
          path: check-results.json
```