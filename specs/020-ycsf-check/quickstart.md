# Quickstart: ycsf-check — runnable validation guide

**Spec**: [specs/020-ycsf-check/spec.md](./spec.md) | **Branch**: `020-ycsf-check` | **Date**: 2026-09-10

Валидационные сценарии Sc1–Sc6 доказывают фичу end-to-end (acceptance criteria US1–US6, SC-001..SC-008). Сценарии на каноническом проекте (`user_service`, `analytics`, `frontend`, `openapi`). Детали форм — в `data-model.md` и `contracts/ycsf-check.json`.

*Преамбула модуля*: `packages/pilot/src/check/` — внутренний модуль pilot. Публичный API: `check(rootDir, options?) → Promise<CheckResult>`. CLI точка входа интегрируется через spec 021 (`ycsf check` command).

---

## Sc1 — Extension target exists / missing (US1, P1)

**Given**: canonical project with generated resources `[yandex_function.user_service, yandex_api_gateway.main]` and `.ycsf/extensions.yaml`:
```yaml
version: 1
extensions:
  - target: functions.user_service
    patch:
      runtime: python312
```

**When**: `check(rootDir)` is called.

**Then**:
- `YCK_MISSING_TARGET` is NOT emitted for `functions.user_service` (it exists in generated model via `idlFor()` → `functions.user_service`).
- No `EXT_UNRESOLVED_TARGET` for this target either (extensions validation passes).

**Edge case**: same project but `extensions.yaml` contains `{ target: 'functions.analytics', patch: {} }`:
- `YCK_MISSING_TARGET` emitted with `target: 'functions.analytics'` and `availableIdls: ['functions.user_service']`.
- `EXT_UNRESOLVED_TARGET` also emitted for the same target (D-10, dual diagnostics).

**How to verify**: `packages/pilot/test/check/override-targets.spec.ts` — hermetic fixture with generated resources and extensions. Assertions on `YCK_MISSING_TARGET` presence/absence + `availableIdls` correctness.

## Sc2 — ENV reference in extension patch (US2, P1)

**Given**: fixture project with `.ycsf/extensions.yaml`:
```yaml
version: 1
extensions:
  - target: functions.user_service
    patch:
      environment:
        API_KEY: "{{$API_KEY}}"
```

**When**: `check(rootDir)` is called.

**Then**:
- `YCK_ENV_IN_PATCH` emitted with `target: 'functions.user_service'` and `field: 'environment.API_KEY'`.
- `EXT_*` diagnostics may also be emitted (depending on whether target resolves).

**Edge case**: patch `{ runtime: 'python312', memory: 128 }` (plain Terraform values, no `{{$...}}`):
- No `YCK_ENV_IN_PATCH`.

**Nested depth**: patch `{ a: { b: { c: '{{$DEEP}}' } } }` → `YCK_ENV_IN_PATCH` with `field: 'a.b.c'` (recursive scan ≥2 depth, SC-003).

**How to verify**: `packages/pilot/test/check/env-in-patch.spec.ts` — fixture with nested patch. Assertions on `field` path correctness + recursive detection.

## Sc3 — Build ENV validation (US3, P1)

**Given**: canonical project with app `user_service` having `build_env: { API_KEY: null }` and `process.env.API_KEY` NOT set.

**When**: `check(rootDir)` is called.

**Then**:
- `PML_ENV_NOT_SET` diagnostic emitted with `app: 'user_service'` and `field: 'API_KEY'`.
- No `YCK_*` codes (this is a reuse diagnostic from 011).

**Edge case**: app with `build_config: { entry: '{{$ENTRY_POINT}}' }` and `process.env.ENTRY_POINT` not set:
- `PML_ENV_NOT_SET` for `ENTRY_POINT`.

**How to verify**: `packages/pilot/test/check/aggregation.spec.ts` — fixture with missing ENV. Assertions on `PML_ENV_NOT_SET` presence.

## Sc4 — Resource consistency (US4, P2)

**Given**: fixture project with `resources.yaml`:
```yaml
functions:
  external_svc: {}
```
Generated resources: `[yandex_function.user_service]` (no `external_svc`).

**When**: `check(rootDir)` is called.

**Then**:
- `YCK_REF_UNRESOLVED` emitted with `resourceRef: 'functions.external_svc'` and `file: '.ycsf/resources.yaml'`.

**Edge case**: same `resources.yaml` but generated resources include `yandex_function.external_svc`:
- No `YCK_REF_UNRESOLVED`.

**Edge case**: empty `resources.yaml` (no entries):
- No `YCK_REF_UNRESOLVED` (nothing to check).

**How to verify**: `packages/pilot/test/check/resource-consistency.spec.ts` — fixture with/without matching generated resource.

## Sc5 — Full aggregation (US5, P1)

**Given**: fixture project with:
- App `user_service` with `build_env: { API_KEY: null }` (missing ENV).
- Extension `{ target: 'functions.analytics', patch: {} }` (missing target).
- Generated resources: `[yandex_function.user_service]` only.

**When**: `check(rootDir)` is called.

**Then**:
- `CheckResult.diagnostics` contains at least:
  - `PML_ENV_NOT_SET` for `API_KEY` (from C2–C3, reuse 011).
  - `YCK_MISSING_TARGET` for `functions.analytics` (from C1, check-specific).
  - `EXT_UNRESOLVED_TARGET` for `functions.analytics` (from C5–C8, reuse 015).
- Exit code: 1 (at least one diagnostic, D-3).

**Edge case**: project without errors (all contracts valid):
- `CheckResult.diagnostics` is empty array.
- Exit code: 0.

**How to verify**: `packages/pilot/test/check/aggregation.spec.ts` — mixed-diagnostics fixture (EXT + model errors). Assertions on diagnostic count + code families present.

## Sc6 — Optional terraform validate (US6, P3)

**Given**: fixture project with NO base errors (all contracts valid).

**When**: `check(rootDir, { validateTf: true })` is called and `terraform validate` returns non-zero exit code.

**Then**:
- `YCK_TERRAFORM_INVALID` emitted with `message` containing terraform error output.
- Exit code: 1.

**Edge case**: same project, `terraform validate` succeeds:
- No `YCK_TERRAFORM_INVALID`. Exit code: 0.

**Edge case**: project WITH base errors + `validateTf: true`:
- Terraform validate is NOT invoked (fail-fast, FR-018).
- Only base check diagnostics in result.

**Edge case**: `terraform` binary not in PATH + `validateTf: true`:
- `YCK_TERRAFORM_UNAVAILABLE` emitted.
- Base checks still complete successfully (if no base errors → exit code 1 due to unavailable terraform).

**How to verify**: `packages/pilot/test/check/terraform-validate.spec.ts` — fixture with mocked `terraform` binary (or spawnSync mocked). Assertions on fail-fast behavior + diagnostic codes.

---

## Покрытие Success Criteria

| SC | Сценарий(и) quickstart | Место теста |
|----|------------------------|-------------|
| SC-001 | Sc1–Sc5 (canonical project, all checks pass) | `test/check/aggregation.spec.ts` |
| SC-002 | Sc1 (missing target → `YCK_MISSING_TARGET` + `availableIdls`) | `test/check/override-targets.spec.ts` |
| SC-003 | Sc2 (nested `{{$ENV}}` in patch → `YCK_ENV_IN_PATCH` + field path) | `test/check/env-in-patch.spec.ts` |
| SC-004 | Sc4 (resources.yaml ref without generated TF counterpart) | `test/check/resource-consistency.spec.ts` |
| SC-005 | Sc5 (mixed diagnostics: EXT_* + PML_* + YCK_*) | `test/check/aggregation.spec.ts` |
| SC-006 | Sc1 (determinism: same input → same diagnostics) | `test/check/override-targets.spec.ts` |
| SC-007 | Sc6 (terraform validate pass/fail/unavailable + fail-fast) | `test/check/terraform-validate.spec.ts` |
| SC-008 | All scenarios (performance: <100ms pure validation) | implicitly covered by all unit tests |
