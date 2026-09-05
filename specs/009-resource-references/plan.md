# Implementation Plan: Resource References (spec 009)

## Source Layout

```
packages/composer/
├── src/
│   ├── resource/
│   │   ├── index.ts                    # Public API barrel
│   │   ├── resource-index.ts           # ResourceIndex + loadResourceIndex()
│   │   ├── env-mapping.ts              # EnvMapping + loadEnvMapping()
│   │   ├── reference-resolver.ts       # validateResourceReference(), resolveReferences()
│   │   ├── errors.ts                   # ResourceRefError, error codes
│   │   ├── types.ts                    # ResourceDomain, DOMAIN_PROPERTIES, ReferenceBearerField
│   │   └── refs/
│   │       ├── parser.ts               # parseResourceReference (re-export 002)
│   │       └── template.ts             # Template syntax constants, regex
│   ├── compose/
│   │   ├── compose.ts                  # Modified: integrate resource index + retarget
│   │   └── authorizer.ts               # Modified: emit ${resources...} instead of bare IDL
│   └── index.ts                        # Updated exports
├── test/
│   ├── fixtures/
│   │   ├── resource-valid/
│   │   ├── resource-bad-version/
│   │   ├── resource-duplicate-identity/
│   │   ├── resource-unknown-domain/
│   │   ├── resource-invalid-property/
│   │   ├── resource-malformed-yaml/
│   │   ├── resource-env/
│   │   ├── resource-no-env/
│   │   └── resource-collision/
│   ├── resource-index.test.ts
│   ├── env-mapping.test.ts
│   ├── reference-resolver.test.ts
│   ├── compose-integration.test.ts
│   └── resource-references.test.ts     # Quickstart scenarios
└── package.json
```

---

## Integration with Compose Pipeline

### Modified Files

**`packages/composer/src/compose/compose.ts`**
```ts
// New imports
import { loadResourceIndex, loadEnvMapping, resolveReferences, REFERENCE_BEARER_FIELDS } from '../resource';

// In compose(request):
// 1. Load resource index from <compositionRoot>/.ycsf/resources.yaml (or project root)
// 2. Load env mapping from <compositionRoot>/.ycsf/env.yaml (optional)
// 3. Validate all function authorizer references against index (FR-006/008)
// 4. Emit template syntax ${resources.functions.<name>.id} (FR-007/013)
// 5. After compose, run resolveReferences on result.document
```

**`packages/composer/src/compose/authorizer.ts`**
```ts
// FR-013 retarget: change emission from
// function_id: `functions.${name}`
// to
// function_id: `\${resources.functions.${name}.id}`

// Validate `name` exists in resourceIndex under 'functions' domain
// Throw ResourceRefError(RESOURCE_REF_NOT_DECLARED) if not
```

### Data Flow

```
ComposeRequest
    │
    ▼
loadResourceIndex(compositionRoot/.ycsf/resources.yaml) ──► ResourceIndex
    │
    ▼
loadEnvMapping(compositionRoot/.ycsf/env.yaml, ResourceIndex) ──► EnvMapping
    │
    ▼
compose() ──► GatewayDocument (with ${resources...} templates)
    │
    ▼
resolveReferences(document, EnvMapping, REFERENCE_BEARER_FIELDS) ──► Final GatewayDocument
    │
    ▼
ComposeResult { document, provenance }
```

---

## Test Strategy

### Unit Tests (per module)

| Module | Tests |
|--------|-------|
| `resource-index.ts` | load valid, each FR-001..004 error, empty file, missing file |
| `env-mapping.ts` | load valid, missing file, FR-012 (env ref unknown resource), FR-020 (default:), unused entries |
| `reference-resolver.ts` | parse valid, validate against index (all FR-005/006 cases), resolveReferences template→resolved/preserved |
| `authorizer.ts` | retarget emission, validation against index, error on undeclared |

### Integration Tests

| Scenario | File | Validates |
|----------|------|-----------|
| US1 canonical | `resource-references.test.ts` | SC-002 |
| US2 each error | `resource-references.test.ts` | SC-002, SC-003 |
| US3 ENV resolved | `compose-integration.test.ts` | SC-004, SC-005 |
| US4 template preserved | `compose-integration.test.ts` | SC-005 |
| US5 seam | `resource-references.test.ts` | SC-006 |
| Other interpolation spaces | `compose-integration.test.ts` | SC-006 |
| Determinism (repeat, reorder) | `compose-integration.test.ts` | SC-004, FR-018 |

### Test-First (Constitution II)
- All acceptance criteria → tests written FIRST (RED)
- Run `pnpm test` → confirm failures
- Implement → GREEN
- No implementation without failing test

---

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Separation A/B/C/Terraform** | ✅ PASS | B only handles logical refs (IDL). No Terraform logic, no IDR, no provider schema. 019/014 own materialization. |
| **II. Spec-First, Test-First** | ✅ PASS | This plan follows spec 009. Tests defined in quickstart.md before implementation. |
| **III. Contract Versioning** | ✅ PASS | `resources.yaml`/`env.yaml` v1. Public API semver with `@ycforge/composer`. Additive changes only. Error codes namespaced. |
| **IV. Terraform Stays Terraform** | ✅ PASS | B emits `${resources...}` logical templates only. No `$${...}`, no data sources, no IDR. 019 translates. |
| **V. Explicit Over Magic** | ✅ PASS | Fail-fast on all collisions/unknown. No defaults in env.yaml. Targeted resolution only. No silent merges. |
| **VI. Ownership: Apps vs Resources** | ✅ PASS | B reads only `resources.yaml` (external). `apps.yaml` collision seam documented → 011. B never generates Terraform for resources. |

**Overall**: PASS — no violations. All design decisions align with Constitution I–VI.

---

## Open Decisions for Tasks Phase

1. **Project root resolution**: How composer receives path to `.ycsf/` (via `compositionRoot`? separate `projectRoot`? CLI context?) — resolve in tasks with 011 alignment.
2. **ReferenceBearerField path syntax**: JSON-path array vs string path — decide in tasks, use consistent with 008 override targeting.
3. **Error message language**: English (per 002 contract) — confirm in tasks.
4. **Performance**: Index building is O(resources) — negligible for MVP. No caching needed.

---

## Dependencies

- **spec 002**: `@ycforge/pilot/contracts` — `parseResourceReference`, `ParsedResourceReference`, `ContractError`, `Diagnostics.InvalidResourceReference` (already ✅)
- **spec 008**: `@ycforge/composer` compose pipeline — authorizer emission point (already ✅, will modify)
- **spec 011**: Project model — collision detection seam (future, not blocking)

---

## Rollback Plan

If issues arise:
1. Revert `authorizer.ts` to emit bare `functions.<name>` (008 behavior)
2. Disable `resolveReferences` call in `compose.ts`
3. Keep `resource/` module for future re-enable
4. No schema migrations needed (resources.yaml/env.yaml new files)