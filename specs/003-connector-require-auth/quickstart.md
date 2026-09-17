# Quickstart: валидация 003-connector-require-auth

## Prerequisites

- pnpm 11, Node.js >= 22
- Ветка `003-connector-require-auth`

## Сценарий 0 — миграционный baseline (Phase M)

```bash
pnpm install
pnpm --filter @ycforge/nestjs-connector build
pnpm --filter @ycforge/nestjs-connector test
```

Ожидаемо: пакет `packages/nest-bridge` собран, ВСЕ перенесённые тесты v0.0.3 зелёные (characterization baseline до новой функциональности).

## Сценарий 1 — декоратор и metadata (US1)

```bash
pnpm --filter @ycforge/nestjs-connector test -- test/auth
```

Ожидаемо зелёными: metadata `ycsf:auth:scheme`/`ycsf:auth:guard` на class и method; `ApiSecurity` присутствует для не-public схем и отсутствует для `('public', null)`; project-local wrapper эквивалентен прямому применению.

## Сценарий 2 — runtime global guard (US2)

Integration-тесты на Nest testing module (`test/auth/*.integration.spec.ts`):

- защищённый маршрут проходит через заявленный guard (controller-level и method-override);
- guard с собственной DI-зависимостью резолвится контейнером;
- `('public', null)` пропускает запрос;
- без metadata: `defaultAuthGuard` из bootstrap-опции применяется; без опции — пропуск;
- guard, не зарегистрированный в DI → понятная ошибка Nest (не молчаливый пропуск).

## Сценарий 3 — subpath exports (US3)

```bash
pnpm --filter @ycforge/nestjs-connector build
pnpm --filter @ycforge/nestjs-connector test -- test/packaging
```

Ожидаемо: compile-фикстуры с импортами `@ycforge/nestjs-connector/auth`, `/queue`, `/context` и корневого barrel компилируются (`tsc --noEmit` против `dist`); guard-тест FR-008 отклоняет импорт корневого barrel из `src/auth|queue|context` (проверяется и позитив — текущие исходники чисты).

## Сценарий 4 — полный прогон (Success Criteria)

```bash
pnpm --filter @ycforge/nestjs-connector test        # SC-001..SC-004
pnpm --filter @ycforge/nestjs-connector typecheck
```

Ожидаемо: зелёно; каждый acceptance scenario US1–US3 покрыт минимум одним тестом (traceability — см. таблицы в `contracts/`).
