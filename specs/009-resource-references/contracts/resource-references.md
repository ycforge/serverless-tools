# Contract: `@ycforge/composer` — resource-references

**Version**: 1 — стабилен в рамках semver `@ycforge/composer` (major = breaking).

Контракт логических ссылок на внешние ресурсы: чтение/валидация `.ycsf/resources.yaml` и `.ycsf/env.yaml`, парсинг/валидация template-синтаксиса `${resources.<domain>.<name>.<property>}`, эмиссия template-формы в артефакты композиции, ENV-only резолв для выделенных reference-bearing полей.

---

## Публичный API

```ts
// Парсер канонической ссылки (re-export из @ycforge/pilot/contracts, spec 002)
function parseResourceReference(ref: string): ParsedResourceReference;

// Валидатор template-ссылки против индекса ресурсов
function validateResourceReference(
  ref: string,
  index: ResourceIndex
): { valid: true; parsed: ParsedResourceReference } | { valid: false; error: ResourceRefError };

// Движок резолва ссылок в артефакте композиции
function resolveReferences(
  document: GatewayDocument,
  envMapping: EnvMapping,
  knownRefFields: readonly ReferenceBearerField[]
): GatewayDocument;  // новый документ с разрешенными/сохраненными полями
```

### Types

```ts
// Каноническая разобранная ссылка (spec 002)
interface ParsedResourceReference {
  domain: string;    // [a-z][a-z0-9_]*
  name: string;      // [a-z][a-z0-9_]*
  property: string;  // [a-z][a-z0-9_]*
}

// Индекс внешних ресурсов (построен из resources.yaml)
interface ResourceIndex {
  readonly domains: ReadonlySet<ResourceDomain>;
  readonly resources: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>; // domain → name → properties
  
  has(domain: string, name: string): boolean;
  getProperties(domain: string, name: string): ReadonlySet<string> | undefined;
  isValidProperty(domain: string, property: string): boolean;
}

type ResourceDomain = 'functions' | 'queues' | 'buckets' | 'containers' | 'gateways';

// ENV mapping (построен из env.yaml)
interface EnvMapping {
  readonly entries: ReadonlyMap<string, ReadonlyMap<string, ReadonlyMap<string, string>>>; // domain → name → property → envVar
  
  getEnvVar(domain: string, name: string, property: string): string | undefined;
  hasEntry(domain: string, name: string, property: string): boolean;
}

// Поле-носитель логической ссылки (контрактный список 009)
interface ReferenceBearerField {
  readonly path: readonly (string | number)[];  // JSON-path к полю в GatewayDocument
  readonly domain: ResourceDomain;              // ожидаемый домен (для валидации)
  readonly property: string;                    // ожидаемое property (для валидации)
}

// В 009: единственное поле
const REFERENCE_BEARER_FIELDS: readonly ReferenceBearerField[] = [{
  path: ['components', 'securitySchemes', '*', 'x-yc-apigateway-authorizer', 'function_id'],
  domain: 'functions',
  property: 'id',
}];
```

---

## YAML Formats

### `.ycsf/resources.yaml` (version 1)

```yaml
version: 1
functions:
  legacy_authorizer: {}
  # name: {} — пустой объект = все валидные property домена доступны
queues:
  events: {}
buckets:
  frontend: {}
containers:
  worker: {}
gateways:
  main: {}
```

**Validation Rules**:
- `version: 1` mandatory (else `RESOURCE_REF_VERSION_UNSUPPORTED`)
- Top-level keys ⊆ `{functions, queues, buckets, containers, gateways}` (else `RESOURCE_REF_DOMAIN_UNKNOWN`)
- Each resource name unique per domain (else `RESOURCE_REF_IDENTITY_COLLISION`)
- Resource value must be object (empty or with explicit properties — future extensibility)
- If explicit properties listed, each must be in domain's allowed set (else `RESOURCE_REF_PROPERTY_INVALID`)

### `.ycsf/env.yaml` (version 1)

```yaml
version: 1
functions:
  legacy_authorizer:
    id:
      env: LEGACY_AUTHORIZER_ID
queues:
  events:
    qurl:
      env: EVENTS_QUEUE_URL
buckets:
  frontend:
    name:
      env: FRONTEND_BUCKET_NAME
```

**Validation Rules**:
- `version: 1` mandatory (else `RESOURCE_REF_VERSION_UNSUPPORTED`)
- Structure mirrors `resources.yaml` domains/names/properties
- Each leaf must have `env: <VAR_NAME>` (string, non-empty)
- `default:` field → `RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED` (fail-fast)
- Every `domain.name.property` MUST exist in `resources.yaml` index (else `RESOURCE_REF_ENV_UNDECLARED_RESOURCE`)
- Unused entries allowed (no error)

---

## Error Taxonomy: `ResourceRefError`

```ts
class ResourceRefError extends Error {
  readonly code: ResourceRefErrorCode;
  readonly context: Readonly<Record<string, string>>;
  
  constructor(code: ResourceRefErrorCode, message: string, context: Record<string, string>);
}

type ResourceRefErrorCode =
  | 'RESOURCE_REF_VERSION_UNSUPPORTED'
  | 'RESOURCE_REF_INVALID_YAML'
  | 'RESOURCE_REF_DOMAIN_UNKNOWN'
  | 'RESOURCE_REF_PROPERTY_INVALID'
  | 'RESOURCE_REF_IDENTITY_COLLISION'
  | 'RESOURCE_REF_NOT_DECLARED'
  | 'RESOURCE_REF_SYNTAX_INVALID'
  | 'RESOURCE_REF_ENV_NOT_SET'
  | 'RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED'
  | 'RESOURCE_REF_ENV_UNDECLARED_RESOURCE'
  | 'RESOURCE_REF_COLLISION_APPS_RESOURCES';  // seam 009→011, documented only
```

**Error Message Format**: English, deterministic, includes only context fields (no user document content).

Examples:
- `RESOURCE_REF_DOMAIN_UNKNOWN`: `"Unknown resource domain: databases. Allowed: functions, queues, buckets, containers, gateways"` + `{domain: "databases"}`
- `RESOURCE_REF_ENV_NOT_SET`: `"Environment variable LEGACY_AUTHORIZER_ID not set for reference ${resources.functions.legacy_authorizer.id}"` + `{envVar: "LEGACY_AUTHORIZER_ID", reference: "${resources.functions.legacy_authorizer.id}"}`

---

## Seams

### 008 → 009: Authorizer Retarget
- **008 emits**: `function_id: "functions.<name>"` (bare IDL, per 008 FR-013)
- **009 transforms**: → `${resources.functions.<name>.id}` (template syntax)
- **Validation**: `<name>` must exist in `resources.yaml` under `functions` domain
- **Error**: `RESOURCE_REF_NOT_DECLARED` if missing
- **Additive**: Contract 008 v1 unchanged; field semantics preserved (logical ref, not IDR)

### 009 → 011: Project Model (app-vs-resource collision)
- **Seam**: `RESOURCE_REF_COLLISION_APPS_RESOURCES` error code defined but NOT thrown by B
- **Owner**: spec 011 (`ycsf check` / Project C)
- **Reason**: B does not read `apps.yaml` (Constitution I)
- **Documentation**: Explicit in spec 009 Edge Cases / Assumptions

### 009 → 019: Materializer Translation
- **Input**: Artifact with `${resources.<domain>.<name>.<property>}` in reference-bearing fields
- **019 responsibility**: Translate to Terraform `data` source expressions (`$${yandex_function.<name>.id}`)
- **009 guarantee**: No Terraform syntax, no real IDR, only logical template syntax
- **Extension**: 019 adds new reference-bearing fields to contract list (integrations)

### 009 → 014: Materializer Dispatch
- **Seam**: Artifact type `ycforge:api-gateway` carries template references
- **014 responsibility**: Route to correct materializer (yandex)
- **009 guarantee**: Template syntax stable, parseable by 002 `parseResourceReference`

---

## Contract Versioning

- `resources.yaml` / `env.yaml` → `version: 1` (Constitution III)
- Public API (`parseResourceReference`, `validateResourceReference`, `resolveReferences`) — semver with `@ycforge/composer`
- Breaking change = major version + migration guide
- Additive changes (new domain, new property, new reference-bearing field) = minor
- Error codes: new codes added non-breaking (namespace `RESOURCE_REF_`)

---

## Determinism Guarantee

- `resolveReferences` is pure function: same `(document, envMapping, knownRefFields)` → byte-identical output
- ResourceIndex and EnvMapping built once, immutable
- Field order in output matches input (stable JSON serialization)
- No dependence on iteration order of Maps/Sets (use sorted keys)