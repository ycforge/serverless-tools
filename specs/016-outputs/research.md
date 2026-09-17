# Research: outputs -- `.ycsf/outputs.yaml`, auto-generated outputs, `ycsf_` prefix, `99-ycsf-outputs.tf.json`

## Decisions & Rationale

### 1. IDL resolution for user outputs: reverse lookup + IDL index

**Decision**: IDL-reference `domain.name.property` (3 segments, `ResourceReference` grammar from contract 002) resolves to `${terraform_type.name.property}` via two steps: (1) reverse lookup `DOMAIN_TO_TF_TYPE` -- frozen `Readonly<Record<string, string>>`, derived from `IDL_DOMAIN_BY_TF_TYPE` (spec 015) at module load time; (2) check existence of `domain.name` in the IDL index `createIdlIndex` (spec 015). Property is NOT validated against provider schema (Constitution IV).

**Rationale**: Spec section 26 requires resolving `gateways.openapi.domain` to `${yandex_api_gateway.openapi.domain}`. `parseResourceReference` (contract 002) parses 3 segments and throws `ContractError` on grammar violation -- mapped to `OUT_INVALID_VALUE` in `buildOutputs`. `DOMAIN_TO_TF_TYPE` is derived from `IDL_DOMAIN_BY_TF_TYPE`: single source of truth, additive growth by spec 019. External resources are not in the index (Constitution VI).

**Alternatives**: Extending `idlFor` to 3 segments (rejected: mixes identity and expression semantics); resolution via provider schema (Constitution IV); separate constant without derivation (duplication).

### 2. Merged file location: `99-ycsf-outputs.tf.json` and `00-` to `99-` migration

**Decision**: Canonical filename is `99-ycsf-outputs.tf.json` (section 26). Code from spec 014 (`dispatch.ts:70-75`, `serialize.ts:serializeOutputs`) is replaced: `00-ycsf-outputs.tf.json` stops being generated; `buildOutputs` from spec 016 generates `99-ycsf-outputs.tf.json`. Orphan mechanism in `write.ts` removes the old `00-` file on first run.

**Rationale**: Section 26 is normative; `99-` suffix does not conflict with `<app_id>.ycsf.tf.json` (FR-020); regex in `write.ts` already covers it; spec-vs-code divergence resolved -- spec wins.

**Alternatives**: Keep `00-` (rejected: section 26); no prefix (rejected: regex); manual migration (rejected: orphan mechanism already solves it).

### 3. `ycsf_` prefix + collision semantics: three error levels

**Decision**: Three levels of collision control:
1. **Materializer-level** (`MTL_OUTPUT_NAME_COLLISION`, spec 014): materializer declares the same output name twice via `OutputBuilder.declare` -- error at dispatch-level, before merge. Code remains.
2. **Merge-level** (`OUT_DUPLICATE_NAME`): output name appears more than once in the merged file (user+user, user+auto, auto+auto). Collect-all, all-or-nothing.
3. **Prefix enforcement** (`OUT_INVALID_AUTO_PREFIX` for auto-generated without `ycsf_`; `OUT_RESERVED_PREFIX` for user with `ycsf_`): Constitution V -- explicit, not silent fix.

**Rationale**: spec 014 `MTL_OUTPUT_NAME_COLLISION` remains for dispatch-level detection (before merge). `OUT_DUPLICATE_NAME` is the unified point for the full user + auto picture in the merged file. Both codes are valid in one pipeline (different stages).

**Alternatives**: Full replacement of `MTL_OUTPUT_NAME_COLLISION` with `OUT_DUPLICATE_NAME` (rejected: dispatch-level detection is valuable); silent merge on duplicates (Constitution V).

### 4. Error codes and diagnostics shape

**Decision**: `OutputsDiagnostic` -- separate type mirroring `ExtensionsDiagnostic` (spec 015) with `target` replaced by `name`:

```typescript
interface OutputsDiagnostic {
  readonly code: string;            // OUT_* constants
  readonly message: string;
  readonly name?: string;           // output name (OUT_RESERVED_PREFIX, OUT_DUPLICATE_NAME, etc.)
  readonly file?: string;           // populated by loader for structural errors
  readonly field?: string;
  readonly line?: number;
  readonly column?: number;
  readonly availableIdls?: readonly string[];  // OUT_UNRESOLVED_IDL only
}
```

`OUT_*` constants live in `src/contracts/outputs.ts` (zero-dep, type-only + constants). Mirror: `contracts/outputs.json`.

**Rationale**: Unified shape for loader + build phase diagnostics (like `ExtensionsDiagnostic` in 015). Field `name` instead of `target` -- semantically more accurate for outputs context. `availableIdls` for helpful message on `OUT_UNRESOLVED_IDL` (pattern `EXT_UNRESOLVED_TARGET`).

**Alternatives**: Reusing `DispatchDiagnostic` (rejected: different code family); reusing `ProjectModelDiagnostic` (rejected: different field `app` vs `name`); merging with `ExtensionsDiagnostic` (rejected: orthogonal families).

### 5. Loader: `loadOutputs(rootDir): OutputsLoadResult`

**Decision**: Pattern `loadExtensions` (spec 015): `readFileSync` + `parseOutputsYaml` (parse-gate `parseDocument(text, { uniqueKeys: true })`). Structural errors produce `OUT_INVALID`/`OUT_VERSION`; missing file throws `OUT_MISSING_FILE`. Duplicate names and IDL grammar of value are NOT checked in loader (that is `buildOutputs` territory, as in 015: `loadExtensions` != `applyExtensions`).

**Rationale**: Phase separation: loader = structural (YAML syntax, version, shape, duplicate YAML keys); buildOutputs = semantic (IDL resolution, prefix, user+auto duplicates). Pattern 015: `parseExtensionsYaml` for structural, `applyExtensions` for semantic. Single entry point for 020 check: `loadOutputs` + `buildOutputs` = full validation.

**Alternatives**: Merging loader + build into one function (rejected: breaks 015 pattern; loader is I/O, buildOutputs is pure transform); parsing without AST (rejected: lose line/column for diagnostics).

### 6. Determinism: sorted keys via `serializeJson`

**Decision**: Final serialization in `buildOutputs` uses `serializeJson` from spec 014 (`SORTED_KEY_REPLACER`, JSON keys lexicographic at every level). `${...}` wrapping applied during resolution (user outputs) and during assembly (auto-generated outputs). Description omitted when absent (not written to JSON); `description: ` (empty string) is preserved -- intentional user choice.

**Rationale**: SC-001/FR-012/FR-019: deterministic repeated runs; pattern 014 (same `serializeJson`). Description omit rule: `undefined` -> omit, `` -> preserve (section 26: optional, omitted; Assumption).

**Alternatives**: New serializer (rejected: `serializeJson` already covers); preserving YAML key order (rejected: non-deterministic).

### 7. Empty outputs behavior: stable `{ output: {} }`

**Decision**: When there are neither user nor auto-generated outputs, `buildOutputs` returns `kind: 'ok'` with `file.content = '{"output":{}}'` via `serializeJson`. File `99-ycsf-outputs.tf.json` is always generated (stable empty output block). When there is no outputs.yaml (project without outputs) -> loader is not called (orchestration 021).

**Rationale**: FR-014: stable empty file, not file absence. Pattern: empty `{ output: {} }` is a valid Terraform output block, does not break `terraform validate`. Determinism: empty file is stable between runs.

**Alternatives**: Do not generate file on empty outputs (rejected: FR-014); generate `{}` without `output` key (rejected: invalid Terraform).

### 8. Write/regeneration integration: lifecycle

**Decision**: `99-ycsf-outputs.tf.json` is a C-owned generated file, managed by `writeGeneratedTerraform` (pattern regeneration 014, FR-020). The regex `FILENAME_RE` in `write.ts` already matches `99-ycsf-outputs.tf.json`. Orphan handling (remove stale `*.ycsf.tf.json` not in current set) automatically manages lifecycle: the old `00-ycsf-outputs.tf.json` is removed on first run after migration. No changes needed to `write.ts`.

**Rationale**: FR-020: C-owned generated file lifecycle is handled by `writeGeneratedTerraform`. The filename matches existing ownership glob. No special-casing needed.

**Alternatives**: Special orphan handling for outputs file (rejected: generic mechanism already covers); separate write function for outputs (rejected: unnecessary complexity).

### 9. Module layout: `src/outputs/`

**Decision**: Runtime module `packages/pilot/src/outputs/` with the following structure:

- `outputs-yaml.ts`: parse gate (`parseOutputsYaml`) -- `parseDocument(uniqueKeys:true)` + version + structural validation, emitting `OUT_*` codes
- `loader.ts`: `loadOutputs(rootDir)` -- file I/O + parse, throws `OUT_MISSING_FILE`
- `resolver.ts`: `resolveIdlReference(ref, idlIndex, domainToTfType)` -- pure function, uses `parseResourceReference` + reverse lookup + IDL index check
- `build.ts`: `buildOutputs(input)` -- pure, two-phase validation (collect-all) + deterministic assembly
- `errors.ts`: `out()` diagnostic factory (`OutputsDiagnostic`) + re-export `diag` for loader structural diagnostics
- `index.ts`: internal barrel (`loadOutputs`, `buildOutputs`, `resolveIdlReference`)

Contracts: `src/contracts/outputs.ts` -- type-only public contracts + pure `OUT_*` constants (zero-dep).

**Rationale**: Mirrors 015 `src/extensions/` structure; separates I/O (loader) from pure transforms (resolver, build). `resolver.ts` isolated for testability. Zero-dep contracts follow established pattern.

**Alternatives**: Fewer files (e.g., merge resolver into build) -- rejected: resolver is independently testable and reusable by 020 check.

### 10. `buildOutputs` input shape: `ReadonlyMap<string, OutputValue>` for auto-generated

**Decision**: `buildOutputs` takes `materializerOutputs: ReadonlyMap<string, OutputValue>` (same type as `OutputBuilder.declared` from spec 014 `context.ts`). No wrapping or conversion needed -- direct pass-through from dispatch output.

**Rationale**: Reuses existing type from spec 014; `ReadonlyMap` preserves immutability; no unnecessary copying. `OutputValue` (`{ value: string, description?: string }`) already matches the expected shape.

**Alternatives**: Plain `Record<string, OutputValue>` (rejected: loses Map semantics and immutability guarantee); custom wrapper type (rejected: unnecessary indirection).
