# Quickstart: api-composition валидационные сценарии

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contract**: [contracts/api-composition.md](./contracts/api-composition.md) | **Data model**: [data-model.md](./data-model.md)

Выполнимый гайд, доказывающий фичу spec 008 end-to-end (US1–US4 + Edge cases). Детали реализации — в `tasks.md` и фазе implement.

## Prerequisites

- Node.js >= 22, pnpm workspace
- Первый запуск: `pnpm install`
- Базис полагается на 006 (`extractOpenApi`) и 007 (`validateAuthConfig`/`validateAuthReferences`) — регрессии 006/007 уже покрыты их собственными suite-ами (SC-007).

## Setup

Fixture-ы живут под `packages/composer/test/fixtures/` (паттерн 006/007). Каждый `compose-*` fixture — корень композиции (`compositionRoot`) с `auth.yaml` (007-валидный), optional `overrides.yaml`, и каталогами приложений-участников с `openapi.json` (источник 006) и optional `overrides.yaml`:

```
packages/composer/test/fixtures/compose-app/           # каноническая композиция
├── auth.yaml                                          # схемы public/user/internal (+ frontend unused)
├── overrides.yaml                                     # global: replace info + add GET /_health
└── participants/
    ├── user_service/
    │   ├── openapi.json                               # /users (listUsers, getUser), /legacy (listLegacy)
    │   └── overrides.yaml                             # local: remove GET /legacy + replace GET /users
    └── analytics/
        └── openapi.json                               # /analytics/{id} (getAnalytics)
```

Отрицательные fixture-ы:

- `compose-app-path-collision/` — `user_service` и `analytics` обе объявляют `GET /users`
- `compose-app-opid-collision/` — `listUsers` объявлен на разных путях двух приложений
- `compose-app-opid-self-collision/` — `getUser` дублируется внутри ОДНОГО приложения
- `compose-app-component-collision/` — `UserDto` определён в обоих приложениях
- `compose-app-version-mismatch/` — `openapi: 3.0.0` vs `3.1.0`
- `compose-app-no-participants/` — `apps: []` → `COMPOSE_NO_PARTICIPANTS`
- `compose-app-no-info/` — нет global override `info` → `COMPOSE_INFO_MISSING`
- `compose-app-none-ref/` — операция `security: [{ anon: [] }]`, схема `anon: {type: none}` → `COMPOSE_SECURITY_REF_NONE_SCHEME`
- `compose-app-ov-bad-version/` — `version: 2` → `OVERRIDE_VERSION_UNSUPPORTED`
- `compose-app-ov-rules-empty/` — `rules: []` → `OVERRIDE_RULES_EMPTY`
- `compose-app-ov-value-missing/` — `replace` без `value` → `OVERRIDE_VALUE_REQUIRED`
- `compose-app-ov-target-missing/` — `replace` несуществующей операции → `OVERRIDE_TARGET_MISSING`
- `compose-app-ov-add-existing/` — `add` существующего пути → `OVERRIDE_TARGET_ALREADY_EXISTS`
- `compose-app-ov-local-out-of-scope/` — local (`user_service`) адресует путь `analytics` → `OVERRIDE_OUT_OF_SCOPE`
- `compose-app-ov-local-info/` — local адресует `kind: info` → `OVERRIDE_OUT_OF_SCOPE`
- `compose-app-bad-auth/` — без `auth.yaml` → `AUTH_FILE_MISSING` (делегированный код 007)
- `compose-app-bad-extract/` — участник без источника → `NO_SOURCE` (делегированный код 006)

## Validation scenarios

Полный прогон пакета: `pnpm --filter @ycforge/composer test`

Точечные прогоны модулей:
`pnpm --filter @ycforge/composer exec vitest run src/compose/<module>.spec.ts` (unit) и
`... test/compose.integration.spec.ts` (e2e на fixture-ах).

### US1 — merge нескольких приложений в один gateway (P1)

- **Given** `compose-app`, **When** `compose({ compositionRoot, apps: [user_service, analytics], functions: ['internal_authorizer'] })`, **Then** резолвится `ComposeResult { document, provenance }`: каждый путь/операция/компонент обоих приложений присутствуют; входные `openapi.json` байт-идентичны входу (SC-002).
- **Given** та же композиция с обратным порядком участников, **When** повторный `compose`, **Then** `document` байт-идентичен предыдущему (AC2, FR-017); интеграционный кейс сериализует `document` (JSON, детерминированная сортировка ключей) и сравнивает.
- **Given** результат, **When** проверка, **Then** `document` не содержит ни одного ключа/поля provenance (перебор путей JSON-объекта не находит `app`/`owner`/ownership-метаданных) (AC3, SC-004); `result.provenance` содержит `path → owner` для каждого пути.
- **Given** `parts` = только `user_service`, **When** `compose`, **Then** корректный gateway-документ (тривиальный merge) с применением тех же overrides/auth (AC4).

Expected: pass — `compose.spec.ts` + integration `compose.integration.spec.ts` (determinism, provenance-absence, order-swap).

### US2 — fail-fast на конфликтах (P1)

- **Given** `compose-app-path-collision`, **When** `compose`, **Then** `ComposeError` `COMPOSE_PATH_COLLISION` с `path: '/users'` и обоими `apps` (`user_service`, `analytics`) (AC1, FR-004).
- **Given** `compose-app-opid-collision`, **When** `compose`, **Then** `COMPOSE_OPERATIONID_COLLISION` с `operationId: 'listUsers'`, путями обеих операций и обоими `apps` (AC2, FR-005).
- **Given** `compose-app-opid-self-collision` (два пути одного приложения с одинаковым operationId), **When** `compose`, **Then** `COMPOSE_OPERATIONID_COLLISION` (Edge, self-collision).
- **Given** `compose-app-component-collision`, **When** `compose`, **Then** `COMPOSE_COMPONENT_COLLISION` с `componentName: 'UserDto'` и обоими `apps` (AC3, FR-006).
- **Given** `compose-app-version-mismatch`, **When** `compose`, **Then** `COMPOSE_OPENAPI_VERSION_MISMATCH` (FR-016).
- **Given** любой конфликт, **When** вызов через standalone (API) и через pipeline-путь (тот же API из C), **Then** диагностика идентична (AC4, FR-015) — проверяется однократностью кода в `compose.ts` и отсутствием C-side дублирующей логики.

Expected: pass — `merge.spec.ts` (unit) + integration.

### US3 — global/local overrides с приоритетом local > global (P2)

- **Given** `compose-app/overrides.yaml` (replace `info`, add `GET /_health`), **When** `compose`, **Then** `document.info` ровно из override (AC1); `/paths//_health` присутствует; `result.provenance` содержит `/_health → 'global'` (AC2, приватно).
- **Given** `user_service/overrides.yaml` (remove `GET /legacy`, replace `GET /users`), **When** `compose`, **Then** `/legacy` отсутствует; `GET /users` заменён атомарно — `value` rule целиком, повторное появление removed-операций невозможно (AC3, FR-010).
- **Given** global и local адресуют одну операцию с разными значениями, **When** `compose`, **Then** применяется ЛОКАЛЬНОЕ, ошибки нет (AC4, FR-009).
- **Given** `compose-app-ov-local-out-of-scope` / `compose-app-ov-local-info`, **When** `compose`, **Then** `OVERRIDE_OUT_OF_SCOPE` с целью и app-владельцем (AC5, FR-008).
- **Given** `compose-app-ov-target-missing` / `compose-app-ov-add-existing`, **When** `compose`, **Then** `OVERRIDE_TARGET_MISSING` / `OVERRIDE_TARGET_ALREADY_EXISTS` (AC6, FR-007) — правило не «молчит» как no-op.
- **Given** grammar-негативы (`ov-bad-version`, `ov-rules-empty`, `ov-value-missing`), **When** `compose`, **Then** соответствующие `OVERRIDE_*` коды (FR-007, V).
- **Given** отсутствие override-файлов у участника, **When** `compose`, **Then** успех — нет правил уровня, не ошибка.

Expected: pass — `overrides/override-yaml.spec.ts` (grammar) + `overrides/apply.spec.ts` (apply/scope/priority) + integration.

### US4 — auth-применение (P2)

- **Given** `compose-app` с `defaultScheme: user` (jwt) и операциями без `security`, **When** `compose`, **Then** `document.security === [{ user: [] }]`; операции без явного `security` наследуют, с явным `security` сохраняют своё (AC1, FR-011).
- **Given** `defaultScheme: public` (тип `none`) вариант fixture, **When** `compose`, **Then** корневой `security` не эмитится; голые операции без auth (AC2).
- **Given** схемы `user` (jwt: jwksUri/issuer/audience) и `internal` (`functions.internal_authorizer`), **When** `compose`, **Then** `components.securitySchemes` содержит обе; запись `user` = `{ type: openIdConnect, openIdConnectUrl: <issuer>/.well-known/openid-configuration, x-yc-apigateway-authorizer: { type: jwt, jwksUri, issuers: [<issuer>], audiences: [<audience>], identitySource: { in: header, name: Authorization, prefix: "Bearer " } } }` (вариант A, FR-013/R5); запись `internal` = `{ type: http, scheme: bearer, x-yc-apigateway-authorizer: { type: function, function_id: functions.internal_authorizer } }` (логическая ссылка, без `${resources...}`/JWKS/Lockbox) (AC3, FR-012/013).
- **Given** схема `frontend` типа `none`, **When** `compose`, **Then** для неё нет ни securitySchemes-записи, ни authorizer (AC4).
- **Given** `compose-app-none-ref` (операция со `security: [{ anon: [] }]`, схема none), **When** `compose`, **Then** `COMPOSE_SECURITY_REF_NONE_SCHEME` (data-model правило 9, V).
- **Given** приложение c уже существующим `components.securitySchemes.user` + `auth.yaml` схемой `user`, **When** `compose`, **Then** `COMPOSE_COMPONENT_COLLISION` (FR-006, не тихий приоритет).

Expected: pass — `auth-apply.spec.ts` (unit) + integration.

### US5 — делегирование ошибок 006/007 (граница)

- **Given** `compose-app-bad-auth`, **When** `compose`, **Then** наружу всплывает `AuthConfigError` `AUTH_FILE_MISSING` (не `ComposeError`, не ремап) (FR-015).
- **Given** `compose-app-bad-extract`, **When** `compose`, **Then** `OpenApiExtractError` `NO_SOURCE` (FR-005, делегирование 006).
- **Given** входные документы, **When** `compose`, **Then** они не мутированы (deep-freeze, byte-parity) (FR-014, SC-007).

Expected: pass — `compose.spec.ts` (делегирование/би-инварианты) + integration.

## Outcome

Все сценарии зелёные = контракт api-composition держится: merge + fail-fast таксономия конфликтов (FR-004/005/006/016), внутренний provenance без утечки в артефакт (FR-003/017), детерминизм при перестановке участников, override-грамматика версии 1 с атомарными операциями и приоритетом local > global (FR-007/008/009/010), auth-применение шва 007 (FR-011/012/013) и seam-ы к 009/010/019. Полные коды ошибок и границы NOT(008) — в `contracts/api-composition.md`.