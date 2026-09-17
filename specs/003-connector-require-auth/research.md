# Research: 003-connector-require-auth

Все NEEDS CLARIFICATION из Technical Context закрыты. Решения ниже — основание для Phase 1.

## R1. Источник миграции пакета

- **Decision**: импорт из `https://github.com/ycforge/ycsf-nestjs-connector`, tag `v0.0.3` (commit `a4f4e2d2ad0b7c64f9cb29587dba9d0a74f49ee6`), в `packages/nest-bridge`. История git не переносится; переносится срез кода + тестов + fixtures.
- **Rationale**: tag доступен (проверено `git ls-remote` 2026-09-04); specs/001 уже снял состояние именно этой версии — ссылки `path:line` в specs/001 остаются валидными для baseline.
- **Alternatives**: npm tarball 0.0.3 (нет исходников тестов), git subtree (тащит историю чужого репо в монорепу — не нужно).

## R2. Регистрация глобального guard

- **Decision**: `createYandexHandler(AppModule, options?)` при создании `INestApplication` регистрирует `GlobalAuthGuard` через `app.useGlobalGuards()` (после `NestFactory.create`, до `init()`). Guard резолвится из DI-контекста приложения.
- **Rationale**: `useGlobalGuards` — программный эквивалент `APP_GUARD`, не требует от приложения ручной регистрации (Assumption spec: «регистрируется автоматически bootstrap-ом»), сохраняет стандартный Nest lifecycle (guards до pipes/interceptors).
- **Alternatives**: `APP_GUARD` provider через `app.select(DynamicModule)` — требует внедрения dynamic module в user AppModule, интрузивнее; mixin-обёртка AppModule — магия, против Constitution V.
- **Scope**: только HTTP-транспорт. MQ dispatch path (spec 001 US2) global guard не затрагивает — `@QueueHandler` не проходит через HTTP guard pipeline (FR-011).

## R3. Делегирование guard через DI (FR-004)

- **Decision**: `GlobalAuthGuard` получает `ModuleRef`; при наличии metadata guard-класса резолвит его `moduleRef.get(guardClass, { strict: false })`, затем вызывает `canActivate(context)`. Ошибка резолва (guard не зарегистрирован) — естественный `UnknownElementException` Nest, не маскируется (Edge Case spec).
- **Rationale**: `strict: false` позволяет guard, зарегистрированному в любом модуле приложения (типичный случай: guard — provider feature-модуля), резолвиться из глобального контекста; guard со своими зависимостями конструируется контейнером (US2/AC4).
- **Alternatives**: `new guardClass()` — запрещено FR-004 (обход DI); require регистрации guard в корневом модуле — неоправданное ограничение.

## R4. Precedence method > controller (FR-003)

- **Decision**: `Reflector.getAllAndOverride('ycsf:auth:guard', [handler, class])` — идемпотентно стандартной семантике Nest (`APP_GUARD`-guards так и читают metadata). Аналогично `ycsf:auth:scheme` (scheme нужна только для будущих нужд/диагностики; guard из неё не выводится — FR-006).
- **Rationale**: `getAllAndOverride` — канонический механизм precedence в Nest; method-level перекрывает controller-level без ручного кода.
- **Alternatives**: ручной `getMetadata` по двум целям + merge — дублирует Reflector, источник ошибок.

## R5. Project-default guard (FR-006, clarify 2026-09-04)

- **Decision**: bootstrap-опция `createYandexHandler(AppModule, { defaultAuthGuard?: Type<CanActivate> | null })`. `GlobalAuthGuard` получает её через инъекцию (options token, регистрируемый bootstrap-ом) и применяет ТОЛЬКО при отсутствии metadata guard на обоих уровнях. Опция не задана → пропуск проверки.
- **Rationale**: прямое следование clarify-ответу и IDEA §11 («нельзя выводить Guard из default scheme»): default — явный параметр, не вывод.
- **Alternatives**: чтение defaultScheme из auth.yaml — запрещено (FR-010, Constitution I: A не знает auth.yaml).

## R6. Subpath exports и сборка (FR-007)

- **Decision**: `tsup.config.ts` с entry `src/index.ts`, `src/auth/index.ts`, `src/queue/index.ts`, `src/context/index.ts`; `package.json.exports` по образцу `@ycforge/pilot/contracts`: каждый subpath → `{types, import, require}` в `dist/`. Dual ESM/CJS как у pilot.
- **Rationale**: конвенция уже установлена в монорепе (pilot); tree-shaking обеспечивается отдельными entry-точками, не barrel.
- **Alternatives**: tsup multi-entry без CJS — ломает CJS-потребителей NestJS (большинство Nest-приложений CJS); отдельные пакеты — против «отдельного SDK-пакета нет» и overkill.

## R7. Статический guard-тест FR-008

- **Decision**: vitest-тест, сканирующий `src/auth/**`, `src/queue/**`, `src/context/**` (regex по `import ... from`), отклоняющий импорты `../index` / `../../index` / `./index` из sibling-barrel — любой путь, резолвящийся в корневой barrel `src/index.ts`. Запускается в обычном `pnpm test`.
- **Rationale**: запрет архитектурный → проверка в CI тестом, а не договорённостью; не требует внешних инструментов (eslint-plugin-import и т.п.).
- **Alternatives**: eslint no-restricted-imports — добавляет eslint-инфраструктуру, которой в монорепе нет.

## R8. Тестирование subpath compile (SC-003)

- **Decision**: три fixture-теста компилируют минимальные TS-файлы с импортами `@ycforge/nestjs-connector/auth|queue|context` через `tsc --noEmit` с `paths`, указывающими на `dist` собранного пакета (pretest: `pnpm build`). Плюс один — корневой barrel (обратная совместимость).
- **Rationale**: проверяет реальный exports-map контракт после сборки, а не только исходники.
- **Alternatives**: публиковать в локальный registry — тяжело для unit-фазы; проверка package.json как JSON — не проверяет резолв.

## R9. NestJS-версия

- **Decision**: peer `@nestjs/common`, `@nestjs/core` ^11 (как зафиксировано specs/001: «Peer-зависимости ^11; Node.js >= 22»), `@nestjs/swagger` ^11 (peer, только для `ApiSecurity` — уже транзитивно используется типичным Nest-приложением со swagger; если v0.0.3 не зависел от swagger — добавляется как peer с пометкой в CHANGELOG/migration note).
- **Rationale**: specs/001 зафиксировал фактические peer-зависимости v0.0.3; Assumption «предположительно ^10» уточняется фактом из specs/001 → ^11.
- **Alternatives**: ^10 — противоречит задокументированному baseline.
