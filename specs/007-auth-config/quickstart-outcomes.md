# Quickstart outcomes — spec 007 (implemented)

Recorded after `/speckit-implement`, 2026-09-05. Reference: [quickstart.md](./quickstart.md). All scenarios verified via `pnpm --filter @ycforge/composer test`.

| Scenario | Requirement | Verifying test | Outcome |
|----------|-------------|----------------|---------|
| US1 — самовалидация `auth.yaml` целиком | US1/AC1, SC-002 | `auth-yaml › accepts a document with none + jwt + function schemes and array audience`; integration `validateAuthConfig — US1 self-validation on fixture roots › resolves the canonical openapi-app composition with the expected authYaml (US1/AC1, SC-002)` | ✅ green |
| US1 — инвалидные варианты fail-fast | US1/AC2–AC6, SC-003 | параметризованные negative-кейсы в `auth-yaml.spec.ts` (`rejects %s fail-fast with the exact code + context`: bad-version, missing-default, default-unresolved, empty-schemes, schemes-not-map, dup → `AUTH_DUPLICATE_SCHEME`, unknown-type, missing-jwt-fields, missing-function) + `AUTH_FILE_MISSING` для `openapi-app-no-auth` | ✅ green |
| US2 — все имена в `security` объявлены | US2/AC1, FR-008 | `auth-security › passes when every referenced scheme is declared (US2/AC1)`; integration canonical root | ✅ green |
| US2 — undeclared-ссылка | US2/AC2 | `auth-security › rejects an undeclared scheme with schemeName + route (US2/AC2, SC-004)`; integration `validateAuthConfig — US2 security-reference cross-validation on fixture roots › rejects an undeclared scheme ref with schemeName + route (US2/AC2, SC-004)` | ✅ green |
| US2 — объявленная, но неиспользуемая схема | US2/AC3 | `auth-security › passes with declared-but-unused schemes (US2/AC3)` | ✅ green |
| US2 — операции без `security` | US2/AC4, 008 seam | integration `accepts naked operations without applying defaultScheme (US2/AC4, 008 seam)` | ✅ green |
| US2 — `public` в security-записи | US2/AC5, FR-009 | `auth-security › rejects \`public\` inside a security entry (US2/AC5, FR-009)`; integration `validateAuthConfig — US2 security-reference cross-validation on fixture roots › rejects \`public\` in a security entry with the route (US2/AC5, FR-009)` | ✅ green |
| US3 — резолвимость `functions.<name>` в переданный набор | US3/AC1, FR-012 | `function-ref › resolves a valid reference set and fills the FunctionReference name`; integration `validateAuthConfig — US3 function-reference resolution on fixture roots › resolves functions.internal_authorizer against the composition functions set (US3/AC1, FR-012)` | ✅ green |
| US3 — неотрезолвленная ссылка | US3/AC2 | `function-ref › rejects a reference outside the set with AUTH_FUNCTION_UNRESOLVED (AC2, FR-012)`; integration `validateAuthConfig — US3 function-reference resolution on fixture roots › rejects an unresolved function reference with the ref (US3/AC2)` | ✅ green |
| US3 — набор `functions` не передан | US3/AC1 (negative), FR-012, V | `function-ref › requires the functions set when a function scheme is present (FR-012, V)`; integration `validateAuthConfig — US3 function-reference resolution on fixture roots › requires the functions set when a function scheme exists (FR-012, V)` | ✅ green |
| US3 — read-model только `authYaml` | US3/AC3, FR-011, SC-006 | integration `validateAuthConfig — US3 function-reference resolution on fixture roots › produces ONLY the authYaml read-model — no provisioning/JWKS/Lockbox artifacts (US3/AC3, FR-011, SC-006)` | ✅ green |

Дополнительное покрытие, добавленное в ходе implement:

| Scenario | Verifying test | Outcome |
|----------|----------------|---------|
| Невалидный формат function-ссылки (без префикса) | `function-ref › parses the two-segment functions.<name> grammar (AC1, FR-012)` + параметризованный `rejects malformed reference %j with AUTH_FUNCTION_INVALID_REF`; `AUTH_FUNCTION_INVALID_REF` | ✅ green |
| Grammar-проверка до проверки наличия набора | `function-ref › checks grammar before the functions set requirement` | ✅ green |
| Схемы без function-ссылок — документ не меняется | `function-ref › returns the document untouched when it has no function schemes` | ✅ green |
| Порядок стадий фиксированной pipeline (version → defaultScheme-presence → schemes-map/empty → defaultScheme-resolvability → type → fields → function → security) | `auth-config.spec.ts › validateAuthConfig — fixed pipeline order (SC-003)` (8 кейсов: первая ошибка побеждает, security — финальная стадия) | ✅ green |
| Остановка pipeline на первой ошибке | `auth-config.spec.ts › validateAuthConfig — fixed pipeline order (SC-003) › stops the pipeline at the first stage failure (SECURITY is never reached)` | ✅ green |
| `validateAuthReferences` standalone (cross-validation без перечитывания auth.yaml), публичный API | `auth-config.spec.ts › validateAuthReferences — standalone cross-validation against a validated authYaml` (2 кейса) | ✅ green |
| Дубликат ключа вне `schemes` с keyPath | `auth-yaml › rejects a duplicate key outside schemes with AUTH_DUPLICATE_KEY and the keyPath` | ✅ green |
| Дубликат внутри `schemes` → `AUTH_DUPLICATE_SCHEME`; никогда silent-last-wins | `auth-yaml › rejects a duplicate scheme name inside schemes with AUTH_DUPLICATE_SCHEME`; `auth-yaml › throws AuthConfigError (never a silent last-wins merge — Constitution V)` | ✅ green |
| `defaultScheme: public` + объявленная `public/none` | `auth-yaml › accepts defaultScheme: public with a declared public/none scheme (FR-009)` | ✅ green |
| Case-sensitivity имён схем (`Public ≠ public`) | `auth-yaml › distinguishes Public from public (case-sensitive scheme names)`; `auth-security › matches scheme names case-sensitively: \`Public\` is not \`public\` (Edge cases)` | ✅ green |
| Пустой/пробельный документ | `auth-yaml › rejects an empty/corrupt document as AUTH_FILE_INVALID_YAML` | ✅ green |
| Пустой ключ имени схемы `''` в `schemes` | `auth-yaml › rejects an empty scheme-name key with AUTH_INVALID_SCHEME_NAME and schemeName context`; `auth-yaml › empty scheme-name error names the scheme and never embeds document contents` (T030) | ✅ green |
| Корневая `security` документа | `auth-security › rejects an undeclared scheme referenced from the document root (R6, FR-008)` | ✅ green |
| OpenApi никогда не мутируется | `auth-security › never mutates the input openApi document (R5)` (deep-freeze) | ✅ green |
| Расширяемость registry типов, unknown-тип fail-fast | `auth-config.spec.ts › extensibility — scheme-type validator registry (FR-005, SC-005) › stays byte-for-byte unchanged through an extended registry` + `accepts a temporary custom scheme type and still fail-fasts on unknown types (SC-005, R1)` | ✅ green |
| Zero runtime dependencies | только `node:*` + relative-импорты в `src/`, `dependencies` в `package.json` отсутствует (yaml — devDependency, bundling через `noExternal`) | ✅ green |

Final gate (после конвергенции T029–T031): 117/117 composer tests green, `tsc --noEmit` clean, monorepo suite (`pnpm test`) зелёный (614 тестов: pilot 55 + composer 117 + nest-bridge 442), `yaml` зашит в бандл. Полный прогон и детали — в отчёте implement-фазы.

> Примечание по пакету `yaml`: проверка DUPLICATE_KEY выполняется на собственном AST-обходе `parseDocument(text, { uniqueKeys: true })`, YAML v2 — единственная внешняя зависимость сборки (bundled, не runtime).