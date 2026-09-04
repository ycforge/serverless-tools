# Quickstart outcomes — spec 007 (implemented)

Recorded after `/speckit-implement`, 2026-09-05. Reference: [quickstart.md](./quickstart.md). All scenarios verified via `pnpm --filter @ycforge/composer test`.

| Scenario | Requirement | Verifying test | Outcome |
|----------|-------------|----------------|---------|
| US1 — самовалидация `auth.yaml` целиком | US1/AC1, SC-002 | `auth-yaml › parses and validates a valid document with none+jwt+function schemes`; integration `resolves the canonical openapi-app composition with the expected authYaml` | ✅ green |
| US1 — инвалидные варианты fail-fast | US1/AC2–AC6, SC-003 | параметризованные negative-кейсы в `auth-yaml.spec.ts` (bad-version, missing-default, default-unresolved, empty-schemes, schemes-not-map, dup → `AUTH_DUPLICATE_SCHEME`, unknown-type, missing-jwt-fields, missing-function) + `AUTH_FILE_MISSING` для `openapi-app-no-auth` | ✅ green |
| US2 — все имена в `security` объявлены | US2/AC1, FR-008 | `auth-security › accepts the canonical doc`; integration canonical root | ✅ green |
| US2 — undeclared-ссылка | US2/AC2 | `auth-security › rejects an undeclared reference with schemeName + route`; integration `openapi-app-undeclared-ref` | ✅ green |
| US2 — объявленная, но неиспользуемая схема | US2/AC3 | `auth-security › accepts unused declared schemes` | ✅ green |
| US2 — операции без `security` | US2/AC4, 008 seam | integration `accepts naked operations... (US2/AC4, 008 seam)` | ✅ green |
| US2 — `public` в security-записи | US2/AC5, FR-009 | `auth-security › rejects public inside a security entry`; integration `openapi-app-public-ref` | ✅ green |
| US3 — резолвимость `functions.<name>` в переданный набор | US3/AC1, FR-012 | `function-ref › resolves... against the composition functions set`; US3 AC1 integration | ✅ green |
| US3 — неотрезолвленная ссылка | US3/AC2 | `function-ref › rejects an unresolved ref`; integration `openapi-app-unresolved-function` | ✅ green |
| US3 — набор `functions` не передан | US3/AC1 (negative), FR-012, V | `function-ref › requires the caller-provided functions set`; integration `openapi-app-no-functions` | ✅ green |
| US3 — read-model только `authYaml` | US3/AC3, FR-011, SC-006 | integration `produces ONLY the authYaml read-model — no provisioning/JWKS/Lockbox artifacts (FR-011)` | ✅ green |

Дополнительное покрытие, добавленное в ходе implement:

| Scenario | Verifying test | Outcome |
|----------|----------------|---------|
| Невалидный формат function-ссылки (без префикса) | `function-ref › rejects malformed refs`; `AUTH_FUNCTION_INVALID_REF` | ✅ green |
| Grammar-проверка до проверки наличия набора | `function-ref › invalid grammar fails even without a functions set` | ✅ green |
| Схемы без function-ссылок — документ не меняется | `function-ref › leaves the doc unchanged when no function schemes exist` | ✅ green |
| Порядок стадий фиксированной pipeline (version → default → schemes → type → fields → function → security) | `auth-config.spec.ts › fixed pipeline order` (7 кейсов: первая ошибка побеждает, security — финальная стадия) | ✅ green |
| Остановка pipeline на первой ошибке | `auth-config.spec.ts › stops the pipeline at the first stage failure` | ✅ green |
| `validateAuthReferences` standalone (cross-validation без перечитывания auth.yaml), публичный API | `auth-config.spec.ts › validateAuthReferences` (2 кейса) | ✅ green |
| Дубликат ключа вне `schemes` с keyPath | `auth-yaml › rejects a duplicate key outside schemes with AUTH_DUPLICATE_KEY` | ✅ green |
| Дубликат внутри `schemes` → `AUTH_DUPLICATE_SCHEME`; никогда silent-last-wins | `auth-yaml › ... AUTH_DUPLICATE_SCHEME`; `... AuthConfigError (never a silent last-wins merge)` | ✅ green |
| `defaultScheme: public` + объявленная `public/none` | `auth-yaml › accepts defaultScheme: public (FR-009)` | ✅ green |
| Case-sensitivity имён схем (`Public ≠ public`) | `auth-yaml › distinguishes Public from public`; `auth-security › matches scheme names case-sensitively` | ✅ green |
| Пустой/пробельный документ | `auth-yaml › rejects an empty/corrupt document as AUTH_FILE_INVALID_YAML` | ✅ green |
| Корневая `security` документа | `auth-security › rejects an undeclared scheme referenced from the document root (route "root")` | ✅ green |
| OpenApi никогда не мутируется | `auth-security › never mutates the input openApi document (R5)` (deep-freeze) | ✅ green |
| Расширяемость registry типов, unknown-тип fail-fast | `auth-config.spec.ts › extensibility ... byte-for-byte unchanged` + `accepts a temporary custom scheme type...` (FR-005, SC-005) | ✅ green |
| Zero runtime dependencies | только `node:*` + relative-импорты в `src/`, `dependencies` в `package.json` отсутствует (yaml — devDependency, bundling через `noExternal`) | ✅ green |

Final gate: 98/98 composer tests green, `tsc --noEmit` clean, monorepo suite (`pnpm test`) зелёный, `yaml` зашит в бандл. Полный прогон и детали — в отчёте implement-фазы.

> Примечание по пакету `yaml`: проверка DUPLICATE_KEY выполняется на собственном AST-обходе `parseDocument(text, { uniqueKeys: true })`, YAML v2 — единственная внешняя зависимость сборки (bundled, не runtime).