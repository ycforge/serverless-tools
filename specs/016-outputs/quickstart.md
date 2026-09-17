# Quickstart: outputs -- validation scenarios Sc1..ScN

Reference project (consistent across all specs): apps `user_service`, `analytics`, `frontend`, `openapi`. Dispatch (014) generated the canonical resource set:

```
yandex_function      user_service   { name: "user_service", runtime: "nodejs20", ... }
yandex_function      analytics      { name: "analytics", ..., tags: { env: "prod" } }
yandex_api_gateway   openapi        { name: "openapi", ..., custom_domains: [{ domain_id: "d1" }] }
yandex_container     frontend       (type not in IDL_DOMAIN_BY_TF_TYPE -- NOT IDL-addressable)
```

`IDL_DOMAIN_BY_TF_TYPE` (C-owned, spec 015): `yandex_function -> functions`, `yandex_api_gateway -> gateways`. IDL index: `functions.user_service`, `functions.analytics`, `gateways.openapi`. `frontend` resource (type outside the table) is not in the index and not addressable.

**Prerequisites**: `packages/pilot`, vitest (`pnpm --filter @ycforge/pilot test`); tests RED -> GREEN per Constitution II. `buildOutputs` is pure (no I/O); `loadOutputs` throws on missing file. Serialization reuses `serializeJson` from spec 014.

---

## Sc1. Happy path: two user outputs resolve to Terraform expressions (US1, FR-006)

`.ycsf/outputs.yaml`:
```yaml
version: 1
outputs:
  frontend_api_url:
    value: "gateways.openapi.domain"
    description: "Public API endpoint"
  user_service_function_id:
    value: "functions.user_service.id"
    description: "Cloud function ID"
```

Input: `outputsYaml` with two outputs, `materializerOutputs` empty, `resources` = canonical set.

**Expected**: `kind === 'ok'`; `result.file.filename === '99-ycsf-outputs.tf.json'`; content JSON contains `"frontend_api_url": {"value": "${yandex_api_gateway.openapi.domain}", "description": "Public API endpoint"}` and `"user_service_function_id": {"value": "${yandex_function.user_service.id}", "description": "Cloud function ID"}`.

**Serialization (014)**: `serializeJson` sorts keys lexicographically (FR-012/FR-019).

## Sc2. User output without description -- omit in JSON (US1 AC3, FR-013)

Input: one output with `value: "functions.user_service.id"`, no `description` key.

**Expected**: JSON object contains only `"value"`, no `"description"` key (omit, section 26).

**Edge**: `description: ""` (empty string) IS preserved as `""` in JSON (intentional user choice).

## Sc3. Auto-generated outputs with `ycsf_` prefix merge with user outputs (US2, FR-008/FR-010)

Input: `materializerOutputs: Map { 'ycsf_function_user_service_id' => { value: 'yandex_function.user_service.id', description: '...' } }`, `outputsYaml` contains `frontend_api_url` -> `gateways.openapi.domain`, `resources` = canonical set.

**Expected**: merged file contains both entries; `ycsf_function_user_service_id` value === `"${yandex_function.user_service.id}"` (wrapped); `frontend_api_url` value === `"${yandex_api_gateway.openapi.domain}"`; keys sorted lexicographically.

## Sc4. Auto-generated output without `ycsf_` prefix -> `OUT_INVALID_AUTO_PREFIX` (US2 AC2, FR-008)

Input: `materializerOutputs: Map { 'function_user_service_id' => { value: '...' } }`.

**Expected**: `kind === 'invalid'`; `OUT_INVALID_AUTO_PREFIX` in errors (Constitution V: explicit, not silent fix).

## Sc5. Empty outputs -> stable `{ "output": {} }` (US2 AC3, US5 AC1, FR-014)

Input: empty `outputs: {}`, empty `materializerOutputs`, any `resources`.

**Expected**: `kind === 'ok'`; `file.content` = `'{"output":{}}'` (stable empty output block).

## Sc6. Duplicate user output name -> `OUT_DUPLICATE_NAME` (US3 AC1, FR-009)

Input: `outputsYaml` with two outputs both named `api_url`.

**Expected**: `OUT_DUPLICATE_NAME` in errors (collect-all).

## Sc7. User output with `ycsf_` prefix -> `OUT_RESERVED_PREFIX` (US3 AC2, FR-005)

Input: output name `ycsf_function_id`.

**Expected**: `OUT_RESERVED_PREFIX` in errors (Constitution V: reserved prefix = error, not silent swap).

## Sc8. Unresolved IDL -> `OUT_UNRESOLVED_IDL` with available IDLs (US3 AC1, FR-006)

Input: value `databases.postgres.id` (domain `databases` not in `DOMAIN_TO_TF_TYPE`).

**Expected**: `OUT_UNRESOLVED_IDL` in errors; message contains `databases.postgres.id` and available IDLs from IDL index in alphabetical order: `functions.analytics`, `functions.user_service`, `gateways.openapi`.

**Edge**: Grammatically valid but non-existent domain (`containers.user_service`) -> same `OUT_UNRESOLVED_IDL` (resolution-level, not structural).

## Sc9. Invalid IDL grammar -> `OUT_INVALID_VALUE` (US5 AC4, FR-007)

Input: value `Functions.User_Service.Id` (uppercase segments).

**Expected**: `OUT_INVALID_VALUE` in errors. `parseResourceReference` rejects uppercase segments.

**Edge**: `value: "${yandex_function.foo.id}"` (already wrapped in `${...}`) -> `OUT_INVALID_VALUE` (not a bare IDL reference).

## Sc10. Version and structural errors -> `OUT_VERSION`/`OUT_INVALID` via loadOutputs (US3 AC4, FR-003/FR-004)

| File content | Expected |
|-------------|----------|
| `version: 2` + `outputs: {}` | `invalid`, `OUT_VERSION` |
| `version: 1` without `outputs` key | `invalid`, `OUT_INVALID` |
| `outputs: "not-a-mapping"` | `invalid`, `OUT_INVALID` |
| `outputs:` with `value: 123` (not string) | `invalid`, `OUT_INVALID` |
| Top-level unknown key `foobar:` | `invalid`, `OUT_INVALID` (Constitution V) |
| Multiple structural errors simultaneously | `invalid`, ALL errors collected (collect-all) |
| `outputs: { a: { value: "x" }, a: { value: "y" } }` (duplicate YAML key) | `invalid`, `OUT_INVALID` (parse-gate uniqueKeys) |

## Sc11. Missing file -> `OUT_MISSING_FILE` throw (US5 AC2, FR-002)

Project has no `.ycsf/outputs.yaml`. Call `loadOutputs(rootDir)`.

**Expected**: throws `Error` with `OUT_MISSING_FILE` in message (pattern `EXT_MISSING_FILE`). Orchestrator 021 decides whether to call loader.

## Sc12. External resource reference -> `OUT_UNRESOLVED_IDL` (US5 AC3, FR-017)

Input: value `queues.events.qurl` (external resource from `resources.yaml`, not generated).

**Expected**: `OUT_UNRESOLVED_IDL` (external resources not in IDL index; Constitution VI: apps = managed, resources = external).

## Sc13. Determinism: two identical runs produce byte-identical output (US4, SC-001)

Two calls to `buildOutputs` with identical inputs -> `result1.file.content === result2.file.content` (byte-identical).

## Sc14. Mixed errors: duplicate + unresolved + invalid grammar in one call (US3, FR-015)

Input: outputs with (a) duplicate name, (b) unresolved IDL, (c) invalid grammar value.

**Expected**: ALL three errors in one `errors` array (collect-all); no file generated (all-or-nothing).

## Sc15. dispatch.ts migration: `00-ycsf-outputs.tf.json` removed, `99-` generated (SC-007)

After spec 016 implementation, `dispatch.ts` no longer generates `00-ycsf-outputs.tf.json`. The old file is removed by orphan mechanism in `write.ts`. `buildOutputs` generates `99-ycsf-outputs.tf.json` instead.

---

## Requirements -> Scenario Map

| Requirement | Scenario |
|-------------|----------|
| FR-002 `OUT_MISSING_FILE` throw | Sc11 |
| FR-003 `OUT_VERSION` | Sc10 |
| FR-004 `OUT_INVALID` (collect-all) | Sc10 |
| FR-005 `OUT_RESERVED_PREFIX` | Sc7 |
| FR-006 `OUT_UNRESOLVED_IDL` + availableIdls | Sc8, Sc12 |
| FR-007 `OUT_INVALID_VALUE` | Sc9 |
| FR-008 `ycsf_` prefix enforcement | Sc3, Sc4 |
| FR-009 `OUT_DUPLICATE_NAME` | Sc6, Sc14 |
| FR-010 merged file `99-ycsf-outputs.tf.json` | Sc1, Sc3, Sc5 |
| FR-011 `${...}` wrapping | Sc1, Sc3 |
| FR-012 sorted keys | Sc1, Sc13 |
| FR-013 description omit | Sc2 |
| FR-014 empty outputs stable file | Sc5 |
| FR-015 collect-all all-or-nothing | Sc14 |
| FR-017 external resources not in IDL index | Sc12 |
| SC-001 determinism | Sc13 |
| SC-007 filename `99-` migration | Sc15 |
| US1 happy path | Sc1, Sc2 |
| US2 auto-generated merge | Sc3, Sc4, Sc5 |
| US3 error paths | Sc6, Sc7, Sc8, Sc9, Sc10, Sc14 |
| US4 determinism | Sc13 |
| US5 edge cases | Sc5, Sc9, Sc11, Sc12 |

> Note: test fixtures will be in `packages/pilot/test/unit/` (outputs-build.spec.ts, outputs-loader.spec.ts, outputs-resolver.spec.ts). Fixture materializers inline (pattern 014). Loader I/O tests use `mkdtemp`.
