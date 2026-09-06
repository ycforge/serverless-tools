# Quickstart: project-model Validation Guide

Validation scenarios for the Project C project model (`@ycforge/pilot` `loadProjectModel`). These scenarios are written as runnable expectations against the pilot package once implemented; at plan stage they define the acceptance criteria for the `/speckit.tasks` → implementation phase. Reference project uses apps `user_service`, `analytics`, `frontend`, `openapi`.

## Prerequisites

- Node.js 22+; monorepo with `packages/pilot` built.
- The public types come from `@ycforge/pilot/contracts` (`App`, `Resource`, `ProjectModel`, `BuildConfig`, `DependsOnGraph`, `ProjectModelError`).
- The loader is invoked as `loadProjectModel(rootDir)` from `@ycforge/pilot` and returns `{ kind: 'ok'; model } | { kind: 'invalid'; errors }`.

## Setup (reference project root)

```text
repo/
├── .ycsf/
│   ├── apps.yaml
│   └── resources.yaml
├── user_service/build_config.yaml
├── analytics/build_config.yaml
├── frontend/build_config.yaml
└── openapi/build_config.yaml
```

```yaml
# .ycsf/apps.yaml
version: 1
apps:
  user_service:
    source_path: user_service
    builder: nestjs-function
  analytics:
    source_path: analytics
    builder: docker
    depends_on:
      - user_service
  frontend:
    source_path: frontend
    builder: vite
    depends_on:
      - user_service
  openapi:
    source_path: openapi
    builder: yandex-api-gateway
    depends_on:
      - user_service
```

```yaml
# .ycsf/resources.yaml
version: 1
queues:
  events: {}
buckets:
  frontend: {}
functions:
  legacy_authorizer: {}
```

## Validation Scenarios

Each scenario is a load + expected result identical to the corresponding acceptance criterion in `spec.md`. All assertions below are on the `ProjectModelLoadResult`.

### Scenario 1: Valid project loads (US-1, P1)

**Setup**: reference project above; set env vars `ANALYTICS_IMAGE_TAG` and `ANALYTICS_DOCKERFILE` before loading because `analytics/build_config.yaml` references them (see Scenario 4).

**Run**: `loadProjectModel(repoRoot)`

**Expected** — `{ kind: 'ok' }`:
- `model.apps` has 4 entries with correct `source_path`, `builder`, `depends_on` (user_service has empty, analytics [user_service], frontend [user_service], openapi [user_service]).
- `model.resources` grouped by domain: `queues.events`, `buckets.frontend`, `functions.legacy_authorizer`.
- `model.build_configs` contains each app that has a `build_config.yaml`; any app without one (e.g. `frontend` here) gets `{ build_config: {}, build_env: {} }`.
- `model.depends_on_graph.topologicalOrder` = some valid order where `user_service` precedes analytics/frontend/openapi (e.g. `[user_service, frontend, analytics, openapi]`).

### Scenario 2: depends_on cycle rejected (US-2, P1)

**Setup**:
```yaml
# .ycsf/apps.yaml
version: 1
apps:
  a: { source_path: a, builder: nestjs-function, depends_on: [b] }
  b: { source_path: b, builder: nestjs-function, depends_on: [c] }
  c: { source_path: c, builder: nestjs-function, depends_on: [a] }
```

**Run**: `loadProjectModel(repoRoot)`

**Expected** — `{ kind: 'invalid' }` with a `PML_DEPENDS_CYCLE` diagnostic whose message names the involved chain (a → b → c → a) and whose `app`/`identity` fields point at the involved apps.

### Scenario 3: self-reference rejected (US-2, P1)

**Setup**: `apps.yaml` with `a.depends_on: [a]`.

**Expected** — `{ kind: 'invalid' }`, `PML_DEPENDS_SELF`, message: self-reference in depends_on for app `a`.

### Scenario 4: dangling reference rejected (US-2, P1)

**Setup**: `apps.yaml` with `a.depends_on: [nonexistent]`.

**Expected** — `{ kind: 'invalid' }`, `PML_DEPENDS_UNKNOWN`, message: depends_on references unknown app 'nonexistent'.

### Scenario 5: identity collision rejected (US-3, P1)

**Setup**: `apps.yaml` has app `legacy_authorizer` (builder: nestjs-function) AND `resources.yaml` has `functions.legacy_authorizer`.

**Expected** — `{ kind: 'invalid' }`, `PML_IDENTITY_COLLISION`, message: identity 'functions.legacy_authorizer' exists in both apps.yaml and resources.yaml; `identity` field set.

### Scenario 6: duplicate app_id rejected (US-3, P1)

**Setup**: `apps.yaml` contains the key `user_service` twice:
```yaml
# .ycsf/apps.yaml
version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
  user_service: { source_path: user_service2, builder: docker }
```

**Expected** — `{ kind: 'invalid' }`, `PML_DUPLICATE_KEY` (YAML duplicate key) or `PML_DUPLICATE_APP_ID` (if detected at app level). Never silent last-wins (fail-fast per Constitution V).

### Scenario 7: missing required ENV rejected (US-4, P2)

**Setup**:
```yaml
# analytics/build_config.yaml
version: 1
build_config:
  dockerfile: "{{$ANALYTICS_DOCKERFILE}}"
build_env:
  NPM_TOKEN:
```
`ANALYTICS_DOCKERFILE` NOT set in `process.env`; `NPM_TOKEN` not set either.

**Run**: `loadProjectModel(repoRoot)`

**Expected** — `{ kind: 'invalid' }` with `PML_ENV_NOT_SET` diagnostics naming both `ANALYTICS_DOCKERFILE` and `NPM_TOKEN` (each with `app: analytics` and the source field). Error list contains both (collect-all), not just the first.

### Scenario 8: required ENV present passes (US-4 / FR-010, P2)

**Setup**: same `build_config.yaml`, but `ANALYTICS_DOCKERFILE` and `NPM_TOKEN` are both set in `process.env`.

**Expected** — `{ kind: 'ok' }`; `model.env_requirements` records both names with `isSet: true`. No interpolation performed here (runtime is spec 012).

### Scenario 9: missing build_config is not an error (US-5, P2)

**Setup**: `apps.yaml` has app `simple_app` with NO `simple_app/build_config.yaml`.

**Expected** — `{ kind: 'ok' }`; `model.build_configs.get('simple_app')` = `{ build_config: {}, build_env: {} }`.

### Scenario 10: version validation (US-6, P3)

**Setup A**: `apps.yaml` without `version` **or** with `version: 2`.

**Expected** — `{ kind: 'invalid' }`, `PML_VERSION`, message: missing/invalid version (or unsupported version '2' (supported: 1)).

## Exit / Result Reference

`loadProjectModel` does **not** throw for validation failures — it returns `{ kind: 'invalid', errors }`. It throws only for I/O catastrophes (e.g. missing `.ycsf/apps.yaml`).

| Result | Meaning |
|--------|---------|
| `{ kind: 'ok', model }` | Model valid; ready for downstream specs (013 builder-registry, 021 CLI, etc.) |
| `{ kind: 'invalid', errors }` | One or more `ProjectModelError`; use `diagnostics` for FR-015 file/app/field/message |

## CI/CD Integration Example (conceptual)

```yaml
# runs a project-model validation gate on every PR
run: pnpm --filter @ycforge/pilot build && node -e "
  const { loadProjectModel } = require('@ycforge/pilot');
  const r = loadProjectModel(process.cwd());
  if (r.kind === 'invalid') {
    r.errors.forEach(e => console.error(e.diagnostics));
    process.exit(1);
  }
"
```

## Reference

- `contracts/project-model.json` — `.ycsf` schemas + `PML_*` error code catalog.
- `data-model.md` — entities, relationships, load flow, full validation rules.
