# Spec 021: ycsf-cli — CLI commands Project C

## Metadata

- **Spec ID**: 021
- **Title**: ycsf-cli — CLI layer Project C (build/materialize/check/plan/apply/destroy)
- **Status**: 🚧 In Progress
- **Dependencies**: 013 (builder-registry ✅), 014 (materializer-dispatch ✅), 020 (ycsf-check ✅)
- **IDEA.md sections**: §20 (Project C overview, CLI commands), §28 (`ycsf check`), §30 (production pipeline), §40 (`ycsf destroy`)
- **Packages**: `packages/pilot` (`@ycforge/pilot`)

---

## Problem Statement

Спецификации 011–020 реализовали library layer Project C: загрузка project model, ENV, builders, materialization, extensions, outputs, moves, check. Каждая функция — чистая, без side effects, экспортируемая из `@ycforge/pilot`. Но **нет CLI-слоя**, который связывает эти функции в пользовательские команды.

§20 IDEA.md определяет CLI команды C:

- `ycsf build` — builders → artifacts;
- `ycsf materialize` — artifacts → generated `.tf.json`;
- `ycsf check` — валидация project-level contracts (реализована как library в spec 020, CLI-обёртка — в этом spec);
- `ycsf plan` — build + materialize + `terraform plan`;
- `ycsf apply` — build + materialize + `terraform apply`;
- `ycsf destroy` — обёртка над `terraform destroy` (§40).

Spec 020 явно отложил CLI `ycsf check` (arg parsing, `--validate-tf`, exit codes 0/1) в spec 021.

Spec 021 реализует **только CLI-слой**: dispatch команд, флаги, exit codes, structured + human-readable вывод, обработка ошибок и diagnostics.

---

## Scope (In Scope)

### Команды

| Команда | Описание | Library functions |
|---------|----------|-------------------|
| `ycsf build` | Запуск builders → сборка artifacts для всех apps | `loadProjectModel`, `prepareBuildEnv`, `loadRegistry`, `validateBuilders`, builders execution |
| `ycsf materialize` | Запуск materializers → генерация `.ycsf.tf.json` | `dispatch`, `writeGeneratedTerraform`, `loadExtensions`, `applyExtensions` |
| `ycsf check` | Валидация project-level contracts (C1–C13) | `check()` (spec 020) |
| `ycsf plan` | Pipeline: build → materialize → extensions → writes infra → `terraform plan` | build + materialize steps + `terraform plan` |
| `ycsf apply` | Pipeline: build → materialize → extensions → writes infra → `terraform plan` → `terraform apply` | build + materialize steps + `terraform apply` |
| `ycsf destroy` | Обёртка над `terraform destroy` + очистка артефактов | `terraform destroy` CLI invocation + artifact cleanup |

### Pipeline order (§30)

```
ycsf build:    loadProjectModel → prepareBuildEnv → validate ENV → run builders → artifacts
ycsf materialize: dispatch (materializers) → applyExtensions → writeGeneratedTerraform → extensions → outputs → moves
ycsf check:    check() — library function (spec 020)
ycsf plan:     build → materialize → check (implicit) → terraform init → terraform plan
ycsf apply:    build → materialize → check (implicit) → terraform init → terraform plan → terraform apply
ycsf destroy:  terraform destroy → artifact cleanup
```

### Флаги

| Флаг | Команды | Описание | Default |
|------|---------|----------|---------|
| `--project-dir <path>` | Все | Корневая директория проекта | cwd |
| `--json` | Все | Machine-readable JSON output (structured diagnostics) | false |
| `--no-color` | Все | Отключение ANSI-цветов в human-readable выводе | false |
| `--validate-tf` | `check` | Запуск `terraform validate` как финальный шаг | false |
| `--target <app>` | `build`, `materialize` | Ограничить команду одним app (по app ID из apps.yaml) | все apps |

### Exit codes

| Code | Значение | Примеры |
|------|----------|---------|
| 0 | Успех: все операции завершены без ошибок | check без diagnostics, build завершён, terraform plan success |
| 1 | Ошибка валидации или runtime: project model invalid, build failed, check diagnostics present, terraform error | check exit code 1 (any diagnostic), build failure, terraform plan/apply non-zero exit |
| 2 | Ошибка ввода/конфигурации: невалидный path, отсутствует apps.yaml, неизвестная команда | invalid `--project-dir`, missing `.ycsf/apps.yaml` |

### Вывод

**Human-readable (default)**:
- Per-step progress messages (echoed to stderr): `Loading project model...`, `Building app user_service...`, `Running terraform plan...`
- Diagnostics: `✗ YCK_MISSING_TARGET: extension target functions.user_service not found` (с деталями)
- Success: `✓ Build complete. 3 app(s) built.`
- Terraform output: pass-through (terraform stdout/stderr)

**Structured (--json)**:
```json
{
  "command": "build",
  "exitCode": 0,
  "diagnostics": [],
  "summary": { "apps": 3, "artifacts": 3 }
}
```

### Ошибки CLI (CLI_0xx family)

| Code | Description | Category |
|------|-------------|----------|
| `CLI_UNKNOWN_COMMAND` | Неизвестная команда | Input |
| `CLI_MISSING_PROJECT_DIR` | `--project-dir` не указана и cwd не содержит `.ycsf/` | Input |
| `CLI_APP_NOT_FOUND` | Указанный `--target` app не найден в apps.yaml | Input |
| `CLI_BUILD_FAILED` | Builder завершился с ошибкой | Runtime |
| `CLI_TERRAFORM_FAILED` | terraform CLI вернул non-zero exit code | Runtime |
| `CLI_TERRAFORM_NOT_FOUND` | `terraform` binary не найден в PATH | Runtime |

### Зафиксированные решения

**D-1 — CLI бинарник: `ycsf`.** Единый entry point `ycsf` с subcommands (`build`, `materialize`, `check`, `plan`, `apply`, `destroy`). Аналогично `ycsf-api` (spec 010, packages/composer). CLI lives в `packages/pilot/src/cli/`, bundler (tsup) добавляет shebang `#!/usr/bin/env node`. `package.json` получает `"bin": { "ycsf": "dist/cli/index.js" }`.

Рациональность:
- Mirrors established convention from `ycsf-api` (packages/composer): same bundler config, same shebang approach.
- Single binary = single `npx ycsf` invocation. No separate packages per command.
- CLI layer is thin: arg parsing + I/O + exit codes. Library functions stay in `src/`.

**D-2 — Framework: commander.js.** CLI использует `commander` (как `ycsf-api`). Commander добавляется как dependency в `packages/pilot/package.json`. CLI entry point — `src/cli/index.ts`, subcommands — `src/cli/{build,materialize,check,plan,apply,destroy}.ts`.

Рациональность:
- Consistency with existing `ycsf-api` CLI.
- commander provides: subcommand dispatch, option parsing, help generation, version display.
- No reason to introduce alternative framework (oclif, yargs) for consistency.

**D-3 — Exit code semantics: unified.** Все команды используют единую схему exit codes: 0 = success, 1 = any error (validation, runtime, terraform), 2 = input/config error. Это align с D-3 spec 020 (check: 0 = clean, 1 = any diagnostics) и расширяет его на все команды.

Рациональность:
- CI/CD pipelines (GitHub Actions, GitLab CI)期待 binary pass/fail; 3-level scheme (0/1/2) покрывает success/validation/input-error.
- `ycsf-api` (spec 010) использует 0/1/2/3. Project C simplifies to 0/1/2 (no IO-specific code 3 — terraform failures are runtime errors = exit 1).
- Consistency across C commands; users memorize one scheme.

**D-4 — `ycsf plan`/`apply` = build + materialize + terraform.** `ycsf plan` выполняет build → materialize → `terraform init` → `terraform plan`. `ycsf apply` = plan + `terraform apply`. Это **pipeline orchestration**, не отдельный deployment engine (Constitution I, §20: "тонкие обёртки над Terraform CLI"). CLI dispatches library functions sequentially; ошибки на любом step прерывают pipeline.

Рациональность:
- §30 IDEA.md: production pipeline order.
- Thin wrapper: CLI вызывает library functions + spawns `terraform` CLI. No terraform state management, no provider schema modeling (Constitution IV).
- Fail-fast on pipeline: if build fails, materialize is not attempted.

**D-5 — `ycsf destroy` = terraform destroy + cleanup.** `ycsf destroy` вызывает `terraform destroy` (pass-through), затем удаляет сгенерированные артефакты (`infra/*.ycsf.tf.json` + `infra/99-ycsf-outputs.tf.json`, T152). CLI не manages state — state is Terraform's responsibility.

Рациональность:
- §40 IDEA.md: "обёртка над `terraform destroy` с дополнительной очисткой артефактов".
- Artifact cleanup is optional flag `--cleanup` (default: false) — user may want to keep generated files for debugging.
- `terraform destroy` is destructive; CLI prints confirmation prompt unless `--yes` flag is provided.

**D-6 — `ycsf check` = library function + CLI wrapper.** `ycsf check` dispatches to `check(rootDir, options?)` (spec 020 library function). CLI adds: `--validate-tf` flag, `--json` output, exit code mapping (0 = no diagnostics, 1 = any diagnostics). CLI layer adds NO additional validation logic.

Рациональность:
- Spec 020 explicitly deferred CLI wrapping to 021.
- CLI is thin: parse args → call check() → format output → set exit code.
- Library function stays pure and side-effect free (Constitution II).

**D-7 — `--target` flag для build/materialize.** Флаг `--target <app>` ограничивает команду одним app (по app ID из apps.yaml). Если app не найден — exit code 2 + `CLI_APP_NOT_FOUND`. По умолчанию — все apps.

Рациональность:
- Common workflow: dev работает над одним app, не хочет rebuild всего проекта.
- No ordering issues: apps are independent (§6: apps = managed, no cross-app dependencies in build/materialize).

### Scope boundaries (Out of Scope)

| Что | Почему не в scope | Owner |
|-----|-------------------|-------|
| Terraform provider schema validation | Constitution IV: C не моделирует provider schema | Terraform |
| Terraform state management | State — Terraform responsibility | Terraform |
| Deployment provisioning (Yandex API calls) | Constitution I: C не знает Yandex API напрямую | Terraform / Provider |
| Builder execution internals | Builder logic validated by builders themselves (spec 018) | Builders |
| Secret management / Lockbox | Runtime secrets; CLI не manages them | User / Lockbox |
| `ycsf-api` commands (compile/check) | Project B scope (spec 010) | Composer |
| Config file formats (.ycsf/*.yaml) | Defined in specs 011–017 | Project C library |
| Incremental builds / caching | Deferred to spec 022 | Spec 022 |
| `--json` output schema versioning | Post-MVP; schema is internal to this spec | Spec 021 |

---

## User Scenarios & Testing

### User Story 1 — DevOps запускает `ycsf build` (Priority: P1)

DevOps запускает `ycsf build` в корне проекта. CLI загружает project model, проверяет ENV requirements, запускает builders для каждого app, выводит progress и результат.

**Why this priority**: Primary build entry point. Foundation for all other commands.

**Independent Test**: Fixture: project с 2 apps (user_service, analytics), builders.yaml, валидный ENV. Запустить `ycsf build --project-dir ./fixture`. Ожидать: exit code 0, 2 artifacts built, progress messages в stderr.

**Acceptance Scenarios**:

1. **Given** project с 2 apps и валидном ENV, **When** `ycsf build` выполняется, **Then** exit code = 0, stdout/stderr содержит progress messages для каждого app, artifacts созданы в `.ycsf/artifacts/`.
2. **Given** project с 1 app, где ENV не установлен, **When** `ycsf build` выполняется, **Then** exit code = 1, diagnostics содержит `PML_ENV_NOT_SET`.
3. **Given** project с неизвестным builder type, **When** `ycsf build` выполняется, **Then** exit code = 1, diagnostics содержит `BRG_UNKNOWN_BUILDER`.

---

### User Story 2 — DevOps запускает `ycsf materialize` (Priority: P1)

DevOps запускает `ycsf materialize` после build. CLI запускает dispatch (materializers), применяет extensions, записывает generated `.ycsf.tf.json`.

**Why this priority**: Essential for generation pipeline; bridge between build and terraform.

**Independent Test**: Fixture: project с artifacts из build step. Запустить `ycsf materialize --project-dir ./fixture`. Ожидать: exit code 0, `.ycsf/*.ycsf.tf.json` файлы созданы.

**Acceptance Scenarios**:

1. **Given** project с generated artifacts, **When** `ycsf materialize` выполняется, **Then** exit code = 0, `.ycsf/*.ycsf.tf.json` файлы содержат generated resources.
2. **Given** project с extensions на несуществующий resource, **When** `ycsf materialize` выполняется, **Then** exit code = 1, diagnostics содержит `YCK_MISSING_TARGET`.
3. **Given** project с 2 apps и `--target user_service`, **When** `ycsf materialize` выполняется, **Then** materialize выполняется только для `user_service`.

---

### User Story 3 — DevOps запускает `ycsf check` с флагами (Priority: P1)

DevOps запускает `ycsf check` для валидации project contracts. CLI вызывает `check()` library function (spec 020), форматирует diagnostics и устанавливает exit code. С флагом `--validate-tf` добавляется terraform validate step.

**Why this priority**: Completes spec 020 deferral; primary validation entry point.

**Independent Test**: Fixture: project с extensions error. Запустить `ycsf check --project-dir ./fixture`. Ожидать: exit code 1, diagnostics содержит EXT_*/YCK_* codes.

**Acceptance Scenarios**:

1. **Given** project без errors, **When** `ycsf check` выполняется, **Then** exit code = 0, diagnostics пуст, stdout: "All checks passed."
2. **Given** project с extension target на несуществующий resource, **When** `ycsf check` выполняется, **Then** exit code = 1, diagnostics содержит `YCK_MISSING_TARGET`, human-readable output: `✗ YCK_MISSING_TARGET: ...`.
3. **Given** project без errors, **When** `ycsf check --validate-tf` выполняется и `terraform validate` завершается успешно, **Then** exit code = 0.
4. **Given** project с errors, **When** `ycsf check --validate-tf` выполняется, **Then** terraform validate НЕ вызывается (fail-fast).
5. **Given** project без errors, **When** `ycsf check --json` выполняется, **Then** stdout — JSON `{ "diagnostics": [], "exitCode": 0 }`.

---

### User Story 4 — DevOps запускает `ycsf plan` (Priority: P1)

DevOps запускает `ycsf plan` для полного pipeline: build → materialize → terraform init → terraform plan. CLI dispatches library functions, затем вызывает `terraform init` и `terraform plan`.

**Why this priority**: Core production workflow per §30.

**Independent Test**: Fixture: project с валидными apps + builders + builder output. Запустить `ycsf plan --project-dir ./fixture`. Ожидать: exit code 0, terraform plan output в stdout.

**Acceptance Scenarios**:

1. **Given** валидный project, **When** `ycsf plan` выполняется, **Then** exit code = 0, terraform plan output отображён, generated files созданы в `.ycsf/`.
2. **Given** project с build error, **When** `ycsf plan` выполняется, **Then** exit code = 1, materialize и terraform НЕ вызываются (fail-fast pipeline).
3. **Given** валидный project, **When** `ycsf plan` выполняется, **Then** сначала выполняется build, затем materialize, затем check (implicit), затем terraform plan — в правильном порядке.

---

### User Story 5 — DevOps запускает `ycsf apply` (Priority: P1)

DevOps запускает `ycsf apply` для deployment: build → materialize → terraform plan → terraform apply. CLI dispatches library functions, затем вызывает terraform.

**Why this priority**: Primary deployment entry point.

**Independent Test**: Fixture: project с валидными apps + terraform state (mock). Запустить `ycsf apply --project-dir ./fixture`. Ожидать: exit code 0, terraform apply output.

**Acceptance Scenarios**:

1. **Given** валидный project, **When** `ycsf apply` выполняется, **Then** exit code = 0, terraform apply output отображён, infrastructure deployed.
2. **Given** project с build error, **When** `ycsf apply` выполняется, **Then** exit code = 1, terraform apply НЕ вызывается.
3. **Given** валидный project, **When** `ycsf apply` выполняется, **Then** сначала plan (build → materialize → terraform plan), затем terraform apply.

---

### User Story 6 — DevOps запускает `ycsf destroy` (Priority: P2)

DevOps запускает `ycsf destroy` для удаления infrastructure. CLI вызывает `terraform destroy`, затем (опционально) очищает generated артефакты.

**Why this priority**: Required per §40, but lower frequency than build/plan/apply.

**Independent Test**: Fixture: project с deployed infrastructure. Запустить `ycsf destroy --project-dir ./fixture --yes`. Ожидать: exit code 0, terraform destroy output.

**Acceptance Scenarios**:

1. **Given** deployed project, **When** `ycsf destroy --yes` выполняется, **Then** exit code = 0, terraform destroy output отображён, infrastructure удалена.
2. **Given** deployed project, **When** `ycsf destroy` выполняется БЕЗ `--yes`, **Then** CLI показывает confirmation prompt "Are you sure? (y/N):" и ждёт ввод.
3. **Given** deployed project, **When** `ycsf destroy --yes --cleanup` выполняется, **Then** после terraform destroy удаляются `infra/*.ycsf.tf.json` файлы.
4. **Given** `terraform` не найден в PATH, **When** `ycsf destroy` выполняется, **Then** exit code = 1, diagnostics содержит `CLI_TERRAFORM_NOT_FOUND`.

---

### User Story 7 — DevOps использует `--json` output (Priority: P2)

DevOps интегрирует `ycsf` в CI/CD pipeline и использует `--json` flag для machine-readable output. Все команды выводят JSON-структуру с diagnostics и summary.

**Why this priority**: CI/CD integration is common use case; consistent with `ycsf-api` `--json` flag.

**Independent Test**: Запустить `ycsf check --json`. Ожидать: stdout — валидный JSON объект с `diagnostics` array и `exitCode` number.

**Acceptance Scenarios**:

1. **Given** project, **When** `ycsf check --json` выполняется, **Then** stdout — валидный JSON: `{ "command": "check", "exitCode": 0, "diagnostics": [], "summary": {...} }`.
2. **Given** project с errors, **When** `ycsf build --json` выполняется, **Then** JSON содержит `diagnostics` с `code`, `message` fields для каждой ошибки.
3. **Given** project, **When** `ycsf plan --json` выполняется, **Then** JSON содержит `summary` с terraform plan output (stdout capture).

---

### User Story 8 — DevOps использует `ycsf --help` (Priority: P3)

DevOps запускает `ycsf --help` или `ycsf build --help` для получения справки по командам и флагам.

**Why this priority**: Standard CLI UX; commander provides this for free.

**Independent Test**: Запустить `ycsf --help`. Ожидать: список команд (build, materialize, check, plan, apply, destroy) с описаниями.

**Acceptance Scenarios**:

1. **When** `ycsf --help` выполняется, **Then** stdout содержит список всех команд с краткими описаниями.
2. **When** `ycsf build --help` выполняется, **Then** stdout содержит описание команды build и её флагов (--project-dir, --target, --json).
3. **When** `ycsf --version` выполняется, **Then** stdout содержит версию пакета.

---

### Edge Cases

- **Нет `.ycsf/apps.yaml`**: Все команды (кроме `destroy`) выходят с exit code 2 + `CLI_MISSING_PROJECT_DIR`. `ycsf destroy` не требует apps.yaml (только terraform state).
- **`--target` app не найден**: exit code 2 + `CLI_APP_NOT_FOUND`.
- **`terraform` не установлен + `ycsf plan/apply/destroy`**: exit code 1 + `CLI_TERRAFORM_NOT_FOUND`.
- **Interrupted pipeline (SIGINT)**: CLI ловит SIGINT, корректно завершает child processes (terraform), exit code 130 (convention).
- **Пустой project (нет apps)**: `ycsf build` — exit code 0 (0 apps built, не ошибка). `ycsf plan` — skip build/materialize, вызывает `terraform plan` (возможно plan на пустом state).
- **`ycsf destroy` без `--yes`**: interactive prompt; если stdin не TTY — exit code 2 + error message "use --yes flag".

---

## Requirements

### Functional Requirements

**CLI dispatch**

- **FR-001**: `ycsf` CLI MUST implement subcommand dispatch: `build`, `materialize`, `check`, `plan`, `apply`, `destroy`. Неизвестная команда → `CLI_UNKNOWN_COMMAND` + exit code 2.
- **FR-002**: `ycsf` CLI MUST быть `commander`-based, mirroring `ycsf-api` conventions (packages/composer/src/cli/index.ts).
- **FR-003**: CLI MUST ловить все unhandled errors в command actions и конвертировать в diagnostics + exit codes. Необработанные ошибки → exit code 1 + `CLI_UNEXPECTED_ERROR` (fallback).

**Global flags**

- **FR-004**: `--project-dir <path>` MUST resolve path и использовать его как rootDir для всех library function calls. Default: `process.cwd()`.
- **FR-005**: `--json` flag MUST переключать вывод в structured JSON format. Human-readable progress messages НЕ выводятся при `--json` (clean JSON stdout).
- **FR-006**: `--no-color` flag MUST отключать ANSI escape sequences в human-readable output.

**`ycsf build`**

- **FR-007**: `ycsf build` MUST вызывать: `loadProjectModel` → `prepareBuildEnv` → `validateBuilders` → builders execution (per app). Exit code 0 при успехе, 1 при ошибке любого step.
- **FR-008**: `ycsf build --target <app>` MUST загружать project model, фильтровать apps по `--target` и выполнять build только для указанного app. Unknown app → `CLI_APP_NOT_FOUND` (exit code 2).
- **FR-009**: `ycsf build` MUST выводить progress messages (per app) в stderr в human-readable mode.
- **FR-010**: `ycsf build` MUST выводить exit code 0 если ни один app не обнаружен (пустой проект не ошибка).

**`ycsf materialize`**

- **FR-011**: `ycsf materialize` MUST вызывать: `loadProjectModel` → `dispatch` → `applyExtensions` → `writeGeneratedTerraform`. Exit code 0 при успехе, 1 при ошибке.
- **FR-012**: `ycsf materialize --target <app>` MUST materialize только указанный app.
- **FR-013**: `ycsf materialize` MUST выводить generated file paths в human-readable mode.

**`ycsf check`**

- **FR-014**: `ycsf check` MUST dispatch to `check(rootDir, options?)` library function (spec 020). CLI layer добавляет: `--validate-tf` flag → `options.validateTf = true`, exit code mapping (0 = no diagnostics, 1 = any diagnostics).
- **FR-015**: `ycsf check` MUST выводить каждый diagnostic в human-readable format: `✗ {code}: {message}` + optional detail fields (target, field, availableIdls).
- **FR-016**: `ycsf check --json` MUST выводить `{ "command": "check", "exitCode": 0|1, "diagnostics": [...] }`.
- **FR-017**: `ycsf check` с пустым diagnostics MUST выводить "All checks passed." в human-readable mode.

**`ycsf plan`**

- **FR-018**: `ycsf plan` MUST выполнять pipeline: build → materialize → `terraform init` → `terraform plan`. Pipeline прерывается при ошибке любого step (fail-fast).
- **FR-019**: `ycsf plan` MUST вызывать `terraform init -no-color` перед `terraform plan`.
- **FR-020**: `ycsf plan` MUST pass-through terraform stdout/stderr в human-readable mode.
- **FR-021**: `ycsf plan` MUST fail если `terraform` не найден в PATH → `CLI_TERRAFORM_NOT_FOUND`.
- **FR-022**: `ycsf plan --json` MUST включать terraform plan stdout в JSON summary.

**`ycsf apply`**

- **FR-023**: `ycsf apply` MUST выполнять pipeline: build → materialize → `terraform init` → `terraform plan` → `terraform apply`. Pipeline прерывается при ошибке.
- **FR-024**: `ycsf apply` MUST pass-through terraform stdout/stderr.
- **FR-025**: `ycsf apply --json` MUST включать terraform apply stdout в JSON summary.

**`ycsf destroy`**

- **FR-026**: `ycsf destroy` MUST вызывать `terraform destroy -auto-approve -no-color` (с `-auto-approve` только если `--yes` flag установлен).
- **FR-027**: `ycsf destroy` БЕЗ `--yes` MUST показывать interactive confirmation prompt. Если stdin не TTY → exit code 2 + `CLI_DESTROY_REQUIRES_YES`.
- **FR-028**: `ycsf destroy --cleanup` MUST удалять `infra/*.ycsf.tf.json` файлы (плюс `infra/99-ycsf-outputs.tf.json`) после успешного terraform destroy (цель материализации — `infra/`, см. pipeline order; T152).
- **FR-029**: `ycsf destroy` MUST вызывать `terraform init -no-color` перед destroy.

### Error Codes (CLI_0xx family)

| Code | Description | Category |
|------|-------------|----------|
| `CLI_UNKNOWN_COMMAND` | Unknown subcommand | Input |
| `CLI_MISSING_PROJECT_DIR` | No `.ycsf/` found in cwd and `--project-dir` not provided | Input |
| `CLI_APP_NOT_FOUND` | `--target` app not found in apps.yaml | Input |
| `CLI_BUILD_FAILED` | Builder execution failed | Runtime |
| `CLI_TERRAFORM_FAILED` | Terraform CLI returned non-zero exit code | Runtime |
| `CLI_TERRAFORM_NOT_FOUND` | `terraform` binary not found in PATH | Runtime |
| `CLI_DESTROY_REQUIRES_YES` | `ycsf destroy` without `--yes` in non-interactive mode | Input |
| `CLI_UNEXPECTED_ERROR` | Unhandled exception caught by CLI error handler | Runtime |

### Key Entities

- **CLICommand**: `{ name: string; description: string; action: (opts) => Promise<void> }` — subcommand definition.
- **CLIResult**: `{ command: string; exitCode: 0 | 1 | 2; diagnostics: readonly Diagnostic[]; summary?: Record<string, unknown> }` — structured output (--json).
- **CLIDiagnostic**: `{ code: string; message: string; details?: Record<string, unknown> }` — CLI-level diagnostic (for errors before library dispatch).
- **PipelineStep**: Sequential execution unit (build, materialize, terraform). Failure in any step aborts the pipeline.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: `ycsf build` на reference-проекте (2 apps, valid builders, valid ENV) завершается с exit code 0 и artifacts в `.ycsf/artifacts/`.
- **SC-002**: `ycsf check` на reference-проекте (0 diagnostics) завершается с exit code 0 и message "All checks passed.".
- **SC-003**: `ycsf check` на project с extension error завершается с exit code 1 и diagnostics list.
- **SC-004**: `ycsf plan` на valid project выполняет build → materialize → terraform init → terraform plan в правильном порядке, exit code 0.
- **SC-005**: `ycsf destroy --yes` вызывает `terraform destroy -auto-approve` и завершается с exit code 0.
- **SC-006**: `ycsf --help` выводит список всех 6 команд с описаниями; `ycsf build --help` выводит описание флагов build.
- **SC-007**: `ycsf check --json` выводит валидный JSON с полем `diagnostics` и `exitCode`.
- **SC-008**: `ycsf build --target unknown_app` завершается с exit code 2 и `CLI_APP_NOT_FOUND`.
- **SC-009**: `ycsf plan` без `terraform` в PATH завершается с exit code 1 и `CLI_TERRAFORM_NOT_FOUND`.
- **SC-010**: `ycsf destroy` без `--yes` в non-TTY завершается с exit code 2.
- **SC-011**: CLI startup overhead (arg parsing + project model load) < 50ms (как library functions: pure, no network).
- **SC-012**: 100% acceptance criteria US1–US8 покрыты тестами (Constitution II: каждый AC → ≥1 тест, RED → GREEN). `typecheck`/`lint` пакета — чисто.

---

## Assumptions

- **Commander dependency**: `commander` добавляется как runtime dependency в `packages/pilot/package.json` (аналог `packages/composer/package.json`). Packages already use `yaml` as dependency; adding `commander` follows established pattern.
- **CLI location**: CLI lives in `packages/pilot/src/cli/`, bundled by tsup with `#!/usr/bin/env node` banner (mirroring `packages/composer/tsup.config.ts`).
- **Build/ materialize library functions**: spec 021 предполагает, что library functions для build (`buildApps` → artifacts) и materialize (`dispatch` → `writeGeneratedTerraform`) уже существуют или будут созданы как часть library layer. CLI dispatches them; CLI НЕ содержит build/materialize logic.
- **Terraform invocation**: `ycsf plan`/`apply`/`destroy` вызывают `terraform` через `child_process.spawn` (Node.js built-in). Terraform binary expected in PATH. No bundling, no version management (Constitution IV: Terraform stays real Terraform).
- **`ycsf destroy` confirmation prompt**: Interactive prompt uses `readline` (Node.js built-in). `--yes` flag bypasses prompt. No external prompt library.
- **`ycsf check` progress messages**: check library function (spec 020) is pure; CLI wraps it with progress messages only in human-readable mode (--json: silent check, no progress).
- **`--json` output schema**: JSON output schema is internal to this spec; no external versioning needed yet. Schema may evolve in future specs.
- **Exit code 2 for input errors**: `ycsf-api` (spec 010) uses exit code 2 for input errors. Project C mirrors this convention.
- **No `--validate-tf` on plan/apply**: `ycsf plan`/`apply` include terraform init which is sufficient for validation. `--validate-tf` is specific to `ycsf check` (lightweight validation without pipeline).

---

## References

- IDEA.md §20: Project C — Build/Deployment Orchestrator, CLI commands list
- IDEA.md §28: `ycsf check` — validation layer
- IDEA.md §30: B + C + Terraform production pipeline
- IDEA.md §40: Cleanup — `ycsf destroy` wrapper
- Constitution I: A/B/C/Terraform separation
- Constitution II: Spec-first, Test-first (RED → GREEN)
- Constitution III: Contract versioning
- Constitution IV: Terraform stays real Terraform
- Constitution V: Explicit over magic; fail-fast
- Constitution VI: Ownership model (apps = managed, resources = external)
- Spec 010: `ycsf-api-cli` — CLI conventions (commander, tsup, error handling, --json)
- Spec 020: `ycsf-check` — `check()` library function, `CheckResult`, `CheckOptions`, `Diagnostic` types, `YCK_*` codes, D-3 exit codes
- `packages/composer/src/cli/index.ts` — CLI pattern to mirror (commander, error handler, --json, --project-dir)
- `packages/composer/src/cli/errors.ts` — CLIError hierarchy pattern
- `packages/composer/tsup.config.ts` — bundler config with shebang banner
- `packages/pilot/src/index.ts` — library function exports
- `packages/pilot/src/check/check.ts` — `check()` implementation (spec 020)
- `packages/pilot/src/contracts/check.ts` — `CheckResult`, `CheckOptions`, `Diagnostic` types

---

## Next Steps

1. `/speckit.plan` — technical design: `src/cli/` module structure, commander setup, error handler, terraform spawn wrapper, --json output schema, progress messages.
2. `/speckit.tasks` — разбивка на задачи с test-first (RED → GREEN) по acceptance criteria US1–US8.
3. `/speckit.analyze` — консистентность spec/plan/tasks.
4. `/speckit.implement` — код, тесты, typecheck/lint.
