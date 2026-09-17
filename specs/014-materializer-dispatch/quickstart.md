# Quickstart: materializer-dispatch Validation Guide

Validation scenarios for the Project C materializer dispatch (`@ycforge/pilot` `dispatch` + `writeGeneratedTerraform`). Written as runnable expectations against the pilot package once implemented; at plan stage they define acceptance criteria for `/speckit.tasks` → implementation. Reference project uses apps `user_service`, `analytics`, `frontend`, `openapi` (canonical).

This layer runs **after** spec 011 `loadProjectModel` + spec 013 `loadRegistry`/`validateBuilders` and **before** any Terraform CLI execution (spec 021). Dispatch is pure+async; `writeGeneratedTerraform` touches the filesystem.

## Prerequisites

- Node.js 22+; monorepo with `packages/pilot` built.
- Public types from `@ycforge/pilot/contracts`: `PluginRegistry`, `PluginEntry`, `MaterializationContext`, `TerraformResource`, `ArtifactDescriptor`, `DispatchResult`, `DispatchDiagnostic`, `GeneratedTfFile`, `MTL_*` constants.
- Runtime entries from `@ycforge/pilot`:
  - `dispatch(projectModel: ProjectModel, registry: PluginRegistry, options?: DispatchOptions): Promise<DispatchResult>` — pure+async (no filesystem).
  - `writeGeneratedTerraform(infraDir: string, files: readonly GeneratedTfFile[]): Promise<void>` — I/O only.
- Hermetic: fixture materializers are inline plain JS objects `{ supports: fn, materialize: fn }`, wrapped as `PluginEntry` (kind: 'materializer', module: fixture). No real npm packages; no `builders.yaml` load needed for dispatch unit tests.

## Setup (reference project + fixture materializers)

```yaml
# .ycsf/apps.yaml (spec 011)
version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
  analytics:    { source_path: analytics,    builder: docker }
  frontend:     { source_path: frontend,     builder: vite,        depends_on: [user_service] }
  openapi:      { source_path: openapi,      builder: yandex-api-gateway, depends_on: [user_service] }
```

Fixture materializer modules (inline plain objects, created by test helper):

```typescript
// Mat-Mock: always supports 'nestjs-function', returns a canned TerraformResource
const matMockNest = {
  supports: (a: ArtifactDescriptor) => a.type === 'nestjs-function',
  materialize: async (a: ArtifactDescriptor, ctx: MaterializationContext) => ({
    kind: 'resource' as const, type: 'yandex_function', name: a.id,
    configuration: { name: a.id, runtime: 'nodejs20', content: { source: `dist/${a.id}.zip` } },
  }),
};

// Mat-Mock-Docker: always supports 'docker'
const matMockDocker = {
  supports: (a: ArtifactDescriptor) => a.type === 'docker',
  materialize: async (a: ArtifactDescriptor) => ({
    kind: 'resource' as const, type: 'yandex_container', name: a.id,
    configuration: { name: a.id, image: `registry.example.com/${a.id}` },
  }),
};

// Mat-Mock-Throw: supports 'vite' but materialize always throws
const matMockThrow = {
  supports: (a: ArtifactDescriptor) => a.type === 'vite',
  materialize: async () => { throw new Error('plugin crashed'); },
};

// Not-a-materializer: object without supports/materialize
const notAMaterializer = { foo: () => {} };
```

## Validation Scenarios

Each scenario uses the canonical apps above; fixture materializers are wrapped into `PluginEntry` objects and collected into a `PluginRegistry.records` `Map`. `ProjectModel` is constructed from the `apps.yaml` above.

### Scenario 1: Single app materializes to correct .tf.json (US-1 / FR-001/005/007/008/009, P1)

**Setup**: project with 1 app `user_service` (builder: `nestjs-function`); registry with 1 materializer `yandex-function` (supports: `type === 'nestjs-function'`).

**Run**:
```typescript
const result = await dispatch(projectModel, registry);
```

**Expected**:
- `result.kind === 'ok'`
- `result.resources.length === 1`, `result.resources[0].name === 'user_service'`, `result.resources[0].type === 'yandex_function'`
- `result.generatedFiles.length === 1`
- `result.generatedFiles[0].filename === 'user_service.ycsf.tf.json'`
- `result.generatedFiles[0].content` contains `"resource"`, `"yandex_function"`, `"user_service"`; keys sorted lexicographically; same content across two dispatch calls (SC-003, SC-008).

**Validate content**:
```json
{
  "resource": {
    "yandex_function": {
      "user_service": {
        "content": { "source": "dist/user_service.zip" },
        "name": "user_service",
        "runtime": "nodejs20"
      }
    }
  }
}
```
(Top-level `resource` only; `configuration` object keys also sorted.)

---

### Scenario 2: Two materializers claim same artifact type → MTL_COLLISION, no materialize (US-2 / FR-003/017, P1)

**Setup**: project with 1 app `user_service` (builder: `nestjs-function`); registry with 2 materializers `m1` and `m2`, both `supports: () => true` for all types.

**Run**:
```typescript
const result = await dispatch(projectModel, registry);
```

**Expected**:
- `result.kind === 'invalid'`
- `result.errors` contains exactly one `MTL_COLLISION` with `artifactId === 'user_service'` and `materializerIds: ['m1', 'm2']` (in registry iteration order).
- Neither materializer's `materialize` was called (all-or-nothing).

---

### Scenario 3: No materializer supports artifact type → MTL_UNHANDLED_ARTIFACT (US-3 / FR-004/017, P1)

**Setup**: project with 1 app `analytics` (builder: `docker`); registry with 1 materializer `yandex-function` (supports: `type === 'nestjs-function'` only).

**Expected**:
- `result.kind === 'invalid'`
- `result.errors` contains `MTL_UNHANDLED_ARTIFACT` with `artifactId === 'analytics'`, `materializerIds: ['yandex-function']`.

---

### Scenario 4: Multiple apps in dependency order (US-4 / FR-014, P1)

**Setup**: project with apps `analytics` (no deps), `user_service` (depends_on: `analytics`), `frontend` (depends_on: `user_service`); registry with 3 materializers (each supports one builder type).

**Expected**:
- `result.kind === 'ok'`
- `result.resources` order: `[analytics, user_service, frontend]` (topological order + alphabetic tie).
- `result.generatedFiles` order: same, filenames `[analytics.ycsf.tf.json, user_service.ycsf.tf.json, frontend.ycsf.tf.json]`.

---

### Scenario 5: Regeneration removes stale C-owned files, leaves user *.tf untouched (US-5 / FR-015/016, P1)

**Setup**: `infra/` contains `user_service.ycsf.tf.json` (previous dispatch) and `main.tf` (user-owned). Current project has only `analytics` (user_service removed). Dispatch produces `analytics.ycsf.tf.json`.

**Run**:
```typescript
await writeGeneratedTerraform('infra', result.generatedFiles);
```

**Expected**:
- `infra/analytics.ycsf.tf.json` exists with correct content.
- `infra/user_service.ycsf.tf.json` is **deleted** (stale, not in current generated set).
- `infra/main.tf` is **untouched** (not C-owned by glob `*.ycsf.tf.json`).

---

### Scenario 6: Materializer throws → MTL_MATERIALIZE_FAILED, abort-on-first (US-6 / FR-006, P1)

**Setup**: project with 2 apps: `user_service` (builder: `nestjs-function`) and `analytics` (builder: `docker`). Registry: `yandex-function` supports `nestjs-function`, `throw-materializer` supports `docker` but `materialize` always throws `Error('plugin crashed')`. Topological order: `analytics → user_service` (no deps, so alphabet: `analytics` first).

**Expected**:
- Phase 1: selection clean (each has one supporter).
- Phase 2: `analytics` processed first (alphabetical, no deps) → throws → `MTL_MATERIALIZE_FAILED` with `artifactId: 'analytics'`, `materializerId: 'throw-materializer'`, `message` containing `'plugin crashed'`.
- `user_service` is **never** materialized (abort-on-first).
- `result.kind === 'invalid'`; `result.resources` is empty / not present in invalid; `result.generatedFiles` is empty / not present.

---

### Scenario 7: Empty registry (0 materializers) + apps → MTL_UNHANDLED_ARTIFACT on each (US-7 / FR-004, P2)

**Setup**: registry with 0 materializer entries; project with 1 app `user_service` (builder: `nestjs-function`).

**Expected**:
- `result.kind === 'invalid'`
- `result.errors` contains `MTL_UNHANDLED_ARTIFACT` with `artifactId: 'user_service'`, empty `materializerIds: []`.

---

### Scenario 8: Empty registry + 0 apps → ok (US-7, P2)

**Setup**: registry with 0 materializer entries; project with 0 apps (empty `apps.yaml`).

**Expected**:
- `result.kind === 'ok'`
- `result.resources.length === 0`
- `result.generatedFiles.length === 0`

---

### Scenario 9: Deterministic output byte-identical across runs (US-8 / SC-003, P1)

**Setup**: same project model + same registry. Run `dispatch` twice with identical inputs.

**Expected**:
- `JSON.stringify(result1.generatedFiles) === JSON.stringify(result2.generatedFiles)` (filename + content byte-identical).

---

### Scenario 10: Filename collision defensive check → MTL_FILENAME_COLLISION (FR-010, P1)

**Setup**: (synthetic) two artifacts `a` and `b` with app ids `x` and `x` (same) — impossible by spec 011 construction but tested defensively by overriding the internal artifact list with duplicates.

**Expected**:
- `result.kind === 'invalid'`
- `result.errors` contains `MTL_FILENAME_COLLISION` with both artifact ids.

---

### Scenario 11: Invalid Terraform address → MTL_INVALID_TERRAFORM_ADDRESS (FR-011, P1)

**Setup**: materializer returns `TerraformResource` with `type: 'yandex-function'` (hyphen = invalid char) or `name: '1bad'` (starts with digit).

**Expected**:
- `result.kind === 'invalid'`
- `result.errors` contains `MTL_INVALID_TERRAFORM_ADDRESS` with the offending `type` or `name` value.

---

### Scenario 12: Outputs declared → 00-ycsf-outputs.tf.json (FR-012, P1)

**Setup**: materializer `matWithOutput` supports `nestjs-function`; `materialize` calls `context.output.declare('url', { value: 'function_url(user_service)', description: 'URL' })` and returns a `TerraformResource`.

**Expected**:
- `result.kind === 'ok'`
- `result.generatedFiles` contains `{ filename: '00-ycsf-outputs.tf.json', ... }` with content:
```json
{
  "output": {
    "url": {
      "description": "URL",
      "value": "${function_url(user_service)}"
    }
  }
}
```
- Top-level keys (`output`, then output name `url`) sorted; output value wrapped in `${...}`.

---

### Scenario 13: Duplicate output name → MTL_OUTPUT_NAME_COLLISION (FR-013, P1)

**Setup**: two apps (`user_service`, `analytics`), both materializers declare `context.output.declare('url', ...)` with the same name `url`.

**Expected**:
- `result.kind === 'invalid'`
- `result.errors` contains `MTL_OUTPUT_NAME_COLLISION` with `outputName: 'url'`.

---

### Scenario 14: User *.tf files never modified during dispatch + write (FR-015, IV, P1)

**Setup**: `infra/main.tf` (user, content: `# user\nresource "yandex_vpc_network" "net" {}`); dispatch produces `user_service.ycsf.tf.json`.

**Run**: `writeGeneratedTerraform('infra', result.generatedFiles)`

**Expected**:
- `infra/main.tf` content unchanged (`# user\nresource "yandex_vpc_network" "net" {}`).
- `infra/user_service.ycsf.tf.json` exists with correct content.

---

### Scenario 15: writeGeneratedTerraform creates infra dir if missing (FR-015)

**Setup**: `infra/` directory does not exist. Dispatch produces 1 file.

**Run**: `writeGeneratedTerraform('infra', [{ filename: 'app.ycsf.tf.json', content: '{}' }])`

**Expected**:
- `infra/` is created (recursive mkdir).
- `infra/app.ycsf.tf.json` exists with `'{}'`.

---

## Exit / Result Reference

| Result | Meaning |
|--------|---------|
| `dispatch` → `{ kind:'ok', resources, generatedFiles }` | All artifacts materialized; `resources` in topological order; `generatedFiles` contain deterministic `.tf.json` strings |
| `dispatch` → `{ kind:'invalid', errors }` | Selection error (all-or-nothing) or materialize error (abort-on-first); resources not materialized; `materialize` never called in selection errors |
| `writeGeneratedTerraform` (no throw) | All `*.ycsf.tf.json` written/overwritten; stale C-owned files removed; user files untouched |

No test calls `terraform` CLI. No test reads user `*.tf` content (only checks absence of write/delete).

## Reference

- `contracts/materialize.json` — `MTL_*` error code catalog + generated `.tf.json` schemas.
- `data-model.md` — entities, dispatch flow, validation rules.
- `research.md` — design decisions (all-or-nothing, determinism, serialization, regeneration, context).