# Quickstart: Resource References Validation (spec 009)

> **Purpose**: Runnable scenarios proving US1–US5 work end-to-end.
> **Fixtures**: Under `packages/composer/test/fixtures/resource-*` (created during tasks phase).

---

## Prerequisites

- Node.js ≥ 20, pnpm ≥ 9
- Repo root: `pnpm install` (installs `@ycforge/composer` from workspace)
- Test runner: `pnpm --filter @ycforge/composer test`

---

## Scenario US1: Valid resources.yaml → Index Built

**Fixture**: `test/fixtures/resource-valid/resources.yaml`
```yaml
version: 1
functions:
  legacy_authorizer: {}
queues:
  events: {}
buckets:
  frontend: {}
containers:
  worker: {}
gateways:
  main: {}
```

**Test**:
```ts
import { loadResourceIndex } from '@ycforge/composer/resource';

const index = await loadResourceIndex('test/fixtures/resource-valid');
expect(index.has('functions', 'legacy_authorizer')).toBe(true);
expect(index.getProperties('functions', 'legacy_authorizer')).toEqual(new Set(['id']));
expect(index.has('queues', 'events')).toBe(true);
expect(index.isValidProperty('queues', 'qurl')).toBe(true);
// Input file byte-identical after read (no mutation)
```

**Expected**: Green. Index built, all 5 domains present, canonical properties validated.

---

## Scenario US2: Malformed resources.yaml → Fail-Fast

**Fixtures** (each tested independently):

| Fixture | Error Code | Key Context |
|---------|------------|-------------|
| `resource-bad-version/resources.yaml` (`version: 2`) | `RESOURCE_REF_VERSION_UNSUPPORTED` | `version: "2"` |
| `resource-duplicate-identity/resources.yaml` (two `functions.auth`) | `RESOURCE_REF_IDENTITY_COLLISION` | `domain: "functions", name: "auth"` |
| `resource-unknown-domain/resources.yaml` (`databases: {}`) | `RESOURCE_REF_DOMAIN_UNKNOWN` | `domain: "databases"` |
| `resource-invalid-property/resources.yaml` (`queues.events: {name: {}}`) | `RESOURCE_REF_PROPERTY_INVALID` | `property: "name", allowed: ["qurl"]` |
| `resource-malformed-yaml/resources.yaml` (invalid YAML) | `RESOURCE_REF_INVALID_YAML` | `filePath` |

**Test Pattern**:
```ts
await expect(loadResourceIndex(fixturePath)).rejects.toThrow(ResourceRefError);
expect(error.code).toBe(expectedCode);
expect(error.context).toMatchObject(expectedContext);
```

**Expected**: Each fails with correct error code and context. No silent merges.

---

## Scenario US3: ENV Resolution → Real Value in function_id

**Fixtures**:
- `resource-env/resources.yaml` — declares `functions.legacy_authorizer`
- `resource-env/env.yaml` — maps `functions.legacy_authorizer.id.env: LEGACY_AUTHORIZER_ID`

**Setup**:
```bash
export LEGACY_AUTHORIZER_ID="d4e123abc456"
```

**Test**:
```ts
import { compose } from '@ycforge/composer';
import { loadResourceIndex, loadEnvMapping, resolveReferences } from '@ycforge/composer/resource';

const index = await loadResourceIndex('test/fixtures/resource-env');
const envMapping = await loadEnvMapping('test/fixtures/resource-env', index);
const result = await compose({
  compositionRoot: 'test/fixtures/composition-with-authorizer',
  apps: [{ appRoot: 'test/fixtures/app-user-service' }],
  functions: ['legacy_authorizer'],
});
const resolved = resolveReferences(result.document, envMapping, REFERENCE_BEARER_FIELDS);

const authScheme = resolved.components?.securitySchemes?.legacy_auth;
expect(authScheme?.['x-yc-apigateway-authorizer']?.function_id).toBe('d4e123abc456');
// NO ${...} template strings anywhere in resolved document
```

**Expected**: Green. `function_id` = actual value from `process.env`. Artifact fully materialized (no `${VAR}`, no `${resources...}`).

---

## Scenario US4: No env Entry → Logical Template Preserved

**Fixtures**:
- `resource-no-env/resources.yaml` — declares `functions.legacy_authorizer`
- **No** `env.yaml` file

**Test**:
```ts
const index = await loadResourceIndex('test/fixtures/resource-no-env');
const envMapping = await loadEnvMapping('test/fixtures/resource-no-env', index); // empty
const result = await compose({...});
const resolved = resolveReferences(result.document, envMapping, REFERENCE_BEARER_FIELDS);

const authScheme = resolved.components?.securitySchemes?.legacy_auth;
expect(authScheme?.['x-yc-apigateway-authorizer']?.function_id).toBe('${resources.functions.legacy_authorizer.id}');
// Template preserved for Terraform path
```

**Expected**: Green. Template syntax intact. No error. Path to Terraform materializer (019) preserved.

---

## Scenario US5: apps.yaml vs resources.yaml Collision → Fail-Fast (Seam 009→011)

**Note**: This validation is **NOT** performed by B (composer) per FR-016 / Constitution I.

**Test** (documenting the seam):
```ts
// B does NOT read apps.yaml — this test verifies B's behavior is unchanged
const index = await loadResourceIndex('test/fixtures/resource-collision'); // has functions.user_service
// B accepts this; collision detected later by 011/ycsf check
expect(index.has('functions', 'user_service')).toBe(true);
```

**Expected**: Green. B builds index successfully. Collision detection is 011's responsibility (documented seam).

---

## Running All Scenarios

```bash
# From repo root
pnpm --filter @ycforge/composer test -- test/resource-references.test.ts
```

**Coverage Target** (per SC-001..SC-006):
- US1: 5+ tests (canonical + each domain)
- US2: 5+ tests (each error type)
- US3: 3+ tests (with env, without env.yaml, with env.yaml but no entry)
- US4: 2+ tests (env absent, env present no entry)
- US5: 1 test (seam documented)
- SC-006: 3+ tests (other interpolation spaces pass through)