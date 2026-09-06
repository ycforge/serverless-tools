# Quickstart: builder-registry Validation Guide

Validation scenarios for the Project C builder/materializer registry (`@ycforge/pilot` `loadRegistry` + `validateBuilders`). Written as runnable expectations against the pilot package once implemented; at plan stage they define acceptance criteria for `/speckit.tasks` → implementation. Reference project uses apps `user_service`, `analytics`, `frontend`, `openapi` (canonical).

This layer runs **after** spec 011 `loadProjectModel` (project model validated) and **before** any builder execution (021) or materializer dispatch (014). It never executes builders.

## Prerequisites

- Node.js 22+; monorepo with `packages/pilot` built.
- Public types from `@ycforge/pilot/contracts`: `PluginRegistry`, `PluginEntry`, `PluginLoadError`, `PluginKind`, `BuilderRegistryValidationResult`, `BRG_*` constants.
- Runtime entries from `@ycforge/pilot`:
  - `loadRegistry(rootDir): Promise<{ kind:'ok'; registry } | { kind:'invalid'; errors }>` (async; config parse sync + plugin `import()` async).
  - `validateBuilders(projectModel, registry): { kind:'ok' } | { kind:'invalid'; errors: ProjectModelDiagnostic[] }` (sync).
- Hermetic plugin fixtures: temp `.mjs`/`.cjs` files created by a test helper; `builders.yaml` values are import specifiers, so fixture paths and npm package names are loaded by the **same** mechanism (research 4). No publishing needed.

## Setup (reference project root + fixtures)

```yaml
# .ycsf/builders.yaml
version: 1
builders:
  nestjs-function: "@ycforge/builder-nestjs-function"   # or: ./fixtures/builder.mjs
  docker:          "@ycforge/builder-docker"            # or: ./fixtures/docker.mjs
  yandex-api-gateway: "@ycforge/ycsf-api"               # Project B as builder plugin (conceptual, boundary)
materializers:
  yandex-function: "@ycforge/materializer-yandex-function"  # or: ./fixtures/mat.mjs
```

```yaml
# .ycsf/apps.yaml
version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
  analytics:    { source_path: analytics,    builder: docker,         depends_on: [user_service] }
  frontend:     { source_path: frontend,     builder: vite,           depends_on: [user_service] }
  openapi:      { source_path: openapi,      builder: yandex-api-gateway, depends_on: [user_service] }
```

Fixture plugin modules (created on disk by a test helper):
- `fixtures/builder.mjs` — `export default { build: async () => ({ type: 'ycforge:function', value: {} }) }`
- `fixtures/docker.mjs` — `export const build = async () => ({ type: 'ycforge:docker', value: {} })` (named export path)
- `fixtures/both.mjs` — `export default { build: async () => ({}), supports: () => false, materialize: async () => ({}) }` (both shapes → builder wins, research 2)
- `fixtures/not-a-plugin.mjs` — `export default { foo: () => {} }`
- `fixtures/load-error.mjs` — top-level `throw new Error('boom')` (evaluation error)

## Validation Scenarios

Each scenario is a `loadRegistry` (then `validateBuilders` where noted) + expected result, identical to the corresponding acceptance criterion in `spec.md`.

### Scenario 1: valid builders.yaml loads (US-1 / FR-001, P1)

**Setup**: reference `builders.yaml` above with 3 builders + 1 materializer installed/resolvable (or mapped to valid fixtures).

**Run**: `const r = await loadRegistry(repoRoot)`

**Expected** — `{ kind: 'ok' }`:
- `registry.records` contains `nestjs-function` (kind `builder`), `docker` (kind `builder`, via named export), `yandex-api-gateway` (kind `builder`), `yandex-function` (kind `materializer`).
- Each entry has correct `packageName` and a loaded `module` carrying the expected shape.

### Scenario 2: missing version rejected (US-1 / FR-002, P1)

**Setup**: `.ycsf/builders.yaml` **without** `version` (or with `version: 2`).

**Expected** — `{ kind: 'invalid' }`, `BRG_VERSION`, message: missing/invalid version (or unsupported version '2' (supported: 1)). No dynamic import attempted.

### Scenario 3: builders↔materializers key collision rejected (US-2 / FR-003, P1)

**Setup**:
```yaml
version: 1
builders:  { my-plugin: "pkg-a" }
materializers: { my-plugin: "pkg-b" }
```

**Expected** — `{ kind: 'invalid' }`, `BRG_KEY_COLLISION`, message: duplicate key 'my-plugin' in builders and materializers. Detected **before** any dynamic import (SC-004).

### Scenario 4: duplicate builder key rejected (US-2 / FR-003, P1)

**Setup**:
```yaml
version: 1
builders:  { a: "pkg-1", a: "pkg-2" }
```

**Expected** — `{ kind: 'invalid' }`, `BRG_DUPLICATE_KEY` (YAML duplicate via `uniqueKeys: true`), message: duplicate builder key 'a'.

### Scenario 5: package not found (US-3 / FR-009, P1)

**Setup**: `builders: { nestjs: "@nonexistent/fake-builder" }` (not installed).

**Expected** — `{ kind: 'invalid' }`, `BRG_PACKAGE_NOT_FOUND`, message: package '\@nonexistent/fake-builder' not found. Registry not "ok"; the failing entry is a `PluginLoadError`, not a registry entry.

### Scenario 6: loaded module is not a plugin (US-4 / FR-010, P1)

**Setup**: entry maps to `fixtures/not-a-plugin.mjs` (`export default { foo: () => {} }`).

**Expected** — `{ kind: 'invalid' }`, `BRG_NOT_A_PLUGIN`, message: module '<spec>' does not export a Builder or Materializer.

### Scenario 7: module load error (FR-011, P1)

**Setup**: entry maps to `fixtures/load-error.mjs` (top-level throw on evaluation).

**Expected** — `{ kind: 'invalid' }`, `BRG_LOAD_ERROR`, message: module '<spec>' failed to load. (Distinct from package-not-found per SC-003.)

### Scenario 8: both-shape module resolved as builder (US-4 AC-2 default, P1)

**Setup**: entry maps to `fixtures/both.mjs` (exports `build` AND `supports`+`materialize`).

**Expected** — `{ kind: 'ok' }`; entry `kind: 'builder'` (builder-priority, research 2). Documented edge, not an error.

### Scenario 9: partial load collects all plugin errors (FR-015, P1)

**Setup**: `builders` has 3 entries: one valid fixture, one non-existent package, one load-error module.

**Expected** — `{ kind: 'invalid' }`; `errors` contains **both** `BRG_PACKAGE_NOT_FOUND` and `BRG_LOAD_ERROR` (plus any), the valid entry was still loaded (best-effort). Non-empty errors ⇒ invalid (fail-fast, not warning).

### Scenario 10: validateBuilders — unknown builder (US-5 / FR-013, P1)

**Setup**: app `analytics` has `builder: nest-function` (not in registry which has `nestjs-function`, `docker`); project model loaded OK (spec 011), registry loaded OK.

**Run**: `validateBuilders(projectModel, registry)`

**Expected** — `{ kind: 'invalid' }`, `BRG_UNKNOWN_BUILDER`, message: app 'analytics' uses unknown builder 'nest-function'; available builders: nestjs-function, docker. Diagnostic carries `app: analytics`, `field: builder`.

### Scenario 11: validateBuilders — known builder passes (US-5 / FR-013, P1)

**Setup**: app `frontend` has `builder: nestjs-function`; registry contains `nestjs-function`.

**Expected** — `{ kind: 'ok' }` (builder found).

### Scenario 12: validateBuilders — collect-all unknowns (US-5 AC-3 / FR-013, P1)

**Setup**: apps `a` (builder `unknown`) and `b` (builder `unknown2`); registry contains only `docker`.

**Expected** — `{ kind: 'invalid' }` with **two** `BRG_UNKNOWN_BUILDER` diagnostics (one per app).

### Scenario 13: empty registry (US-6 / FR-013, P2)

**Setup**: `.ycsf/builders.yaml` with `version: 1` only (no `builders`/`materializers`); project has 1 app (`builder: nestjs-function`).

**Expected** — `loadRegistry` → `{ kind: 'ok' }` with `registry.records` empty (0 entries); `validateBuilders` → `{ kind: 'invalid' }`, `BRG_UNKNOWN_BUILDER` with available builders list empty. A project with 0 apps + empty registry stays valid (`validateBuilders` → `{ kind: 'ok' }`).

### Scenario 14: optional materializers, not referenced (US-1/FR-005, P1)

**Setup**: `builders.yaml` has only `materializers: { yandex-function: ... }`, no `builders`; project apps use no builder (or reference a builder absent → Scenario 10). Materializer entries load fine; a registry with builders empty and materializers present is valid.

**Expected** — materializer entry `yandex-function` present with `kind: 'materializer'`; `loadRegistry` `{ kind: 'ok' }` (materializers are not cross-checked by `validateBuilders`, which validates `App.builder` only — materializer dispatch is spec 014).

## Exit / Result Reference

| Result | Meaning |
|--------|---------|
| `loadRegistry` → `{ kind:'ok', registry }` | `.ycsf/builders.yaml` parsed + all plugin modules loaded + shapes recognized; immutable `PluginRegistry` |
| `loadRegistry` → `{ kind:'invalid', errors }` | Structural `BRG_*` or plugin-load `BRG_*` errors (fail-fast); no usable registry |
| `validateBuilders` → `{ kind:'ok' }` | Every `App.builder` present in registry |
| `validateBuilders` → `{ kind:'invalid', errors }` | One `BRG_UNKNOWN_BUILDER` per unknown app builder |

No test executes builders (021) or dispatches materializers (014).

## CI/CD Integration Example (conceptual)

```yaml
# project-model + builder-registry validation gate on every PR
run: pnpm --filter @ycforge/pilot build && node -e "
  const { loadProjectModel, loadRegistry, validateBuilders } = require('@ycforge/pilot');
  (async () => {
    const m = loadProjectModel(process.cwd());
    if (m.kind === 'invalid') { m.errors.forEach(e => console.error(e.diagnostics)); process.exit(1); }
    const r = await loadRegistry(process.cwd());
    if (r.kind === 'invalid') { r.errors.forEach(e => console.error(e.message)); process.exit(1); }
    const v = validateBuilders(m.model, r.registry);
    if (v.kind === 'invalid') { v.errors.forEach(d => console.error(d)); process.exit(1); }
  })();
"
```

## Reference

- `contracts/plugin-registry.json` — `.ycsf/builders.yaml` schema + `BRG_*` error code catalog.
- `data-model.md` — entities, relationships, load flow, full validation rules.
- `research.md` — design decisions (import strategy, export contract, fixtures, BRG_* placement, immutability).
