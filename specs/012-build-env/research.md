# Research: build-env — `{{$ENV}}` интерполяция, `build_env` resolution, ENV runtime validation

## Decisions & Rationale

### 1. Interpolation Algorithm: Shared String-Leaf Walk (reuse, not duplicate)

**Decision**: Extract the string-leaf traversal from spec 011's `env-requirements.ts` into a reusable, exported helper (`walkStringLeaves(value, visit)` returning/replacing leaves) and have **both** the spec 011 collection path and the spec 012 interpolation path use it. The interpolation pass is a **mutating deep transform**: it walks the same structure but replaces each string leaf with its fully-interpolated form (or reports an unresolved reference).

**Rationale**:
- Spec FR-001 explicitly says interpolation must be "глубоко рекурсивно, как `env-requirements.ts` `collectStringLeaves`" — i.e. the two passes share the same shape semantics (objects, arrays, and string leaves; all other JSON scalars skipped).
- Duplicating the traversal invites drift: a future change to "which leaves count" (e.g. new scalar type) would branch across two copies. One canonical walk keeps the load-time requirement extraction (011) and the runtime substitution (012) consistent — both operate on identical inputs.
- The 011 `collectStringLeaves` only *collects* into a flat array; 012 needs *replace-in-place*. So the shared primitive is a generic leaf mapper: `forEachStringLeaf(value, (leaf, setLeaf) => void)` where `setLeaf` writes the replacement back. 011's collector becomes a thin `forEachStringLeaf` consumer; 012's interpolator becomes another. This avoids mutating the original (we produce a **new** interpolated `build_config`, leaving the loaded model read-only — important for determinism and for not corrupting the shared `ProjectModel`).
- Because we rebuild maps/arrays rather than mutate in place, the interpolation result is a fresh deep-cloned value — the original `build_config` in the model stays intact.

**Alternatives Considered**:
- Duplicate an independent `interpolateStringLeaves` in `src/build-env/`: Rejected — violates DRY and risks semantic drift between load-time and runtime leaf definitions.
- Mutate the loaded model's `build_config` in place: Rejected — makes the shared `ProjectModel` non-reentrant and non-deterministic across app preparations; we must not corrupt the read-only model.
- Reuse the exact private `collectStringLeaves` via export and re-collect then rebuild by path: Rejected — path-tracking is more complex than a leaf mapper that carries a `setLeaf` writeback.

---

### 2. `process.env` Read: Snapshot at Entry (per spec assumption)

**Decision**: Capture environment once at the entry of the per-app prep operation into a `Readonly<Record<string, string | undefined>>` snapshot, defaulting to `{ ...process.env }` (or `process.env` reference), and pass it down to all sub-steps. The public entry accepts an optional `envSnapshot` override purely for hermetic testing and determinism; production callers omit it and use `process.env`.

**Rationale**:
- Spec Assumption: "значения берутся один раз на момент runtime-prep (после load-time validation). Изменения `process.env` внутри runtime-prep не отслеживаются." A single snapshot is the simplest faithful implementation and guarantees SC-002 (determinism: same inputs → binary identical output).
- Testability: spec 011 already uses `vi.stubEnv`/`vi.unstubAllEnvs`; an explicit snapshot parameter lets us pass controlled values without mutating the host process in every test (cleaner, parallel-safe).

**Alternatives Considered**:
- Read `process.env` live at each substitution: Rejected — violates the snapshot assumption and breaks determinism if env changes mid-prep.
- Always default to `process.env` reference with no override: Rejected — less testable; the override costs nothing.

---

### 3. `build_env` Resolution Order & Semantics

**Decision**: Process `build_env` as an ordered map in **declaration (insertion) order** of the YAML object. For each entry `ENV_NAME → EnvValue`:
- `kind:'null'` → read `envSnapshot[ENV_NAME]`; if `undefined` or `''` (empty string) → fail-fast `PML_ENV_UNRESOLVED` (matches `env-requirements.ts` `isSet`: empty = not set); else resolved value = that string.
- `kind:'literal'` (no `{{$…}}`) → resolved value = the literal as-is.
- `kind:'interpolated'` (contains one or more `{{$NAME}}`) → substitute each `{{$NAME}}`; a referenced var that is `undefined` or `''` → fail-fast `PML_ENV_UNRESOLVED` naming that var.

Output: `resolvedEnv: Record<string,string>` (no `null`, no `{{$…}}`), stable and deterministic in the source order.

**Rationale**:
- Column 3 of the spec table (FR-004/005/002) directly defines the three behaviors; this decision formalizes them into a single ordered pass.
- Declaration order matters for determinism (SC-002): iteration over `Object.entries` on a plain parsed object preserves YAML insertion order for string keys in modern V8, but we record the output as a map whose own order is a stable function of input order — tests assert by key lookup, not by ordering, so this is robust.
- Empty string ≡ not set is inherited from 011 (`isSet`), keeping both phases mutually consistent on the same definition (FR-007/011).

**Alternatives Considered**:
- Treat empty string as set (resolve to `''`): Rejected — spec Edge Case and 011's `isSet` explicitly treat `''` as not set; diverging would let empty values reach the builder.
- Alphabetical output ordering: Rejected — no semantic need; declaration order is simpler and less surprising.

---

### 4. Residual-`{{$` Detection & Cross-Namespace Safety

**Decision**: Detection of unresolved interpolation runs **only** the exact `{{$NAME}}` pattern (`/\{\{\$[A-Z0-9_]+\}\}/`), the same `ENV_REF_RE` grammar from 011. After producing the interpolated string, if any `{{$NAME}}` remains **or** any referenced var was empty/unset → fail-fast with `PML_ENV_UNRESOLVED`. Because `${...}` and `${resources...}` do **not** match `{{$NAME}}`, they are structurally impossible to mis-treat as env refs; the algorithm simply never matches them. No escaping/allow-list needed for those namespaces.

**Rationale**:
- The three namespaces (IDEA §19) have disjoint grammars: `{{$...}}`, `${...}`, `${resources...}`. The first two share no leading `{{`-`}}` vs `${`-`}` collision, and `${resources...}` is a `${`-form too. A regex anchored on the literal `{{$` + `[A-Z0-9_]+` + `}}` is unambiguous.
- FR-008/FR-010 require that `${resources...}` / `${...}` "НЕ обрабатываются" and "не трогаются". Since the substitution routine only anchors on `{{$`, it cannot touch `${}`-forms; the design documents this as an invariant and locks it with a dedicated test (quickstart Sc6 / a cross-namespace splice scenario).
- Requirement edge — residual detection *after* substitution: the algorithm substitutes each matched `{{$NAME}}`; a well-formed `{{$NAME}}` that maps to an empty/unset var is *not* substituted and *is* reported (via `PML_ENV_UNRESOLVED`), so a malformed/unresolved case always fails fast rather than leaking `{{$...}}` to the builder. The SC-004 invariant ("ни одного `{{$` в переданном builder-у") is enforced by construction + final assert.

**Alternatives Considered**:
- A generic `{{`/`}}` scanner that also inspects `${...}`: Rejected — over-broad, risks configurating cross-namespace collisions and violates FR-010's "не мой namespace" stance (SC-006).
- Escaping mechanism (e.g. `\{{$X}}` to emit a literal): Rejected — spec explicitly forbids any escape/default mechanism; namespace remains strict.

---

### 5. `PML_ENV_UNRESOLVED` Semantics & Catalog Update

**Decision**: Introduce the new additive runtime code **`PML_ENV_UNRESOLVED`** in the `contracts/project-model.json` `#/errorCodes` catalog (alongside load-time `PML_ENV_NOT_SET`) AND in `src/contracts/project-model.ts` as a constant (`export const PML_ENV_UNRESOLVED = 'PML_ENV_UNRESOLVED'`). The JSON is updated **additively** (a new required code entry; no existing code removed/re-keyed), per spec FR-008 clarify and Constitution III (semver-compatible addition, no `version` bump). The diagnostic reuses the `ProjectModelDiagnostic` shape (app/field/message, FR-015) with `code = PML_ENV_UNRESOLVED`.

**Rationale**:
- FR-008 (post-clarify, requirements.md note): runtime-prep phase is distinguishable from load phase via its own code so spec 020/021 can report "which phase failed". Keeping one code for both would erase that distinction.
- Additive change is non-breaking (Constitution III): consumers comparing against known `PML_*` constants still match; new code is simply an added known value. The machine-readable JSON is the source of truth; the TS constant must mirror it (Constitution V: compared via constants, never string literals).
- `version: 1` on `.ycsf` formats is untouched — the code is a runtime diagnostic, not a format-version change.

**Alternatives Considered**:
- Reuse `PML_ENV_NOT_SET` for runtime failures: Rejected — conflates load and runtime phases, breaking the FR-008 clarify decision and phase-distinction requirement.
- A separate `RUNTIME_*` code family: Rejected — unnecessarily splits the catalog; `PML_*` already is the project-model/catalog namespace and the diagnostic shape is identical.

---

### 6. Per-App Isolation

**Decision**: `prepareBuildEnv(appId, buildConfig, envSnapshot?)` computes the resolved env + interpolated build_config **only** for the given app, from that app's own `BuildConfig`. No module-level mutable state is shared across app calls; each preparation is independent, deterministic, and idempotent given the same inputs.

**Rationale**:
- FR-014 requires per-app resolution based on the app's own `BuildConfig`; an app must never see another app's resolved variables.
- Stateless/immutable prep supports SC-002 (determinism) and robustness: concurrent preparation of multiple apps (future 021 batch flow) cannot cross-contaminate.
- The loaded `ProjectModel` remains read-only (research decision 1 produces fresh interpolated values), reinforcing isolation.

**Alternatives Considered**:
- A stateful "preparation session" that resolves the whole model at once with shared caches: Rejected — introduces cross-app coupling and non-determinism risk; per-app stateless prep is simpler and spec-conformant.

---

### 7. Public Entry & Result Shape

**Decision**: The public runtime entry is `prepareBuildEnv(appId: string, buildConfig: BuildConfig, envSnapshot?: Readonly<Record<string,string|undefined>>): BuildEnvResolutionResult`, where `BuildEnvResolutionResult` is either a success (`resolvedEnv: Record<string,string>` + `buildConfig: unknown` = interpolated opaque config) or a fail-fast error set (`errors: ProjectModelDiagnostic[]`). Success and failure are mutually exclusive (spec `BuildEnvResolutionResult` invariant). The success case is mapped into spec 002 `BuildContext` at the boundary (spec 021 wires `resolvedEnv → buildEnv`, `buildConfig → buildConfig`); this module does **not** construct a `BuildContext`.

**Rationale**:
- Mirrors the 011 load result philosophy (`{ kind:'ok' } | { kind:'invalid' }`): the caller always has a typed, exhaustive path, and a *validation/prep failure never throws* — it returns an error set (consistent with `ProjectModelError` philosophy; only catastrophic I/O throws, which does not apply here).
- Deliberately keeping the builder-boundary mapping out of this module preserves the spec-002 contract boundary: this spec defines the *materialized input* (new types), spec 021 wires it into `BuildContext`. FR-009 explicitly says "не изобретать новый build-API / переиспользовать shapes".

**Alternatives Considered**:
- Return a partial success with accumulated warnings: Rejected — violates the exclusivity invariant in spec (never mixed state; fail-fast).
- Have this module produce a filled `BuildContext` directly: Rejected — spec 021 owns builder invocation; producing a Builder-specific context here couples this module to a future spec and violates the boundary-contract framing.

---

## Performance Considerations

- Single pass over `build_config` string leaves (regex substitution) + single pass over `build_env` entries.
- Snapshot copy of `process.env` is O(V) trivial at the referenced scale (~10 vars).
- Deep-clone-and-interpolate of `build_config` builds one new value tree per app; at typical builder-config sizes (tens of leaves) this is negligible.
- Well under SC-005's 50ms added to load for the 5-app / 10-ENV project.
- Deterministic: same inputs → binary identical output (SC-002).

## Dependencies to Add

None. No new runtime or dev dependencies. Reuses `@ycforge/pilot/contracts` types/constants and the existing spec 011 model internals (walk helper, `diag`, `isRecord`).
