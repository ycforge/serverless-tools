# Quickstart outcomes — spec 008 (implemented)

Recorded after `/speckit-implement`, 2026-09-05. Reference: [quickstart.md](./quickstart.md). All scenarios verified via `pnpm --filter @ycforge/composer test`.

| Scenario | Requirement | Verifying test | Outcome |
|----------|-------------|----------------|---------|
| US1 — merge нескольких приложений в один gateway | US1/AC1, FR-001/002 | `compose.integration.spec.ts › merges participant paths and components into a gateway document (US1/AC1)`; unit `mergeDocuments › merges two non-overlapping docs into the union of paths and components (US1/AC1)` | ✅ green |
| US1 — детерминизм при перестановке участников | US1/AC2, FR-017 | `compose.integration.spec.ts › is deterministic: participant order does not change the gateway document (FR-017, SC-002)`; `mergeDocuments › order independence of conflict reports` | ✅ green |
| US1 — отсутствие provenance в артефакте | US1/AC3, FR-003/017, SC-004 | `compose.integration.spec.ts › never leaks provenance into the serialized gateway document (FR-017, SC-004)`; `provenance.spec.ts › provenance never leaks into a serialized GatewayDocument` | ✅ green |
| US1 — path → owner в `result.provenance` | US1/AC3, FR-003 | `compose.integration.spec.ts › exposes path → owner provenance for every merged path (FR-003, US1/AC3)`; `PathOwnership › builds path → owner for every participant path` | ✅ green |
| US1 — single-participant composition — корректный gateway | US1/AC4, FR-002 | `compose.integration.spec.ts › single-participant composition yields a valid gateway document (US1/AC2)`; `compose.spec.ts › single-participant composition is a valid gateway with the same override/auth rules (US1/AC4)` | ✅ green |
| US1 — входы не мутированы (byte-parity) | FR-014, SC-007 | `compose.spec.ts › never mutates input documents (deep-freeze + deep-compare, FR-014/SC-007)`; `mergeDocuments › never mutates the input documents (FR-014)` | ✅ green |
| US2 — path-коллизия | US2/AC1, FR-004 | integration `compose-app-path-collision › two apps declaring the same path → COMPOSE_PATH_COLLISION`; unit `same path string across two apps → COMPOSE_PATH_COLLISION with both apps` | ✅ green |
| US2 — path-коллизия при разных методах | Edge cases, FR-004 | `mergeDocuments › same path with only DIFFERENT methods is STILL a collision (strict path partition)` | ✅ green |
| US2 — operationId-коллизия (across apps) | US2/AC2, FR-005 | integration `compose-app-opid-collision › same operationId on different paths of two apps → COMPOSE_OPERATIONID_COLLISION`; unit `same operationId on different paths across apps` | ✅ green |
| US2 — self-коллизия operationId внутри одного приложения | Edge cases, FR-005 | integration `compose-app-opid-self-collision › duplicate operationId within ONE app`; unit `duplicate operationId WITHIN a single app (self-collision)` | ✅ green |
| US2 — component-коллизия | US2/AC3, FR-006 | integration `compose-app-component-collision › shared component name → COMPOSE_COMPONENT_COLLISION`; unit `same component name in two apps` | ✅ green |
| US2 — version mismatch | US2, FR-016 | integration `compose-app-version-mismatch › openapi version mismatch → COMPOSE_OPENAPI_VERSION_MISMATCH`; unit `rejects a version mismatch` | ✅ green |
| US2 — пустой `apps` | US2/AC4, FR-001 | integration + unit `rejects an empty apps list with COMPOSE_NO_PARTICIPANTS before any extraction` | ✅ green |
| US2/FR-017 — диагностика конфликта не зависит от порядка участников | V, FR-017 | `mergeDocuments › the SAME conflict in either participant order reports the same code and context` | ✅ green |
| US3 — global override: `info` + добавить `/_health` | US3/AC1/AC2, FR-007/008 | integration `canonical fixture: global override sets info + adds /_health (owner "global")`; unit `info rule replace → document.info is EXACTLY the override value` + `added paths get the correct owner: global → "global"` | ✅ green |
| US3 — local override: remove/replace атомарно | US3/AC3, FR-007/010 | integration `canonical fixture` (remove `GET /legacy`, replace `GET /users`); unit `replace atomically replaces the WHOLE target value — no deep merge` | ✅ green |
| US3 — local > global без ошибки | US3/AC4, FR-009 | `applyOverrides › global then local on the same target → local wins, never an error` | ✅ green |
| US3 — local вне своего path-space / root-поля | US3/AC5, FR-008 | integration negatives `compose-app-ov-local-out-of-scope`, `compose-app-ov-local-info` → `OVERRIDE_OUT_OF_SCOPE`; unit `local rule addressing a foreign path` + `root info/component` | ✅ green |
| US3 — target missing / already exists | US3/AC6, FR-007 | integration negatives `compose-app-ov-target-missing`, `compose-app-ov-add-existing`; unit `remove deletes the target; replace/remove on a missing target → OVERRIDE_TARGET_MISSING` + `add on an existing target → OVERRIDE_TARGET_ALREADY_EXISTS` | ✅ green |
| US3 — grammar-негативы | US3/AC6, FR-007, V | `override-yaml.spec.ts` параметризованные negative-кейсы (bad-version, rules-not-list/empty, unknown-op, invalid-target, value-required, value-forbidden, method-invalid, invalid-yaml, dup-keys) + integration negatives `ov-bad-version`, `ov-rules-empty`, `ov-value-missing` | ✅ green |
| US3 — отсутствие override-файлов — не ошибка | Edge, data-model «НЕ ошибки» | integration `absence of override files (global and local) is not an OVERRIDE_* error — pipeline reaches the info gate` | ✅ green |
| US4 — root `security` из `defaultScheme` | US4/AC1, FR-011 | integration `defaultScheme user/jwt → root security [{ user: [] }]`; unit `applyAuth › non-none defaultScheme → root security: [{ <defaultScheme>: [] }]`; `security: []` preserved; explicit op-`security` сохранено, replaced-операции наследуют через root | ✅ green |
| US4 — `defaultScheme: none` → нет root `security` | US4/AC2, FR-011 | integration `compose-app-default-public › defaultScheme type none → no root security emitted`; unit `defaultScheme type none → NO root security emitted` | ✅ green |
| US4 — jwt scheme: точная форма Variant A | US4/AC3, FR-012/013 | integration `securitySchemes user = openIdConnect + openIdConnectUrl + x-yc-apigateway-authorizer jwt`; unit `emits jwt scheme in exact Variant A openIdConnect form` + `jwt audiences scalar wraps into array` | ✅ green |
| US4 — function scheme: логический `function_id` | US4/AC3, FR-013 | integration `internal = http/bearer + function_id: functions.internal_authorizer`; unit `emits function scheme as http/bearer with logical function_id` | ✅ green |
| US4 — none-scheme не эмитится | US4/AC4, FR-012 | integration `none schemes → no securitySchemes entry, no authorizer`; unit `none schemes → no securitySchemes entry, no authorizer` | ✅ green |
| US4 — ссылка операции на none-схему | data-model правило 9, FR-011/012, V | integration `compose-app-none-ref → COMPOSE_SECURITY_REF_NONE_SCHEME (route, schemeName)`; unit `op security referencing a none-type scheme → COMPOSE_SECURITY_REF_NONE_SCHEME` | ✅ green |
| US4 — коллизия securitySchemes с auth-эмиссией | US4, FR-006 | unit `existing securitySchemes name colliding with an auth scheme to emit → COMPOSE_COMPONENT_COLLISION` | ✅ green |
| US4 — порядок эмиссии = порядок map `schemes` | FR-012 | unit `emits schemes in auth.yaml map order`; integration `securitySchemes keys = [user, internal]` | ✅ green |
| US4 — отсутствие provisioning-артефактов | US4/AC3, SC-006, FR-013/018 | integration `output contains no ${resources...} / provisioning artifacts`; unit (T038) `emitted document contains no integration, IAM, JWKS-publishing, Lockbox/OS, or ${resources} artifacts` | ✅ green |
| US5 — делегированные ошибки всплывают как есть | US5, FR-015 | integration `compose-app-bad-auth → AuthConfigError AUTH_FILE_MISSING` + `compose-app-bad-extract → OpenApiExtractError NO_SOURCE`; unit (T035) `surfaces 006/007 errors untransformed as their own types across the whole pipeline` | ✅ green |
| US5 — compose не переписывает 006/007 | US5, research R1/R7 | unit (T035) `compose never reimplements extraction/auth: fake app roots only resolve via the 006/007 mocks`; `compose.spec.ts › delegates extraction to extractOpenApi and auth to validateAuthConfig/validateAuthReferences` | ✅ green |
| Edge — пустое приложение-участник | FR-002, Edge cases | unit `empty-app participant → empty set, not an error — other participants complete`; `mergeDocuments › an empty participant contributes an empty set` | ✅ green |
| Edge — дубликат `appRoot` в `apps` | data-model «НЕ ошибки», optimistic-duplicate, V | unit `duplicate appRoot in apps → fail-fast (COMPOSE_NO_PARTICIPANTS)` | ✅ green |
| Edge — path-template различия не коллизия | Edge cases (документируемое ограничение), FR-004 | unit `path-template differences (/users/{id} vs /users/{name}) are NOT detected as a collision — string equality only` | ✅ green |

## Final gate (после конвергенции T035–T041)

- `pnpm --filter @ycforge/composer test`: **206/206** green (17 файлов; 006/007 baseline 117 + новый compose-набор 89).
- `pnpm --filter @ycforge/composer typecheck`: `tsc --noEmit` — 0 ошибок.
- `pnpm lint` (root): clean.
- `pnpm build` (root): ок (dist не коммитится).
- `pnpm test` (root): **703** (pilot 55 + composer 206 + nest-bridge 442; baseline 614, +89 в composer).

> Примечание по `yaml`: override-парсинг использует `parseDocument(text, { uniqueKeys: true })` (как 007); `yaml` v2 — единственная внешняя зависимость сборки (devDependency, bundling через `noExternal`), runtime-зависимостей нет (`dependencies` в `package.json` пуст).