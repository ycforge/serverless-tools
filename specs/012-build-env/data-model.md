# Data Model: build-env — runtime ENV interpolation, `build_env` resolution, runtime validation

This module transforms the **already-loaded and validated** project model (spec 011) into builder-ready materialized input. It operates purely in memory, per app, after `loadProjectModel` succeeded (`{ kind:'ok' }`). All entities below are in `src/build-env/` (runtime) and the type-only contracts in `src/contracts/build-env.ts` (public, re-exported via `@ycforge/pilot/contracts`).

## Entities

### EnvValue
Typed interpretation of **one** `build_env` record entry (`ENV_NAME → string | null` from `BuildConfig.build_env`, spec 011). Produced at runtime-prep stage from the loaded `BuildConfig`.

```typescript
type EnvValue =
  | { kind: 'null' }                          // take from process env (same name); strict requirement
  | { kind: 'literal'; value: string }        // no {{$...}} → passed as-is
  | { kind: 'interpolated'; refs: string[] }; // contains one or more {{$NAME}}; refs = the referenced names (deduped)
```

**Validation rules** (derived from spec FR-004/005/002 and 011's `BuildConfig.build_env`):
- `null` kind is a strict requirement — must resolve to a non-empty process-env value, else `PML_ENV_UNRESOLVED`.
- `literal` contains no `{{$…}}`; passed through unchanged.
- `interpolated` contains ≥1 `{{$NAME}}`; each name must resolve to a non-empty process-env value, else `PML_ENV_UNRESOLVED` naming that `NAME`.
- A `null` build_env entry is **distinct** from `{kind:'interpolated'}` — a `null` entry is a requirement on the *same* name (`NPM_TOKEN:` → `process.env.NPM_TOKEN`), whereas an interpolated string references *other* names.

### Interpolation
The operation that replaces each `{{$NAME}}` (`NAME ∈ [A-Z0-9_]+`) with the snapshot value of `process.env.NAME`. Applied to:
- `build_config`: all string leaves, deeply recursively (objects, arrays; non-string scalars skipped) — same shape semantics as spec 011's `collectStringLeaves`.
- `build_env` literal/interpolated values.

Produces an interpolated string that contains **no** `{{$…}}` on success.

### BuildEnvResolutionResult
Result of resolving `build_env` **and** interpolating `build_config` for **one** app.

```typescript
type BuildEnvResolutionResult =
  | { kind: 'ok';
      resolvedEnv: Record<string, string>;  // effective env map, no null, no {{$...}}
      buildConfig: unknown;                 // interpolated build_config (opaque to C, FR-011)
    }
  | { kind: 'invalid'; errors: ProjectModelDiagnostic[] }; // PML_ENV_UNRESOLVED, fail-fast
```

**Invariant** (spec key entity): either fully successful resolved env + config, or a fail-fast error set; **never** a mixed state. No unresolved `{{$…}}` / null / empty-string value may reach the builder.

### PreparedBuildEnv (public per-app materialized input)
The stable, typed per-app result that spec 021 wires into spec 002 `BuildContext` at the builder boundary. Alias/consumer-facing form of the `ok` branch; carried alongside `resolvedEnv` + `buildConfig`. **Not** a `BuildContext` itself (spec 021 performs that mapping; FR-009: reuse shapes, don't invent a new build API).

```typescript
interface PreparedBuildEnv {
  readonly appId: string;
  readonly resolvedEnv: Record<string, string>;
  readonly buildConfig: unknown; // interpolated, opaque
}
```

### EnvUnresolvedError (runtime error type)
Aggregates one or more `PML_ENV_UNRESOLVED` diagnostics (mirrors spec 011 `ProjectModelError`/`diag` shape RE: FR-015 fields).

```typescript
class EnvUnresolvedError extends Error {
  readonly code: 'PML_ENV_UNRESOLVED';
  readonly diagnostics: ProjectModelDiagnostic[];
}
```

### Runtime Diagnostic (PML_ENV_UNRESOLVED)
Reuses `ProjectModelDiagnostic` (spec 011) shape:
- `code: 'PML_ENV_UNRESOLVED'`
- `file`: the app's build_config source (e.g. `analytics/build_config.yaml`) for traceability
- `app`: app_id
- `field`: `build_config` | `build_env` | the specific ENV_NAME (for a null `build_env` record or the unresolved `{{$NAME}}`)
- `message`: human-readable (EN) naming the app, field, and variable

## Relationships

```
BuildConfig (spec 011, per app)
├── build_config: Record<string,unknown>   ──interpolate──► interpolated buildConfig (new tree)
└── build_env: Record<string,string|null>  ──classify──► per-entry EnvValue
                                                                  │
        EnvValue.kind: null|literal|interpolated                    │
                                                                  ▼
                                              BuildEnvResolutionResult
                                              ├── ok: resolvedEnv (Record<string,string>) + interpolated buildConfig
                                              └── invalid: diagnostics[] (PML_ENV_UNRESOLVED)
                                                     │
                                              (wired by spec 021 into BuildContext.buildEnv/.buildConfig)
```

- Per-app: each app's `BuildConfig` → one `BuildEnvResolutionResult`; no cross-app sharing, model stays read-only.

## Runtime-Prep Flow (state transitions)

```
prepareBuildEnv(appId, buildConfig, envSnapshot = process.env)
  → snapshot env once (research decision 2)
  → interpolate build_config:
        walkStringLeaves(build_config.build_config, replace each {{$NAME}} with envSnapshot[NAME])
        on empty/unset NAME → PML_ENV_UNRESOLVED (app, field=build_config, var=NAME)
        → interpolated buildConfig (new tree; original untouched)
  → for each [ENV_NAME, value] of build_env (declaration order):
        classify → EnvValue
        null            → resolvedEnv[ENV_NAME] = envSnapshot[ENV_NAME]
                           (undefined|'' → PML_ENV_UNRESOLVED, field=ENV_NAME, var=ENV_NAME)
        literal         → resolvedEnv[ENV_NAME] = value (as-is)
        interpolated    → resolvedEnv[ENV_NAME] = substitute(value)
                           (any referenced undefined|'' → PML_ENV_UNRESOLVED, field=ENV_NAME, var=ref)
  → final guard: assert no residual {{$NAME}} in resolvedEnv values or interpolated buildConfig
                 (SC-004); if any → PML_ENV_UNRESOLVED
  → if any errors → { kind:'invalid', errors }; else { kind:'ok', resolvedEnv, buildConfig }
```

No persistence/state beyond the returned result; stateless, idempotent, deterministic per snapshot.

## Validation Rules

| Entity / step | Rule | Error code |
|---------------|------|------------|
| build_config string leaf | every `{{$NAME}}` resolves to non-empty env value | `PML_ENV_UNRESOLVED` |
| build_config | no residual `{{$NAME}}` after substitution (SC-004) | `PML_ENV_UNRESOLVED` |
| build_env `null` record | `process.env[ENV_NAME]` non-empty | `PML_ENV_UNRESOLVED` |
| build_env literal | passed as-is; no requirement | none |
| build_env interpolated | every referenced `{{$NAME}}` non-empty | `PML_ENV_UNRESOLVED` |
| resolvedEnv | no `null`, no `{{$…}}` values; `Record<string,string>` (FR-006) | n/a (invariant) |
| namespace | `{{$NAME}}` only; `${...}` / `${resources...}` never matched (FR-010/SC-006) | n/a (by construction) |
| defaults / `.env` | never applied / never read (FR-012/013) | n/a (by construction) |
| empty build_config / build_env | trivial empty resolved env, not an error (FR-015) | none |

## Contract Alignment

- `PML_ENV_UNRESOLVED` constant added to `src/contracts/project-model.ts` and to `contracts/project-model.json` `#/errorCodes` (additive, Constitution III) — see research decision 5.
- Public type contracts (`EnvValue`, `BuildEnvResolutionResult`, `PreparedBuildEnv`, `EnvUnresolvedError`) live in `src/contracts/build-env.ts`, re-exported from `src/contracts/index.ts` via `@ycforge/pilot/contracts`; documented in `contracts/build-env.json`.
- Success `ok` branch maps to spec 002 `BuildContext` shape (`resolvedEnv → buildEnv`, `buildConfig → buildConfig`); no new build API invented (FR-009).
