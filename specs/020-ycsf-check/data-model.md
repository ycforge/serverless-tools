# Data Model: ycsf-check

**Spec**: [specs/020-ycsf-check/spec.md](./spec.md) | **Branch**: `020-ycsf-check` | **Date**: 2026-09-10

Сущности публичного контракта модуля `ycsf check`, типы диагностик `YCK_*`, модель агрегации, конфигурационная поверхность CLI и внутренние вспомогательные типы.

---

## 1. Публичная поверхность модуля `src/check/`

```text
packages/pilot/src/check/
├── index.ts                     # public API: export { check, type CheckResult, type CheckOptions }
├── check.ts                     # orchestration: load generated model + run all categories + aggregate
├── categories/
│   ├── override-targets.ts      # C1: extension target → generated resource existence (YCK_MISSING_TARGET)
│   ├── env-in-patch.ts          # C7: deep-scan extension patch for {{$ENV}} refs (YCK_ENV_IN_PATCH)
│   ├── resource-consistency.ts  # C4: resources.yaml refs → generated TF addresses (YCK_REF_UNRESOLVED)
│   └── terraform-validate.ts    # C13: optional terraform validate spawn (YCK_TERRAFORM_INVALID / YCK_TERRAFORM_UNAVAILABLE)
├── generated-loader.ts          # load *.ycsf.tf.json files → TerraformResource[] (FR-002)
└── errors.ts                    # YCK_* constants + diagnostic factory
```

Дополнительно: `src/contracts/check.ts` — типы `CheckResult`, `CheckOptions`, `YckDiagnostic`, `YCK_*` codes.

Экспорт из barrel `src/index.ts`:
```ts
export { check } from './check/index.js';
export type { CheckResult, CheckOptions } from './check/index.js';
```

## 2. Типы

### 2.1 CheckResult

```ts
/** Unified result of all check categories (FR-004). */
export interface CheckResult {
  /** All diagnostics from all categories — collect-all, never abort-on-first (D-4). */
  readonly diagnostics: readonly Diagnostic[];
}
```

`Diagnostic` — union тип всех существующих diagnostic families + `YckDiagnostic`:
```ts
type Diagnostic =
  | ProjectModelDiagnostic    // PML_*
  | ExtensionsDiagnostic      // EXT_*
  | OutputsDiagnostic         // OUT_*
  | MovesDiagnostic           // MOV_*
  | YckDiagnostic;            // YCK_* (check-specific)
```

### 2.2 CheckOptions

```ts
export interface CheckOptions {
  /** Enable `terraform validate` final step (default: false). --validate-tf CLI flag. */
  readonly validateTf?: boolean;
  /** Override path to generated `.ycsf.tf.json` files (default: <rootDir>/.ycsf/). */
  readonly generatedDir?: string;
}
```

### 2.3 YckDiagnostic

```ts
/** Check-specific diagnostic (YCK_* family). */
export interface YckDiagnostic {
  readonly code: string;
  readonly message: string;
  /** IDL target that failed validation (C1, C7). */
  readonly target?: string;
  /** IDL resource reference string (C4). */
  readonly resourceRef?: string;
  /** Field path within patch where issue was found (C7). */
  readonly field?: string;
  /** File path where the referenced contract lives (C4). */
  readonly file?: string;
  /** Available IDLs in the generated model when target was missing (C1). */
  readonly availableIdls?: readonly string[];
}
```

### 2.4 GeneratedModel

Internal type for the loaded generated Terraform resources:

```ts
/** Internal: loaded from .ycsf/*.ycsf.tf.json files. */
export interface GeneratedResource {
  readonly kind: 'resource';
  readonly type: string;
  readonly name: string;
  readonly configuration: Record<string, unknown>;
}
```

`loadGeneratedModel(rootDir)` returns `readonly GeneratedResource[]` (empty array if no files).

## 3. Diagnostic codes: `YCK_*` family

| Code | Message template | Fields | Category |
|------|-----------------|--------|----------|
| `YCK_MISSING_TARGET` | `extension target '<target>' does not exist in generated model (YCK_MISSING_TARGET); available IDLs: <availableIdls>` | target, availableIdls | C1 |
| `YCK_ENV_IN_PATCH` | `extension patch for '<target>' contains ${{$ENV}} reference at '<field>' (YCK_ENV_IN_PATCH); extensions use Terraform expressions, not build env` | target, field | C7 |
| `YCK_REF_UNRESOLVED` | `resource reference '<resourceRef>' has no matching generated Terraform resource (YCK_REF_UNRESOLVED)` | resourceRef, file | C4 |
| `YCK_TERRAFORM_INVALID` | `terraform validate failed: <message>` | message | C13 |
| `YCK_TERRAFORM_UNAVAILABLE` | `terraform binary not found in PATH (YCK_TERRAFORM_UNAVAILABLE)` | — | C13 |

### 3.1 Constants (Constitution V — compare via constants, never string literals)

```ts
export const YCK_MISSING_TARGET = 'YCK_MISSING_TARGET';
export const YCK_ENV_IN_PATCH = 'YCK_ENV_IN_PATCH';
export const YCK_REF_UNRESOLVED = 'YCK_REF_UNRESOLVED';
export const YCK_TERRAFORM_INVALID = 'YCK_TERRAFORM_INVALID';
export const YCK_TERRAFORM_UNAVAILABLE = 'YCK_TERRAFORM_UNAVAILABLE';
```

### 3.2 Diagnostic factory

```ts
export interface YckOptions {
  readonly code: string;
  readonly message: string;
  readonly target?: string;
  readonly resourceRef?: string;
  readonly field?: string;
  readonly file?: string;
  readonly availableIdls?: readonly string[];
}

export function yck(opts: YckOptions): YckDiagnostic {
  // identical pattern to src/extensions/errors.ts `ext()`
  // — only defined fields are set (exactOptionalPropertyTypes)
}
```

## 4. Aggregation model

```
check(rootDir, options?) → CheckResult
│
├─ 1. loadProjectModel(rootDir) → ProjectModelLoadResult         [C12, reuse 011]
│   └─ errors → PML_* diagnostics
│
├─ 2. loadGeneratedModel(rootDir) → GeneratedResource[]          [FR-002, new]
│   └─ empty if no .ycsf/*.ycsf.tf.json files
│
├─ 3. C2–C3: checkEnvRequirements(appId, buildConfig, file)      [reuse 011]
│   └─ errors → PML_ENV_NOT_SET diagnostics
│
├─ 4. C11: validateBuilders(projectModel, registry)              [reuse 013]
│   └─ errors → BRG_UNKNOWN_BUILDER diagnostics
│
├─ 5. try loadExtensions(rootDir) → ExtensionsYaml | undefined   [optional, reuse 015]
│   ├─ file missing → skip C1, C5–C8 (no error)
│   └─ loaded:
│       ├─ C1: checkOverrideTargets(extensions, generatedModel)  [new, YCK_MISSING_TARGET]
│       └─ C5–C8: applyExtensions(generatedModel, extensions)    [reuse 015]
│           └─ errors → EXT_UNRESOLVED_TARGET, EXT_DUPLICATE_TARGET, EXT_INVALID
│           └─ C7: scanPatchForEnvRefs(extensions)               [new, YCK_ENV_IN_PATCH]
│
├─ 6. C4: checkResourceConsistency(projectModel, generatedModel) [new, YCK_REF_UNRESOLVED]
│
├─ 7. try loadOutputs(rootDir) + buildOutputs(input)             [optional, reuse 016]
│   └─ file missing → skip C9 (no error)
│   └─ errors → OUT_* diagnostics
│
├─ 8. try loadMoves(rootDir) + validateMoves(moves)              [optional, reuse 017]
│   └─ errors → MOV_* diagnostics
│
├─ 9. Aggregate all diagnostics → CheckResult.diagnostics        [D-4 collect-all]
│
└─ 10. if options.validateTf && diagnostics.length === 0:        [C13, optional]
       terraform-validate → YCK_TERRAFORM_INVALID / YCK_TERRAFORM_UNAVAILABLE
```

### 4.1 Execution order rationale

1. **Project model first** (step 1): all other validators depend on project model data.
2. **Generated model second** (step 2): C1 and C4 need generated resources; C5–C8 also need them.
3. **ENV checks third** (step 3): standalone, no dependency on generated model.
4. **Builder registry fourth** (step 4): standalone.
5. **Extensions fifth** (step 5): depends on generated model (C1, C5–C8). Optional file.
6. **Resource consistency sixth** (step 6): depends on generated model + project model resources.
7. **Outputs seventh** (step 7): depends on generated model (for IDL resolution). Optional file.
8. **Moves eighth** (step 8): standalone structural validation. Optional file.
9. **Aggregate ninth** (step 9): collect-all.
10. **Terraform validate last** (step 10): only if `validateTf` flag + zero base errors (fail-fast, FR-018).

### 4.2 Error handling per category

| Category | Missing file behavior | Error behavior |
|----------|----------------------|----------------|
| C2–C3 (ENV) | No file to miss (uses project model) | `PML_ENV_NOT_SET` per missing env |
| C11 (builders) | No file to miss (uses project model + registry) | `BRG_UNKNOWN_BUILDER` per unknown |
| C1, C5–C8 (extensions) | Skip all (no error if extensions.yaml absent) | `EXT_*` + `YCK_*` per rule |
| C4 (resource consistency) | Skip if resources empty | `YCK_REF_UNRESOLVED` per unresolved ref |
| C9 (outputs) | Skip (no error if outputs.yaml absent) | `OUT_*` per issue |
| C10 (moves) | Empty moves (ok) | `MOV_*` per entry |
| C13 (terraform) | Skip if `validateTf=false` | `YCK_TERRAFORM_INVALID` / `YCK_TERRAFORM_UNAVAILABLE` |

## 5. CLI surface (D-6)

```
ycsf check [rootDir] [--validate-tf]
```

- `rootDir`: optional, default `cwd`.
- `--validate-tf`: boolean flag, default `false`.
- Exit code: 0 (no diagnostics), 1 (any diagnostics) — D-3.
- stdout/stderr: handled by CLI layer (spec 021); check module returns `CheckResult`.

## 6. Exit code semantics (D-3)

```ts
// CLI layer (spec 021):
const result = await check(rootDir, { validateTf });
if (result.diagnostics.length > 0) {
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
```

No distinction between warnings and errors — all diagnostics are errors (Constitution V: fail-fast).

## 7. Invariants

```text
invariants:
  check is a pure function (FR-001): (rootDir, options?) → CheckResult
    → no side effects on the file system
    → no terraform state reads
    → no network calls
    → optional: spawnSync for terraform validate (C13 only, D-5)

  collect-all (D-4):
    → all categories run regardless of errors in other categories
    → diagnostics array contains ALL findings from ALL categories
    → no early returns for non-fatal categories

  fail-fast for terraform validate (FR-018):
    → if base checks (C1–C12) have any errors → terraform validate is skipped
    → terraform validate only runs when diagnostics.length === 0

  duplicate diagnostics (D-10):
    → applyExtensions emits EXT_UNRESOLVED_TARGET for missing target
    → check also emits YCK_MISSING_TARGET for the same target
    → both appear in CheckResult.diagnostics (different abstraction levels)

  O(N + M + E) performance (FR-005):
    → N = number of apps (ENV checks, builder checks)
    → M = number of generated resources (IDL index, resource consistency)
    → E = number of extension rules (target checks, patch scan)
    → no nested loops that would create O(N×M) or O(E×M) complexity
```
