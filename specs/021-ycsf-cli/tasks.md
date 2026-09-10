---
description: "Task list for ycsf-cli — CLI layer Project C (build/materialize/check/plan/apply/destroy, --json, --help)"
---

# Tasks: ycsf-cli — CLI layer Project C

**Input**: Design documents from `/specs/021-ycsf-cli/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), data-model.md, research.md, contracts/ycsf-cli.json, quickstart.md

**Tests**: Test-first per constitution (II). Каждый acceptance criterion US1–US8 → ≥1 тест (RED → GREEN). Тесты пишутся ДО реализации и подтверждаются RED. Constitution II exception (thin orchestration) применяется только для terraform spawn wrapper (D-RE-2, characterization tests).

**Organization**: Задачи сгруппированы по фазам Setup / Foundational (CLI types, buildApps orchestrator, terraform wrapper, CLI skeleton, pipeline — блокируют все US) / US1 build / US2 materialize / US3 check / US4 plan / US5 apply / US6 destroy / US7 --json / US8 help/version / Polish. CLI layer lives в `packages/pilot` — no new package.

## Format: `[ID] [P?] [USn] Description with file path`

- **[P]**: Can run in parallel (different files, no incomplete deps)
- **[US1]–[US8]**: User story labels (required in US phases)
- Include exact file paths in descriptions

## Path Conventions

- **CLI source**: `packages/pilot/src/cli/` — commander program, per-command actions, error handler
- **CLI types**: `packages/pilot/src/cli/errors.ts` — CLIError hierarchy + CLI_* constants
- **Build orchestrator**: `packages/pilot/src/build/index.ts` — `buildApps(rootDir, options?) → BuildAppsResult`
- **Terraform wrapper**: `packages/pilot/src/cli/terraform.ts` — spawnTerraform, findTerraform, SIGINT
- **Pipeline shared**: `packages/pilot/src/cli/pipeline.ts` — runBuildAndMaterialize, runTerraform*
- **Registry shape**: `packages/pilot/src/registry/shape.ts` — UPDATE: add getBuilder()
- **Pilot barrel**: `packages/pilot/src/index.ts` — UPDATE: add buildApps export
- **Package config**: `packages/pilot/package.json` — add commander dep, bin field
- **Bundler**: `packages/pilot/tsup.config.ts` — add CLI entry point with shebang
- **Tests**: `packages/pilot/test/cli/unit/*.test.ts` + `test/cli/integration/*.spec.ts`
- **Fixtures**: `packages/pilot/test/check/fixtures/canonical/` (reuse existing, extend for CLI)

---

## Phase 1: Setup (Package Config & Bundler)

**Purpose**: Добавить `commander` dependency, bin field, tsup entry point с shebang. Без этого CLI entry point не соберётся.

- [x] T001 Add `"commander": "^12.0.0"` to `dependencies` in `packages/pilot/package.json` (mirror composer pattern) and add `"bin": { "ycsf": "dist/cli/index.js" }`. **Ref**: FR-002 (commander-based), D-RE-9.
- [x] T002 [P] Add CLI entry point to `packages/pilot/tsup.config.ts` — `{ entry: { index: 'src/cli/index.ts' }, outDir: 'dist/cli', format: ['esm'], banner: { js: '#!/usr/bin/env node' }, external: ['commander'] }`. Mirror `packages/composer/tsup.config.ts`. **Ref**: D-RE-9, plan.md.

---

## Phase 2: Foundational (Types, buildApps, Terraform, CLI Skeleton, Pipeline)

**Purpose**: Типы контракта, оркестратор buildApps, обёртка terraform, commander skeleton, shared pipeline. ALL user story work depends on this phase.

### CLI types & error hierarchy (RED → GREEN)

- [x] T010 [P] Create `packages/pilot/src/cli/errors.ts` — `CLIError` base class (`code: string`, `exitCode: 1|2`), `InputError` (exitCode: 2), `RuntimeError` (exitCode: 1), `DestroyRequiresYesError`; 8 `CLI_*` constants (CLI_UNKNOWN_COMMAND, CLI_MISSING_PROJECT_DIR, CLI_APP_NOT_FOUND, CLI_BUILD_FAILED, CLI_TERRAFORM_FAILED, CLI_TERRAFORM_NOT_FOUND, CLI_DESTROY_REQUIRES_YES, CLI_UNEXPECTED_ERROR); `ExitCode` enum (Success=0, Error=1, InputError=2). Per data-model §2.4. **Ref**: FR-001, FR-003, contracts/ycsf-cli.json.
- [x] T011 [P] RED unit-test `packages/pilot/test/cli/unit/errors.test.ts` — AC: InputError.code=CLI_MISSING_PROJECT_DIR, InputError.exitCode=2; RuntimeError.exitCode=1; DestroyRequiresYesError.code=CLI_DESTROY_REQUIRES_YES, exitCode=2; 8 CLI_* constants exported; ExitCode enum values correct. Structural audit vs `contracts/ycsf-cli.json` `#/errorCodes`. RED: imports fail. **Ref**: SC-012.

### CLIResult & CLIDiagnostic types (RED → GREEN)

- [x] T012 [P] Create `packages/pilot/src/cli/result.ts` — `CLIResult` interface (`{ command, exitCode, diagnostics, summary? }`), `CLIDiagnostic` interface (`{ code, message, details? }`). Per data-model §2.1–2.2. **Ref**: D-RE-7, FR-005 (--json schema).
- [x] T013 [P] RED unit-test `packages/pilot/test/cli/unit/result.test.ts` — CLIResult shape matches contracts/ycsf-cli.json `#/schemas/CLIResult`; CLIDiagnostic has required code+message, optional details; readonly arrays. RED: imports fail.

### CLI entry point (RED → GREEN)

- [x] T014 Create `packages/pilot/src/cli/index.ts` — commander program: name `ycsf`, version from package.json, global options `--project-dir <path>` (default: cwd), `--json` (flag), `--no-color` (flag); register 6 subcommands (stubs from T040–T045) as lazy imports; global error handler: catch all → CLIError → process.exitCode + stderr message (FR-003); `.parseAsync(process.argv)`. **Ref**: FR-001, FR-002, FR-004, FR-005, FR-006, D-RE-9, D-RE-13.
- [x] T015 RED unit-test `packages/pilot/test/cli/unit/index.test.ts` — (a) unknown command → exit code 2 + CLI_UNKNOWN_COMMAND; (b) `--project-dir` resolves path correctly; (c) `--json` flag present in opts; (d) `--no-color` sets NO_COLOR in process.env. Mock commander.parseAsync. RED: index.ts stub.

### `getBuilder` shape function (RED → GREEN)

- [x] T016 [P] Add `getBuilder(module: unknown): Builder | null` to `packages/pilot/src/registry/shape.ts` — symmetric to existing `getMaterializer`. Check `isBuilderShape`, return typed Builder or null. **Ref**: D-RE-15, D-RE-1.
- [x] T017 [P] RED unit-test `packages/pilot/test/cli/unit/builder-shape.test.ts` — valid builder module → returns Builder; invalid module → returns null; `getBuilder(null)` → null; `getBuilder({})` → null. Symmetric assertions vs `getMaterializer`. RED: getBuilder absent.

### `buildApps` orchestrator (RED → GREEN)

- [x] T018 Create `packages/pilot/src/build/index.ts` — `buildApps(rootDir: string, options?: { target?: string }): Promise<BuildAppsResult>`; pipeline: loadProjectModel(rootDir) → prepareBuildEnv(model) → loadRegistry(rootDir) → validateBuilders(model, registry) → if options.target: filter apps (unknown → CLI_APP_NOT_FOUND) → for each app: getBuilder(registry) → builder.build(context) → collect artifacts; return `{ kind: 'ok', projectModel, registry, artifacts }` or `{ kind: 'invalid', errors }`. Import `BuildAppsResult`, `BuiltArtifact` from `src/contracts/build.ts` (new). **Ref**: FR-007, FR-008, FR-010, D-RE-1, D-RE-11, D-RE-12, data-model §3.
- [x] T019 Create `packages/pilot/src/contracts/build.ts` — `BuildAppsResult` discriminated union (kind: 'ok' with projectModel/registry/artifacts; kind: 'invalid' with errors), `BuiltArtifact` interface (`{ appId, artifact }`), `BuildAppsOptions` interface (`{ target?: string }`). Per data-model §3. **Ref**: D-RE-1.
- [x] T026 [P] RED unit-test `packages/pilot/test/build/build-apps.spec.ts` — (a) valid 2-app project → kind:'ok', artifacts.length===2; (b) missing ENV → kind:'invalid', errors contains PML_ENV_NOT_SET; (c) unknown builder → kind:'invalid', BRG_UNKNOWN_BUILDER; (d) --target valid app → 1 artifact; (e) --target unknown app → CLI_APP_NOT_FOUND; (f) empty project (0 apps) → kind:'ok', artifacts.length===0 (FR-010). Mock loadProjectModel, prepareBuildEnv, loadRegistry, validateBuilders, getBuilder. RED: buildApps stub. **Ref**: SC-001, US1 AC2, US1 AC3.
- [x] T027 [P] RED integration-test `packages/pilot/test/build/build-apps.integration.spec.ts` — use canonical fixture: buildApps(fixtureRootDir) → kind:'ok', 2 artifacts built; buildApps(fixtureRootDir, { target: 'unknown_app' }) → CLI_APP_NOT_FOUND. RED: buildApps throws.

### Terraform spawn wrapper (RED → GREEN)

- [x] T030 Create `packages/pilot/src/cli/terraform.ts` — `findTerraform(): string` (throws CLIError CLI_TERRAFORM_NOT_FOUND if not in PATH via which/spawnSync ENOENT); `spawnTerraform(command: 'init'|'plan'|'apply'|'destroy', rootDir: string, opts?: { autoApprove?: boolean }): Promise<{ exitCode: number }>` (async spawn, cwd=`rootDir/infra/`, stdio:'inherit', args per FR-018..029: init=`-no-color`, plan=`-no-color`, apply=`-auto-approve -no-color`, destroy=`-no-color` or `-auto-approve -no-color`; SIGINT handler: SIGTERM → wait 2s → SIGKILL → exit 130); `setupSigintHandler(child: ChildProcess): void`. **Ref**: FR-019, FR-021, FR-026, FR-029, D-RE-2, D-RE-3, D-RE-4.
- [x] T031 [P] RED unit-test `packages/pilot/test/cli/unit/terraform.test.ts` — (a) spawnTerraform('init', rootDir) → spawn called with correct args ['init', '-no-color'], cwd=rootDir/infra; (b) spawn with 'destroy' + autoApprove=true → args include '-auto-approve'; (c) ENOENT error → CLI_TERRAFORM_NOT_FOUND thrown; (d) SIGINT handler: mock child.kill, verify SIGTERM → SIGKILL sequence; (e) non-zero exit → RuntimeError CLI_TERRAFORM_FAILED. Mock child_process.spawn. RED: terraform.ts stub. **Ref**: SC-009, SC-010.
- [x] T032 [P] RED unit-test `packages/pilot/test/cli/unit/prompt.test.ts` — create `packages/pilot/src/cli/prompt.ts` and test simultaneously: (a) TTY + 'y' input → returns true; (b) TTY + 'n' input → returns false; (c) non-TTY stdin → throw DestroyRequiresYesError (exit 2). Mock process.stdin.isTTY. RED: prompt.ts stub. **Ref**: FR-027, D-RE-5.

### Prompt module (pair with T032)

- [x] T032b Create `packages/pilot/src/cli/prompt.ts` — `confirmDestroy(): Promise<boolean>`; check `process.stdin.isTTY` — false → throw `DestroyRequiresYesError`; true → `readline.createInterface` → prompt "Are you sure you want to destroy infrastructure? (y/N): " → read line → 'y'/'Y' → return true, else return false; close interface. **Ref**: FR-027, D-RE-5.

### Pipeline shared functions (RED → GREEN)

- [x] T035 Create `packages/pilot/src/cli/pipeline.ts` — `runBuildAndMaterialize(rootDir: string, opts?: { target?: string, json?: boolean }): Promise<void>` (calls buildApps → dispatch → loadExtensions → applyExtensions → writeGeneratedTerraform; throws on any step failure — fail-fast); `runTerraformInit(rootDir: string): Promise<void>` (spawnTerraform('init')); `runTerraformPlan(rootDir: string, json?: boolean): Promise<string>` (spawnTerraform('plan'), return captured stdout); `runTerraformApply(rootDir: string, json?: boolean): Promise<string>` (spawnTerraform('apply'), return stdout); `runTerraformDestroy(rootDir: string, autoApprove: boolean): Promise<string>` (spawnTerraform('destroy', { autoApprove }), return stdout). Progress messages to stderr (suppressed when json=true). **Ref**: FR-018, FR-020, FR-022, FR-024, FR-025, D-RE-6.
- [x] T036 RED unit-test `packages/pilot/test/cli/unit/pipeline.test.ts` — (a) runBuildAndMaterialize: buildApps succeeds → dispatch called → extensions applied → writeGeneratedTerraform called; (b) buildApps fails → dispatch NOT called (fail-fast); (c) runTerraformInit: spawnTerraform('init') called with correct rootDir; (d) progress messages to stderr when json=false; (e) no progress when json=true. Mock buildApps, dispatch, spawnTerraform. RED: pipeline.ts stub.

### Command stubs (phase 2 completion)

- [x] T040 [P] Create `packages/pilot/src/cli/build.ts` — commander action stub: `async function buildAction(opts: CommandOptions): Promise<void>`. Thin skeleton calling buildApps. Full logic in Phase 3. **Ref**: FR-007.
- [x] T041 [P] Create `packages/pilot/src/cli/materialize.ts` — stub. **Ref**: FR-011.
- [x] T042 [P] Create `packages/pilot/src/cli/check.ts` — stub. **Ref**: FR-014.
- [x] T043 [P] Create `packages/pilot/src/cli/plan.ts` — stub. **Ref**: FR-018.
- [x] T044 [P] Create `packages/pilot/src/cli/apply.ts` — stub. **Ref**: FR-023.
- [x] T045 [P] Create `packages/pilot/src/cli/destroy.ts` — stub. **Ref**: FR-026.

### Barrel export

- [x] T046 Add `export { buildApps } from './build/index.js'; export type { BuildAppsResult, BuiltArtifact } from './contracts/build.js';` to `packages/pilot/src/index.ts`. **Ref**: D-RE-1.

---

## Phase 3: US1 — `ycsf build` (Priority: P1) 🎯 MVP

**Goal**: DevOps запускает `ycsf build` — builders → artifacts. Exit code 0 при успехе, 1 при ошибке, 2 при невалидном вводе.

**Independent Test**: Fixture: canonical project с 2 apps (user_service, analytics), builders.yaml, валидный ENV. `ycsf build --project-dir ./fixture` → exit 0, 2 artifacts.

### Tests for US1 (RED — write FIRST)

- [x] T050 [P] [US1] RED unit-test `packages/pilot/test/cli/unit/build.test.ts` — AC1: build succeeds → exit code 0, summary `{ apps: 2, artifacts: 2 }`; AC2: ENV not set → exit code 1, diagnostics contains PML_ENV_NOT_SET; AC3: unknown builder → exit code 1, BRG_UNKNOWN_BUILDER; FR-009: progress messages emitted to stderr; FR-010: empty project → exit code 0, 0 artifacts. Mock buildApps + commander action. RED: buildAction throws. **Ref**: US1 AC1, AC2, AC3.
- [x] T051 [P] [US1] RED integration-test `packages/pilot/test/cli/integration/build.integration.spec.ts` — (a) Sc1: spawn `node dist/cli/index.js build --project-dir test/check/fixtures/canonical` → exit 0, stderr contains "Building app"; (b) Sc2: `--target unknown_app` → exit 2, stderr contains "CLI_APP_NOT_FOUND". RED: binary not built / wrong exit codes. **Ref**: SC-001, SC-008.

### Implementation for US1 (GREEN)

- [x] T052 [US1] Implement `packages/pilot/src/cli/build.ts` — action: resolve rootDir from `--project-dir`, call `buildApps(rootDir, { target })`, format progress messages to stderr (FR-009), set exit code from result (kind:'ok' → 0; kind:'invalid' → 1 + map errors to diagnostics), emit CLIResult JSON if `--json`. FR-007, FR-008, FR-009, FR-010. **Depends**: T018, T014, T012.
- [x] T053 [US1] Wire `buildAction` into `packages/pilot/src/cli/index.ts` — register `program.command('build').description('Запуск builders → сборка artifacts').option('--target <app>', 'Ограничить команду одним app').action(buildAction)`. **Ref**: FR-001, FR-002, D-RE-7.

**Checkpoint**: `ycsf build` fully functional. Run `pnpm --filter @ycforge/pilot test -- --run test/cli/unit/build.test.ts test/cli/integration/build.integration.spec.ts` — GREEN.

---

## Phase 4: US2 — `ycsf materialize` (Priority: P1)

**Goal**: DevOps запускает `ycsf materialize` — materializers → generated `.ycsf.tf.json` files.

**Independent Test**: Fixture: project с artifacts из build. `ycsf materialize --project-dir ./fixture` → exit 0, `.ycsf/*.ycsf.tf.json` созданы.

### Tests for US2 (RED — write FIRST)

- [x] T060 [P] [US2] RED unit-test `packages/pilot/test/cli/unit/materialize.test.ts` — AC1: materialize succeeds → exit code 0, summary `{ files: 2 }`; AC2: extension target missing → exit code 1, diagnostics contains YCK_MISSING_TARGET; AC3: `--target user_service` → dispatch called with target filter. Mock dispatch, applyExtensions. RED: materializeAction throws. **Ref**: US2 AC1, AC2, AC3.
- [x] T061 [P] [US2] RED integration-test `packages/pilot/test/cli/integration/materialize.integration.spec.ts` — (a) materialize on canonical fixture (pre-built artifacts) → exit 0, `.ycsf/*.ycsf.tf.json` files exist; (b) `--target user_service` → only user_service materialized. RED: binary fails. **Ref**: SC-001.

### Implementation for US2 (GREEN)

- [x] T062 [US2] Implement `packages/pilot/src/cli/materialize.ts` — action: load project model, call dispatch(model, registry, { target }), applyExtensions, writeGeneratedTerraform, format generated file paths to stderr (FR-013), set exit code (0 success, 1 error). Emit CLIResult if `--json`. **Depends**: T014, T012, T041.
- [x] T063 [US2] Wire `materializeAction` into `packages/pilot/src/cli/index.ts` — `program.command('materialize').description('Запуск materializers → генерация .ycsf.tf.json').option('--target <app>').action(materializeAction)`. **Ref**: FR-011, FR-012, D-RE-7.

**Checkpoint**: `ycsf materialize` functional. Run `pnpm --filter @ycforge/pilot test -- --run test/cli/unit/materialize.test.ts test/cli/integration/materialize.integration.spec.ts` — GREEN.

---

## Phase 5: US3 — `ycsf check` (Priority: P1)

**Goal**: DevOps запускает `ycsf check` для валидации project contracts. CLI dispatches `check()` library function (spec 020), форматирует diagnostics, устанавливает exit code.

**Independent Test**: Fixture: canonical fixture (clean). `ycsf check --project-dir ./fixture` → exit 0, "All checks passed." Fixture: missing-target → exit 1, YCK_MISSING_TARGET.

### Tests for US3 (RED — write FIRST)

- [x] T070 [P] [US3] RED unit-test `packages/pilot/test/cli/unit/check.test.ts` — AC1: check clean → exit 0, stdout "All checks passed."; AC2: check with errors → exit 1, diagnostics formatted as `✗ {code}: {message}`; AC3: `--validate-tf` → check called with validateTf:true; AC4: base errors + validateTf → terraform NOT invoked (fail-fast); AC5: `--json` → valid JSON output `{ command: "check", exitCode: 0|1, diagnostics: [...] }`. Mock check() from library. RED: checkAction throws. **Ref**: US3 AC1–AC5, SC-002, SC-003.
- [x] T071 [P] [US3] RED integration-test `packages/pilot/test/cli/integration/check.integration.spec.ts` — (a) Sc3: canonical fixture → exit 0, stdout "All checks passed."; (b) Sc4: missing-target fixture → exit 1, stderr "YCK_MISSING_TARGET"; (c) Sc5: `--json` flag → valid JSON stdout. RED: binary fails. **Ref**: SC-002, SC-003, SC-007.

### Implementation for US3 (GREEN)

- [x] T072 [US3] Implement `packages/pilot/src/cli/check.ts` — action: resolve rootDir, call `check(rootDir, { validateTf: opts.validateTf })`, format diagnostics human-readable (FR-015: `✗ {code}: {message}` + details), empty → "All checks passed." (FR-017), exit code: 0 if no diagnostics, 1 if any (FR-014). JSON output per FR-016. **Depends**: T014, T012, T042.
- [x] T073 [US3] Wire `checkAction` into `packages/pilot/src/cli/index.ts` — `program.command('check').description('Валидация project-level contracts').option('--validate-tf', 'Запуск terraform validate как финальный шаг').action(checkAction)`. **Ref**: FR-014, D-RE-14, D-RE-7.

**Checkpoint**: `ycsf check` with --validate-tf and --json fully functional. Run `pnpm --filter @ycforge/pilot test -- --run test/cli/unit/check.test.ts test/cli/integration/check.integration.spec.ts` — GREEN.

---

## Phase 6: US4 — `ycsf plan` (Priority: P1)

**Goal**: DevOps запускает `ycsf plan` — build → materialize → terraform init → terraform plan. Pipeline fail-fast.

**Independent Test**: Fixture: canonical project + mock terraform. `ycsf plan --project-dir ./fixture` → exit 0, terraform plan output.

### Tests for US4 (RED — write FIRST)

- [x] T080 [P] [US4] RED unit-test `packages/pilot/test/cli/unit/plan.test.ts` — AC1: plan succeeds → exit 0, terraform plan output captured; AC2: build fails → exit 1, materialize NOT called, terraform NOT called (fail-fast); AC3: steps executed in order: build → materialize → init → plan. Mock runBuildAndMaterialize, runTerraformInit, runTerraformPlan. RED: planAction throws. **Ref**: US4 AC1, AC2, AC3, SC-004.
- [x] T081 [P] [US4] RED integration-test `packages/pilot/test/cli/integration/plan.integration.spec.ts` — (a) Sc6: canonical + mock terraform → exit 0, stderr build progress, stdout terraform output; (b) Sc7: no terraform in PATH → exit 1, stderr "CLI_TERRAFORM_NOT_FOUND". RED: binary fails.

### Implementation for US4 (GREEN)

- [x] T082 [US4] Implement `packages/pilot/src/cli/plan.ts` — action: resolve rootDir, runBuildAndMaterialize(rootDir, opts) → runTerraformInit(rootDir) → runTerraformPlan(rootDir). On any step failure: catch CLIError/RuntimeError → set exit code + diagnostics. Progress to stderr: "Running terraform init...", "Running terraform plan...". JSON summary includes tfPlanOutput (FR-022). **Depends**: T035, T030, T014.
- [x] T083 [US4] Wire `planAction` into `packages/pilot/src/cli/index.ts` — `program.command('plan').description('Pipeline: build → materialize → terraform plan').action(planAction)`. **Ref**: FR-018, FR-019, FR-020, FR-021, FR-022, D-RE-6, D-RE-7.

**Checkpoint**: `ycsf plan` pipeline functional. Run `pnpm --filter @ycforge/pilot test -- --run test/cli/unit/plan.test.ts test/cli/integration/plan.integration.spec.ts` — GREEN.

---

## Phase 7: US5 — `ycsf apply` (Priority: P1)

**Goal**: DevOps запускает `ycsf apply` — build → materialize → terraform init → terraform plan → terraform apply. Primary deployment entry point.

**Independent Test**: Fixture: canonical project + mock terraform. `ycsf apply --project-dir ./fixture` → exit 0, terraform apply output.

### Tests for US5 (RED — write FIRST)

- [x] T090 [P] [US5] RED unit-test `packages/pilot/test/cli/unit/apply.test.ts` — AC1: apply succeeds → exit 0, terraform apply output; AC2: build fails → exit 1, terraform NOT called; AC3: full pipeline order: build → materialize → init → plan → apply. Mock pipeline functions. RED: applyAction throws. **Ref**: US5 AC1, AC2, AC3.
- [x] T091 [P] [US5] RED integration-test `packages/pilot/test/cli/integration/apply.integration.spec.ts` — canonical + mock terraform → exit 0, stderr build progress, stdout terraform apply output. RED: binary fails.

### Implementation for US5 (GREEN)

- [x] T092 [US5] Implement `packages/pilot/src/cli/apply.ts` — action: resolve rootDir, runBuildAndMaterialize → runTerraformInit → runTerraformPlan → runTerraformApply. Fail-fast on any step. Progress to stderr. JSON summary includes tfApplyOutput (FR-025). **Depends**: T035, T030, T014.
- [x] T093 [US5] Wire `applyAction` into `packages/pilot/src/cli/index.ts` — `program.command('apply').description('Pipeline: build → materialize → terraform apply').action(applyAction)`. **Ref**: FR-023, FR-024, FR-025, D-RE-6, D-RE-7.

**Checkpoint**: `ycsf apply` functional. Run `pnpm --filter @ycforge/pilot test -- --run test/cli/unit/apply.test.ts test/cli/integration/apply.integration.spec.ts` — GREEN.

---

## Phase 8: US6 — `ycsf destroy` (Priority: P2)

**Goal**: DevOps запускает `ycsf destroy` — terraform destroy + cleanup. Interactive prompt без --yes, --cleanup для удаления .ycsf.tf.json файлов.

**Independent Test**: Fixture: deployed project. `ycsf destroy --yes --project-dir ./fixture` → exit 0, terraform destroy output.

### Tests for US6 (RED — write FIRST)

- [x] T100 [P] [US6] RED unit-test `packages/pilot/test/cli/unit/destroy.test.ts` — AC1: destroy with --yes → exit 0, terraform destroy called with -auto-approve; AC2: destroy without --yes + TTY + 'y' → proceeds; AC3: destroy without --yes + non-TTY → exit 2, CLI_DESTROY_REQUIRES_YES; AC4: --cleanup → .ycsf/*.ycsf.tf.json files deleted after destroy; AC5: SIGINT during terraform → child killed, exit 130; FR-029: terraform init called before destroy. Mock prompt, spawnTerraform, fs.unlink. RED: destroyAction throws. **Ref**: US6 AC1–AC4, SC-010.
- [x] T101 [P] [US6] RED integration-test `packages/pilot/test/cli/integration/destroy.integration.spec.ts` — (a) Sc8: `echo "" | node dist/cli/index.js destroy ...` → exit 2, "CLI_DESTROY_REQUIRES_YES"; (b) Sc9: `--yes` + mock terraform → exit 0, terraform destroy output. RED: binary fails. **Ref**: SC-005, SC-010.

### Implementation for US6 (GREEN)

- [x] T102 [US6] Implement `packages/pilot/src/cli/destroy.ts` — action: resolve rootDir, if no `--yes` → call `confirmDestroy()` (T032b) → false → exit 0 (user cancelled); true or `--yes` → runTerraformInit(rootDir) → runTerraformDestroy(rootDir, autoApprove=opts.yes). If `--cleanup` → delete `.ycsf/*.ycsf.tf.json` via fs.glob + fs.unlink. Progress to stderr. JSON summary includes tfDestroyOutput, cleanedUp (D-RE-7). **Depends**: T032b, T035, T030, T014.
- [x] T103 [US6] Wire `destroyAction` into `packages/pilot/src/cli/index.ts` — `program.command('destroy').description('Обёртка над terraform destroy + очистка артефактов').option('--yes, -y', 'Пропустить подтверждение').option('--cleanup', 'Удалить .ycsf/*.ycsf.tf.json после destroy').action(destroyAction)`. **Ref**: FR-026, FR-027, FR-028, FR-029, D-RE-5, D-RE-7.

**Checkpoint**: `ycsf destroy` with --yes and --cleanup functional. Run `pnpm --filter @ycforge/pilot test -- --run test/cli/unit/destroy.test.ts test/cli/integration/destroy.integration.spec.ts` — GREEN.

---

## Phase 9: US7 — `--json` output (Priority: P2)

**Goal**: DevOps интегрирует `ycsf` в CI/CD и использует `--json` для machine-readable output. Все команды выводят единую структуру CLIResult `{ command, exitCode, diagnostics, summary }`. (Базовая реализация `--json` встроена в каждую команду в Phases 3–8; здесь — end-to-end верификация формата по всем командам.)

**Independent Test**: `ycsf check --json` → stdout — валидный JSON объект c `diagnostics` array и `exitCode` number.

### Tests for US7 (RED — write FIRST)

- [x] T104 [P] [US7] RED integration-test `packages/pilot/test/cli/integration/json.integration.spec.ts` — AC1: `check --json --project-dir canonical` → stdout — валидный JSON `{ "command": "check", "exitCode": 0, "diagnostics": [], "summary": {...} }`; AC2: `build --json` на fixture с build error → JSON stdout содержит `diagnostics` с полями `code` и `message` для каждой ошибки; AC3: `plan --json` + mock terraform → JSON `summary` содержит `tfPlanOutput` (stdout capture terraform). Assert stdout is PURE JSON (no progress messages — FR-005). RED: binary emits progress or wrong schema. **Ref**: US7 AC1, AC2, AC3, FR-005.

### Implementation for US7 (GREEN)

- [x] T105 [US7] Verify JSON aggregation in `packages/pilot/src/cli/{build,materialize,check,plan,apply,destroy}.ts` — каждая команда при `--json` выводит в stdout ТОЛЬКО `JSON.stringify(CLIResult)`, progress suppressed (FR-005); `summary` per spec D-RE-7: build `{ apps, artifacts }`, materialize `{ files, extensions }`, check `{ total }`, plan `{ tfPlanOutput }`, apply `{ tfApplyOutput }`, destroy `{ tfDestroyOutput, cleanedUp }`. Fix все расхождения, найденные T104. **Depends**: T052, T062, T072, T082, T092, T102.

**Checkpoint**: `--json` output stays clean across all commands. Run `pnpm --filter @ycforge/pilot test -- --run test/cli/integration/json.integration.spec.ts` — GREEN.

---

## Phase 10: US8 — `--help` & `--version` (Priority: P3)

**Goal**: DevOps использует `ycsf --help` и `ycsf build --help` для получения справки. Commander provides this for free; need integration tests + text content verification.

**Independent Test**: `ycsf --help` → stdout lists all 6 commands. `ycsf build --help` → stdout lists build flags.

### Tests for US8 (RED — write FIRST)

- [x] T110 [P] [US8] RED integration-test `packages/pilot/test/cli/integration/help.integration.spec.ts` — Sc10: `ycsf --help` → stdout contains "build", "materialize", "check", "plan", "apply", "destroy", "--project-dir", "--json"; Sc11: `ycsf build --help` → stdout contains "build" description, "--target", "--project-dir"; Sc12: `ycsf --version` → stdout contains package version string. RED: binary not built / missing text. **Ref**: SC-006 (all 6 commands listed + build flags listed).

### Implementation for US8 (GREEN)

- [x] T111 [US8] Verify `packages/pilot/src/cli/index.ts` — commander program `.name('ycsf')`, `.version()` from package.json, `.description()` per spec. All subcommands have `.description()` matching spec table. US8 AC1–AC3 are satisfied by commander auto-generated help. **Depends**: T014, T053, T063, T073, T083, T093, T103.

**Checkpoint**: `ycsf --help` / `ycsf build --help` / `ycsf --version` all work. Run `pnpm --filter @ycforge/pilot test -- --run test/cli/integration/help.integration.spec.ts` — GREEN.

---

## Phase 11: Polish & Cross-Cutting

**Purpose**: Quickstart validation, export audit, typecheck, lint, full regression.

- [x] T120 [P] Verify quickstart Sc1 (build canonical) — `node packages/pilot/dist/cli/index.js build --project-dir packages/pilot/test/check/fixtures/canonical` → exit 0, stderr progress messages. **Depends**: T052, T053.
- [x] T121 [P] Verify quickstart Sc2 (build unknown target) — `node packages/pilot/dist/cli/index.js build --project-dir packages/pilot/test/check/fixtures/canonical --target unknown_app` → exit 2, "CLI_APP_NOT_FOUND". **Depends**: T052, T053.
- [x] T122 [P] Verify quickstart Sc3 (check clean) — `node packages/pilot/dist/cli/index.js check --project-dir packages/pilot/test/check/fixtures/canonical` → exit 0, "All checks passed." **Depends**: T072, T073.
- [x] T123 [P] Verify quickstart Sc4 (check missing-target) — `node packages/pilot/dist/cli/index.js check --project-dir packages/pilot/test/check/fixtures/missing-target` → exit 1, "YCK_MISSING_TARGET". **Depends**: T072, T073.
- [x] T124 [P] Verify quickstart Sc5 (check --json) — `node packages/pilot/dist/cli/index.js check --json --project-dir packages/pilot/test/check/fixtures/canonical` → valid JSON stdout, exitCode 0. **Depends**: T072, T073.
- [x] T125 [P] Verify quickstart Sc6 (plan with mock terraform) — `packages/pilot/test/check/fixtures/canonical` + mock terraform binary → exit 0, terraform plan output. **Depends**: T082, T083.
- [x] T126 [P] Verify quickstart Sc7 (plan no terraform) — `PATH=/usr/bin:/bin node packages/pilot/dist/cli/index.js plan --project-dir packages/pilot/test/check/fixtures/canonical` → exit 1, "CLI_TERRAFORM_NOT_FOUND". **Depends**: T082, T083.
- [x] T127 [P] Verify quickstart Sc8 (destroy non-TTY) — `echo "" | node packages/pilot/dist/cli/index.js destroy --project-dir packages/pilot/test/check/fixtures/canonical` → exit 2, "CLI_DESTROY_REQUIRES_YES". **Depends**: T102, T103.
- [x] T128 [P] Verify quickstart Sc9 (destroy --yes mock terraform) — `packages/pilot/test/check/fixtures/canonical` + mock terraform + `--yes` → exit 0. **Depends**: T102, T103.
- [x] T129 [P] Verify quickstart Sc10/Sc11/Sc12 (help + version) — `node packages/pilot/dist/cli/index.js --help`, `... build --help`, `... --version` → correct output. **Depends**: T111.
- [x] T130 Verify `packages/pilot/src/index.ts` exports `buildApps`, `BuildAppsResult`, `BuiltArtifact` — `import { buildApps } from '@ycforge/pilot'` succeeds in an external consumer smoke test against `packages/pilot/dist/index.js`. **Depends**: T046.
- [x] T131 Verify `packages/pilot/package.json` bin field: `"bin": { "ycsf": "dist/cli/index.js" }` — `npm pack --dry-run` in `packages/pilot/` shows bin entry + dist/cli/index.js present with shebang. **Depends**: T001, T134.
- [x] T132 Typecheck clean: `pnpm --filter @ycforge/pilot typecheck` against `packages/pilot/tsconfig.json` → zero errors (including `exactOptionalPropertyTypes` on CLIResult, CLIDiagnostic, BuildAppsResult). **Depends**: T046, T053, T063, T073, T083, T093, T103.
- [x] T133 Lint clean: `pnpm --filter @ycforge/pilot lint` against `packages/pilot/eslint.config.*` → zero errors (no string-literal CLI_* comparisons in src/cli/**; only constant imports from errors.ts — per Constitution V). **Depends**: T132.
- [x] T134 Full build: `pnpm --filter @ycforge/pilot build` with `packages/pilot/tsup.config.ts` → dist contains `dist/cli/index.js` with shebang, dist contains `dist/build/index.js`. **Depends**: T002, T001.
- [x] T135 Full check suite + zero-regression: `pnpm --filter @ycforge/pilot test` with `packages/pilot/vitest.config.ts` — ALL existing pilot tests (011–020) still green + ALL new `packages/pilot/test/cli/**/*.test.ts` + `packages/pilot/test/cli/**/*.spec.ts` + `packages/pilot/test/build/*.spec.ts` green. **Depends**: T132, T133, T134.
- [x] T136 Structural consistency audit: (a) CLI_* constants in `packages/pilot/src/cli/errors.ts` byte-for-byte == keys in `specs/021-ycsf-cli/contracts/ycsf-cli.json` `#/errorCodes`; (b) CLIResult shape matches contracts JSON schema; (c) exit code mapping matches data-model §2.4 exactly; (d) no string-literal CLI_* or YCK_* comparisons in `packages/pilot/src/cli/**` or `packages/pilot/src/build/**` (only constant imports from errors.ts/check/errors.ts). **Depends**: T011, T120–T129.
- [x] T137 SC-011 performance verification — measure `node packages/pilot/dist/cli/index.js check --project-dir packages/pilot/test/check/fixtures/canonical` wall time: arg parsing + project model load < 50ms (pure functions, no network). Appendix result to Polish notes. **Depends**: T134, T072.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No deps — can start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 (commander installed, tsup configured). BLOCKS all US phases. Internal order: T010/T012/T014/T016/T018/T030/T035 [P] (types + modules) → T011/T013/T015/T017/T026/T027/T031/T032/T036 (tests) → T040–T045 (stubs) → T046 (barrel).
- **Phase 3 (US1)**: Depends on Phase 2 complete. T050/T051 [P] (RED) → T052 (GREEN) → T053 (wire).
- **Phase 4 (US2)**: Depends on Phase 2 complete. T060/T061 [P] (RED) → T062 (GREEN) → T063 (wire).
- **Phase 5 (US3)**: Depends on Phase 2 complete. T070/T071 [P] (RED) → T072 (GREEN) → T073 (wire).
- **Phase 6 (US4)**: Depends on Phase 2 + Phase 3 (buildApps) complete. T080/T081 [P] (RED) → T082 (GREEN) → T083 (wire).
- **Phase 7 (US5)**: Depends on Phase 2 + Phase 3 (buildApps) complete. T090/T091 [P] (RED) → T092 (GREEN) → T093 (wire).
- **Phase 8 (US6)**: Depends on Phase 2 complete. T100/T101 [P] (RED) → T102 (GREEN) → T103 (wire).
- **Phase 9 (US7)**: Depends on all command implementations (Phases 3–8). T104 (RED) → T105 (verify/fix JSON aggregation).
- **Phase 10 (US8)**: Depends on all commands wired (Phases 3–8). T110 (RED) → T111 (verify).
- **Phase 11 (Polish)**: Depends on all US phases. T120–T129 [P] (quickstart) → T130–T131 → T132 → T133 → T134 → T135 → T136 → T137.

### User Story Dependencies

```
Phase 1 (Setup) ──────────────────────────────────────────┐
                                                           ▼
Phase 2 (Foundational) ──────┬────────────────────────────┐
                              │                            │
                              ├──► Phase 3 (US1 build) ────┼──► Phase 6 (US4 plan)  ──┐
                              │                            │                            │
                              ├──► Phase 4 (US2 material.)─┼──► Phase 6 (US4 plan)  ──┤──► Phase 9 (US7 json)
                              │                            │                            │       │
                              ├──► Phase 5 (US3 check) ───┼───────────────────────────┘       │
                              │                            │                                    │
                              ├──► Phase 8 (US6 destroy) ─┼────────────────────────────────────┘
                              │                            │
                              └──► Phase 3+4 → Phase 7 (US5 apply) ────────────────────┐
                                                                                       │
                                             Phase 9 (US7) ─► Phase 10 (US8) ─► Phase 11
```

- **US1, US2, US3, US6**: Can start in parallel after Phase 2 (independent files).
- **US4, US5**: Depend on US1 (buildApps orchestrator must exist for pipeline).
- **US7**: Depend on command implementations (Phases 3–8) for end-to-end JSON verification.
- **US8**: Depends on all command wires (Phases 3–8).
- **Polish**: Depends on all US phases.

### Parallel Opportunities

- **Phase 2**: T010/T012/T014/T016/T018/T030/T035 [P] (types, modules, CLI skeleton); T011/T013/T015/T017/T026/T027/T031/T032/T036 [P] (unit tests); T040–T045 [P] (command stubs).
- **Phases 3, 4, 5, 8**: After Phase 2, four US chains run in parallel: US1 (T050/T051 → T052 → T053), US2 (T060/T061 → T062 → T063), US3 (T070/T071 → T072 → T073), US6 (T100/T101 → T102 → T103).
- **Phases 6, 7**: After US1 complete, US4 and US5 run in parallel: US4 (T080/T081 → T082 → T083), US5 (T090/T091 → T092 → T093).
- **Phase 11**: T120–T129 [P] (quickstart verification per scenario).

### Parallel Example: Phases 3, 4, 5, 8

```bash
# After Phase 2 (foundational complete):
Task: "US1: build tests T050/T051 → impl T052 → wire T053"
Task: "US2: materialize tests T060/T061 → impl T062 → wire T063"
Task: "US3: check tests T070/T071 → impl T072 → wire T073"
Task: "US6: destroy tests T100/T101 → impl T102 → wire T103"
# Then (after US1):
Task: "US4: plan tests T080/T081 → impl T082 → wire T083"
Task: "US5: apply tests T090/T091 → impl T092 → wire T093"
# Then (after Phases 3–8):
Task: "US7: json integration test T104 → verify T105"
Task: "US8: help tests T110 → verify T111"
```

---

## Implementation Strategy

### MVP First (US1 only — `ycsf build`)

1. Complete Phase 1: Setup (package.json, tsup).
2. Complete Phase 2: Foundational (types, buildApps, CLI skeleton, terraform, pipeline).
3. Complete Phase 3: US1 — `ycsf build` (RED T050/T051 → GREEN T052 → wire T053).
4. **STOP and VALIDATE**: `ycsf build --project-dir test/check/fixtures/canonical` → exit 0, 2 artifacts built, progress messages in stderr.
5. MVP: `ycsf build` works end-to-end.

### Incremental Delivery

1. Setup + Foundational → module skeleton buildable + types/constants.
2. US1 (`ycsf build`) → Test independently → MVP!
3. US2 (`ycsf materialize`) → Test independently → generation complete.
4. US3 (`ycsf check`) → Test independently → validation complete (spec 020 CLI wrap).
5. US4 (`ycsf plan`) → Test independently → plan pipeline works.
6. US5 (`ycsf apply`) → Test independently → deployment pipeline works.
7. US6 (`ycsf destroy`) → Test independently → lifecycle complete.
8. US7 (`--json`) → Test independently → CI/CD integration ready.
9. US8 (`--help`) → Verify commander integration.
10. Polish → quickstart, exports, typecheck, lint, regression.

### Parallel Team Strategy

With multiple developers:
1. Together: Phase 1 (Setup) + Phase 2 (Foundational).
2. Once Foundational done:
   - Developer A: US1 (build) + US2 (materialize) — build pipeline
   - Developer B: US3 (check) + US6 (destroy) — independent commands
3. After A: US4 (plan) + US5 (apply) — pipeline commands
4. After B & A: US7 (json) + US8 (help) — verification
5. Together: Polish — quickstart, typecheck, lint, regression.
