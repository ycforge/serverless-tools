# Implementation Plan: api-composition — единая API Gateway specification из извлечённых OpenAPI-документов (Project B)

**Branch**: `008-api-composition` | **Date**: 2026-09-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-api-composition/spec.md`

## Summary

Spec 008 adds the API-composition phase to `@ycforge/composer` (Project B): merging per-app OpenAPI documents extracted by 006 into one deterministic Gateway document per composition, fail-fast on paths/operationId/components collisions (incl. `openapi`-version consensus), tracking provenance route→app strictly internally (never in the artifact), applying the auth layer from the 007-validated `auth.yaml` (defaultScheme root `security`, `components.securitySchemes` + `x-yc-apigateway-authorizer` emission), and applying global (`<compositionRoot>/overrides.yaml`) + local (`<appRoot>/overrides.yaml`) overrides with local > global priority using explicit addressing and atomic replace/add/remove — never deep merge. Composition owns merge/conflicts/auth/overrides; IDR substitution and integrations are the 019/009 seams. 

Key technical approach:
- New module `src/compose/` in the existing composer package (greenfield, mirrors 006/007 module layout); public entry `compose(request)` reusing `extractOpenApi` (006) and `validateAuthConfig`/`validateAuthReferences` (007) as pipeline stages — no reimplementation (research R1/R7)
- Determinism (FR-017) via canonical key normalization (lexicographic sort of `paths`/`components` keys) + order-independent conflict detection; provenance returned as a separate internal read-map, never serialized into the artifact (R2)
- Overrides grammar: each file `version: 1` + flat `rules[]` of `{ op: replace|add|remove, target: {kind: info|path|operation|operationId|component, ...}, value? }`; sequential apply per file, global before local, target-mismatch and scope violations fail-fast (R3)
- Real-form authorizer emission inside `components.securitySchemes.<name>.x-yc-apigateway-authorizer` per current Yandex API Gateway spec (research R5); `function_id: functions.<name>` logical ref (019 seam); jwt params mapped deterministically (jwksUri/issuers/audiences + fixed identitySource)
- New error type `ComposeError` with its own code set for composition-owned faults; delegated 006/007 errors surface untransformed (FR-015)

## Technical Context

**Language/Version**: TypeScript 5.9, ES2022 target, ESNext modules (repo convention, composer `tsconfig.json`)

**Primary Dependencies**: runtime (published manifest) — none, builtins only (`node:fs`, `node:path`). `yaml` v2 devDependency bundled via tsup `noExternal: ['yaml']` (007 convention) for override-file parsing with duplicate-key detection. Reuse in-codebase: `extractOpenApi` (006), `validateAuthConfig`/`validateAuthReferences`/`AuthConfigError`/`AuthYamlDocument`/`AuthScheme` (007), `OpenApiExtractError` (006).

**Storage**: N/A (stateless; reads `<compositionRoot>/auth.yaml`, `<compositionRoot>/overrides.yaml`, `<appRoot>/overrides.yaml`, participant sources via the 006 chain)

**Testing**: vitest (monorepo convention, `vitest.config.ts` globs `src/**/*.spec.ts` + `test/**/*.spec.ts`); unit specs per module under `src/compose/`, integration `test/compose.integration.spec.ts` driven by fixture roots under `test/fixtures/compose-*` (006/007 pattern)

**Target Platform**: Node.js 22+ (dev/CI build tool — mirrors the other packages; not a Cloud Function runtime)

**Project Type**: library — added public API of the existing npm package `@ycforge/composer`

**Performance Goals**: build-time; linear in total paths/operations/components and in schemes/rules counts; single small-file reads (auth.yaml, overrides files); no measurable cost

**Constraints**: no new published runtime dependencies (bundled `yaml`); 006/007 stages reused, not re-implemented (SC-007); inputs never mutated (FR-014); provenance never in the artifact (FR-003/017); no Terraform, no `${resources...}`, no integrations (FR-013/018); override grammar `version: 1`, explicit addressing, no deep merge (FR-010, III); every invalid state fail-fast with deterministic code + context (FR-004/005/006/015/016)

**Scale/Scope**: ~8 source files + spec files + integration spec in `packages/composer/src/compose/` (+ `src/index.ts` export extension); fixture roots `test/fixtures/compose-*`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Separation of concerns | ✅ | 008 is B's composition zone: merge/conflicts/auth-application/overrides; B emits logical `functions.<name>` refs and REAL Yandex authorizer structure, but performs no provisioning (no IDR/IAM substitution, no `service_account_id`/`tag`, no `${resources...}` — FR-013); C does not duplicate conflict diagnostics (FR-015). Delegation to 006/007 keeps each stage in its package module |
| II. Spec-first, test-first | ✅ | Spec complete with ACs (US1–US4, Edge Cases); each AC → test before implementation (RED→GREEN); upfront and negative fixtures enumerated in quickstart |
| III. Contracts versioned | ✅ | `overrides.yaml` carries `version: 1` (app-artifact `.yaml` family, auth.yaml precedent) and is governed by contract versioning (III) together with `@ycforge/composer` semver + documented error taxonomy (`contracts/api-composition.md`); new public API `compose` versioned with the package |
| IV. Terraform stays Terraform | ✅ | B produces a document + logical refs; Terraform mapping (IDR substitution, integrations, IAM fields) is the 019 materializer seam, explicitly documented; B never models provider schema |
| V. Explicit over magic | ✅ | Fail-fast on every collision (path/operationId/components incl. securitySchemes-vs-auth-emission, openapi-version) — never last-wins; overrides = explicit address + atomic op (replace/add/remove), no deep merge, missing/unmappable target and scope violations fail-fast; provenance never leaks (FR-003/017); unknown override grammar → fail-fast; `security` referencing a none-type scheme → new fail-fast invariant code |
| VI. Ownership | N/A | No apps/resources identity work (011); participants + functions are caller-provided, B does not read `apps.yaml` (research R1) |

**Post-design re-check**: see Phase 1.

## Project Structure

### Documentation (this feature)

```text
specs/008-api-composition/
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
├── package.json                           # (unchanged: no new deps, yaml stays devDep/bundled)
├── tsup.config.ts                         # (unchanged: noExternal: ['yaml'])
├── src/
│   ├── index.ts                           # MOD: публичные экспорты compose + типы + ComposeError/коды (без изменения 006/007 экспортов)
│   └── compose/
│       ├── compose.ts                     # NEW: оркестрация pipeline compose(request) (FR-001/015/016/017; делегирование 006/007)
│       ├── compose.spec.ts                # NEW: pipeline-тесты (порядок этапов, детерминизм, делегирование, би-инварианты)
│       ├── types.ts                       # NEW: ComposeRequest/ComposeApp/ComposeResult/GatewayDocument/RouteOwner
│       ├── compose-errors.ts              # NEW: ComposeError + детерминированные коды (таксономия contract)
│       ├── compose-errors.spec.ts         # NEW: сообщения строятся только из контекста
│       ├── provenance.ts                  # NEW: PathOwnership (path→owner) + operationId-индекс (research R2)
│       ├── provenance.spec.ts             # NEW: владение, global-owner, отсутствие утечки в документ
│       ├── merge.ts                       # NEW: path-partition + operationId/components конфликты + version-consensus (FR-004/005/006/016)
│       ├── merge.spec.ts                  # NEW: US2 AC1–AC3, UIC, version mismatch, order-independence
│       ├── auth-apply.ts                  # NEW: defaultScheme root security, securitySchemes + authorizer эмиссия, none-ref инвариант (FR-011/012/013, R5/R6)
│       ├── auth-apply.spec.ts             # NEW: US4 AC1–AC4, none-ref, securitySchemes collision (FR-006)
│       └── overrides/
│           ├── override-yaml.ts           # NEW: чтение + parse + грамматика overrides.yaml (version 1, rules, target/op/value)
│           ├── override-yaml.spec.ts      # NEW: все grammar-негативы (OVERRIDE_*)
│           ├── apply.ts                   # NEW: applyOverrides(document, ownership, globalRules, localByApp) — атомарные op, scope, priority local>global
│           └── apply.spec.ts              # NEW: US3 AC1–AC6, локальный скоуп, последовательность, priority, provenance обновления
└── test/
    ├── compose.integration.spec.ts        # NEW: e2e на fixture-ах (US1–US4, Edge Cases, делегирование 006/007)
    └── fixtures/
        ├── compose-app/                   # NEW: каноническая композиция (auth.yaml + global overrides + participant dirs)
        ├── compose-app-path-collision/    # NEW: общий GET /users
        ├── compose-app-opid-collision/    # NEW: общий operationId на разных путях
        ├── compose-app-opid-self-collision/# NEW: дубликат operationId в одном приложении
        ├── compose-app-component-collision/# NEW: общий UserDto
        ├── compose-app-version-mismatch/  # NEW: 3.0.0 vs 3.1.0
        ├── compose-app-no-participants/   # NEW: apps: [] → COMPOSE_NO_PARTICIPANTS
        ├── compose-app-no-info/           # NEW: нет info override → COMPOSE_INFO_MISSING
        ├── compose-app-none-ref/          # NEW: операция на none-схему → COMPOSE_SECURITY_REF_NONE_SCHEME
        ├── compose-app-ov-bad-version/    # NEW: version: 2
        ├── compose-app-ov-rules-empty/    # NEW: rules: []
        ├── compose-app-ov-value-missing/  # NEW: replace без value
        ├── compose-app-ov-target-missing/ # NEW: replace несуществующего
        ├── compose-app-ov-add-existing/   # NEW: add существующего
        ├── compose-app-ov-local-out-of-scope/ # NEW: local адресует чужой путь
        ├── compose-app-ov-local-info/     # NEW: local адресует info
        ├── compose-app-bad-auth/          # NEW: нет auth.yaml → AUTH_FILE_MISSING (делегирование 007)
        └── compose-app-bad-extract/       # NEW: участник без источника → NO_SOURCE (делегирование 006)
```

**Structure Decision**: composer keeps the lean library layout from 006/007; composition is a self-contained `src/compose/` module with `overrides/` nested (grammar vs apply separated like `auth-yaml`/`auth-security` in 007) so each FR group is independently testable per boundary (extract→auth→merge→apply→overrides→finalize). A single public orchestrator `compose(request)` mirrors `extractOpenApi`/`validateAuthConfig`; granular sub-modules map 1:1 to FR groups for test traceability (SC-001..SC-007). The 006/007 stages are called through their existing public API (no code reuse beyond the published surface).

## Phase 0: Research

**Output**: [research.md](./research.md)

All NEEDS CLARIFICATION items resolved:

| # | Unknown | Resolution |
|---|---------|------------|
| R1 | Форма composition input/output | `ComposeRequest { compositionRoot, apps: ComposeApp[{appRoot}][], functions? }` → `ComposeResult { document, provenance }`; участники caller-provided (B не читает apps.yaml — зона C/011); provenance отдельно, никогда в документе |
| R2 | Структура provenance + детерминизм | `path → owner (appId | 'global')` + индекс operationId→{path,appId}; нормализация ключей paths/components (лексикографически) для byte-детерминизма при перестановке участников |
| R3 | Грамматика override-файлов | `version: 1` + плоский `rules[]` с дискриминированным `target.kind ∈ {info,path,operation,operationId,component}` и атомарными `op ∈ {replace,add,remove}`; local = только path-space своего приложения; последовательное применение, глобальный перед локальными (приоритет local > global) |
| R4 | Merge + конфликты | Строгий path-partition (совпадение строки пути), operationId уникальность вкл. self-collision, имена components уникальны вкл. securitySchemes-vs-auth-эмиссию, version-consensus FR-016; все fail-fast, инвариантно порядку |
| R5 | Gateway-артефакт + REAL Yandex формат | Authorizer — вложенный `x-yc-apigateway-authorizer` внутри `components.securitySchemes.<name>` (актуальная документация Yandex); `function_id: functions.<name>` логический ref (шов 019); jwt: jwksUri/issuers/audiences/fixed identitySource. **РЕШЕНО (plan clarify, 2026-09-05): jwt securityScheme = вариант A** — `{ type: openIdConnect, openIdConnectUrl: <issuer>/.well-known/openid-configuration }` + jwt authorizer (см. `spec.md`, «Clarifications») |
| R6 | Auth-применение | defaultScheme → root `security` (не-none); securitySchemes+authorizers на каждую не-none схему; none-ссылка операции → новый fail-fast код; root security приложений не переносится |
| R7 | Pipeline + ошибки | Фиксированный порядок READ→EXTRACT→AUTH→VERSION→MERGE→AUTH-APPLY→OVERRIDES→FINALIZE; новый `ComposeError` со своим набором кодов; ошибки 006/007 всплывают как есть (FR-015) |

## Phase 1: Design & Contracts

**Outputs**: [data-model.md](./data-model.md), [contracts/](./contracts/api-composition.md), [quickstart.md](./quickstart.md)

Key design decisions:

- **`compose(request)`** — единая публичная точка (`request = { compositionRoot, apps, functions? }`); pipeline по R7; возвращает `ComposeResult { document, provenance }`; кидает `OpenApiExtractError`/`AuthConfigError`/`ComposeError` по месту зоны (FR-001/015)
- **Детерминизм** — нормализация ключей + order-independent конфликты (R2/R4); входы не мутируются (FR-014 deep-copy)
- **Provenance гасится из артефакта** — document не содержит следов принадлежности (FR-003/017, SC-004); `result.provenance` — внутренняя read-map, отдельный от артефакта return-value
- **Real-Yandex authorizer-эмиссия** — внутри `securitySchemes.<name>.x-yc-apigateway-authorizer`, `function_id: functions.<name>` логический ref, `identitySource` фиксированный дефолт, без provisioning-артефактов и `${resources...}` (R5; FR-013; Constitution I)
- **Overrides грамматика v1** — flat `rules[]`, атомарные replace/add/remove (никогда deep merge), fail-fast на несовместимых целях и нарушении скоупа, local > global за счёт порядка применения (R3; FR-007/008/009/010)
- **Новый error-type `ComposeError`** — собственный код-набор для зон композиции; делегированные 006/007 не ремапятся (R7; FR-015)
- **Seams** — authorizer→019 (IDR-подстановка, интеграции, IAM-поля), resource-references→009, CLI→010 (contract, секции «Seam к ...»); mvp-границы FR-018

**Post-design Constitution re-check**: ✅ No new violations after Phase 1. The plan-level decision on the jwt securityScheme descriptor type was resolved 2026-09-05 in favor of **Variant A** (`openIdConnect` + derived `openIdConnectUrl`, see `spec.md` → «Clarifications») — a detail of auth emission within the already-stable authorizer boundary; the resolved form keeps Constitution I/IV intact (B emits the logical `functions.<name>` ref unchanged and never substitutes real IDs; authorizer emission with logical refs is untouched by the jwt-descriptor resolution). All «Точки неоднозначности» spec.md are closed; plan-level decisions R1–R7 do not raise new component boundaries requiring clarification. См. also [research.md](./research.md): R5 (REAL Yandex authorizer form, researched from docs.yandex.cloud; Variant A now the committed contract) and R1 (caller-provided participants keep Constitution I/VI).

## Complexity Tracking

> No constitution violations requiring justification.