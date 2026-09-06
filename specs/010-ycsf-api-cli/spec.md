# Spec 010: ycsf-api CLI — compile / check

## Metadata

- **Spec ID**: 010
- **Title**: ycsf-api CLI — `compile` и `check` команды для Project B (composer)
- **Status**: 🚧 In Progress
- **Dependencies**: 008 (api-composition), 009 (resource-references)
- **IDEA.md sections**: §3 (Project B overview), §13 (API composition), §14 (Overrides), §12 (auth.yaml), §15–16 (Resource model, IDL/IDT/IDR)
- **Packages**: `packages/composer` (`@ycforge/composer`)

---

## Problem Statement

Project B (`@ycforge/composer`) нужен **standalone CLI** (`ycsf-api`) с двумя командами:

1. **`ycsf-api compile`** — собирает единую Yandex API Gateway OpenAPI specification из:
   - приложений в `.ycsf/apps.yaml` (фильтр: только приложения с `builder: yandex-api-gateway`);
   - их OpenAPI sources (через `openapi_entry` / safe build mode, spec 006);
   - `auth.yaml` (spec 007) — auth schemes: `none`, `jwt`, `function`;
   - `overrides.yaml` (глобальный + per-app, spec 014) — deep merge с provenance;
   - resource references (IDL/IDT/IDR, spec 009) — интерполяция `${resources...}` в OpenAPI/overrides.

2. **`ycsf-api check`** — **lightweight validation** API-composition contracts **без Terraform / без Project C**:
   - наличие OpenAPI sources у всех gateway-приложений;
   - валидность auth schemes в `auth.yaml` (существующие scheme names, корректные поля по типу);
   - отсутствие конфликтов `path` / `operationId` между приложениями (fail-fast, spec 013);
   - разрешимость всех `${resources...}` ссылок (IDL → IDT) через `.ycsf/resources.yaml` + `apps.yaml` (spec 009);
   - корректность overrides (пути существуют в собранной spec, нет дублирующих keys).

**Важно**: `ycsf-api check` НЕ делает:
- `terraform validate` / provider schema validation (это `ycsf check` / `terraform validate`);
- build приложений (это Project C / builders);
- deployment / provisioning.

---

## Scope (In Scope)

### `ycsf-api compile`

**Inputs** (все relative to project root / `--project-dir`):

| File | Role |
|------|------|
| `.ycsf/apps.yaml` | список приложений; берём только `builder: yandex-api-gateway` |
| `<app>/build_config.yaml` | `openapi_entry` (spec 006) — путь к сгенерированному OpenAPI |
| `<app>/auth.yaml` | auth schemes (spec 007) — один на gateway-app |
| `<app>/overrides.yaml` | per-app overrides (опционально) |
| `openapi/overrides.yaml` | global overrides (опционально) |
| `.ycsf/resources.yaml` | resource declarations для IDL resolution (spec 009) |

**Output**:

- stdout / `--output` file: **единая OpenAPI 3.1 document** (Yandex API Gateway compatible) с:
  - merged `paths` / `components` из всех gateway-приложений;
  - встроенными `securitySchemes` из `auth.yaml` + `security` requirements на operations (по `@RequireAuth` / scheme mapping);
  - применёнными global + local overrides (local > global, provenance-based);
  - разрешёнными `${resources.<domain>.<name>.<prop>}` → реальные значения (или placeholder в ENV-only mode, spec 018);
  - `x-yc-*` extensions для API Gateway integrations (functions, containers, MQ, OBS, HTTP, dummy).

**Behaviour**:

- Provenance tracking: каждый `path` / `operationId` tagged с `sourceApp` для conflict detection и local overrides.
- Fail-fast на конфликтах: duplicate `operationId` или overlapping `path` (same method + path pattern) → error с диагностикой (какие apps, какие routes).
- `SERVERLESS_TOOLS_OPENAPI_BUILD=1` устанавливается автоматически для builder-ов (spec 006).
- Exit codes: `0` = success, `1` = composition error, `2` = input/config error, `3` = IO error.

### `ycsf-api check`

**Inputs**: те же, что у `compile` (но build artifacts не обязательны — достаточно `openapi_entry` paths и `auth.yaml` / `overrides.yaml` / `resources.yaml`).

**Checks** (все должны пройти для exit code 0):

1. **OpenAPI sources exist**: у каждого `builder: yandex-api-gateway` app есть `openapi_entry` и файл существует (или будет сгенерирован builder-ом — в ENV-only mode допускается отсутствие, spec 018).
2. **Auth schemes valid**:
   - `defaultScheme` существует в `schemes`;
   - каждый scheme имеет `type: none | jwt | function`;
   - `jwt`: `issuer`, `audience[]`, `jwksUri` present;
   - `function`: `function` (IDL reference, e.g. `functions.internal_authorizer`) resolvable через resources.yaml.
3. **No path/operationId conflicts**: между всеми gateway-приложениями (same logic as compile).
4. **Resource references resolvable**: все `${resources...}` в OpenAPI sources / overrides / auth.yaml имеют matching IDL в `resources.yaml` или app-generated artifacts (functions.*, containers.*, queues.*, buckets.*, gateways.*).
5. **Overrides target existing paths**: keys в `overrides.yaml` (global и per-app) match существующие paths/components в merged spec (до применения overrides).

**Output**:

- Human-readable summary (stdout): ✓/✗ per check, details на failures.
- `--json` flag: machine-readable JSON с results.
- Exit codes: `0` = all pass, `1` = validation failures, `2` = input/config error.

---

## Out of Scope (Non-Goals)

- **Terraform generation / validation** — это Project C (`ycsf check` / `terraform validate`).
- **Build orchestration** — `ycsf build` / `ycsf materialize` / `ycsf plan` / `ycsf apply` (spec 021).
- **Builder execution** — B не запускает builders; предполагает, что OpenAPI sources уже есть или будут созданы C.
- **Secret management / Lockbox / JWKS publishing** — B только генерирует gateway config.
- **Semantic OpenAPI merge** (beyond fail-fast) — post-MVP.
- **Multiple gateway support в одной команде** — MVP: один `yandex-api-gateway` app на проект; multiple gateways = multiple project dirs или повторный запуск с `--app <gateways.app>`.

---

## Acceptance Criteria

| ID | Criterion | Traceability |
|----|-----------|--------------|
| AC-01 | `ycsf-api compile` читает `.ycsf/apps.yaml`, находит app с `builder: yandex-api-gateway`, загружает его OpenAPI через `openapi_entry` | §3, §10, §13 |
| AC-02 | `ycsf-api compile` мержит `paths` / `components` нескольких gateway-apps, сохраняя provenance (`sourceApp` per route) | §13 |
| AC-03 | `ycsf-api compile` применяет `auth.yaml`: генерирует `components.securitySchemes` + `security` на operations согласно scheme mapping | §12 |
| AC-04 | `ycsf-api compile` применяет global `overrides.yaml` + per-app `overrides.yaml` (local > global) с provenance-aware merge | §14 |
| AC-05 | `ycsf-api compile` интерполирует `${resources...}` через IDL/IDT/IDR (spec 009), в ENV-only mode оставляет placeholder | §15–16, §18 |
| AC-06 | `ycsf-api compile` выдаёт error с диагностикой при duplicate `operationId` или overlapping `path` (same method) | §13, §14 |
| AC-07 | `ycsf-api compile` пишет результат в stdout или `--output` файл, exit code 0 при успехе | §3 |
| AC-08 | `ycsf-api check` валидирует наличие OpenAPI sources у всех gateway-apps | §10 |
| AC-09 | `ycsf-api check` валидирует `auth.yaml` схемы (типы, обязательные поля, resolvable function refs) | §12 |
| AC-10 | `ycsf-api check` обнаруживает конфликты `path` / `operationId` между gateway-apps | §13 |
| AC-11 | `ycsf-api check` проверяет разрешимость всех `${resources...}` ссылок | §15–16 |
| AC-12 | `ycsf-api check` проверяет, что overrides targets существуют в merged spec | §14 |
| AC-13 | `ycsf-api check` поддерживает `--json` output, exit codes 0/1/2 | §3 |
| AC-14 | CLI работает **без Project C / Terraform** — standalone binary / `npx ycsf-api` | §3 |
| AC-15 | `ycsf-api` устанавливает `SERVERLESS_TOOLS_OPENAPI_BUILD=1` при вызове builder-ов (если интегрирован в C) | §10 |

---

## Non-Functional Requirements

- **Performance**: `check` < 2s для типичного проекта (10 apps, 200 routes); `compile` < 5s.
- **Determinism**: одинаковые inputs → бинарно идентичный OpenAPI output.
- **Diagnostics**: ошибки должны указывать файл, строку, app ID, route/operationId.
- **No side effects**: `check` не пишет файлы, не вызывает внешние процессы.

---

## Open Questions (Clarifications Needed)

1. **Multiple gateway apps в одном проекте**: MVP поддерживает только один? Если да — как выбрать, если несколько? (`--app` flag? первый в apps.yaml? error?)
2. **ENV-only mode в `check`**: пропускать проверку наличия OpenAPI файлов если `env.yaml` с `mode: env-only`?
3. **Output format**: всегда Yandex API Gateway extensions (`x-yc-*`) или опционально plain OpenAPI?
4. **Scheme mapping**: как `@RequireAuth` (Nest decorator) мапится на scheme name в `auth.yaml`? Через `x-yc-auth-scheme` в operation extensions?
5. **Overrides syntax**: точный формат `overrides.yaml` — JSON Pointer / JSON Patch / custom? (spec 014 говорит "не generic deep merge", нужно уточнить).

---

## References

- Spec 006: `openapi-extraction` — `openapi_entry`, safe build mode
- Spec 007: `auth-config` — `auth.yaml` scheme types, validation
- Spec 008: `api-composition` — merge, provenance, fail-fast conflicts
- Spec 009: `resource-references` — IDL/IDT/IDR, `${resources...}` syntax
- Spec 014: `overrides` — global/local, precedence, provenance
- IDEA.md §3: Project B purpose, CLI separation
- IDEA.md §13: API composition details
- IDEA.md §14: Overrides mechanics
- IDEA.md §12: auth.yaml structure

---

## Next Steps

1. `/speckit.clarify` — resolve open questions above with concrete examples.
2. `/speckit.plan` — technical design: CLI structure (commander.js / oclif), composition engine modules, validation pipeline, error reporting.
3. `/speckit.tasks` — breakdown into implementation tasks with test-first approach.