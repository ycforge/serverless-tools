# Data Model: Resource References (spec 009)

## Entities

### ResourceReference (from @ycforge/pilot/contracts, spec 002)
```ts
interface ResourceReference {
  ref: string;  // canonical form: "domain.name.property"
}
```
- Immutable value object
- Parsed via `parseResourceReference(ref: string): ParsedResourceReference`
- Serialized via `formatResourceReference(parsed: ParsedResourceReference): string`
- Round-trip guarantee: `format(parse(x)) === x`

### ParsedResourceReference (from @ycforge/pilot/contracts)
```ts
interface ParsedResourceReference {
  domain: string;    // [a-z][a-z0-9_]*
  name: string;      // [a-z][a-z0-9_]*
  property: string;  // [a-z][a-z0-9_]*
}
```

### ResourceDomain (Internal Enum/Const)
```ts
type ResourceDomain = 'functions' | 'queues' | 'buckets' | 'containers' | 'gateways';

const DOMAIN_PROPERTIES: ReadonlyMap<ResourceDomain, ReadonlySet<string>> = new Map([
  ['functions', new Set(['id'])],
  ['queues', new Set(['qurl'])],
  ['buckets', new Set(['name'])],
  ['containers', new Set(['id'])],
  ['gateways', new Set(['id'])],
]);
```
- Fixed per contract 009 (R1, Q1 resolution)
- 019 extends additively

### ResourceIndex (Internal Build-Time Structure)
```ts
interface ResourceIndex {
  // domain → name → declared properties (empty set = all domain properties)
  readonly entries: ReadonlyMap<ResourceDomain, ReadonlyMap<string, ReadonlySet<string>>>;
  
  // Lookup helpers
  has(domain: ResourceDomain, name: string): boolean;
  getProperties(domain: ResourceDomain, name: string): ReadonlySet<string> | undefined;
  validateProperty(domain: ResourceDomain, name: string, property: string): boolean;
}
```
- Built once at composition initialization from validated `resources.yaml`
- Immutable after construction
- Empty index if `resources.yaml` absent

### EnvMapping (Internal Build-Time Structure)
```ts
interface EnvMapping {
  // domain → name → property → env var name
  readonly entries: ReadonlyMap<ResourceDomain, ReadonlyMap<string, ReadonlyMap<string, string>>>;
  
  getEnvVar(domain: ResourceDomain, name: string, property: string): string | undefined;
  hasEntry(domain: ResourceDomain, name: string, property: string): boolean;
}
```
- Built from validated `env.yaml` (optional)
- Empty if `env.yaml` absent or no entries

### ReferenceResolutionResult
```ts
type ReferenceResolutionResult = 
  | { kind: 'template'; template: string }           // ${resources...} preserved
  | { kind: 'resolved'; value: string }               // actual value from process.env
  | { kind: 'error'; code: ResourceRefErrorCode; message: string; context: Record<string, string> };
```
- Returned per reference-bearing field during ENV resolution pass
- `template` form used for Terraform path (materializer 019 translates)
- `resolved` form used for ENV-only fully materialized artifact

---

## Validation Rules: FR → Invalid State → Error Code

| FR | Invalid State | Error Code | Context Fields |
|----|---------------|------------|----------------|
| FR-001 | resources.yaml not valid YAML map | `RESOURCE_REF_INVALID_YAML` | `filePath` |
| FR-002 | version ≠ 1 | `RESOURCE_REF_VERSION_UNSUPPORTED` | `filePath`, `version` |
| FR-003 | Duplicate `domain.name` in resources.yaml | `RESOURCE_REF_IDENTITY_COLLISION` | `domain`, `name` |
| FR-004 | Unknown domain in resources.yaml | `RESOURCE_REF_DOMAIN_UNKNOWN` | `domain`, `filePath` |
| FR-004 | Invalid property for domain in resources.yaml | `RESOURCE_REF_PROPERTY_INVALID` | `domain`, `name`, `property`, `allowedProperties` |
| FR-005 | Malformed `${resources...}` string | `RESOURCE_REF_SYNTAX_INVALID` | `input`, `reason` (from 002 parser) |
| FR-006 | Reference domain not in index | `RESOURCE_REF_DOMAIN_UNKNOWN` | `domain`, `reference` |
| FR-006 | Reference name not in index | `RESOURCE_REF_NOT_DECLARED` | `domain`, `name`, `reference` |
| FR-006 | Reference property not allowed for domain | `RESOURCE_REF_PROPERTY_INVALID` | `domain`, `name`, `property`, `reference` |
| FR-008 | Template reference to undeclared resource | `RESOURCE_REF_NOT_DECLARED` | `domain`, `name`, `reference` |
| FR-009 | env.yaml declares env: VAR but process.env[VAR] unset/empty | `RESOURCE_REF_ENV_NOT_SET` | `envVar`, `reference` |
| FR-011 | (same as FR-009) | `RESOURCE_REF_ENV_NOT_SET` | `envVar`, `reference` |
| FR-012 | env.yaml references domain/name/property not in resources.yaml index | `RESOURCE_REF_ENV_UNDECLARED_RESOURCE` | `domain`, `name`, `property` |
| FR-019 | (N/A — targeted resolution only applies to known fields) | — | — |
| FR-020 | env.yaml contains `default:` field | `RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED` | `domain`, `name`, `property` |
| — | apps.yaml vs resources.yaml collision | `RESOURCE_REF_COLLISION_APPS_RESOURCES` | `domain`, `name` (seam 009→011, not enforced by B) |

---

## State Transitions

```
┌─────────────────────┐
│  Composition Start  │
└─────────┬───────────┘
          ▼
┌─────────────────────┐     fail-fast on error
│  Read resources.yaml │──────────────────► Error (FR-001/002)
│  (optional file)     │
└─────────┬───────────┘
          ▼
┌─────────────────────┐     fail-fast on error
│  Validate Domains   │──────────────────► Error (FR-004)
│  (fixed 5 domains)  │
└─────────┬───────────┘
          ▼
┌─────────────────────┐     fail-fast on error
│  Validate Properties │──────────────────► Error (FR-003/004)
│  per Domain Map     │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Build ResourceIndex │
└─────────┬───────────┘
          ▼
┌─────────────────────┐     (optional, no error if absent)
│  Read env.yaml      │──────────────────► Empty EnvMapping
│  (optional file)    │
└─────────┬───────────┘
          ▼
┌─────────────────────┐     fail-fast on error
│  Validate env.yaml  │──────────────────► Error (FR-012/020)
│  structure & refs   │
└─────────┬───────────┘
          ▼
┌─────────────────────┐     fail-fast on error
│  Compose Pipeline   │──────────────────► Error (FR-005/006/008)
│  (008 + 009 retarget)│
│  - Emit templates   │
│  - Validate refs    │
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  ENV Resolution     │     fail-fast on error
│  (targeted fields)  │──────────────────► Error (FR-009/011)
│  - Substitute or    │
│    preserve template│
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Final Artifact     │
│  (GatewayDocument)  │
└─────────────────────┘
```

**Key Invariants**:
1. ResourceIndex built once, immutable, before any reference validation
2. env.yaml validated against ResourceIndex (FR-012) before resolution
3. Reference validation (FR-006) happens during compose, against ResourceIndex
4. ENV resolution (FR-009) happens AFTER compose, ONLY on contracted fields
5. Determinism: same inputs → byte-identical output (FR-018)