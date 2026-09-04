# Quickstart: auth-config валидационные сценарии

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contract**: [contracts/auth-config.md](./contracts/auth-config.md) | **Data model**: [data-model.md](./data-model.md)

Выполнимый гайд, доказывающий фичу spec 007 end-to-end. Детали реализации — в `tasks.md` и фазе implement.

## Prerequisites

- Node.js >= 22, pnpm workspace
- Первый запуск: `pnpm install`

## Setup

Fixture-овое openapi-приложение живёт под `packages/composer/test/fixtures/` (паттерн 006). Каждый fixture — корень composition (`appRoot`) со своим `auth.yaml` и (где нужно) извлечённым OpenAPI-документом:

- `openapi-app/` — каноническая composition: валидный `auth.yaml` (схемы `public`/`user`/`internal`), документ с `security`-записями на `user`, плюс объявленная, но неиспользуемая схема — проверка AC3
- `openapi-app-no-auth/` — `auth.yaml` отсутствует → `AUTH_FILE_MISSING`
- `openapi-app-bad-version/` — `version: 2` → `AUTH_VERSION_UNSUPPORTED`
- `openapi-app-missing-default/` — нет `defaultScheme` → `AUTH_DEFAULT_MISSING`
- `openapi-app-default-unresolved/` — `defaultScheme: ghost` → `AUTH_DEFAULT_UNRESOLVED`
- `openapi-app-empty-schemes/` — `schemes: {}` → `AUTH_SCHEMES_EMPTY`
- `openapi-app-schemes-not-map/` — `schemes` — список → `AUTH_SCHEMES_NOT_MAP`
- `openapi-app-dup/` — дубликат ключа `schemes.user` → `AUTH_DUPLICATE_SCHEME`
- `openapi-app-unknown-type/` — `type: oauth2` → `AUTH_UNKNOWN_SCHEME_TYPE`
- `openapi-app-missing-jwt-fields/` — `jwt` без `audience` → `AUTH_MISSING_FIELD`
- `openapi-app-missing-function/` — `function`-схема без поля `function` → `AUTH_MISSING_FIELD`
- `openapi-app-bad-function-format/` — `function: internal_authorizer` (без префикса) → `AUTH_FUNCTION_INVALID_REF`
- `openapi-app-unresolved-function/` — `function: functions.nope` вне набора → `AUTH_FUNCTION_UNRESOLVED`
- `openapi-app-no-functions/` — есть `function`-схема, но `functions` в запросе не передан → `AUTH_FUNCTION_SET_REQUIRED`
- `openapi-app-undeclared-ref/` — документ со `security: [{ admin: [] }]`, схемы `admin` нет → `AUTH_SECURITY_UNDECLARED` (scheme + route)
- `openapi-app-public-ref/` — документ со значением `public` в security-записи → `AUTH_SECURITY_PUBLIC_VIOLATION`
- `openapi-app-naked-ops/` — валидный `auth.yaml`, документ с операциями без `security` → успех (US2/AC4: применение defaultScheme — 008)

## Validation scenarios

Полный прогон: `pnpm --filter @ycforge/composer test`

Точечные прогоны модулей: `pnpm --filter @ycforge/composer exec vitest run src/auth/auth-yaml.spec.ts` (самовалидация), `...auth-security.spec.ts` (cross-validation), `...function-ref.spec.ts` (function-ссылки), `...auth-config.spec.ts` (оркестрация), `...test/auth-config.integration.spec.ts` (e2e на fixture-ах).

### US1 — самовалидация `auth.yaml` целиком (P1)

**Given** `openapi-app/auth.yaml` — `version: 1`, `defaultScheme: user`, схемы `public` (none), `user` (jwt без обязательных полей), `internal` (function), **When** `validateAuthConfig({ appRoot, openApi, functions: ['internal_authorizer'] })`, **Then** резолвится `AuthValidationResult { authYaml }` без ошибок и предупреждений.

Expected: pass — `auth-yaml › valid document with none+jwt+function schemes` (SC-002).

### US1 — инвалидные варианты fail-fast (SC-003)

**Given** каждый отрицательный fixture (`no-auth`, `bad-version`, `missing-default`, `default-unresolved`, `empty-schemes`, `schemes-not-map`, `dup`, `unknown-type`, `missing-jwt-fields`, `missing-function`), **When** `validateAuthConfig(...)`, **Then** отклоняет `AuthConfigError` с ожидаемым кодом из таблицы contract; в сообщении указан проблемный аспект (поле/имя схемы/тип).

Expected: pass — параметризованные negative-тесты в `auth-yaml.spec.ts` / integration.

### US2 — валидация scheme-ссылок (P1)

- **Given** канонический документ, все имена в `security` объявлены, **When** валидация, **Then** успех — композиция продолжается (AC1).
- **Given** `openapi-app-undeclared-ref` (`security: [{ admin: [] }]` на `GET /admin`), **When** валидация, **Then** `AUTH_SECURITY_UNDECLARED` с `schemeName: 'admin'` и `route: 'GET /admin'` (AC2).
- **Given** объявленная, но неиспользуемая схема (`frontend` не встречается в security), **When** валидация, **Then** успех — не ошибка (AC3).
- **Given** операции без `security` (`openapi-app-naked-ops`), **When** валидация, **Then** успех — применение defaultScheme вне 007 (AC4).
- **Given** `openapi-app-public-ref`, **When** валидация, **Then** `AUTH_SECURITY_PUBLIC_VIOLATION` с `route` (AC5, FR-009).

Expected: pass — `auth-security.spec.ts` + integration (SC-004).

### US3 — function-ссылки (P2)

- **Given** `function: functions.internal_authorizer` и `functions: ['internal_authorizer']`, **When** валидация, **Then** успех (AC1).
- **Given** `openapi-app-unresolved-function` (`functions.nope` вне набора), **When** валидация, **Then** `AUTH_FUNCTION_UNRESOLVED` (AC2).
- **Given** `openapi-app-no-functions` (набор не передан), **When** валидация, **Then** `AUTH_FUNCTION_SET_REQUIRED` — resolvability не пропускается молча (FR-012, V).
- **Given** `function: functions.internal_authorizer` с прошедшей валидацией, **When** инспекция результата, **Then** результат не содержит артефактов key/JWKS/Lockbox/provisioning — только `authYaml` read-model (AC3; FR-011).

Expected: pass — `function-ref.spec.ts` + integration (SC-006).

## Outcome

Все сценарии зелёные = контракт auth-config держится (формат `version: 1`, fail-fast таксономия ошибок, cross-validation безопасности, функция-резолвимость, seam к 008). Полные коды ошибок и границы NOT(007) — в `contracts/auth-config.md`.