# Tasks: `@RequireAuth` + global guard + subpath exports (003)

**Input**: Design documents from `/specs/003-connector-require-auth/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: обязательны (Constitution II: test-first; SC-001 требует traceability каждого AC). Тесты пишутся FIRST, RED подтверждается запуском, затем GREEN.

**Organization**: Phase M (миграционный preamble, blocking) → Foundational → US1 (P1) → US2 (P1) → US3 (P2) → Polish.

## Format: `[ID] [P?] [Story] Description`

---

## Phase M: Migration Preamble (blocking, per plan.md Assumptions)

**Purpose**: `packages/nest-bridge` не существует — перенос `ycsf-nestjs-connector@v0.0.3` (tag `v0.0.3`, commit `a4f4e2d`, https://github.com/ycforge/ycsf-nestjs-connector) в монорепу с конвенциями workspace. Никакой новой функциональности в этой фазе.

**⚠️ CRITICAL**: ни одна user story не начинается до зелёного baseline.

- [X] T001 Склонировать tag `v0.0.3` репозитория `ycsf-nestjs-connector` во временный каталог (напр. `git clone --depth 1 --branch v0.0.3` в `/tmp`) и скопировать `src/`, тесты и fixtures в `packages/nest-bridge/`, сохранив структуру `src/core`, `src/http`, `src/mq`
- [X] T002 Создать `packages/nest-bridge/package.json`: name `@ycforge/nestjs-connector`, version `0.1.0`, `"type": "module"`, peer deps `@nestjs/common`/`@nestjs/core` ^11 (Node >= 22), скрипты build/test/typecheck по образцу `packages/pilot/package.json`
- [X] T003 [P] Создать `packages/nest-bridge/tsup.config.ts` (entry `src/index.ts`, dual ESM/CJS, dts — по образцу `packages/pilot/tsup.config.ts`)
- [X] T004 [P] Создать `packages/nest-bridge/vitest.config.ts` и `packages/nest-bridge/tsconfig.json` (ESM, decorators/metadata включены: `experimentalDecorators`, `emitDecoratorMetadata`)
- [X] T005 Адаптировать перенесённые тесты к vitest (заменить legacy test runner оригинального репозитория, импорты, конфиг); логику тестов не менять
- [X] T006 Запустить `pnpm install && pnpm --filter @ycforge/nestjs-connector test` — ВСЕ перенесённые тесты зелёные (characterization baseline); `build` и `typecheck` тоже зелёные

**Checkpoint**: baseline зелёный. Существующее поведение (spec 001) зафиксировано тестами в новом пакете.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: структура для auth-модуля и subpath entries, нужная всем story.

- [X] T007 Создать `packages/nest-bridge/src/auth/auth-metadata.ts`: константы ключей `AUTH_SCHEME_KEY = 'ycsf:auth:scheme'`, `AUTH_GUARD_KEY = 'ycsf:auth:guard'` и тип `AuthGuardType = Type<CanActivate> | null` (per data-model.md)
- [X] T008 Добавить `@nestjs/swagger` ^11 как peer dependency в `packages/nest-bridge/package.json` (для `ApiSecurity`; research R9)

**Checkpoint**: metadata-ключи — единый источник для US1/US2.

---

## Phase 3: User Story 1 — `@RequireAuth` декоратор и metadata (Priority: P1) 🎯 MVP

**Goal**: `@RequireAuth(scheme, guard)` записывает metadata и `ApiSecurity` для не-public схем (FR-001, FR-002, FR-009).

**Independent Test**: `pnpm --filter @ycforge/nestjs-connector test -- test/auth` — unit-тесты metadata зелёные.

### Tests for User Story 1 ⚠️ (write FIRST, confirm RED)

- [X] T009 [P] [US1] Unit-тест: `@RequireAuth('user', UserAuthGuard)` на class → `ycsf:auth:scheme === 'user'`, `ycsf:auth:guard === UserAuthGuard`, присутствует `ApiSecurity('user')`-metadata в `packages/nest-bridge/test/auth/require-auth.decorator.spec.ts` (US1/AC1)
- [X] T010 [P] [US1] Unit-тест: `@RequireAuth('admin', AdminGuard)` на method → оба ключа на уровне метода + `ApiSecurity('admin')` там же, в `packages/nest-bridge/test/auth/require-auth.decorator.spec.ts` (US1/AC2)
- [X] T011 [P] [US1] Unit-тест: `@RequireAuth('public', null)` → scheme `'public'`, guard `null`, `ApiSecurity`-metadata ОТСУТСТВУЕТ, там же (US1/AC3, FR-002)
- [X] T012 [P] [US1] Unit-тест: project-local wrapper `const Public = () => RequireAuth('public', null)` даёт metadata, идентичную прямому применению, там же (US1/AC4, FR-009)
- [X] T013 [P] [US1] Unit-тест: пустой/нестроковый scheme → `TypeError` при применении декоратора (fail-fast), там же (data-model validation)
- [X] T014 [US1] Запустить `pnpm --filter @ycforge/nestjs-connector test -- test/auth` и зафиксировать RED (модуль не существует)

### Implementation for User Story 1

- [X] T015 [US1] Реализовать `RequireAuth` в `packages/nest-bridge/src/auth/require-auth.decorator.ts`: валидация scheme, `applyDecorators(SetMetadata(AUTH_GUARD_KEY, guard), SetMetadata(AUTH_SCHEME_KEY, scheme), scheme === 'public' ? () => {} : ApiSecurity(scheme))` (пер. IDEA §11)
- [X] T016 [US1] Создать `packages/nest-bridge/src/auth/index.ts` — экспорт `RequireAuth`, ключей/типов из `auth-metadata.ts`; НЕ импортировать `src/index.ts` (FR-008)
- [X] T017 [US1] Добавить ре-экспорт auth из корневого barrel `packages/nest-bridge/src/index.ts` (обратная совместимость + US3/AC3)
- [X] T018 [US1] Прогнать тесты US1 — GREEN; убедиться, что baseline-тесты (Phase M) не сломаны

**Checkpoint**: US1 независимо проверяема; декоратор — стабильный контракт (contracts/auth-decorator.md).

---

## Phase 4: User Story 2 — Global guard с делегированием через DI (Priority: P1)

**Goal**: `createYandexHandler` регистрирует `GlobalAuthGuard`; precedence method > controller > project-default (bootstrap-опция `defaultAuthGuard`); делегирование через `ModuleRef` (FR-003..FR-006); HTTP-only (FR-011).

**Independent Test**: integration-тесты на Nest testing module в `packages/nest-bridge/test/auth/global-auth-guard.integration.spec.ts` зелёные.

### Tests for User Story 2 ⚠️ (write FIRST, confirm RED)

- [X] T019 [P] [US2] Integration-тест: controller `@RequireAuth('user', UserAuthGuard)`, method без декоратора → запрос проходит через `UserAuthGuard` (spy на canActivate), в `packages/nest-bridge/test/auth/global-auth-guard.integration.spec.ts` (US2/AC1, FR-003, FR-004)
- [X] T020 [P] [US2] Integration-тест: controller-level guard + method `@RequireAuth('admin', AdminGuard)` → применяется `AdminGuard` (precedence method > controller), там же (US2/AC2, SC-002)
- [X] T021 [P] [US2] Integration-тест: `@RequireAuth('public', null)` → guard не вызывается, запрос пропускается, там же (US2/AC3, FR-005)
- [X] T022 [P] [US2] Integration-тест: guard с собственной DI-зависимостью (injectable service приложения) резолвится контейнером и видит зависимость, там же (US2/AC4, SC-004)
- [X] T023 [P] [US2] Integration-тест: без metadata — `defaultAuthGuard` из bootstrap-опции применяется; без опции — пропуск; отдельный кейс: scheme без guard не порождает guard (нет вывода из scheme), там же (US2/AC5, FR-006, SC-002)
- [X] T024 [P] [US2] Integration-тест: guard-класс не зарегистрирован в DI → запрос завершается понятной ошибкой Nest (не молчаливым пропуском), там же (Edge Case)
- [X] T025 [P] [US2] Тест: `@RequireAuth` на `@QueueHandler()`-методе не влияет на MQ dispatch (MQ-событие доставляется без guard-проверки), в `packages/nest-bridge/test/auth/mq-auth-scope.spec.ts` (FR-011)
- [X] T026 [US2] Запустить новые тесты — зафиксировать RED

### Implementation for User Story 2

- [X] T027 [US2] Реализовать `GlobalAuthGuard` в `packages/nest-bridge/src/auth/global-auth.guard.ts`: `Reflector.getAllAndOverride(AUTH_GUARD_KEY, [handler, class])`; заявленный guard → `moduleRef.get(guard, { strict: false })` → `canActivate`; `null` → true; нет metadata → `defaultAuthGuard` из options-token (через DI) либо true; ошибки резолва не перехватывать (research R2–R5)
- [X] T028 [US2] Расширить `createYandexHandler` в `packages/nest-bridge/src/core/create-yandex-handler.ts`: параметр `options?: { defaultAuthGuard?: Type<CanActivate> | null, ...существующие }`; регистрация `GlobalAuthGuard` как global guard (`app.useGlobalGuards`) только для HTTP pipeline; options-token в DI (research R2, R5)
- [X] T029 [US2] Экспортировать `GlobalAuthGuard` и тип `ConnectorBootstrapOptions` из `packages/nest-bridge/src/auth/index.ts` и корневого barrel
- [X] T030 [US2] Прогнать тесты US2 — GREEN; baseline не сломан

**Checkpoint**: US1+US2 работают независимо; runtime-принудительность подтверждена.

---

## Phase 5: User Story 3 — Subpath exports `/auth`, `/queue`, `/context` (Priority: P2)

**Goal**: точечные импорты через exports-мапу при сохранённом корневом barrel (FR-007, FR-008, SC-003).

**Independent Test**: compile-фикстуры + статический guard-тест зелёные после `pnpm --filter @ycforge/nestjs-connector build`.

### Tests for User Story 3 ⚠️ (write FIRST, confirm RED)

- [X] T031 [P] [US3] Compile-фикстура `packages/nest-bridge/test/packaging/fixtures/import-auth.ts` (`import { RequireAuth } from '@ycforge/nestjs-connector/auth'`) + vitest-тест, компилирующий её `tsc --noEmit` с paths на `dist` собранного пакета, в `packages/nest-bridge/test/packaging/subpath-exports.spec.ts` (US3/AC1)
- [X] T032 [P] [US3] Compile-фикстуры `import-queue.ts` (`QueueHandler`, `QueueMessage` из `/queue`) и `import-context.ts` (`YandexContext` из `/context`) + кейсы в `subpath-exports.spec.ts` (US3/AC2)
- [X] T033 [P] [US3] Compile-фикстура `import-root.ts` (корневой barrel) + кейс обратной совместимости там же (US3/AC3)
- [X] T034 [P] [US3] Статический guard-тест в `packages/nest-bridge/test/packaging/no-root-barrel-import.spec.ts`: сканирует `src/auth/**`, `src/queue/**`, `src/context/**` и отклоняет любой import, резолвящийся в `src/index.ts`; включает позитивный self-check (тест падает на намеренно добавленном запрещённом импорте во временном fixture) (FR-008)
- [X] T035 [US3] Запустить — зафиксировать RED (subpath entries и exports-мапа отсутствуют)

### Implementation for User Story 3

- [X] T036 [P] [US3] Создать `packages/nest-bridge/src/queue/index.ts` — ре-экспорт `QueueHandler`, `QueueMessage` из конкретных модулей `src/mq/` (без импорта корневого barrel; логика mq не перемещается)
- [X] T037 [P] [US3] Создать `packages/nest-bridge/src/context/index.ts` — ре-экспорт `YandexContext` из конкретного модуля контекста
- [X] T038 [US3] Обновить `packages/nest-bridge/tsup.config.ts`: entry `src/index.ts`, `src/auth/index.ts`, `src/queue/index.ts`, `src/context/index.ts` (dual ESM/CJS + dts, research R6)
- [X] T039 [US3] Обновить `packages/nest-bridge/package.json`: `exports` для `.`, `./auth`, `./queue`, `./context` с types/import/require (contracts/package-exports.md)
- [X] T040 [US3] Прогнать `build` + тесты US3 — GREEN; полный `pnpm --filter @ycforge/nestjs-connector test` зелёный

**Checkpoint**: все три story независимо функциональны.

---

## Phase 6: Polish & Cross-Cutting

- [X] T041 [P] Прогнать все сценарии `specs/003-connector-require-auth/quickstart.md` (SC-001..SC-004) и зафиксировать результат
- [X] T042 [P] Проверить traceability: каждый AC из spec.md покрыт тестом (таблицы в `contracts/`); `pnpm --filter @ycforge/nestjs-connector typecheck` зелёный
- [X] T043 Обновить `packages/nest-bridge/README.md` (если перенесён из v0.0.3): документировать `@RequireAuth`, global guard, `defaultAuthGuard`, subpath imports, семантику `guard === null` при схеме ≠ public (Edge Case spec)
- [X] T044 Обновить корневой `README.md`/`AGENTS.md` при необходимости (появление `packages/nest-bridge` в монорепе)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase M (migration)**: без зависимостей; **BLOCKS** всё остальное
- **Phase 2 (Foundational)**: после Phase M; блокирует US1/US2
- **US1 (P1)**: после Phase 2
- **US2 (P1)**: после US1 (использует metadata-ключи и декоратор в тестах); логика guard формально независима, но порядок P1→P1 последовательный
- **US3 (P2)**: после Phase 2; зависит от T016 (`src/auth/index.ts`) для exports-мапы → фактически после US1; параллелится с US2
- **Phase 6**: после всех story

### Parallel Opportunities

- T003, T004 — параллельно (разные файлы)
- T009–T013 — все тесты US1 параллельно (один spec-файл, но независимые кейсы; при конфликте — последовательно в одном файле)
- T019–T025 — тесты US2: T025 в отдельном файле (параллельно), остальные в одном integration-файле
- T031–T034 — тесты US3 параллельно; T036, T037 — параллельно
- T041, T042 — параллельно

### Parallel Example: User Story 3

```bash
Task: "Создать packages/nest-bridge/src/queue/index.ts — ре-экспорт QueueHandler/QueueMessage"
Task: "Создать packages/nest-bridge/src/context/index.ts — ре-экспорт YandexContext"
```

---

## Implementation Strategy

### MVP First

1. Phase M (миграция, зелёный baseline) → Phase 2 → US1 → **STOP**: декоратор — самостоятельная ценность (OpenAPI security metadata для B).
2. US2 → runtime-принудительность (второй P1).
3. US3 → packaging (P2).
4. Phase 6 — валидация quickstart и traceability.

### Test-First (Constitution II)

- Каждая story: тесты → RED (зафиксирован запуском) → реализация → GREEN.
- Исключений нет: новая функциональность не подпадает под characterization-исключение (оно — для оркестрационных слоёв C).

## Notes

- [P] = разные файлы, нет зависимостей от незавершённых задач
- Метки [US1]/[US2]/[US3] — traceability к spec.md
- Commit после каждой фазы/checkpoint
- Phase M не вносит изменений в поведение v0.0.3 — любые правки сверх адаптации tooling фиксируются отдельно
