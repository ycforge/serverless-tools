# Research: Resource References (spec 009)

## R1: Domain + Property Map (Fixed Set)

**Decision**: Fixed set of 5 domains with explicit property maps per contract 009 (per Q1 resolution):
- `functions` → `{id}`
- `queues` → `{qurl}`
- `buckets` → `{name}`
- `containers` → `{id}`
- `gateways` → `{id}`

**Rationale**: 
- Constitution V (fail-fast over magic) requires deterministic validation at compose time
- Registry-driven approach (variant B) would defer typo detection to materializers (019), weakening fail-fast
- 019 can extend additively later (per spec assumptions)
- Matches §15/§17 canonical examples exactly

**Alternatives Considered**:
- Variant B (registry-driven): Rejected — moves validation to 019, violates Constitution V
- Extensible via `.ycsf/extensions.yaml`: Rejected — adds complexity, not needed for MVP

---

## R2: Reference Grammar & Validation

**Decision**: Grammar `${resources.<domain>.<name>.<property>}` with strict parsing via `parseResourceReference` from `@ycforge/pilot/contracts` (spec 002).

**Grammar Rules**:
- Prefix: `${resources.` (mandatory, per §19)
- Domain: `[a-z][a-z0-9_]*` (lowercase, underscore allowed)
- Name: `[a-z][a-z0-9_]*` (lowercase, underscore allowed)
- Property: `[a-z][a-z0-9_]*` (lowercase, underscore allowed)
- Suffix: `}` (closing brace)
- Full pattern: `^\$\{resources\.([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\}$`

**Validation**:
1. Syntax validation via `parseResourceReference` (throws `ContractError` with `Diagnostics.InvalidResourceReference` on malformed)
2. Domain validation against fixed 5-domain map (R1)
3. Property validation against domain's allowed properties
4. Identity (`domain.name`) existence in `resources.yaml` index

**Rationale**: 
- §19 mandates `${resources...}` prefix to separate from `${var.foo}` (APIGW) and Terraform `${...}`
- Contract 002 owns the canonical parser — B uses it, doesn't reimplement
- Hyphen rejected in segments (per 002 grammar) — fail-fast on malformed

---

## R3: resources.yaml Read & Validation

**Decision**: Read `.ycsf/resources.yaml` at composition initialization; build in-memory index `Map<domain, Map<name, Set<property>>>`.

**File Format (v1)**:
```yaml
version: 1
functions:
  legacy_authorizer: {}
queues:
  events: {}
buckets:
  frontend: {}
```

**Validation Pipeline** (fail-fast, deterministic):
1. File exists → parse YAML (fail on non-map, malformed YAML)
2. `version` === 1 (else `RESOURCE_VERSION_UNSUPPORTED`)
3. Top-level keys ⊆ fixed 5 domains (else `RESOURCE_DOMAIN_UNKNOWN`)
4. For each domain, each resource name unique (else `RESOURCE_IDENTITY_COLLISION`)
5. For each resource, declared properties ⊆ domain's allowed properties (else `RESOURCE_PROPERTY_INVALID`)
   - Note: Empty object `{}` means "all valid properties for this domain are available"
   - Explicit properties can be listed if needed for future extensibility

**Rationale**:
- Constitution V: collisions = error, never silent merge
- Constitution III: `version: 1` mandatory, unsupported version = fail-fast
- Empty `{}` per §17 examples — declares resource identity, all domain properties implicitly available

---

## R4: env.yaml Read & ENV Resolution

**Decision**: Read `.ycsf/env.yaml` (optional); per-field ENV resolution at compile time for declared reference-bearing fields only.

**File Format (v1)**:
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
```

**Resolution Rules** (per Q2/Q3 resolutions):
1. `env.yaml` absent → no ENV resolution, all refs stay as `${resources...}` templates
2. `env.yaml` present but no entry for a specific `domain.name.property` → template preserved (Terraform path)
3. Entry exists with `env: VAR_NAME`:
   - Read `process.env[VAR_NAME]` at compile time
   - If unset/empty → fail-fast `ENV_NOT_SET` with variable name and reference
   - If set → write ACTUAL VALUE (e.g., `d4e123...`) directly into artifact field
   - NO `${VAR}` string remains in artifact — fully materialized per §18
4. `default:` field → fail-fast `ENV_DEFAULT_UNSUPPORTED` (per Q2, FR-020)

**Rationale**:
- §18: "B может выпустить уже полностью materialized OpenAPI spec" — literal, no template strings
- Constitution V: explicit over magic — no defaults, fail-fast on missing env
- Per-field activation (Q3): only declared reference-bearing fields resolved (authorizer `function_id` in 009)

---

## R5: Targeted Resolution Engine

**Decision**: Resolution applies ONLY to explicitly listed reference-bearing fields in contract 009.

**In Scope (009)**:
- `components.securitySchemes.<scheme>.x-yc-apigateway-authorizer.function_id` (function authorizer scheme)

**Out of Scope (009)**:
- Any `${resources...}` in `description`, `summary`, `x-*` extensions, etc.
- Future integration fields (019 scope)

**Algorithm**:
1. Compose produces artifact with `${resources...}` templates in reference-bearing fields
2. If `env.yaml` loaded, walk ONLY the contracted field paths
3. For each field value matching `${resources.<domain>.<name>.<property>}`:
   - Check `env.yaml` for `domain.name.property.env`
   - If found → resolve per R4
   - If not found → leave template unchanged
4. Non-matching strings (other interpolation spaces) pass through untouched

**Rationale**:
- Constitution V: explicit over magic — no universal scanning
- Q3 resolution: targeted only, universal scanning deferred to 019
- Prevents accidental resolution in documentation strings

---

## R6: 008 Seam Retarget (Authorizer function_id)

**Decision**: Transform 008's `function_id: "functions.<name>"` → `${resources.functions.<name>.id}` in composer output.

**Transformation Point**: During authorizer scheme emission in compose pipeline (after 007 auth validation, before override application).

**Details**:
- 008 contract (FR-013) emits: `function_id: "functions.<name>"` (bare IDL)
- 009 intercepts: replaces with `${resources.functions.<name>.id}` (template syntax)
- Validation: `<name>` MUST exist in `resources.yaml` index under `functions` domain
- If not declared in `resources.yaml` → fail-fast `RESOURCE_NOT_DECLARED`
- Change is additive per Constitution III: same field, same semantic (logical ref), new syntax

**Rationale**:
- Spec 009 FR-013 explicitly mandates this retarget
- Enables 019 materializer to recognize and translate to Terraform `data` source
- Maintains "logical reference, not IDR" semantic (Constitution I/IV)

---

## R7: Contract Versioning & Additive Notes

**Decision**: 
- `resources.yaml` and `env.yaml` both carry `version: 1`
- Contract versioning follows Constitution III: breaking change = major + migration guide
- Additive extensions (new domains, new properties, new reference-bearing fields) = minor
- Error codes namespaced under `ResourceRefError` (see contracts doc)

**Additive Extension Paths**:
1. New domain (e.g., `databases{id}`) → 019 adds, 009 validates against updated map
2. New property for existing domain → additive, 009 validates against updated map
3. New reference-bearing field (e.g., integration `x-yc-apigateway-integration.uri`) → 019 adds to contract list, 009 resolves per-field
4. New interpolation namespace → separate spec, not 009

**Error Taxonomy** (prefixed `RESOURCE_REF_`):
- `RESOURCE_REF_VERSION_UNSUPPORTED` — version ≠ 1
- `RESOURCE_REF_DOMAIN_UNKNOWN` — domain not in fixed 5
- `RESOURCE_REF_PROPERTY_INVALID` — property not allowed for domain
- `RESOURCE_REF_IDENTITY_COLLISION` — duplicate `domain.name` in resources.yaml
- `RESOURCE_REF_NOT_DECLARED` — reference to resource not in index
- `RESOURCE_REF_SYNTAX_INVALID` — malformed `${resources...}` (from 002 parser)
- `RESOURCE_REF_ENV_NOT_SET` — declared env var unset/empty
- `RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED` — `default:` in env.yaml
- `RESOURCE_REF_ENV_UNDECLARED_RESOURCE` — env.yaml references unknown resource
- `RESOURCE_REF_COLLISION_APPS_RESOURCES` — documented seam 009→011 (not enforced by B)

**Rationale**: 
- Constitution III: explicit versioning, additive changes non-breaking
- Error codes enable programmatic handling by CLI (010) and C (011)
- Seam 009→011 documented but not enforced in B (Constitution I)