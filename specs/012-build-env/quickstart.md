# Quickstart: build-env Validation Guide

Validation scenarios for the Project C runtime-prep layer `prepareBuildEnv` (`@ycforge/pilot`). These scenarios are written as runnable expectations against the pilot package once implemented; at plan stage they define the acceptance criteria for the `/speckit.tasks` → implementation phase. Reference project uses apps `user_service`, `analytics`, `frontend`, `openapi` (canonical).

The layer runs **after** load-time validation (spec 011 `loadProjectModel`) and feeds spec 021 (`ycsf build`) with builder-ready input; it never executes builders.

## Prerequisites

- Node.js 22+; monorepo with `packages/pilot` built.
- `@ycforge/pilot` public types from `@ycforge/pilot/contracts`: `BuildConfig`, `ProjectModelDiagnostic`, `PML_ENV_UNRESOLVED`, plus new `EnvValue`, `BuildEnvResolutionResult`, `PreparedBuildEnv`.
- Runtime entry: `prepareBuildEnv(appId: string, buildConfig: BuildConfig, envSnapshot?: Readonly<Record<string, string | undefined>>)` from `@ycforge/pilot` returns `{ kind:'ok'; resolvedEnv; buildConfig } | { kind:'invalid'; errors }`.
- Model load must already have succeeded (`{ kind:'ok' }`) before these scenarios (this spec assumes a valid model; runtime round can still fail on empty/unset runtime vars).

## Setup (reference project, per-app build_config)

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
    depends_on: [user_service]
  frontend:
    source_path: frontend
    builder: vite
    depends_on: [user_service]
  openapi:
    source_path: openapi
    builder: yandex-api-gateway
    depends_on: [user_service]
```

### analytics/build_config.yaml — mixed build_env modes + interpolation in build_config

```yaml
version: 1
build_config:
  image:
    repository: "cr.yandex/ya_mob_ya_lublu_yandex"
    tag: "{{$ANALYTICS_IMAGE_TAG}}"
  dockerfile: "{{$ANALYTICS_DOCKERFILE}}"
  url: "https://{{$REG}}/{{$REPO}}"
build_env:
  NPM_TOKEN:                       # null → from process.env.NPM_TOKEN
  HELLO_TEXT: "привет, мир!"       # literal
  REGISTRY: "{{$DOCKER_REGISTRY}}" # interpolated
```

### frontend — empty build_config (trivial path)

```yaml
version: 1
build_config: {}
build_env: {}
```

## Validation Scenarios

Each scenario runs `prepareBuildEnv(appId, buildConfig, envSnapshot)` with a controlled `envSnapshot` (hermetic; no host `process.env` mutation). Expected outcomes follow.

### Sc1 — valid mixed build_env + build_config interpolation (US-1, US-2; P1)

**envSnapshot**: `{ ANALYTICS_IMAGE_TAG:'v2', ANALYTICS_DOCKERFILE:'Dockerfile', REG:'foo', REPO:'bar', NPM_TOKEN:'tok', DOCKER_REGISTRY:'reg.example' }`

**Run**: `prepareBuildEnv('analytics', analyticsBuildConfig, snapshot)`

**Expected** — `{ kind:'ok' }`:
- `resolvedEnv == { NPM_TOKEN:'tok', HELLO_TEXT:'привет, мир!', REGISTRY:'reg.example' }` — all string, no `null`, no `{{$…}}`.
- `buildConfig` interpolated: `image.tag === 'v2'`, `dockerfile === 'Dockerfile'`, `url === 'https://foo/bar'` (both `{{$REG}}` and `{{$REPO}}` substituted in one line; US-1 AC2).

### Sc2 — null build_env entry (US-2, P1)

**envSnapshot**: `{ NPM_TOKEN:'s3cr3t' }`

**Run**: `prepareBuildEnv('user_service', { build_config:{}, build_env:{ NPM_TOKEN:null } }, snapshot)`

**Expected** — `{ kind:'ok' }`, `resolvedEnv.NPM_TOKEN === 's3cr3t'`.

### Sc3 — literal build_env passthrough (US-1 AC3, P1)

**Run**: `prepareBuildEnv('analytics', { build_config:{}, build_env:{ HELLO_TEXT:'привет, мир!' } }, {})`

**Expected** — `{ kind:'ok' }`, `resolvedEnv.HELLO_TEXT === 'привет, мир!'` (literal unchanged, not a requirement, no interpolation).

### Sc4 — interpolated build_env (US-2, P1)

**envSnapshot**: `{ DOCKER_REGISTRY:'reg.example' }`

**Run**: `prepareBuildEnv('analytics', { build_config:{}, build_env:{ REGISTRY:'{{$DOCKER_REGISTRY}}' } }, snapshot)`

**Expected** — `{ kind:'ok' }`, `resolvedEnv.REGISTRY === 'reg.example'`.

### Sc5 — unresolved-after-load `{{$NAME}}` → fail-fast (US-3, P1)

**envSnapshot**: `{ ANALYTICS_DOCKERFILE:'' }` (set but empty string = not set, per 011 `isSet`)

**Run**: `prepareBuildEnv('analytics', buildConfigWith(dockerfile:'{{$ANALYTICS_DOCKERFILE}}'), snapshot)`

**Expected** — `{ kind:'invalid' }` with a `PML_ENV_UNRESOLVED` diagnostic: `app === 'analytics'`, `field === 'build_config'`, message names `ANALYTICS_DOCKERFILE`. Builder never invoked (nothing is returned to a builder in the `invalid` branch).

### Sc6 — cross-namespace splice: `${terraform}` / `${resources...}` untouched (FR-010 / SC-006, P2)

**envSnapshot**: `{ PORT:'8080' }`

**Run**: `prepareBuildEnv('x', { build_config:{ cmd:'run ${TFO_VAR} --port {{$PORT}} ${resources.functions.fn.id}' }, build_env:{} }, snapshot)`

**Expected** — `{ kind:'ok' }`; interpolated `buildConfig.cmd === 'run ${TFO_VAR} --port 8080 ${resources.functions.fn.id}'`. The `{{$PORT}}` is substituted; `${TFO_VAR}` and `${resources.functions.fn.id}` are **not** touched (never matched). No `PML_ENV_UNRESOLVED`.

### Sc7 — empty build_config / empty build_env (FR-015, P3)

**Run**: `prepareBuildEnv('frontend', { build_config:{}, build_env:{} }, {})`

**Expected** — `{ kind:'ok' }`, `resolvedEnv === {}`, `buildConfig === {}`.

### Sc8 — per-app isolation (FR-014, P1)

**envSnapshot**: `{ A:'a', B:'b' }`

**Run**:
- `prepareBuildEnv('appA', { build_config:{}, build_env:{ X:'{{$A}}' } }, snapshot)` → `resolvedEnv.X === 'a'`.
- `prepareBuildEnv('appB', { build_config:{}, build_env:{ X:'{{$B}}' } }, snapshot)` → `resolvedEnv.X === 'b'`.

**Expected** — each app resolves only its own `BuildConfig`; no cross-app contamination; the loaded model stays unchanged between calls.

### Sc9 — multiple `{{$NAME}}` per line + duplicate reference (US-1 AC2, Edge Case, P1)

**envSnapshot**: `{ REG:'registry', REPO:'my-repo', TOKEN:'t' }`

**Run**: `prepareBuildEnv('a', { build_config:{ url:'https://{{$REG}}/{{$REPO}}?token={{$TOKEN}}' }, build_env:{ T:'{{$TOKEN}}' } }, snapshot)`.

**Expected** — `buildConfig.url === 'https://registry/my-repo?token=t'`; `resolvedEnv.T === 't'`; duplicate `{{$TOKEN}}` references in a single string each resolve to the same value (Edge Case "Duplicate `{{$NAME}}`").

### Sc10 — deterministic snapshot, no `.env`, no defaults (FR-012/013, SC-002, P2)

**envSnapshot**: `{ FOO:'bar' }`; also write a *fixture* `.env` file in the project root with `FOO=from_file` (this spec must NOT read it).

**Run**: same `prepareBuildEnv` twice with the same snapshot and `.env` fixture.

**Expected** — run #1 and run #2 produce **binary identical** output; `resolvedEnv.FOO === 'bar'` (from process env snapshot, **not** from `.env`); no default value ever injected; no value from `.env` appears.

## How to Run (once implemented)

From repo root:

```bash
pnpm --filter @ycforge/pilot build
pnpm --filter @ycforge/pilot test -- --run test/build-env/
```

Or in a scratch script (ESM):

```bash
node --input-type=module -e "
import { prepareBuildEnv } from '@ycforge/pilot';
const r = prepareBuildEnv('analytics', {
  build_config: { url: 'https://{{$REG}}/{{$REPO}}' },
  build_env: { NPM_TOKEN: null, HELLO_TEXT: 'hi' },
}, { REG:'foo', REPO:'bar', NPM_TOKEN:'tok' });
console.log(r);
if (r.kind !== 'ok') process.exit(1);
"
```

Expected: `{ kind:'ok', resolvedEnv:{ NPM_TOKEN:'tok', HELLO_TEXT:'hi' }, buildConfig:{ url:'https://foo/bar' } }`.

## Expected Outcomes Table

| Sc | Input summary | Expected result |
|----|---------------|-----------------|
| Sc1 | mixed build_env (null/literal/interpolated) + build_config interpolation, multiple refs | ok; resolvedEnv strings-only; build_config fully interpolated |
| Sc2 | `build_env: {NPM_TOKEN:null}` with var set | ok; resolvedEnv picks it up |
| Sc3 | literal build_env | ok; value passthrough unchanged |
| Sc4 | interpolated build_env | ok; substituted |
| Sc5 | `{{$}}` var empty/unset at runtime | invalid; `PML_ENV_UNRESOLVED` app/field/var; builder not called |
| Sc6 | `${...}` + `${resources...}` splices | ok; those untouched, only `{{$}}` substituted |
| Sc7 | empty build_config / build_env | ok; trivial empty resolved env |
| Sc8 | per-app resolution | ok; isolated per app, model unchanged |
| Sc9 | multiple refs per line, duplicate ref | ok; all substituted, duplicates same value |
| Sc10 | determinism + no `.env`/defaults | binary identical across runs; `.env` ignored |

## Reference

- `contracts/build-env.json` — resolved-build-env runtime API contract + `EnvValue` grammar + `PML_ENV_UNRESOLVED` diagnostic shape.
- `data-model.md` — entities, relationships, runtime-prep flow, full validation rules.
- `../011-project-model/contracts/project-model.json` — shared `PML_*` catalog (spec 012 adds `PML_ENV_UNRESOLVED` additively).
