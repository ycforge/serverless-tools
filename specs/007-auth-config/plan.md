# Implementation Plan: `auth.yaml` — формат и валидация authentication scheme references (Project B)

**Branch**: `007-auth-config` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-auth-config/spec.md`

## Summary

Spec 007 adds the auth-config phase to `@ycforge/composer` (Project B): reading and self-validating the composition's `auth.yaml` (`version: 1`, exactly one `defaultScheme`, a non-empty `schemes` map with scheme types `none`/`jwt`/`function`), resolving `functions.<name>` references, and cross-validating that every scheme name appearing in the `security`-entries of the extracted OpenAPI document (006) is declared in that same `auth.yaml`. Every invalid state is a deterministic fail-fast error that names the offending field/scheme/route; unknown scheme types are never silently ignored; duplicate scheme names are collisions, never last-wins merges. Applying `defaultScheme` to naked operations and emitting `components.securitySchemes`/API Gateway authorizers is explicitly reserved for spec 008 — 007 produces a validated source and reference-resolvability only.

Key technical approach:
- New module `src/auth/` in the existing composer package (greenfield, mirrors 006 module layout); no changes to extraction (`extract.ts`, `runner/`)
- YAML parsing via the battle-tested `yaml` v2 package **bundled** into `dist` (tsup `noExternal`), preserving the package's published zero-runtime-dependency property while getting built-in duplicate-key detection (`DUPLICATE_KEY` `YAMLParseError`) — no hand-rolled subset parser (research R1)
- `auth.yaml` is read from the composition root (`<appRoot>/auth.yaml`, same `appRoot` that 006 extraction already receives) — research R2
- Function references validated on the `functions.<name>` syntax (FR-012a) and resolved against a caller-provided set of functions made available with the composition input; content introspection is out of scope — research R3
- Extensibility seam for new scheme types: discriminated union + per-type validator registry — additive contract change, existing validators untouched (FR-005) — research R4
- Explicit seam to 008: 007 never mutates the OpenAPI document, never applies `defaultScheme`, never emits securitySchemes/authorizer config — research R5

## Technical Context

**Language/Version**: TypeScript 5.9, ES2022 target, ESNext modules (repo convention, composer `tsconfig.json`)

**Primary Dependencies**: runtime (published manifest) — none, builtins only (`node:fs`, `node:path`). `yaml` v2 is a devDependency **bundled** into `dist/index.js` via tsup `noExternal: ['yaml']`; the published package keeps an empty `dependencies` field. Dev: typescript, vitest, tsup, `@types/node`.

**Storage**: N/A (stateless; reads the single `auth.yaml` file at the composition root)

**Testing**: vitest (monorepo convention, `vitest.config.ts` globs `src/**/*.spec.ts` + `test/**/*.spec.ts`); unit tests drive inline YAML fixtures; a small number of appRoot-based scenarios use fixture dirs under `test/fixtures/` (006 pattern)

**Target Platform**: Node.js 22+ (dev/CI build tool — mirrors the other packages; not a Cloud Function runtime)

**Project Type**: library — added public API of the existing npm package `@ycforge/composer`

**Performance Goals**: build-time; single small-file read + parse; linear in `schemes` count and `security`-entry count; no measurable cost

**Constraints**: no new published runtime dependencies (bundled `yaml`); `auth.yaml` is read-only input for B; every invalid state is fail-fast with deterministic message naming scheme/field/route; unknown types never ignored; duplicate names are errors; B never introspects target functions and never performs provisioning (FR-011/012)

**Scale/Scope**: ~6 source files + spec files + integration spec in `packages/composer/src/auth/`; fixture dirs + inline YAML fixtures

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation of concerns | ✅ | Auth config validation + security-reference validation is B's (composition) zone; no provisioning, no key/JWKS/Lockbox/Object Storage (FR-011), no guard-semantics proof (FR-010), no user-code import (B consumes only the extracted OpenAPI doc, FR-013) |
| II. Spec-first, test-first | ✅ | Spec complete with ACs (US1–US3, Edge Cases); acceptance scenarios become tests before implementation |
| III. Contracts versioned | ✅ | `auth.yaml` carries `version: 1` and is contract-versioned with `@ycforge/composer` semver (Assumptions); new public API + error taxonomy documented in `contracts/auth-config.md`; no `.ycsf/*.yaml` new format in this spec, but the file is governed by the same contract-versioning line |
| IV. Terraform stays Terraform | N/A | No Terraform involvement |
| V. Explicit over magic | ✅ | Unknown scheme type — fail-fast, never "no security" (FR-005); duplicate scheme name — collision, never last-wins (FR-007); reserved `public` convention explicit (FR-009); deterministic error codes; failed resolvability of `function` reference and a missing `functions` set — fail-fast (FR-012); all spec ambiguity rows resolved by defaults — /speckit-clarify not needed |
| VI. Ownership | N/A | No apps/resources identity work (011) |

**Post-design re-check**: see Phase 1.

## Project Structure

### Documentation (this feature)

```text
specs/007-auth-config/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command — NOT created here)
```

### Source Code (repository root)

```text
packages/composer/                         # MOD: @ycforge/composer (Project B)
├── package.json                           # MOD: devDependency "yaml"; dependencies остаются пустыми; files = [dist, runner]
├── tsup.config.ts                         # MOD: noExternal: ['yaml'] — yaml вшивается в dist, published manifest без runtime deps
├── src/
│   ├── index.ts                           # MOD: публичный экспорт auth-config API + типы + коды ошибок
│   ├── auth/
│   │   ├── auth-config.ts                 # NEW: оркестрация validateAuthConfig(request) (FR-001/002/003/006/013)
│   │   ├── auth-config.spec.ts            # NEW: FSM-тесты интеграции этапов
│   │   ├── auth-yaml.ts                   # NEW: чтение <compositionRoot>/auth.yaml, parse (yaml v2), self-validation (FR-002..FR-007, дубликаты), reserved public
│   │   ├── auth-yaml.spec.ts              # NEW: все инвалидные варианты SC-003
│   │   ├── auth-security.ts               # NEW: сбор security-entries из извлечённого OpenAPI (root + operation), cross-validation (FR-008/009/013)
│   │   ├── auth-security.spec.ts          # NEW: US2 AC1–AC5, SC-004
│   │   ├── function-ref.ts                # NEW: синтаксис functions.<name> + разрешимость в набор функций (FR-012)
│   │   ├── function-ref.spec.ts           # NEW: US3 AC1–AC2, FR-012
│   │   └── auth-errors.ts                 # NEW: AuthConfigError + детерминированные коды
└── test/
    ├── auth-config.integration.spec.ts    # NEW: e2e на fixture-директориях (US1–US3, Edge Cases)
    └── fixtures/
        ├── openapi-app/                   # NEW: каноническая composition (корень openapi-app): auth.yaml (valid) + документ с security-ссылками
        ├── openapi-app-no-auth/           # NEW: auth.yaml отсутствует → AUTH_FILE_MISSING
        ├── openapi-app-dup/               # NEW: дубликат ключа schemes
        ├── openapi-app-unknown-type/      # NEW: type: oauth2
        ├── openapi-app-bad-version/       # NEW: version: 2
        ├── openapi-app-missing-default/   # NEW: нет defaultScheme
        ├── openapi-app-default-unresolved/# NEW: defaultScheme: ghost
        ├── openapi-app-empty-schemes/     # NEW: schemes: {}
        ├── openapi-app-schemes-not-map/   # NEW: schemes — список (edge: не-мапа)
        ├── openapi-app-no-functions/      # NEW: есть function-схема, functions в запросе не передан
        ├── openapi-app-missing-jwt-fields/# NEW: jwt без audience
        ├── openapi-app-missing-function/  # NEW: function-схема без поля function
        ├── openapi-app-bad-function-format/# NEW: function: internal_authorizer (без префикса)
        ├── openapi-app-unresolved-function/# NEW: function: functions.nope (не в наборе)
        ├── openapi-app-undeclared-ref/    # NEW: security → admin (не объявлена)
        ├── openapi-app-public-ref/        # NEW: security → public (договорное нарушение)
        └── openapi-app-naked-ops/         # NEW: операции без security; валидно на 007 (defaultScheme — 008)
```

**Structure Decision**: composer keeps the lean library layout from 006; the auth work is a self-contained `src/auth/` module so extraction stays untouched and the validator is independently testable per boundary (self-validation, security cross-validation, function resolvability). A single public orchestrator `validateAuthConfig(request)` mirrors the `extractOpenApi` request/options idiom; granular sub-modules map 1:1 to FR groups for test traceability (SC-003..SC-006).

## Phase 0: Research

**Output**: [research.md](./research.md)

All NEEDS CLARIFICATION items resolved:

| # | Unknown | Resolution |
|---|---------|------------|
| R1 | YAML-парсер с детекцией дубликатов | `yaml` v2, bundled в dist (tsup `noExternal`); `YAMLParseError` с `code: DUPLICATE_KEY` из коробки; изданный пакет без runtime deps |
| R2 | Откуда читается `auth.yaml` | `<compositionRoot>/auth.yaml` — корень openapi-приложения, тот же `appRoot`, который 006 получает для извлечения (IDEA §8/§9) |
| R3 | Валидация `function`-ссылки | Синтаксис `functions.<name>` (регэксп) + разрешимость против caller-provided набора функций composition input; минимум поверхности, без интроспекции |
| R4 | Расширяемость модели | Discriminated union + реестр валидаторов по типу; неизвестный тип — fail-fast; добавление типа аддитивно |
| R5 | Граница с 008 | 007 не мутирует OpenAPI, не применяет defaultScheme, не генерирует securitySchemes/authorizers — только валидный источник + резолвимость |
| R6 | Какие `security`-записи сканируются | Документный `security` (root) + `paths[*][method].security`; маршрут в ошибке `root\|METHOD /path`; `components.securitySchemes` документа источником не является (источник — `auth.yaml`, 008 генерирует свои) |
| R7 | Форма `audience` в jwt-схеме | `string \| string[]` (непустые); пустой массив = отсутствие поля (`AUTH_MISSING_FIELD`); семантика не интерпретируется |

## Phase 1: Design & Contracts

**Outputs**: [data-model.md](./data-model.md), [contracts/](./contracts/auth-config.md), [quickstart.md](./quickstart.md)

Key design decisions:

- **`validateAuthConfig(request)`** — единая публичная точка (`request = { appRoot, openApi, functions? }`): читает `auth.yaml`, парсит, self-валидирует, разрешает function-ссылки, cross-валидирует `security`-entries извлечённого документа; возвращает `AuthValidationResult { authYaml }`; кидает `AuthConfigError` с кодом на любой fail-fast (FR-001..009/012/013)
- **`yaml` v2 + tsup noExternal** — детекция дубликатов силами парсера, published manifest остаётся без runtime-зависимостей (R1)
- **Порядок валидации фиксирован** (версия → defaultScheme → schemes-map → per-scheme тип/поля → function-ссылки → security cross-validation) — первый нарушенный инвариант даёт детерминированную ошибку (fail-fast, SC-003)
- **Security-entries сканируются и на document root, и на уровне операций** (`paths[*][method].security`), маршрут в ошибке — `METHOD /path` или `root` (FR-008/013)
- **`public` в security-записи — договорное нарушение** (FR-009); `public`-схема типа `none` и `defaultScheme: public` допустимы
- **Discriminated union `AuthScheme` + реестр** — новый scheme type добавляется как новый член union и новая запись реестра; существующие валидаторы не трогаются (FR-005, SC-005)
- **08-берег**: 007 не модифицирует OpenApiDocument, не выводит default-применение и не эмитит gateway-конфигурацию — результаты оформлены как данные для 008 (R5)
- **Backward compatible / greenfield**: новые модули в существующем пакете, публичный API расширяется без изменений 006-поверхности

**Post-design Constitution re-check**: ✅ No new violations after Phase 1. Bundling `yaml` keeps the published manifest's zero-runtime-dependency property (006 convention) — the trade-off is documented in research R1 and does not touch constitution I–VI. All «Точки неоднозначности» spec.md закрыты дефолтами до планирования; проектные решения уровня plan (R1–R7) не поднимают новых границ, требующих clarify — CLARIFY: none. См. also [research.md](./research.md): R5 (граница к 008, seam = `AuthValidationResult { authYaml }` без эмиссии) и R3 (function-набор приходит в запросе, а не читается B из `apps.yaml` — граница I сохранена).