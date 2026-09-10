# Research: ycsf-cli (spec 021)

**Spec**: [specs/021-ycsf-cli/spec.md](./spec.md) | **Branch**: `021-ycsf-cli` | **Date**: 2026-09-10

Решения технических неопределённостей, выявленных в Technical Context.

---

## D-RE-1 — Build-step library gap: `buildApps` orchestrator

**Decision**: Добавить в pilot функцию `buildApps(rootDir, options?) → BuildAppsResult`, размещающуюся в `src/build/index.ts`. CLI dispatches её для `ycsf build`, `ycsf plan`, `ycsf apply`.

**Rationale**: Верификация кодовой базы показала, что публичный barrel `src/index.ts` экспортирует отдельные шаги (`loadProjectModel`, `prepareBuildEnv`, `loadRegistry`, `validateBuilders`), но **не экспортирует** высокоуровневую функцию-оркестратор, которая связывает их в единый pipeline «загрузить → подготовить ENV → валидировать реестр → запустить builder для каждого app → собрать артефакты». Материализация уже имеет `dispatch()` (spec 014) как единую точку входа; строительная фаза — нет.

Существующий паттерн: `dispatch()` в `src/materialize/dispatch.ts` — единая точка входа для materialization, вызывается CLI `ycsf materialize`, pipeline `ycsf plan`/`apply`. Строительная фаза должна иметь симметричный паттерн.

Альтернативы:
1. **CLI собирает шаги из exports напрямую** — дублирование логики оркестрации в CLI; каждая команда (build/plan/apply) повторяет один и тот же pipeline. Нарушение DRY, сложнее тестировать.
2. **Полный `pipeline()` функция (build+materialize+terraform)** — нарушает разделение concerns; build и materialize должны быть вызываемы независимо (`ycsf build`, `ycsf materialize`).
3. **`buildApps` в CLI, не в pilot** — CLI станет оркестратором вместо thin wrapper; нарушает Constitution I (C owns orchestration). Additionally, materialize needs `PluginRegistry` from build phase — если build в CLI, registry загружается дважды.

**Влияние на D-7 (--target)**: `buildApps` принимает `options.target?: string` и фильтрует apps по app ID перед запуском builders. Unknown target → `CLI_APP_NOT_FOUND`.

**Влияние на кодовую базу**:
- Новый модуль: `src/build/index.ts` (export `buildApps`, `BuildAppsResult`)
- `src/registry/shape.ts`: добавить `getBuilder(module) → Builder | null` (симметрично `getMaterializer`)
- `src/index.ts`: добавить `export { buildApps } from './build/index.js'`

---

## D-RE-2 — Terraform spawn: `spawn` async, pass-through stdio

**Decision**: `ycsf plan`/`apply`/`destroy` вызывают terraform через `node:child_process.spawn` (async), с pass-through stdio (inherit). `ycsf check --validate-tf` продолжает использовать `spawnSync` (spec 020, D-RE-5) — там tiny команды, sync допустим.

**Rationale**: `plan`/`apply`/`destroy` — долгоживущие процессы (десятки секунд). Pass-through stdio (inherit) позволяет пользователю видеть реальный вывод terraform в реальном времени, а не копить в буфере. `spawnSync` блокирует event loop, неприемлем для этих команд.

**Terraform arg sets** (из spec FR-018..029):
- `terraform init -no-color` — предшествует plan/apply/destroy
- `terraform plan -no-color` — plan step
- `terraform apply -auto-approve -no-color` — apply step (всегда с `-auto-approve`)
- `terraform destroy -no-color` — destroy без `--yes`
- `terraform destroy -auto-approve -no-color` — destroy с `--yes`

Флаг `-no-color` нужен для чистого вывода (CI/CD парсинг). Решение: всегда `-no-color` для CLI terraform вызовов (нет `--color` флага у CLI; это internal detail).

**Timeout**: 30 секунд для init/plan/apply/destroy — консервативный default. Нет конфигурируемого timeout в MVP;将来 можно добавить `--timeout`.

**CWD**: terraform вызывается из `<rootDir>/infra/` (infra directory). Generated `.ycsf.tf.json` файлы живут здесь.

**Альтернативы**:
1. `spawnSync` для всех — блокирует event loop, нет progress streaming.
2. `execFile` — аналогично spawn, но collect-ит output; нет pass-through.
3. Нет timeout — terraform зависнет навсегда.

---

## D-RE-3 — Terraform not found: ENOENT detection

**Decision**: При spawn terraform, ловим `ENOENT` error (child process не найден в PATH) → `CLI_TERRAFORM_NOT_FOUND` diagnostic + exit code 1.

**Rationale**: `spawn` для несуществующего бинарника генерирует Error с `code: 'ENOENT'`. Проверяем `error.code === 'ENOENT'` в обработчике.

```
CLI_TERRAFORM_NOT_FOUND: terraform binary not found in PATH
exit code: 1
category: Runtime
```

**Альтернативы**:
1. `which terraform` перед spawn — лишний вызов, race condition с PATH.
2. `command -v terraform` — shell-dependent.

---

## D-RE-4 — SIGINT child-process cleanup

**Decision**: CLI регистрирует обработчик `process.on('SIGINT', ...)` который:
1. Убивает текущий child process (`child.kill('SIGTERM')`)
2. Ждёт 2 секунды для graceful shutdown
3. Если child жив — `child.kill('SIGKILL')`
4. `process.exit(130)`

**Rationale**: Exit code 130 — стандартная UNIX convention для SIGINT (128 + signal 2). Child process (terraform) может не завершиться при SIGINT если терминал в raw mode.

**Альтернативы**:
1. `process.exit(130)` без kill child — child becomes orphan.
2. `SIGKILL` сразу — грубое завершение, потеря данных terraform state.
3. Нет обработки — child becomes zombie.

---

## D-RE-5 — Interactive destroy prompt: readline + non-TTY guard

**Decision**: `ycsf destroy` без `--yes`:
1. `process.stdin.isTTY` проверка: если false → exit code 2 + `CLI_DESTROY_REQUIRES_YES`
2. Если TTY: `readline.createInterface({ input: process.stdin, output: process.stderr })` → prompt `"Are you sure you want to destroy infrastructure? (y/N): "` → читаем одну строку → `y/Y` → proceed, всё остальное → abort (exit code 0, не ошибка — пользователь отменил).

**Rationale**: readline — встроенный Node.js модуль, нет внешних зависимостей (Constitution). Non-TTY guard предотвращает зависание в CI/CD пайплайнах. `--yes` flag пропускает prompt и передаёт `-auto-approve` в terraform destroy.

**Альтернативы**:
1. `inquirer` — внешняя зависимость, избыточна для одного prompt.
2. `process.stdout.write` + `process.stdin.once` — rewrite readline, больше кода.
3. Нет prompt — `terraform destroy` без `-auto-approve` сам показывает prompt; но CLI хочет контроль над артефактами после destroy.

---

## D-RE-6 — Pipeline module: plan/apply/destroy share build+materialize

**Decision**: Новый модуль `src/cli/pipeline.ts` содержит:
- `runBuildAndMaterialize(rootDir, target?, json?) → void` — общий для plan/apply/destroy (build+materialize+extensions+writes)
- `runTerraformInit(rootDir)` — init step
- `runTerraformPlan(rootDir, json?)` — plan step
- `runTerraformApply(rootDir, json?)` — apply step
- `runTerraformDestroy(rootDir, yes?, json?)` — destroy step

**Rationale**: plan/apply/destroy разделяют первые 2 шага (build → materialize). Выносим в pipeline module, исключая дублирование.

```
ycsf plan:     runBuildAndMaterialize → runTerraformInit → runTerraformPlan
ycsf apply:    runBuildAndMaterialize → runTerraformInit → runTerraformPlan → runTerraformApply
ycsf destroy:  runTerraformInit → runTerraformDestroy → (optional) cleanup
```

**Ключевой момент**: `ycsf destroy` **не** вызывает build/materialize — только terraform destroy + cleanup. Это align с spec D-5.

**Альтернативы**:
1. Дублировать pipeline в каждой команде — нарушение DRY.
2. Единая `runPipeline(command, rootDir)` —过度 abstraction, команды слишком разные.
3. Pipeline в library layer (pilot) — нарушает разделение concerns (CLI owns I/O, pipeline owns terraform orchestration).

---

## D-RE-7 — --json output schema: CLIResult

**Decision**: Единый JSON output schema для всех команд:

```json
{
  "command": "build|materialize|check|plan|apply|destroy",
  "exitCode": 0,
  "diagnostics": [],
  "summary": { ... }
}
```

**Rationale**: Единая структура упрощает парсинг в CI/CD. `summary` — командно-специфичный:
- `build`: `{ "apps": 3, "artifacts": 3 }`
- `materialize`: `{ "files": 2, "extensions": 1 }`
- `check`: `{ "total": 0 }` (пока diagnostics пуст)
- `plan`: `{ "tfPlanOutput": "..." }`
- `apply`: `{ "tfApplyOutput": "..." }`
- `destroy`: `{ "tfDestroyOutput": "...", "cleanedUp": true }`

`diagnostics` содержит массив `{ "code": string, "message": string, ... }` — library diagnostics (PML_*, EXT_*, YCK_*) и CLI diagnostics (CLI_*).

При `--json` flag: progress messages в stderr НЕ выводятся (FR-005); stdout — только JSON.

**Альтернативы**:
1. Разные schemas для каждой команды — сложнее парсинг.
2. Минимальный `{ "exitCode": 0 }` — нет diagnostics/summary, бесполезен.
3. Wrapped в `{ "ok": true, "data": {...} }` — избыточная обёртка.

---

## D-RE-8 — Diagnostics mapping: library → CLI

**Decision**: CLI конвертирует ошибки в diagnostics по трём путям:

1. **Library errors** (PML_*, BRG_*, EXT_*, MTL_*, YCK_*): проверяются по `kind === 'invalid'` результата. Массив `errors`/`diagnostics` из результата → CLI diagnostics. Exit code: 1.
2. **CLI-level errors** (CLI_*): генерируются в CLI при валидации ввода (missing .ycsf/, unknown target). Класс `CLIError` с `code` и `exitCode`.
3. **Terraform errors** (CLI_TERRAFORM_FAILED): non-zero exit code от terraform spawn → `CLI_TERRAFORM_FAILED` diagnostic. Exit code: 1.

Exit code mapping:
- `CLIError` с `exitCode: 2` → process.exitCode = 2 (input/config error)
- `CLIError` с `exitCode: 1` → process.exitCode = 1 (runtime error)
- `CLI_TERRAFORM_NOT_FOUND` → process.exitCode = 1 (runtime error)
- `CLI_DESTROY_REQUIRES_YES` → process.exitCode = 2 (input error)
- SIGINT → process.exitCode = 130

**Rationale**: Соответствует D-3 из spec (0/1/2) и зеркалит `ycsf-api` паттерн (composer `src/cli/errors.ts`).

---

## D-RE-9 — Commander integration: mirror from composer

**Decision**: CLI использует `commander` v12 (как composer). Структура зеркала:

- `src/cli/index.ts` — entry point, program definition, global flags, error handler, `.parseAsync()`
- `src/cli/errors.ts` — `CLIError` hierarchy (analogous to composer `src/cli/errors.ts`)
- `src/cli/build.ts` — build command action
- `src/cli/materialize.ts` — materialize command action
- `src/cli/check.ts` — check command action
- `src/cli/plan.ts` — plan command action
- `src/cli/apply.ts` — apply command action
- `src/cli/destroy.ts` — destroy command action
- `src/cli/pipeline.ts` — shared terraform pipeline functions

Global flags: `--project-dir`, `--json`, `--no-color` (set on program root).

**Rationale**: Точное зеркало паттерна из `packages/composer/src/cli/index.ts`. Commander provides:
- Subcommand dispatch
- Option parsing with types
- Auto-generated help (`--help`)
- Version display (`--version`)

**tsup bundling**: Аналогично composer `tsup.config.ts`:
```ts
{
  entry: { index: 'src/cli/index.ts' },
  outDir: 'dist/cli',
  format: ['esm'],
  banner: { js: '#!/usr/bin/env node' },
  external: ['commander'],
}
```

**package.json bin field**:
```json
{
  "bin": { "ycsf": "dist/cli/index.js" }
}
```

---

## D-RE-10 — CLI test strategy

**Decision**: CLI тесты используют два подхода:

1. **Unit tests** (`test/cli/unit/`): прямой вызов action functions (commander actions), mock `child_process.spawn` для terraform команд. Аналог pattern из composer integration tests (прямой вызов `compose()`, не CLI spawn).

2. **Integration tests** (`test/cli/integration/`): `node:child_process.execFile('node', ['dist/cli/index.js', ...])` на built binary с fixture projects. Проверяют exit codes, stdout/stderr output.

**Rationale**: Unit tests быстрые и hermetic. Integration tests проверяют реальный CLI invocation (arg parsing, shebang, exit codes). Composer не имеет CLI tests (проверяет только library functions) — это gap, который spec 021 закрывает.

**vitest config**: Добавить `include: ['test/cli/**/*.spec.ts']` в `vitest.config.ts` пакета pilot.

**Fixture reuse**: `test/check/fixtures/canonical/` — канонический fixture с 2 apps (user_service, analytics), builders.yaml, валидным ENV, extensions, outputs, moves. CLI integration tests переиспользуют его.

---

## D-RE-11 — `prepareBuildEnv` role в pipeline

**Decision**: `prepareBuildEnv(projectModel)` возвращает `BuildEnvResolutionResult`. CLI должен проверять этот результат перед запуском builders: если есть ошибки (unresolved ENV) → exit code 1 + `PML_ENV_NOT_SET` diagnostics, не запускать builders.

**Rationale**: `prepareBuildEnv` (spec 011/012) разрешает `{{$ENV}}` references в build_config/build_env и проверяет, что обязательные ENV установлены. Если разрешение не удалось, builders не могут быть запущены (build_config содержит неразрешённые `{{$ENV}}`).

---

## D-RE-12 — `--target` app filtering

**Decision**: В `buildApps`, если `--target` указан:
1. Загружаем project model
2. Проверяем `model.apps.has(target)` — если нет → `CLI_APP_NOT_FOUND` (exit code 2)
3. Фильтруем apps map: `new Map([[target, model.apps.get(target)]])`
4. Для filtered model: проверяем build_configs, запускаем builders

В `materialize` (CLI) `--target` фильтр применяется ПОСЛЕ `dispatch` по имени файла: из `generatedFiles` остаются только записи `{target}.ycsf.tf.json`. Это НЕ поле `DispatchOptions` — тип `DispatchOptions` не содержит `target` (спецификация target-фильтра в dispatch отсутствует; константа-коллбэк `_options` в `src/materialize/dispatch.ts` не используется).

**Rationale**: Фильтрация на уровне model, не на уровне runner. Чистый approach: model загружается полностью, фильтруется до запуска. Для materialize фильтр по имени файла после dispatch — единственный безопасный канал target-семантики (FR-012); план/apply НЕ передают target, поэтому материализуют все apps.

---

## D-RE-13 — `--no-color` implementation

**Decision**: `--no-color` флаг устанавливает `NO_COLOR=1` в `process.env` (стандарт https://no-color.org/). Commander передаёт через global opts. CLI прогресс-сообщения (✓/✗) использует chalk-like formatting или ANSI escape codes; `--no-color` отключает их.

Для MVP: progress messages в stderr используют простые строки без ANSI:
- `✓` / `✗` — Unicode symbols, не ANSI-colored
- Если потребуется color: модульная проверка `opts.noColor || process.env.NO_COLOR`

**Rationale**: `NO_COLOR` environment variable — стандарт. Commander не имеет built-in `--no-color` support; реализуется в CLI layer.

---

## D-RE-14 — `ycsf check` library delegation

**Decision**: `ycsf check` dispatches to `check(rootDir, options?)` из `@ycforge/pilot` (spec 020). CLI layer:
1. Парсит args (`--validate-tf`, `--json`)
2. Вызывает `check(rootDir, { validateTf: opts.validateTf })`
3. Форматирует вывод:
   - Human-readable: `✗ {code}: {message}` для каждого diagnostic; "All checks passed." если пуст
   - JSON: `{ "command": "check", "exitCode": 0|1, "diagnostics": [...], "summary": {...} }`
4. Устанавливает exit code: 0 если diagnostics пуст, 1 если нет

**Rationale**: Spec 020 D-6 определяет CLI surface; spec 021 реализует CLI wrapper. Library function чистая и side-effect free (Constitution II). CLI layer добавляет только I/O и exit code.

---

## D-RE-15 — `getBuilder` shape function

**Decision**: Добавить `getBuilder(module: unknown): Builder | null` в `src/registry/shape.ts`. Симметрично `getMaterializer`:

```ts
export function getBuilder(module: unknown): Builder | null {
  if (module === null || typeof module !== 'object') return null;
  const rec = module as Record<string, unknown>;
  const target: unknown = rec.default !== null && typeof rec.default === 'object' ? rec.default : rec;
  return isBuilderShape(target) ? (target as unknown as Builder) : null;
}
```

**Rationale**: `isBuilderShape` уже существует, но возвращает boolean. CLI и `buildApps` нужен typed `Builder` для вызова `.build()`. Материализация уже имеет `getMaterializer`.

---

## Все NEEDS CLARIFICATION решены

| # | Неопределённость | Решение |
|---|-------------------|---------|
| 1 | Build-step library gap | D-RE-1: `buildApps` в pilot `src/build/` |
| 2 | Terraform spawn strategy | D-RE-2: async spawn, pass-through stdio |
| 3 | Terraform not found | D-RE-3: ENOENT → CLI_TERRAFORM_NOT_FOUND |
| 4 | SIGINT cleanup | D-RE-4: kill SIGTERM → wait → SIGKILL → exit 130 |
| 5 | Destroy prompt | D-RE-5: readline + non-TTY guard |
| 6 | Pipeline reuse | D-RE-6: `src/cli/pipeline.ts` shared functions |
| 7 | --json schema | D-RE-7: unified CLIResult |
| 8 | Diagnostics mapping | D-RE-8: library errors → CLI errors → exit codes |
| 9 | Commander conventions | D-RE-9: mirror from composer |
| 10 | Test strategy | D-RE-10: unit + integration tests |
| 11 | prepareBuildEnv role | D-RE-11: check before builders |
| 12 | --target filtering | D-RE-12: filter at model level |
| 13 | --no-color | D-RE-13: NO_COLOR env var |
| 14 | check delegation | D-RE-14: dispatch to check() + format |
| 15 | getBuilder shape | D-RE-15: add to registry/shape.ts |
