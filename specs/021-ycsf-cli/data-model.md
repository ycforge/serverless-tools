# Data Model: ycsf-cli

**Spec**: [specs/021-ycsf-cli/spec.md](./spec.md) | **Branch**: `021-ycsf-cli` | **Date**: 2026-09-10

Сущности публичного контракта CLI-слоя `ycsf`, типы ошибок, pipeline model, exit codes.

---

## 1. Структура CLI модуля

```text
packages/pilot/src/cli/
├── index.ts           # entry point: program, global flags, error handler, parseAsync
├── errors.ts          # CLIError hierarchy + CLI_* constants
├── build.ts           # ycsf build command action
├── materialize.ts     # ycsf materialize command action
├── check.ts           # ycsf check command action
├── plan.ts            # ycsf plan command action
├── apply.ts           # ycsf apply command action
├── destroy.ts         # ycsf destroy command action
├── pipeline.ts        # shared: runBuildAndMaterialize, runTerraform*
├── terraform.ts       # spawn wrapper: spawnTerraform, findTerraform
└── prompt.ts          # readline confirmation (destroy)
```

Дополнительно в library layer:
```text
packages/pilot/src/build/
└── index.ts           # buildApps orchestration function
packages/pilot/src/registry/
└── shape.ts           # UPDATE: add getBuilder()
```

---

## 2. Типы

### 2.1 CLIResult (--json output)

```ts
/** Unified structured output for all commands (--json flag). */
export interface CLIResult {
  /** Command name: 'build' | 'materialize' | 'check' | 'plan' | 'apply' | 'destroy'. */
  readonly command: string;
  /** Exit code: 0 = success, 1 = error, 2 = input/config error. */
  readonly exitCode: 0 | 1 | 2;
  /** Diagnostics from library + CLI errors. Empty array = clean. */
  readonly diagnostics: readonly CLIDiagnostic[];
  /** Command-specific summary. */
  readonly summary?: Record<string, unknown>;
}
```

### 2.2 CLIDiagnostic

```ts
/** CLI-level diagnostic (for errors before/during library dispatch). */
export interface CLIDiagnostic {
  /** Diagnostic code: CLI_* or library codes (PML_*, EXT_*, BRG_*, MTL_*, YCK_*). */
  readonly code: string;
  /** Human-readable description. */
  readonly message: string;
  /** Additional context fields (command-specific). */
  readonly details?: Record<string, unknown>;
}
```

### 2.3 CLIError hierarchy

```ts
/** Base CLI error — all CLI errors extend this. */
export class CLIError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly exitCode: 1 | 2,
  ) {
    super(message);
    this.name = 'CLIError';
  }
}

/** Input/config error — invalid path, missing file, unknown command. */
export class InputError extends CLIError {
  constructor(message: string, code: string) {
    super(message, code, 2);
    this.name = 'InputError';
  }
}

/** Runtime error — build failure, terraform error. */
export class RuntimeError extends CLIError {
  constructor(message: string, code: string) {
    super(message, code, 1);
    this.name = 'RuntimeError';
  }
}

/** Destroy requires --yes in non-interactive mode. */
export class DestroyRequiresYesError extends InputError {
  constructor() {
    super('destroy requires --yes flag in non-interactive mode (CLI_DESTROY_REQUIRES_YES)', CLI_DESTROY_REQUIRES_YES);
    this.name = 'DestroyRequiresYesError';
  }
}
```

### 2.4 CLI_* error codes

| Constant | Value | Exit Code | Category |
|----------|-------|-----------|----------|
| `CLI_UNKNOWN_COMMAND` | `'CLI_UNKNOWN_COMMAND'` | 2 | Input |
| `CLI_MISSING_PROJECT_DIR` | `'CLI_MISSING_PROJECT_DIR'` | 2 | Input |
| `CLI_APP_NOT_FOUND` | `'CLI_APP_NOT_FOUND'` | 2 | Input |
| `CLI_BUILD_FAILED` | `'CLI_BUILD_FAILED'` | 1 | Runtime |
| `CLI_TERRAFORM_FAILED` | `'CLI_TERRAFORM_FAILED'` | 1 | Runtime |
| `CLI_TERRAFORM_NOT_FOUND` | `'CLI_TERRAFORM_NOT_FOUND'` | 1 | Runtime |
| `CLI_DESTROY_REQUIRES_YES` | `'CLI_DESTROY_REQUIRES_YES'` | 2 | Input |
| `CLI_UNEXPECTED_ERROR` | `'CLI_UNEXPECTED_ERROR'` | 1 | Runtime |

### 2.5 ExitCode enum

```ts
export enum ExitCode {
  Success = 0,
  Error = 1,
  InputError = 2,
}
```

---

## 3. BuildAppsResult (library layer)

```ts
/** Result of buildApps orchestration (spec 021, D-RE-1). */
export type BuildAppsResult =
  | {
      readonly kind: 'ok';
      readonly projectModel: ProjectModel;
      readonly registry: PluginRegistry;
      readonly artifacts: readonly BuiltArtifact[];
    }
  | {
      readonly kind: 'invalid';
      readonly errors: readonly Diagnostic[];
    };

/** One successfully built app artifact. */
export interface BuiltArtifact {
  readonly appId: string;
  readonly artifact: Artifact;
}
```

---

## 4. Pipeline steps

### 4.1 Build pipeline (buildApps)

```
buildApps(rootDir, options?)
│
├─ 1. loadProjectModel(rootDir) → ProjectModelLoadResult
│   ├─ throws (ENOENT) → CLI_MISSING_PROJECT_DIR (exit 2)
│   └─ kind: invalid → CLI_BUILD_FAILED (exit 1)
│
├─ 2. prepareBuildEnv(model) → BuildEnvResolutionResult
│   └─ errors → CLI_BUILD_FAILED (exit 1) + PML_ENV_NOT_SET
│
├─ 3. loadRegistry(rootDir) → PluginRegistryLoadResult
│   ├─ throws (BRG_MISSING_FILE) → CLI_BUILD_FAILED (exit 1)
│   └─ kind: invalid → CLI_BUILD_FAILED (exit 1) + BRG_*
│
├─ 4. validateBuilders(model, registry) → BuilderRegistryValidationResult
│   └─ kind: invalid → CLI_BUILD_FAILED (exit 1) + BRG_UNKNOWN_BUILDER
│
├─ 5. Filter by --target (if specified)
│   └─ unknown app → CLI_APP_NOT_FOUND (exit 2)
│
├─ 6. For each app in topological order:
│   ├─ getBuilder(registry.records.get(builderId).module)
│   ├─ builder.build(context) → Artifact
│   └─ error → CLI_BUILD_FAILED (exit 1) + BLC_*
│
└─ 7. Return { kind: 'ok', projectModel, registry, artifacts }
```

### 4.2 Materialize pipeline (dispatch + extensions + writes)

```
runMaterialize(rootDir, projectModel, registry, target?)
│
├─ 1. dispatch(projectModel, registry, { target })
│   └─ kind: invalid → exit 1 + MTL_*
│
├─ 2. loadExtensions(rootDir)
│   └─ loaded:
│       ├─ applyExtensions(resources, extensions)
│       │   └─ kind: invalid → exit 1 + EXT_*
│       ├─ buildMoves(rootDir) + buildMovedFile()
│       ├─ buildOutputs(...)
│       └─ writeGeneratedTerraform(infraDir, files)
│
└─ 3. Return generated file paths (for --json summary)
```

### 4.3 Terraform pipeline

```
spawnTerraform(command, rootDir)
│
├─ 1. Resolve terraform binary (check PATH)
│   └─ ENOENT → CLI_TERRAFORM_NOT_FOUND (exit 1)
│
├─ 2. spawn('terraform', args, { cwd: infraDir, stdio: 'inherit' })
│   ├─ exit code 0 → success
│   └─ exit code non-zero → CLI_TERRAFORM_FAILED (exit 1)
│
└─ 3. SIGINT handling:
    ├─ child.kill('SIGTERM')
    ├─ wait 2s
    ├─ child still alive → child.kill('SIGKILL')
    └─ process.exit(130)
```

### 4.4 Destroy pipeline

```
ycsf destroy (no --yes):
│
├─ 1. Check process.stdin.isTTY
│   └─ false → CLI_DESTROY_REQUIRES_YES (exit 2)
│
├─ 2. Prompt: "Are you sure? (y/N): "
│   └─ 'y'/'Y' → proceed, else → exit 0
│
ycsf destroy (--yes or confirmed):
│
├─ 3. spawnTerraform('init', rootDir)
├─ 4. spawnTerraform('destroy', rootDir, { autoApprove: yes })
├─ 5. If --cleanup: delete .ycsf/*.ycsf.tf.json
└─ 6. Exit 0
```

---

## 5. State transitions: plan/apply/destroy

### 5.1 `ycsf plan`

```
IDLE → BUILD → MATERIALIZATION → TF_INIT → TF_PLAN → DONE
                    ↓ error            ↓ error      ↓ error
                  FAILED             FAILED       FAILED
```

### 5.2 `ycsf apply`

```
IDLE → BUILD → MATERIALIZATION → TF_INIT → TF_PLAN → TF_APPLY → DONE
                    ↓ error            ↓ error      ↓ error     ↓ error
                  FAILED             FAILED       FAILED      FAILED
```

### 5.3 `ycsf destroy`

```
IDLE → CONFIRM → TF_INIT → TF_DESTROY → CLEANUP → DONE
  ↓ TTY-check fail     ↓ error          ↓ error
FAILED              FAILED            FAILED
```

---

## 6. Command → Global flags mapping

| Flag | build | materialize | check | plan | apply | destroy |
|------|-------|-------------|-------|------|-------|---------|
| `--project-dir` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `--json` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `--no-color` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `--target` | ✅ | ✅ | — | — | — | — |
| `--validate-tf` | — | — | ✅ | — | — | — |
| `--yes` | — | — | — | — | — | ✅ |
| `--cleanup` | — | — | — | — | — | ✅ |

---

## 7. Validation rules

| Rule | Source | Enforcement |
|------|--------|-------------|
| `--project-dir` must resolve to existing directory | FR-004 | InputError (exit 2) before library dispatch |
| `.ycsf/apps.yaml` must exist (except destroy) | Edge case | CLI_MISSING_PROJECT_DIR (exit 2) |
| `--target` app must exist in apps.yaml | FR-008, D-7 | CLI_APP_NOT_FOUND (exit 2) |
| `terraform` must be in PATH | FR-021 | CLI_TERRAFORM_NOT_FOUND (exit 1) |
| `--yes` required for destroy in non-TTY | FR-027 | CLI_DESTROY_REQUIRES_YES (exit 2) |
| Pipeline aborts on first step failure | D-4 (spec) | Fail-fast: no subsequent steps |

---

## 8. Invariants

```text
invariants:
  CLI is a thin wrapper (Constitution I):
    → CLI owns arg parsing, I/O, exit codes
    → CLI does NOT contain build/materialize/check logic
    → CLI dispatches to library functions (buildApps, dispatch, check)

  Fail-fast pipeline (D-4, spec):
    → plan/apply: if build fails → materialize + terraform NOT attempted
    → plan/apply: if materialize fails → terraform NOT attempted
    → destroy: independent of build/materialize

  Exit codes are unified (D-3, spec):
    → 0 = success (all operations completed without errors)
    → 1 = error (validation, runtime, terraform failure)
    → 2 = input/config error (invalid path, missing file, unknown command)
    → 130 = SIGINT

  --json is clean (FR-005):
    → When --json, stdout contains ONLY JSON (no progress messages)
    → Progress messages suppressed entirely when --json

  Library diagnostics preserved (D-RE-8):
    → PML_*, EXT_*, BRG_*, MTL_*, YCK_* codes pass through as-is
    → CLI adds CLI_* codes for CLI-specific errors
    → No code transformation or renaming
```
