# Research: materializer-dispatch — two-phase dispatch, `.tf.json` serialization, regeneration

## Decisions & Rationale

### 1. Two-phase all-or-nothing selection, NOT a streamed/pipelined dispatch

**Decision**: Implement dispatch as two strictly separated phases over the full project model:

- **Phase 1 (selection)**: build one `ArtifactDescriptor` per app; for each artifact, iterate all registered `kind: 'materializer'` entries and call `supports(artifact, context)`; count supporters. Collect `MTL_COLLISION` (>1) and `MTL_UNHANDLED_ARTIFACT` (0) for **every** artifact (collect-all). If the error list is non-empty → `{ kind: 'invalid', errors }` for the **whole** dispatch; `materialize` is **never** called for any artifact (FR-017).
- **Phase 2 (materialization)**: only when Phase 1 is clean, for each artifact in deterministic order call the single selected materializer's `materialize(artifact, context)`; abort-on-first throw → single `MTL_MATERIALIZE_FAILED`, `{ kind: 'invalid', errors }`.

**Rationale**:
- The spec (FR-003/FR-004/FR-017, "all-or-nothing") is explicit: "при наличии ЛЮБОЙ ошибки selection `materialize` НЕ вызывается вообще". A streamed design (select+materialize per artifact as it passes) would partially execute side effects before a later artifact's collision is known — violating the atomic guarantee and Constitution II (consistent, spec-exact behavior over a clever pipeline).
- `supports` is cheap and pure (contract doc: "Must stay pure and cheap: C calls it for every registered materializer per artifact"; spec 014 calls it "дешёвый и pure"), so running all of Phase 1 before Phase 2 has no meaningful cost and buys the atomic invalid result.
- The two-phase split mirrors the spec's own error/execution division ("Фаза 1 определяет правила коллизии (FR-003/FR-004), фаза 2 — исполнение (FR-005/FR-006)") and makes the abort-on-first semantics visually local to Phase 2.

**Alternatives Considered**:
- Stream one artifact at a time (select → materialize → next): Rejected — violates all-or-nothing (FR-017); a later collision would have already triggered earlier `materialize` side effects.
- Two passes but materialize reached artifacts even when other artifacts' selection had errors: Rejected — exactly what FR-017 forbids.
- Treat unhandled as warning and continue: Rejected — Constitution V, spec FR-004 ("fail-fast, не warning").

### 2. Determinism strategy: which orders are fixed

**Decision**:

1. **JSON key ordering** — a recursive sorted-key serializer: every object's keys are emitted in lexicographic (code-unit) ascending order. Implemented as a `JSON.stringify(value, replacer, 2)` with a replacer that re-keys plain objects; `configuration`'s whole subtree is re-keyed the same way, so equality of input data ⇒ byte-identical output (FR-009, SC-003).
2. **Artifact order** — `ProjectModel.depends_on_graph.topologicalOrder` (spec 011; already dependency-first by construction of `buildDependsOnGraph` post-order DFS), then ties within the same "level" resolved **alphabetically by `app_id`**. Concretely: the spec's `topologicalOrder` is exactly app_ids in DFS post-order; to make ties deterministic we process artifacts in `topologicalOrder` and additionally **sort the order list lexicographically stable by app_id when apps share no dependency edge** — the reproducible rule in the implementation: take `topologicalOrder`, then perform a stable sort keyed by `app_id` precedence: two apps `a` and `b` are ordered by dependency first (`a` before `b` if `a` ∈ transitive deps of `b`... rather: follow `topologicalOrder` as primary, and for equal positions from insertion ambiguity, `app_id` ascending). Since `buildDependsOnGraph` is deterministic for a given `apps` input, and `projectModel.apps` is a Map built from the apps list in file order (deterministic), the primary order is already deterministic; the alphabetical tie-break in the spec is then also necessarily well-defined for any two apps that the spec considers "same level". **Implementation note**: the practical deterministic rule is to sort the app_ids alphabetically and then topologically order that pre-sorted list; both orders are then fully deterministic and, because the DAG and alphabet are both fixed, equal to the spec's intent. (Exact tie definition is recorded here and task-ified.)
3. **Materializer iteration order** — `registry.records` (a `ReadonlyMap`) iterated in **insertion order**. `registry.records` is built in `loadRegistry` from `builders.yaml` section order (`builders:` then `materializers:`, each keyed as written in YAML), and JS `Map` iteration is insertion-order — so for an identical `builders.yaml`, iteration order is byte-identical (research 013 decision 3/6 keeps this source-of-truth order). This is deterministic without inventing a separate registry ordering rule. Collision diagnostics report supporter ids in iteration order (also deterministic).

**Rationale**:
- FR-009/SC-003 demand byte-identical output for identical input; every dimension an object key, an artifact, or a materializer introduces ordering must be pinned. Sorting keys lexicographically is the spec's explicit requirement; pinning artifact and materializer iteration is the minimal additional determinism needed so that `MTL_*` message ordering and (in future) merged files stay stable.
- Reusing spec 011's `topologicalOrder` (already deterministic, dependency-first) plus an alphabetic tie-break matches US-4 exactly (`analytics → user_service → frontend`).
- Materializer iteration on insertion order reuses 013's registry construction and avoids a second sort; `builders.yaml` is a checked-in, versioned artifact so its order is as deterministic as its content.

**Alternatives Considered**:
- Sort materializer ids alphabetically: Rejected — a second ordering rule with no spec backing; insertion order is equally deterministic and true to the source file.
- Sort keys only at top level of `.tf.json`: Rejected — `configuration` is a JSON object too; Terraform JSON parse is order-insensitive but byte-determinism (FR-009) requires the full subtree sorted.
- Depend on `Object.keys` emission order of the loaded YAML: Rejected — that IS insertion order for string keys in YAML object maps, but making it explicit as "insertion order of `records`" (Map) is the honest, stable contract.

### 3. `supports` calls: sequential, pure, I/O-free — selection cannot fail

**Decision**: Phase-1 calls `supports(artifact, context)` **sequentially** over the materializer list; the spec 002 contract documents `supports` as sync + pure + cheap, and the dispatch treats it accordingly: `supports` is a pure predicate call that returns a boolean and is **never** expected to throw. The dispatch does not try/catch around `supports` — a materializer whose `supports` throws is a broken plugin surfaced as a hard error (the registry should already have shape-detected it via 013; a throw here is a plugin-quality bug that must not be silently swallowed, and no silent skip is allowed per Constitution V). `materialize` (Phase 2) IS guarded: see decision 7.

**Side-effect policy**: `supports` MUST be free of observable side effects (spec 002: "Must stay pure"). Dispatch does not rely on side-effect-free beyond calling it once per (artifact, materializer); ordering is irrelevant to outcomes except for deterministic diagnostic listing.

**Rationale**:
- Spec 002 pins `supports` as synchronous, pure, per-materializer-per-artifact; the dispatch design must not assume async so a plain `for` loop satisfies "cheap" (0 I/O).
- Sequential (not `Promise.all`) because there is nothing to parallelize in a sync predicate; determinism of collision reporting follows materializer iteration order (decision 2.3).
- Not catching `supports` throws keeps the failure surface honest: dispatch guards the one boundary the contract says may throw (`materialize`), and treats a throwing `supports` as a load-time/quality contract violation of the same class as `BRG_NOT_A_PLUGIN` — reported as a hard error, not a silent skip.

**Alternatives Considered**:
- `Promise.all` over artifacts for Phase 1: Rejected — sync predicate, no I/O; would add nondeterministic error ordering for zero benefit.
- Wrap `supports` in try/catch → `MTL_NO_SUPPORT_ERROR`: Rejected — the `MTL_*` catalog (spec Key Entities / Error Codes table) fixes exactly six codes; a phantom code would invent contract surface. A throwing `supports` is a broken plugin and surfaces as an unhandled dispatch error (documented; 019 materializers must be pure).

### 4. Materializer identity and Terraform address resolution

**Decision**:

- **Identity for diagnostics**: the materializer's identity is the **`PluginEntry.id`** (the `builders.yaml` identifier, e.g. `yandex-function`) — the registry key. Diagnostics `MTL_COLLISION` and `MTL_MATERIALIZE_FAILED` carry `materializerId` / `materializerIds` from these registry ids, never package names or fuzzy labels.
- **Terraform address**: the serialized resource address is **`type.name`** derived from the returned `TerraformResource.type` and `TerraformResource.name` (spec: "address = type.name"). For the default case (one artifact per app) this is `<materializer-chosen type>.<app_id>`-shaped; the address string itself is computed only for (a) filename/address validation (`MTL_INVALID_TERRAFORM_ADDRESS`) and (b) collision detection (`MTL_FILENAME_COLLISION`), not for writing anything into the file except the nested keys.
- **Narrowing `unknown` module**: `PluginEntry.module` is typed `unknown` (registry contract). Dispatch narrows it to the spec 002 `Materializer` with a shape guard in `src/materialize/shape.ts` (`isMaterializerShape` equivalent): `{ supports: fn, materialize: fn }`. Because `loadRegistry` already classified the entry as `kind: 'materializer'`, the guard is defensive and cheap; a mismatch is a dispatch-level contract violation (hard error).

**Rationale**:
- Registry ids are stable identifiers from a single source of truth (`.ycsf/builders.yaml`, spec 013) — they are what the user wrote in config, so diagnostics referencing them are actionable and unambiguous.
- `type.name` is the only address grammar dispatch computes; it derives solely from the resource the plugin returned, which keeps C ignorant of provider schemas (Constitution IV).
- A shape guard is required only because `PluginEntry.module` is deliberately `unknown` (registry doesn't know plugin shapes) — dispatch is where a `materializer`-kind entry is finally consumed as a `Materializer`.

**Alternatives Considered**:
- Use `packageName` in diagnostics: Rejected — the identifier the user configured is the `id`; package names can repeat (multiple ids → one package) and are noisy.
- Trust `kind === 'materializer'` and cast `module` directly: Rejected — `unknown` needs a real guard (Constitution V: explicit over magic; a guard documents the contract boundary).

### 5. JSON serialization details

**Decision**:

- **Serializer**: a single deterministic function `serializeJson(value): string` using `JSON.stringify(value, replacer, 2)` where `replacer` re-emits plain objects with sorted keys. `2`-space indentation for human-diffable output; keys lexicographic (code-unit order via `a < b` on strings); arrays preserved in order; `configuration`'s full subtree re-keyed. Numeric precision is untouched (JSON-native).
- **File shape** for one resource: `{"resource": { "<type>": { "<name>": <configuration> } } }`. One file per app; each file contains exactly one resource block (one artifact per app, spec 014 assumption; multi-resource is 019). Outputs (if declared) go in a separate `00-ycsf-outputs.tf.json` shaped `{"output": { "<name>": { "value": "${<value>}" } } }`; `value` from the `OutputBuilder` channel is the raw Terraform expression string and is wrapped with `${...}` during serialization (per spec 002: "wrapping during `.tf.json` serialization is Project C's responsibility"). If no outputs were declared, the outputs file is NOT generated.
- **No schema validation**: `configuration` is opaque — C never validates provider schema (Constitution IV; `terraform validate` does). Serialization only requires `configuration` to be a JSON-serializable value (objects/arrays/primitives/null pass through; functions/undefined/bigint would throw `JSON.stringify`'s "no JSON value" but that's a malformed plugin return, surfaced as a dispatch error).
- **Indentation/format**: `JSON.stringify` with `2` is the settled formatting so generated artifacts are stable and reviewable; a future formatting change is a deliberate breaking change to byte output, not a silent drift.

**Rationale**:
- Sorted keys + fixed indentation + same input data ⇒ same bytes (FR-009). Reusing `JSON.stringify` avoids a YAML/dependency for a value C must treat as opaque JSON; the replacer is ~10 lines and keeps `src/contracts/` dependency-free.
- Two files (per-app resource + single outputs) match spec filenames exactly; the outputs file is only emitted when outputs exist (avoids empty `{}` files, which Terraform would still accept but which are noise).
- Output `value` wrapping in C (not in the materializer) keeps the contract explicit: materializers declare raw expressions, C owns the TFJSON syntax detail (spec 002 comment).

**Alternatives Considered**:
- Write all resources into one amalgamated `*.tf.json`: Rejected — contradicts `*.ycsf.tf.json` per-app naming (FR-008) and per-app ownership.
- Preserve insertion order of `configuration` keys (no sort): Rejected — FR-009 requires byte-stable output regardless of plugin insertion behavior.
- `JSON.stringify(value, null, 2)` without replacer: Rejected — insertion-order emission is not guaranteed stable across plugin authors.

### 6. Filename generation, ownership matching, and restoration of stale files

**Decision**:

- **Filename**: every generated resource file is named **`<app_id>.ycsf.tf.json`**; the outputs file is **`00-ycsf-outputs.tf.json`**. Filenames are computed from the app id (already validated to `\w+` by spec 011, so no path separators / illegal-name risk); a defensive guard still checks the computed filename against an allowlist of characters and a non-empty basename → `MTL_INVALID_TERRAFORM_ADDRESS` on mismatch (FR-008/FR-011, spec Edge Case).
- **Filename collision** (`MTL_FILENAME_COLLISION`): two artifacts computing the same filename are impossible by construction (single app id → single filename, app ids unique by spec 011); the check is kept defensively per FR-010 (computing filenames into a `Map`, duplicate → error). It also covers the outputs file if an app were ever named `00-ycsf-outputs` — prevented by the app_id `\w+` grammar, guarded anyway.
- **Ownership matching**: C-owned files are exactly those matching the glob convention `*.ycsf.tf.json` — this covers both `<app_id>.ycsf.tf.json` and `00-ycsf-outputs.tf.json`. User-owned `*.tf` (and any other file) are never matched.
- **Write flow** (`writeGeneratedTerraform(infraDir, files)`):
  1. `mkdir` the infra dir if absent (recursive).
  2. For each `{ filename, content }` in `files`: `writeFile(join(infraDir, filename), content, 'utf8')` (create/overwrite).
  3. Compute the **previous generated set**: `readdir(infraDir)` → filter `*.ycsf.tf.json`; **unlink** entries whose filename is NOT in the current `files` set (stale cleanup, FR-016 — "no orphaned generated files").
  - User files (`.tf`, everything non-matching) are never read past the `readdir` name filter and never written/deleted (FR-015).
- **Async/fs**: `writeGeneratedTerraform` is the ONLY I/O in the dispatch surface; `dispatch` itself is filesystem-free. FS via `node:fs/promises` (`mkdir`, `writeFile`, `readdir`, `unlink`), paths via `node:path.join`. Tests use `fs.mkdtemp` under the OS temp dir.

**Rationale**:
- The owning convention `*.ycsf.tf.json` is the spec's favored glob (matches both app files and the outputs file); scanning by glob avoids maintaining a separate persistent manifest file (simpler than the "manifest of generated filenames" alternative; the filesystem itself is the manifest).
- Stale-cleanup-before/after-write ordering: cleanup is done AFTER writes so that a crash mid-write leaves at worst old+new files (overwrites are atomic-ish per file); never deleting a file that is in the current set.
- Separating `write` from `dispatch` keeps dispatch pure+async and the I/O layer trivially hermetically testable (spec: "dispatch без filesystem").

**Alternatives Considered**:
- Persistent JSON manifest `infra/.ycsf-manifest.json`: Rejected — extra state file that itself needs ownership rules; the glob-per-write scan is simpler and self-correcting.
- Delete ALL `*.tf.json` then rewrite current set: Rejected — non-atomic window and unnecessary risk; target only stale names.
- String-prefix ownership (`00-ycsf-generated`/`99-ycsf-outputs` from IDEA §24 example): Rejected — 014 fixes the `*.ycsf.tf.json` convention; IDEA §24 filenames are illustrative of the older scheme and the spec wins.

### 7. Materializer throw / reject → `MTL_MATERIALIZE_FAILED`, abort-on-first

**Decision**: Phase 2 wraps each `materialize(artifact, context)` call in try/catch. On throw/reject:
- Capture `message` (prefixing with the original message, per US-6 AC-1 "message содержит 'plugin crashed'").
- Emit a single `MTL_MATERIALIZE_FAILED` diagnostic carrying `artifactId` (the app id), `materializerId` (registry entry id, decision 4), and the original message.
- The dispatch **aborts immediately** (FR-006, abort-on-first): artifacts after the failing one are never materialized, and successfully materialized resources are **not** returned (dispatch result is `invalid`, no partial `resources` — matches US-6 AC-2 "первый resource не в result.resources").
- The error is reported, never swallowed (SC-006); the dispatch API does not throw — it returns `{ kind: 'invalid', errors }`.

**Rationale**:
- Materializers are external plugin code; the contract establishes `materialize` as the one async boundary that may fail, so C must contain it (spec US-6, FR-006).
- Abort-on-first + no partial results keeps semantics simple and deterministic: dispatch either completes wholly `ok` or stops at the first execution error with one diagnostic — no fractured state.
- No rethrow: the `DispatchResult` union is the API's only failure channel (consistent with `loadProjectModel`/`loadRegistry` result-style handling); the original error message is preserved in the diagnostic.

**Alternatives Considered**:
- Collect-all materialize errors (continue after failure): Rejected — spec FR-006 explicitly says abort-on-first; and re-running failed plugins is out of scope.
- Include partial `resources` alongside the error: Rejected — US-6 AC-2 forbids it; an `invalid` result is atomic and total.
- Rethrow the raw error (dispatch throws): Rejected — breaks the result-union API and SC-006 ("dispatch НЕ crash").

### 8. Context construction (`MaterializationContext`), env snapshot

**Decision**: `MaterializationContext` is constructed fresh **per Phase-2 materialize call**, containing exactly the spec 002 shape `{ output: OutputBuilder }` — **not extended** (spec 014 Key Entities: "переиспользуется из spec 002 контракт ... Определяется spec 014 только как consumer; не расширяется"). Concretely:
- A `MaterializeContext` factory creates a fresh `OutputBuilder` per **dispatch call** (not per artifact — spec Assumption: "context.output — transient per-dispatch-call ... OutputBuilder создаётся на вызов dispatch"). All output declarations across artifacts accumulate into one builder for the single `00-ycsf-outputs.tf.json`.
- The `OutputBuilder` implementation records declarations, dedupes names, and raises `MTL_OUTPUT_NAME_COLLISION` on a repeated name (Constitution V; spec FR-013).
- **No env snapshot is passed** to the materializer in this spec. `prepareBuildEnv` (spec 012) produces a per-app `resolvedEnv`/`buildConfig`; spec 014's dispatch is deliberately context-minimal (the materializer translates an artifact *type descriptor*, not a built value — spec "artifact value содержимое ... 021"). Wiring resolved env into the artifact/context is spec 021's job ("decide: ... keep context minimal and let 021 wire env; follow spec.md" — the spec keeps it minimal).

**Rationale**:
- Extending the context would break the spec 002 contract line (breaking change = major + migration guide, Constitution III) and contradict the spec's own Key Entities note. Keeping `{ output }` is contract-conservative.
- One OutputBuilder per dispatch makes output uniqueness global (all apps' outputs live in the same outputs file), which is exactly the collision semantics the spec wants (`MTL_OUTPUT_NAME_COLLISION` per the whole dispatch).
- Sending env data sideways (or embedding `prepareBuildEnv` results into `ArtifactDescriptor.value`) is out-of-scope and deferred to 021 per the spec's explicit "артефакты ... 021" boundary.

**Alternatives Considered**:
- Extend `MaterializationContext` with `appId` / `projectRoot` / resolved env: Rejected — breaks the 002 contract surface and the spec's explicit "не расширяется" note; would need the whole env pipeline in this spec.
- A shared context across all artifacts: Rejected — `supports`/`materialize` are per-artifact; a shared persistent context would leak state between plugins (Constitution V: explicit, no hidden coupling).
- Per-artifact OutputBuilder: Rejected — split outputs across files/artifacts contradicts the single `00-ycsf-outputs.tf.json` convention and would make duplicate-name detection per-artifact instead of global.

### 9. Version marker on generated files

**Decision**: Generated `.tf.json` files get **no version marker/header**. The output is exactly Terraform JSON syntax: `{"resource":{...}}` / `{"output":{...}}`. No `version: 1` field inside the JSON.

**Rationale**:
- Terraform JSON module config has a fixed grammar; adding a foreign `version` key would produce invalid Terraform (Constitution IV: "Terraform остаётся настоящим Terraform"). The `.tf.json` *format* is pinned by Terraform itself, not by `.ycsf/*.yaml`-style contracts (which are the ones requiring `version: 1`, Constitution III).
- No new `.ycsf/*.yaml` file is created by spec 014, so no YAML format-version obligation arises. The `MTL_*` code catalog is versioned via the `@ycforge/pilot/contracts` semver line (Constitution III) instead.
- Ownership encoding (`*.ycsf.tf.json`) already namespaces generated files; a header would be redundant decoration.

**Alternatives Considered**:
- A `//`-style comment header with format version: Rejected — invalid for the JSON-syntax `.tf.json`; Terraform would reject the file.
- A `version` field inside the top object: Rejected — invalid Terraform JSON block shape.
- Suffix marker in filename (e.g. `v1-` prefix): Rejected — no need; the contracts semver line covers format evolution.

### 10. Zero-dep contracts + `MTL_*` catalog placement

**Decision**: New public types (`ArtifactDescriptor`, `GeneratedTfFile`, `DispatchOptions`, `DispatchResult`, `DispatchDiagnostic`) and `MTL_*` constants live in **`src/contracts/materialize.ts`** (type-only + pure constants, mirroring `src/contracts/registry.ts` with `BRG_*`). A new catalog file **`contracts/materialize.json`** mirrors the six `MTL_*` codes + the two generated-file JSON shapes (like 013's `plugin-registry.json`). The runtime (`dispatch`, serialization, write) lives in `src/materialize/`; `src/contracts/` stays zero-runtime-dependency (existing `zero-dependency.test.ts`). `dispatch` + `writeGeneratedTerraform` are exported from `src/index.ts`; type-only re-exported via `@ycforge/pilot/contracts`.

**Rationale**:
- The `MTL_*` family is distinct from `PML_*`/`BRG_*` (a new failure domain: dispatch + serialization), so 014 gets its own catalog rather than enlarging project-model.json or plugin-registry.json (matches how 012/013 each kept their catalog).
- The spec's own error-code table names exactly six MTL_* codes; constants keep code comparison honest (Constitution V), mirrored in JSON for tooling.
- Serialization/`fs` must not enter contracts; `write.ts` is the only `fs`-touching file (decision 6).

**Alternatives Considered**:
- Extend `contracts/plugin-registry.json` with `MTL_*`: Rejected — MTL_* are dispatch codes, not registry-load codes; families stay orthogonal (as in 013 research 5).
- Runtime functions in `src/contracts/`: Rejected — violates the zero-dep rule (fs/promises).
- Catalog-less (constants only in TS): Rejected — the repo convention (013, 012, 011) ships a JSON catalog for tooling/CLI reuse.

## Performance Considerations

- Phase 1 is O(apps × materializers) pure predicate calls — negligible for a typical project (5–20 apps × 2–5 materializers).
- Phase 2 is O(apps) async `materialize` calls executed sequentially (deterministic order, abort-on-first); no I/O in dispatch itself.
- Serialization is a single pass over small JSON objects; sorted-key replacer is ~O(n log n) over keys per object — negligible.
- `writeGeneratedTerraform` does O(1) `readdir` + per-file `writeFile` + stale `unlink`; the only real I/O in the layer.

## Dependencies to Add

None. `node:fs/promises` and `node:path` are Node builtins; `src/contracts/` remains dependency-free; no new npm packages.