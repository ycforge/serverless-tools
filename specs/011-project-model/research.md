# Research: project-model — `.ycsf/*.yaml` Project Model

## Decisions & Rationale

### 1. YAML Parser: Reuse `yaml@^2`

**Decision**: Use the `yaml` npm package (v2.x), the same one `@ycforge/composer` already depends on and uses (`parseDocument`). Add it to `packages/pilot/package.json` `dependencies`.

**Rationale**:
- Already in the monorepo and battle-tested in composer (`src/cli/load-config.ts`, `resource-index.ts`, `override-yaml.ts`) — same parsing patterns (AST-aware `parseDocument`, `isMap`, `isAlias`, typed `YAMLParseError`).
- `parseDocument(text, { uniqueKeys: true })` gives first-class **duplicate-key detection** (required by spec FR / US-3 fail-fast), which `yaml.load()` (plain) does NOT. Composer already relies on this exact option.
- AST-based parsing lets us collect multiple errors via `doc.errors` and attach line/column to diagnostics (required by FR-015).
- No new transitive dependency beyond what the ecosystem already accepts.

**Alternatives Considered**:
- `yaml.load()` plain parse: Rejected — silently overwrites duplicate keys (last wins), which violates fail-fast on collisions (Constitution V).
- `js-yaml`: Capable but adds a second YAML implementation to the monorepo; duplicate-key detection is manual and less ergonomic than `yaml`'s `uniqueKeys`.
- Custom tokenizer/parser: Rejected — reinventing a correct YAML parser is not our concern.

### 2. Code Location: `packages/pilot/src/model/` (NOT `src/contracts/`)

**Decision**: Runtime parsing/validation lives in a new `src/model/` directory. Public **type-only** contracts are re-exported from `src/contracts/project-model.ts` via `@ycforge/pilot/contracts`.

**Rationale**:
- Existing `test/unit/zero-dependency.test.ts` enforces that `src/contracts/` imports **only relative modules** and that the package `dependencies` is empty. The model parser needs the `yaml` runtime dependency, so it cannot live under `src/contracts/` without breaking that invariant (Constitution: contracts stay portable for plugin authors).
- Separation mirrors existing layout: `src/contracts/` = public pure plugin contracts (spec 002), `src/` = internal orchestration runtime.
- Downstream consumers (spec 021 CLI, spec 013 builder-registry) import the public types from `@ycforge/pilot/contracts`; the loader/validator API is exported from the package root (`src/index.ts`) as an internal-use entry.

**Alternatives Considered**:
- Put everything in `src/contracts/`: Rejected — breaks zero-dependency guarantee.
- New top-level `src/project-model/` instead of `src/model/`: Equivalent; `src/model/` chosen to keep the internal dir name short and focused on "the project model" concept.

### 3. DependsOn Graph: DFS White/Gray/Black Coloring, Collect ALL Errors

**Decision**: Build an adjacency graph from `depends_on` across apps; validate in a single pass with **iterative DFS coloring** (white=unvisited, gray=in-stack, black=done). A gray back-edge = cycle; edge to unknown app = dangling; edge to self = self-reference. **Collect all errors encountered**, not just the first.

**Rationale**:
- DFS coloring is O(V+E), simple, and trivially reports the exact involved-app cycle chain (spec US-2: "error contains all involved apps") — spec requires the chain in the diagnostic, which a topological-sort failure does not directly provide.
- **Collect all** errors (rather than fail on first) aligns with Constitution V (explicit, informative) and mirrors composer's `check.ts`, which aggregates multiple `CheckError` entries per check. A single malformed project should report every problem in one round, not force the developer through repeated failures. This is a development-companion choice, not magic.
- Deterministic order: iterate apps in declaration order of `apps.yaml`; report cycles before treating duplicate reporting conservatively (a node in a cycle is only reported once via coloring state).

**Alternatives Considered**:
- Kahn topological sort: Correct for cycle *detection* but doesn't directly yield the cycle path (chain) that US-2 demands; more bookkeeping to extract the involved apps.
- Fail-fast on first error (throw immediately): Rejected — contradicts the "collect all diagnostics" pattern of composer `check` and reduces UX for a validation tool; still fail-fast in the sense that a **non-empty error list ⇒ model rejected**.
- Pure recursive DFS: Rejected for deep graphs (stack overflow risk); iterative with explicit stack is bounded.

### 4. `{{$ENV}}` Extraction: Regex over `build_config` + `build_env` Values; Validate Presence at Load

**Decision**: Walk `build_config` (recursively over all string values) and `build_env` values; extract `{{$NAME}}` tokens with a single regex. Collect into `env_requirements` set. For each required name where the *current process env* (`process.env`) lacks a non-empty value → `PML_*` error at load (FR-009/FR-010).

**Rationale**:
- Spec explicitly says this spec defines the **model and validation of presence**; runtime substitution is spec 012. So the model stores the normalized requirement set (names), and validation just checks `process.env` presence — no substitution performed here.
- Regex is the lightweight contract: `/\{\{\$([A-Z0-9_]+)\}\}/g`. Yes — only interpolation refs `{{$...}}` are required; bare `build_env` entries with a `null` value are also required (spec: `NPM_TOKEN:` means "take from process ENV"). Literal values are not requirements.
- Fail-fast at load matches Constitution V ("все `{{$ENV}}` обязательны и валидируются до запуска builder") and US-4.

**Alternatives Considered**:
- Defer validation to spec 012 runtime: Rejected — spec FR-009/US-4/SC-004 explicitly require presence check at **model load**.
- Validate only at builder dispatch (spec 013/021): Rejected — same violation; load-time is the contract.

### 5. Diagnostics Format: `PML_*` Error Codes + `#/definitions/diagnostic` shape

**Decision**: New `PML_*` code family (e.g. `PML_VERSION`, `PML_DUPLICATE_APP_ID`, `PML_DEPENDS_CYCLE`, `PML_DEPENDS_SELF`, `PML_DEPENDS_UNKNOWN`, `PML_IDENTITY_COLLISION`, `PML_ENV_NOT_SET`, `PML_PARSE`, `PML_INVALID`). Each diagnostic carries file, app/identity, field, message (FR-015).

**Rationale**:
- Existing `Diagnostic` in `src/contracts/diagnostic.ts` is a generic `{ code, message }` + `ContractError`. Project-model diagnostics need richer fields (file, app, field) for FR-015, so define `ProjectModelDiagnostic extends Diagnostic` with those fields. Reuses the same philosophy: machine-readable `code`, never compare against string literals via constants.
- `PML_*` prefix namespaces the catalog (mirrors `INVALID_RESOURCE_REFERENCE` naming but grouped), and the contracts JSON (`project-model.json`) lists all codes for tooling.
- Collection model: loader returns `ProjectModelLoadResult` = `{ model } | { errors: ProjectModelError[] }` (success or error list), never throws for a *validation* failure; throws only for I/O catastrophes (missing `.ycsf/apps.yaml`).

**Alternatives Considered**:
- Reuse `ContractError` (throws) exclusively: Rejected — throwing on first validation error loses the collect-all property; also conflates "model invalid" (expected user error) with "contract boundary violated".
- Return a single error only: Rejected — see decision 3.

### 6. `version: 1` Enforcement + Duplicate YAML Keys

**Decision**: Every `.ycsf/*.yaml` and `build_config.yaml` must have `version: 1` (missing or any other value → `PML_VERSION` error). Parse each file via `parseDocument(text, { uniqueKeys: true })`; syntax or duplicate-key errors → `PML_PARSE`/`PML_DUPLICATE_*` error. Duplicate `app_id` / duplicate `resource_id` (same key repeated in YAML) → error, not silent last-wins.

**Rationale**:
- `version: 1` is the contract-versioning guarantee (Constitution III, FR-004/FR-014, US-6).
- `uniqueKeys: true` turns duplicate YAML keys into a parse error, satisfying US-3 ("дублирование ключа YAML ... fail-fast"). This is the explicit-over-magic behavior (Constitution V) — a silently overwritten app would corrupt the model.

**Alternatives Considered**:
- Default `uniqueKeys: false` (last-wins): Rejected — silent merge violates Constitution V.
- Only warn on duplicates: Rejected — spec requires error.

### 7. Missing `build_config.yaml` = Empty Config (FR-003)

**Decision**: If `<app>/build_config.yaml` does not exist, the app's `BuildConfig` is `{ build_config: {}, build_env: {} }` and `env_requirements` contributes nothing. Only `.ycsf/apps.yaml` presence is mandatory (missing it → hard IO error).

**Rationale**:
- FR-003 / US-5: absence of `build_config.yaml` is not an error. Some apps rely on builder defaults.
- An app with no build_config still participates in the depends_on graph and may still be built.

**Alternatives Considered**:
- Treat missing build_config as error: Rejected — contradicts FR-003/US-5.
- Store `void`/null: Rejected — spec says "build_config = пустой объект", so normalize to `{}`.

### 8. Sync vs Async: Sync Load for the Library API

**Decision**: `loadProjectModel(rootDir)` is synchronous. File reads use `fs.readFileSync`/`existsSync`.

**Rationale**:
- The model is small (KBs of YAML); no streaming, no network. Sync keeps the API simple and matches the "load at startup" consumption pattern (CLI, other specs).
- The overall decision cost of blocking is negligible at this scale (<500ms anyway). Deterministic and easy to test.

**Alternatives Considered**:
- Async (`readFile` promises): Valid and fine, but adds `await`/`Promise` plumbing with no benefit for this data volume.
- Lazy/deferred validation: Rejected — spec requires all validation at load.

### 9. Identity Collision Semantics (apps vs resources)

**Decision**: After loading both `apps.yaml` and `resources.yaml`, build a set of all `resource_id`s (prefixed by their domain, e.g. `functions.my_func`, `queues.events`) and a set of `app_id`s; any logical identity present in both → `PML_IDENTITY_COLLISION` error naming the identity.

**Rationale**:
- Constitution VI + spec FR-008 / US-3: one logical identity cannot be both a managed app and an external resource.
- Note the identity grammar: app_id is a bare identifier; resource logical identity is `domain.name`. The collision is detected on the *app_id ↔ resource_id* basis across the same logical family (see data-model for exact matching rule).

**Alternatives Considered**:
- Allow and let later specs resolve: Rejected — constitution VI ownership is "жёсткая, без флагов".

### 10. Builders / `builder` value validation deferred

**Decision**: `builder` is stored as an opaque string; unknown builder identifiers are **not** an error at model load (layout-level validation only). Dangling `depends_on` targets the app identity, not builder.

**Rationale**:
- Spec Assumption line 322: "builder value проверяется на известность в builder registry (spec 013), не при загрузке модели".
- `source_path` existence also deferred (spec 020 `ycsf check`).

### 11. `resources.yaml` domains

**Decision**: Accept the minimal domain set `queues`, `buckets`, `functions`; unknown top-level domain keys are still collected as resources (grouped by domain) — the spec's "minimal set ... расширение — spec 019" is about *typed handling*, not a reject-list. For this spec, any top-level key whose value is a map of `resource_id → {}` is treated as a resource group; the three known domains are documented but validation does not reject unknown ones.

**Rationale**:
- Spec Assumption (line 324) lists a minimal set but defers enumeration to spec 019. Rejecting unknown domains now would break forward compatibility; the model is read-only here.

## Performance Considerations

- Single pass reads: read each file once, parse once.
- `env_requirements` is a Set; regex runs over each unique string value once.
- DependsOn graph O(V+E).
- Well under SC-001's 500ms for the referenced 5-app/3-resource/10-ENV project.

## Dependencies to Add

```json
{
  "dependencies": {
    "yaml": "^2.9.0"
  }
}
```

Note: added to `packages/pilot` (not the contracts subpath, which stays dependency-free).
