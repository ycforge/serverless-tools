# Research: builder-registry — `.ycsf/builders.yaml`, загрузка плагинов

## Decisions & Rationale

### 1. Dynamic `import()` (native Node 22), not `createRequire`; error-shape classification

**Decision**: Load every plugin module with native dynamic `import(packageName)` (ESM-first, works for both ESM `import` and CJS modules in Node 22). Do NOT use `createRequire`. Classify failures by inspecting the rejection error:

- **`ERR_MODULE_NOT_FOUND`** (or module-not-resolvable / not found) → `BRG_PACKAGE_NOT_FOUND`.
- **`ERR_MODULE_NOT_FOUND` with a syntax/load origin or any other thrown error during module evaluation** (syntax error, top-level runtime exception, invalid module) → `BRG_LOAD_ERROR`.
- Module **loaded** but no `Builder`/`Materializer` shape → `BRG_NOT_A_PLUGIN` (a separate post-import check, not an `import()` rejection).

**Rationale**:
- `import()` is the spec's stated mechanism (spec Assumption: "dynamic `import()` поддерживает и ESM, и CJS (Node 22 … Пакеты-плагины могут быть ESM или CJS; loading mechanism единообразен)"). Using it natively keeps a single code path and matches ESM module-caching semantics (a plugin is loaded once per process — spec Assumption).
- `createRequire` would force a CJS-only resolution path and re-introduce CJS interop edge cases that native `import()` already handles (`import.meta.url`, `default`/namespace interop). Unnecessary specialized machinery (Constitution: explicit-over-magic but also no magic/vendor-specific plumbing where a standard primitive suffices).
- Dynamic `import()` accepts the full import specifier grammar — both `@scope/pkg` package names and absolute/relative file paths — which is exactly what hermetic tests need (decision 4).
- Classification by error is reliable in Node 22: `ERR_MODULE_NOT_FOUND` reliably distinguishes "cannot resolve/load the module" from "module evaluated but threw" (the latter surfaces as whatever the module threw, possibly wrapped, and is never `ERR_MODULE_NOT_FOUND`). To avoid over-fitting on the message, we check the `code` property (`error.code === 'ERR_MODULE_NOT_FOUND'`), not string-matching the `.message`.

**Alternatives Considered**:
- `createRequire`/`require()`: Rejected — CJS-only path, breaks ESM-only plugins, adds interop complexity.
- Rely on `package.json` `"exports"` presence for pre-validation before `import()`: Rejected — the registry value is a plain specifier; probing `node_modules` would reintroduce auto-discovery-like behavior and double resolution logic. Let `import()` resolve and classify the resulting error.
- String-match on `error.message`: Rejected — fragile; use `error.code` where available, fall back to category inference.

### 2. Plugin module export contract: default **or** named export; shape detection

**Decision**: After `import(packageName)`, resolve the candidate plugin object from the module namespace `ns`:

1. **Default export**: `ns.default` (if it is a non-null object) is the primary candidate.
2. **Named export**: if no usable `default`, fall back to `ns` itself (i.e. a plugin that exports `build`/`supports`/`materialize` as top-level named exports).

Then classify by shape (matching spec FR-007/FR-008 and the Assumption's `module.default?.build ?? module.build` intent):

- **Builder**: candidate has a `build` property that is a `function` → `kind: 'builder'`.
- **Materializer**: candidate has both `supports` and `materialize` present as `function`s → `kind: 'materializer'`.
- **Neither** (or candidate is not an object, or one of the required functions missing): no recognized shape → `BRG_NOT_A_PLUGIN`.

**Ambiguous module (both builder and materializer shapes present)**: classify as **builder** (builder shape priority). This matches spec US-4 AC-2 (default branch: "распознаётся как builder (shape `build` present — приоритет)"). A module exposing both is an allowed edge; builder-kind wins deterministically. Documented, not an error.

**Rationale**:
- The spec explicitly allows both default and named exports (Assumption) and explicitly prefers `default` when resolvable, then falls back to named (`module.default?.build ?? module.build`). Decision 2 makes that precise and deterministic.
- Builder-priority on ambiguity is the spec's stated default and avoids a silent double-registration; it is explicit, documented behavior (Constitution V — but here it's an unambiguous single classification, not a silent merge).
- Shape detection is structural (function-presence), matching that this spec "НЕ переопределяет" the spec 002 contracts — it only defines the *recognition mechanism* (spec Assumption).

**Alternatives Considered**:
- Error on ambiguous both-shapes module: Rejected — spec's default branch / US-4 AC-2 favors builder priority; erroring would contradict the recorded default. Kept as a documented edge rather than a new failure mode.
- Support only explicit factory exports (`createBuilder`): Rejected — spec FR-007/FR-008 and the Assumption define detection by `build`/`supports`+`materialize` presence, not by a factory-signature convention. Adding a `createBuilder` convention would be invention beyond the spec.

### 3. Sync vs async API surface

**Decision**: Two-stage, mixed-async surface on the runtime API:

- `loadRegistry(rootDir): Promise<PluginRegistryLoadResult>` — **async**. Stage 1 is a sync file pass parsing `builders.yaml` into registry entries; stage 2 awaits dynamic `import()` for each entry (partial load: collect all `PluginLoadError`s, FR-015).
- `validateBuilders(projectModel, registry): BuilderRegistryValidationResult` — **sync**, given an already-loaded registry and a valid project model (spec 011 already run).

**Rationale**:
- Dynamic `import()` is inherently async, so the plugin-loading stage must be `async`. Keeping the whole load async lets tests and the future CLI `await` a single call.
- `validateBuilders` performs no I/O — it just reads `App.builder` from the in-memory project model and the registry map — so sync keeps it simple and mirrors spec 011's sync validation philosophy (plan 011 decision 8).
- The two-stage split maps directly onto the spec's key entities: config→`BuildersYaml`/`PluginRegistry`, then load→`PluginRegistryLoadResult`, then validate→`BuilderRegistryValidationResult`.

**Alternatives Considered**:
- Fully sync `loadRegistry` (read + `require`): Rejected — `require` is CJS-only and would not load ESM plugins (decision 1); async `import()` is required.
- Fully async `validateBuilders`: Rejected — unnecessary `await` plumbing with no I/O benefit; the model and registry are already in memory.

### 4. Hermetic test fixtures WITHOUT publishing packages

**Decision**: A test helper creates temporary plugin modules as `.mjs` (ESM) and `.cjs` (CJS) files on disk. The `builders.yaml` registry value is an **import specifier**, and `import()` natively accepts both package names (`@scope/pkg`) and file paths (absolute or relative). Therefore:

- In **hermetic tests**, the test project's `builders.yaml` `builders:`/`materializers:` values point at the on-disk fixture files (e.g. absolute paths or relative-to-project path derived from the temp root).
- In **production**, the same value field holds npm package specifiers (`@ycforge/builder-nestjs-function`), which `import()` resolves from `node_modules`.
- No package publishing, no `node_modules` mutation, no network — fully deterministic and test-first friendly.

**Rationale**:
- `import()`'s specifier grammar is deliberately permissive (ECMAScript module specifier = package name OR path), so reusing it for fixtures requires no new abstraction and does not weaken the explicit-mapping principle: the test still goes through the **exact same loader code path** (parse `builders.yaml` → `import(value)` → shape-detect). Only the *value* differs (path vs package name), never the loading mechanism.
- This keeps FR-012 (explicit mapping only) intact: fixtures are still loaded by explicit reference, not auto-discovery.
- Reuses the existing `test/helpers/temp-project.ts` pattern (spec 011) — the same temp-project root can hold `.ycsf/builders.yaml` and the fixture module files.

**Alternatives Considered**:
- Registry accepts a special "fixture override" map bypassing `builders.yaml`: Rejected — adds a second loading mechanism and diverges test and prod code paths; harms the "spec testability through real mechanism" goal.
- Publish real packages locally / link via `file:` overrides: Rejected — heavier, slow, fragile across environments; defeats hermetic fast unit tests.
- Mock the module loader entirely (no real `import()`): Rejected — loses the CJS/ESM interop + error-classification coverage that acceptance scenarios require (BRG_PACKAGE_NOT_FOUND etc.); a thin real-`import()` layer with fixture files stays honest to the contract.

### 5. BRG_* code granularity and catalog placement

**Decision**: Use a **new catalog file** `contracts/plugin-registry.json`, NOT `contracts/project-model.json`. BRG_* are a distinct family from PML_* (these are plugin-registry load codes, not project-model codes). Catalog covers three buckets:

- **Structural** (builders.yaml parse/validation, mirroring PML_* style in `src/model/parse.ts`): `BRG_VERSION` (missing/invalid `version`), `BRG_MISSING_FILE` (`.ycsf/builders.yaml` absent), `BRG_DUPLICATE_KEY` (duplicate key within `builders` or `materializers`, uniqueKeys), `BRG_KEY_COLLISION` (same identifier in both `builders` and `materializers`), `BRG_INVALID` (non-string/empty value, empty key, bad top-level shape).
- **Load** (from spec FR-009/010/011): `BRG_PACKAGE_NOT_FOUND`, `BRG_NOT_A_PLUGIN`, `BRG_LOAD_ERROR`.
- **Validation** (from spec FR-013): `BRG_UNKNOWN_BUILDER`.

Constants live in `src/contracts/registry.ts` (pure, like `PML_*` in `src/contracts/project-model.ts`), compared via constants, never string literals (Constitution V). The JSON catalog mirrors them for tooling.

**Rationale**:
- The spec explicitly uses the `BRG_*` prefix (not `PML_*`), signalling a distinct family; co-locating them with PML_* in `project-model.json` would blur the ownership model and the spec's explicit naming. A new `plugin-registry.json` keeps each catalog self-describing (mirrors how spec 012 kept `build-env.json` separate while cross-referencing the shared PML catalog).
- The spec.md does not itself fix the catalog file; this is the recorded default (per scope instructions: "probably a NEW catalog file" — confirmed here).
- Granularity: one code per distinct failure mode so consumers (020/021 CLI) can branch precisely (SC-003: "ни одна ошибка не становится warning; каждый diagnostic уникален").

**Alternatives Considered**:
- Extend `contracts/project-model.json` with BRG_* codes: Rejected — BRG_* are not PML_* project-model codes; keeps families orthogonal.
- Single generic `BRG_LOAD_FAILED` for all plugin failures: Rejected — SC-003/FR-009..011 require distinct codes per failure category.

### 6. Registry immutability / freezing

**Decision**: The public `PluginRegistry` is an **immutable, read-only** structure exposed to consumers. Internally it is built as a frozen object with a read-only entries map; after `loadRegistry` resolves (ok or invalid), no mutation API is exposed. Loaded module handles are cached within the registry instance (spec Assumption: plugin loaded once, ESM module caching).

**Rationale**:
- Immutability matches the existing public contract style (`readonly` fields throughout `@ycforge/pilot/contracts`) and prevents downstream consumers (014 materializer dispatch, 021 build) from mutating registry state, which would be a source of subtle bugs.
- Reflects "one source of truth" (Constitution V): the registry is a snapshot of a validated load, not a mutable accumulator.

**Alternatives Considered**:
- Mutable `Map` exposed directly: Rejected — allows accidental mutation and inconsistent state.
- Deep-freeze via `Object.freeze`: lightweight and acceptable for the small entry set; the read-only `ReadonlyMap` typing is the primary enforcement, `Object.freeze` the belt-and-suspenders.

### 7. Duplicate-key semantics for `builders.yaml`

**Decision**: Parse `builders.yaml` with the **same** `parseDocument(text, { uniqueKeys: true })` convention as spec 011's `src/model/parse.ts`. A duplicate key within `builders` (or within `materializers`) → `BRG_DUPLICATE_KEY`. A repeated identifier across `builders` AND `materializers` → `BRG_KEY_COLLISION` (spec FR-003, Constitution V collision = fail-fast), detected during the structural pass **before** any dynamic import (SC-004).

**Rationale**:
- Mirrors spec 011 exactly (research 011 decision 6): `uniqueKeys: true` turns repeated YAML keys into an error rather than silent last-wins.
- The builders↔materializers collision is a cross-section check on the already-parsed maps — trivially done before plugin loading, satisfying SC-004 ("до任何 dynamic import").

**Alternatives Considered**:
- Let YAML silently last-wins: Rejected — violates Constitution V.
- Only warn on duplicates: Rejected — spec FR-003 requires error.

### 8. `validateBuilders` diagnostics shape

**Decision**: `validateBuilders` returns a `BuilderRegistryValidationResult` of `{ kind: 'ok' }` or `{ kind: 'invalid'; errors: ProjectModelDiagnostic[] }`, reusing the **existing** `ProjectModelDiagnostic` shape (it already carries `code`, `message`, `file`, `app`, `field`). Each unknown builder yields one `BRG_UNKNOWN_BUILDER` diagnostic carrying `app` (app_id) and a message listing the available builders; **all** unknown builders are reported (not just the first).

**Rationale**:
- Reusing `ProjectModelDiagnostic` avoids inventing a parallel diagnostic type and lets 020/021 CLI handle validation uniformly. It already has `app` and `file` fields that BRG_UNKNOWN_BUILDER needs.
- Collect-all (one per unknown app) matches the user story US-5 AC-3 ("выданы обе ошибки") and specs' collect-all philosophy (011 decision 3, 013 FR-013 "на каждый app").
- `file` is the app's `build_config.yaml`/`apps.yaml` source; `field` is `builder`.

**Alternatives Considered**:
- Dedicated `BuilderValidationDiagnostic`: Rejected — unnecessary duplicate type; `ProjectModelDiagnostic` fits and keeps consumers uniform.
- Fail on first unknown builder (throw): Rejected — contradicts collect-all (US-5 AC-3) and the return-result philosophy.

## Performance Considerations

- `builders.yaml` is small (~KB); parse once, structural pass once.
- Dynamic `import()` of N plugins is the dominant cost; Node 22 memoizes modules so subsequent loads reuse handles. Parallel-starting the `import()` calls (`Promise.all` over entries, then classify) keeps runtime near the slowest single plugin (SC-001 < 2s for 5 plugins).
- `validateBuilders` is O(apps) map lookups — negligible.

## Dependencies to Add

None. `yaml@^2` is already a `@ycforge/pilot` dependency (spec 011); dynamic `import()` is a Node builtin. `src/contracts/` remains dependency-free.
