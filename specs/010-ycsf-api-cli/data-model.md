# Data Model: ycsf-api CLI

## Entities

### GatewayApp
Represents a single application with `builder: yandex-api-gateway` from `.ycsf/apps.yaml`.

```typescript
interface GatewayApp {
  id: string;                    // app ID from apps.yaml (e.g., "user_service")
  name: string;                  // display name
  builder: "yandex-api-gateway"; // constant
  openapiEntry: string;          // relative path from project root (from build_config.yaml)
  authPath?: string;             // relative path to auth.yaml (default: "<app>/auth.yaml")
  overridesPath?: string;        // relative path to overrides.yaml (default: "<app>/overrides.yaml")
  provenance: Provenance;        // tracking for conflict detection
}

interface Provenance {
  sourceApp: string;             // app ID this route/component came from
  sourceFile: string;            // original OpenAPI file path
}
```

### AuthScheme
Authentication scheme from `auth.yaml` (spec 007).

```typescript
type AuthSchemeType = "none" | "jwt" | "function";

interface AuthScheme {
  name: string;                          // unique within project (e.g., "default", "internal")
  type: AuthSchemeType;
  config: JwtConfig | FunctionConfig | NoneConfig;
}

interface NoneConfig {
  type: "none";
}

interface JwtConfig {
  type: "jwt";
  issuer: string;                        // required
  audience: string[];                    // required, non-empty
  jwksUri: string;                       // required
}

interface FunctionConfig {
  type: "function";
  function: string;                      // IDL reference, e.g., "functions.internal_authorizer"
}
```

### AuthConfig (auth.yaml root)
```typescript
interface AuthConfig {
  version: 1;
  defaultScheme: string;                 // must exist in schemes
  schemes: Record<string, AuthScheme>;
}
```

### ResourceRef
A `${resources.<domain>.<name>.<prop>}` reference found in OpenAPI sources, overrides, or auth.yaml.

```typescript
interface ResourceRef {
  domain: string;                        // e.g., "functions", "containers", "queues", "buckets", "gateways"
  name: string;                          // resource name
  property: string;                      // property to resolve (e.g., "id", "url", "arn")
  location: ResourceRefLocation;         // where this ref was found
  resolvedValue?: string;                // after resolution (undefined if unresolved)
  isPlaceholder: boolean;                // true in ENV-only mode when value not available
}

interface ResourceRefLocation {
  file: string;                          // source file path
  path?: string;                         // OpenAPI path (if in paths)
  method?: string;                       // HTTP method (if in paths)
  operationId?: string;                  // operationId (if in paths)
  component?: string;                    // component name (if in components)
  overrideEntry?: OverrideEntry;         // if in overrides
}
```

### ResourceIndex
Built from `.ycsf/resources.yaml` + app-generated artifacts.

```typescript
interface ResourceIndex {
  functions: Record<string, FunctionResource>;
  containers: Record<string, ContainerResource>;
  queues: Record<string, QueueResource>;
  buckets: Record<string, BucketResource>;
  gateways: Record<string, GatewayResource>;
  // ... other domains per spec 009
}

interface FunctionResource {
  id: string;
  name: string;
  // ... other properties
}
```

### OverrideEntry
Single override rule from global or per-app `overrides.yaml`.

```typescript
interface OverrideEntry {
  path: string;                          // OpenAPI path pattern (e.g., "/users", "/users/{id}")
  method?: string;                       // HTTP method (get, post, etc.); undefined = all methods
  patch: Record<string, unknown>;        // Deep-merged into target operation/path item
  source: "global" | `app:${string}`;    // provenance for precedence
  provenance: Provenance;
}
```

### CompiledOpenAPI
Result of `ycsf-api compile` — unified OpenAPI 3.1 document with Yandex extensions.

```typescript
interface CompiledOpenAPI extends OpenAPI31Document {
  // Standard OpenAPI 3.1 fields
  openapi: "3.1.0";
  info: InfoObject;
  paths: PathsObject;                    // merged, with provenance metadata
  components?: ComponentsObject;         // merged, with provenance metadata
  security?: SecurityRequirementObject[];
  
  // Yandex API Gateway extensions (x-yc-*)
  "x-yc-apigateway"?: YcApiGatewayConfig;
  
  // Internal metadata (not serialized to output)
  _provenance?: ProvenanceMap;           // path/method/operationId → Provenance
  _resourceRefs?: ResourceRef[];         // all refs found (for check command)
}

interface YcApiGatewayConfig {
  integrations: YcIntegration[];
  // ... other gateway-specific config
}

interface ProvenanceMap {
  [path: string]: {
    [method: string]: Provenance;
  };
}
```

### CheckResult
Result of `ycsf-api check` — validation outcome per check.

```typescript
interface CheckResult {
  check: CheckName;
  passed: boolean;
  details?: string;                      // human-readable details on failure
  errors?: CheckError[];                 // structured errors for --json
}

type CheckName = 
  | "openapi-sources-exist"
  | "auth-schemes-valid"
  | "no-path-operationid-conflicts"
  | "resource-refs-resolvable"
  | "overrides-targets-exist";

interface CheckError {
  code: string;                          // e.g., "DUPLICATE_OPERATION_ID"
  message: string;
  source?: string;                       // file path
  line?: number;
  column?: number;
  apps?: string[];                       // affected app IDs
  routes?: RouteRef[];                   // affected routes
}

interface RouteRef {
  path: string;
  method: string;
  operationId?: string;
}
```

### CheckSummary
Aggregated output for `check` command.

```typescript
interface CheckSummary {
  projectDir: string;
  timestamp: string;                     // ISO 8601
  results: CheckResult[];
  passed: number;
  failed: number;
  total: number;
  exitCode: 0 | 1 | 2;                   // 0=all pass, 1=validation failures, 2=input/config error
}
```

### CLI Options (Compile)

```typescript
interface CompileOptions {
  projectDir: string;                    // --project-dir, default: process.cwd()
  output?: string;                       // --output, default: stdout
  app?: string;                          // --app <appId>, select specific gateway app
  envOnly?: boolean;                     // --env-only, treat as ENV-only mode
  json?: boolean;                        // --json, output JSON (for machine parsing, not OpenAPI)
}
```

### CLI Options (Check)

```typescript
interface CheckOptions {
  projectDir: string;                    // --project-dir, default: process.cwd()
  app?: string;                          // --app <appId>
  envOnly?: boolean;                     // --env-only
  json?: boolean;                        // --json, machine-readable output
}
```

## Relationships

```
GatewayApp (1) ─────► AuthConfig (1)
       │
       ├─► OpenAPI Source (1) ───► Paths/Components
       │
       ├─► OverrideEntry[] (0..n)
       │
       └─► ResourceRef[] (0..n) ───► ResourceIndex
```

## State Transitions

### Compile Flow
```
Load apps.yaml
  → Filter gateway apps
  → Select app (--app or first)
  → Load OpenAPI source
  → Load auth.yaml
  → Load overrides (global + app)
  → Build ResourceIndex
  → Merge OpenAPI (with provenance)
  → Apply auth (securitySchemes + security)
  → Apply overrides (global → local)
  → Interpolate resources
  → Validate conflicts (fail-fast)
  → Sort keys (determinism)
  → Output
```

### Check Flow
```
Load apps.yaml
  → Filter gateway apps
  → Select app (--app or first)
  → Load build_config.yaml (openapi_entry paths)
  → Load auth.yaml
  → Load overrides (global + app)
  → Build ResourceIndex
  → Run checks 1-5 (parallel where possible)
  → Aggregate results
  → Output summary / JSON
  → Exit with code
```

## Validation Rules

| Entity | Rules |
|--------|-------|
| GatewayApp | Must have `builder: yandex-api-gateway`; `openapiEntry` required |
| AuthScheme | `type` must be `none`/`jwt`/`function`; required fields per type |
| AuthConfig | `defaultScheme` must exist in `schemes` |
| ResourceRef | Must resolve to ResourceIndex entry (or placeholder in ENV-only) |
| OverrideEntry | `path` must exist in merged spec before overrides applied |
| CompiledOpenAPI | No duplicate `operationId`; no overlapping `path` + same method |