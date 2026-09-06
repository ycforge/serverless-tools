# Data Model: project-model — `.ycsf/*.yaml` Project Model

## Entities

### App
Buildable source unit from `.ycsf/apps.yaml` (Constitution VI: apps = managed).

```typescript
interface App {
  app_id: string;              // stable logical identity; renamed only via .ycsf/moved.yaml (spec 017)
  source_path: string;         // relative path to the app dir (from repo root)
  builder: string;             // opaque builder identifier (validated in spec 013, not here)
  depends_on: string[];        // app_id dependencies (build order); empty if absent
}
```

### Resource
External infrastructure/logical resource from `.ycsf/resources.yaml` (Constitution VI: always external, reference only).

```typescript
interface Resource {
  domain: string;              // e.g. "queues" | "buckets" | "functions" (minimal set; extensible per spec 019)
  resource_id: string;         // logical identity within the domain
  properties: Record<string, unknown>;  // currently empty `{}`; not an input to materializers
}
```

### BuildConfig
Content of `<app>/build_config.yaml`.

```typescript
interface BuildConfig {
  build_config: Record<string, unknown>;   // opaque builder config; C does NOT validate internals (builder's job)
  build_env: Record<string, string | null>; // ENV_NAME → literal string | null (take from process env)
}
```

### EnvRequirement
A required environment variable discovered during model load.

```typescript
interface EnvRequirement {
  name: string;                // ENV name, e.g. "ANALYTICS_IMAGE_TAG"
  source: string;              // "build_config" | "build_env" — where it was found
  app_id: string;              // the app that declared it
  isSet: boolean;              // presence in process.env at load time
}
```

### DependsOnGraph
Validated acyclic directed graph built from all apps' `depends_on`.

```typescript
interface DependsOnGraph {
  adjacency: Map<string, string[]>;   // app_id → its depends_on targets
  topologicalOrder: string[];          // valid DAG order; empty if graph not acyclic
}
```

Invariant: DAG — no cycles, no self-references, no dangling references (all targets exist as app_ids).

### ProjectModel
Root result of loading + validating all `.ycsf/*.yaml`.

```typescript
interface ProjectModel {
  apps: Map<string, App>;                     // app_id → App
  resources: Map<string, Map<string, Resource>>; // domain → (resource_id → Resource)
  build_configs: Map<string, BuildConfig>;    // app_id → BuildConfig (absent apps → empty config)
  env_requirements: Map<string, EnvRequirement>; // ENV name → requirement
  depends_on_graph: DependsOnGraph;           // validated
}
```

### ProjectModelError / ProjectModelDiagnostic
A single validation problem (FR-015 requires file/app/field/message).

```typescript
interface ProjectModelDiagnostic {
  code: string;                // PML_* code
  message: string;             // human-readable (EN)
  file: string;                // source .ycsf/*.yaml path
  app?: string;                // affected app_id (where applicable)
  identity?: string;           // affected logical identity (collisions)
  field?: string;              // specific field, e.g. "version", "depends_on", "NPM_TOKEN"
  line?: number;               // from yaml AST where applicable
  column?: number;
}

class ProjectModelError extends Error {
  readonly code: string;
  readonly diagnostics: ProjectModelDiagnostic[];
}
```

### ProjectModelLoadResult
Result of `loadProjectModel`, distinct from throwing IO errors.

```typescript
type ProjectModelLoadResult = { kind: 'ok'; model: ProjectModel }
                            | { kind: 'invalid'; errors: ProjectModelError[] };
```

Constituent usage: loader never throws for a *validation* failure; it returns `invalid`. It throws only for I/O catastrophes (missing `.ycsf/apps.yaml`, unreadable file).

## Relationships

```
ProjectModel
├── apps: Map<app_id, App>
│      App.depends_on ──────► App (another app_id)          (DependsOnGraph edges)
│      App ──(0..1)──────► BuildConfig                      (build_config.yaml)
├── resources: domain → resource_id → Resource
├── env_requirements: ENV name → EnvRequirement
│      EnvRequirement ──► App (declaring app) ──► BuildConfig.build_env / build_config
└── depends_on_graph                                      (derived from apps' depends_on)
```

Identity collision (Constitution VI): an `app_id` from `apps.yaml` and a `resource_id` from `resources.yaml` must not refer to the same logical identity.

## Load Flow (State Transitions)

```
loadProjectModel(rootDir)
  → read .ycsf/apps.yaml          (MUST exist; else IO error)
      → parse (yaml, uniqueKeys:true)   → PML_PARSE / PML_DUPLICATE on failure
      → check version:1                 → PML_VERSION
      → build App[]                     → PML_INVALID on bad shape; PML_DUPLICATE_APP_ID on repeated app_id
  → read .ycsf/resources.yaml   (optional; absent → empty)
      → parse, version:1, build Resource[] → PML_* on failure
  → for each app: read <app>/build_config.yaml  (optional; absent → empty BuildConfig)
      → parse, version:1, extract build_config + build_env → PML_* on failure
  → extract {{$ENV}} from build_config (all string leaves) + build_env values → env_requirements
      → check process.env presence → PML_ENV_NOT_SET for missing
  → build DependsOnGraph; DFS validate cycles/self/dangling → PML_DEPENDS_* (collect ALL)
  → check identity collision apps ↔ resources → PML_IDENTITY_COLLISION
  → if any errors → { kind:'invalid', errors }; else { kind:'ok', model }
```

No persistence/state beyond the returned `ProjectModel`. All validation happens in one synchronous load.

## Validation Rules

| Entity | Rule | Error code |
|--------|------|------------|
| Any `.ycsf/*.yaml` | `version` present and `=== 1` | `PML_VERSION` |
| Any `.ycsf/*.yaml` | YAML parses (uniqueKeys) | `PML_PARSE` / `PML_DUPLICATE_*` |
| apps.yaml | top-level is a mapping with `apps`; each app has `app_id`, `source_path`, `builder`; `depends_on` optional array of strings | `PML_INVALID` |
| apps.yaml | no duplicate `app_id` (repeated YAML key or repeated after parse) | `PML_DUPLICATE_APP_ID` |
| apps.yaml | only `source_path`, `builder`, `depends_on` per app — no builder-specific fields (FR-012) | `PML_INVALID` (unknown app-level key) |
| depends_on | no self-reference | `PML_DEPENDS_SELF` |
| depends_on | no dangling reference (target must exist as app_id) | `PML_DEPENDS_UNKNOWN` |
| depends_on | graph acyclic | `PML_DEPENDS_CYCLE` (with involved chain) |
| resources.yaml | parse + version; shape `domain → resource_id → {}` | `PML_INVALID` / `PML_PARSE` |
| apps ↔ resources | no shared logical identity | `PML_IDENTITY_COLLISION` |
| build_config.yaml | parse + version; `build_config` mapping + `build_env` mapping | `PML_INVALID` / `PML_PARSE` |
| build_config.yaml | every `{{$NAME}}` (build_config + build_env) name present in process.env; every null build_env entry present | `PML_ENV_NOT_SET` |
| build_config.yaml | builder-specific `build_config` internals NOT validated (FR-011) | (none) — intentional |

## Decision: apps ↔ resources collision matching rule

An `app_id` (`apps.yaml`) collides with a `resource_id` (`resources.yaml`) when the app's logical identity can be expressed under the same resource domain. Because apps map to artifacts like `functions.<app_id>` (IDEA §17 example: `apps.user_service → functions.user_service`), the collision is checked as: **`functions.<app_id>` collides with any `functions.<resource_id>`** — and, more strictly for this spec's scope, a bare `app_id` matching a `resource_id` within the same domain is flagged. Concretely, the loader reports `PML_IDENTITY_COLLISION` when a `resource_id` equals either `app_id` or `functions.<app_id>` for a resource in the `functions` domain. This rule is documented here and enforced in `resources.ts` + collision pass; refine per spec 019 if the identity grammar is extended.
