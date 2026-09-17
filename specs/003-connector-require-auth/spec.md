# Feature Specification: `@RequireAuth` + global guard + subpath exports — закрытие gap-ов 15–17 из specs/001

**Feature Branch**: `003-connector-require-auth`

**Created**: 2026-09-04

**Status**: Draft — greenfield в рамках Project A; закрывает расхождения №15–17 таблицы «Расхождения с IDEA.md» specs/001-connector-reverse

**Input**: Greenfield-spec для Project A (`@ycforge/nestjs-connector`, мигрирует в `packages/nest-bridge`): декоратор `@RequireAuth(scheme, guard)`, глобальный guard с делегированием по metadata (method > controller > project default), subpath exports `/auth`, `/queue`, `/context`. Источники требований: `IDEA.md` §11, §2; зависимость: spec 001 (reverse-spec, фиксирует отсутствие функциональности: пп. 15–17 таблицы расхождений).

> Аппаратная проверка из specs/001 (код `ycsf-nestjs-connector@0.0.3`): декоратора, metadata `ycsf:auth:guard`/`ycsf:auth:scheme`, `ApiSecurity`-интеграции, глобального guard и subpath exports НЕТ. Этот spec описывает, ЧТО должно появиться.

## Clarifications

### Session 2026-09-04

- Q: Что делает глобальный guard, если ни method, ни controller не несут auth-metadata? → A (вариант C): применяется project-default guard, заданный bootstrap-опцией connector-а; опция не задана — проверка пропускается. Guard НЕ выводится из scheme (FR-006).
- Q: Регламентировать ли запрет корневого barrel внутри subpath-модулей? → A (вариант A): subpath-модули (`/auth`, `/queue`, `/context`) SHALL NOT импортировать корневой barrel; запрет проверяется статическим guard-тестом (FR-008).
- Q: Распространяется ли `@RequireAuth` на `@QueueHandler`-методы в 003? → A (вариант A): HTTP-only. Обоснование: в OpenAPI/API Gateway MQ фигурирует только как исходящая интеграция (HTTP/WS → MQ), а Project A обслуживает только входящую доставку (облако → функция); security schemes API Gateway на входящий MQ не действуют (FR-011).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Разработчик помечает auth-схему и guard на controller/методе (Priority: P1)

Разработчик NestJS-приложения декларирует authentication-контракт маршрута: `@RequireAuth('user', UserAuthGuard)` на controller или method; для публичного маршрута — `@RequireAuth('public', null)`. Декоратор записывает metadata (`ycsf:auth:scheme`, `ycsf:auth:guard`) и для не-public схемы ставит `ApiSecurity(scheme)`, чтобы B (composer) увидел security-требование в сгенерированном OpenAPI, не импортируя user-код.

**Why this priority**: декоратор — заявленный в IDEA §11 публичный контракт A; без него нет ни OpenAPI security metadata, ни основы для runtime-принудительности (gap №15).

**Independent Test**: unit-тест: декорированный класс/метод несёт metadata `ycsf:auth:scheme`/`ycsf:auth:guard` с переданными значениями; для схемы ≠ `public` присутствует `ApiSecurity`-metadata; для `('public', null)` — `ApiSecurity` отсутствует.

**Acceptance Scenarios**:

1. **Given** `@RequireAuth('user', UserAuthGuard)` на controller, **When** читается metadata, **Then** `ycsf:auth:scheme === 'user'`, `ycsf:auth:guard === UserAuthGuard`, присутствует `ApiSecurity('user')`.
2. **Given** `@RequireAuth('admin', AdminGuard)` на method, **When** читается metadata метода, **Then** оба ключа записаны на уровне метода, `ApiSecurity('admin')` присутствует.
3. **Given** `@RequireAuth('public', null)` на method, **When** читается metadata, **Then** `ycsf:auth:scheme === 'public'`, `ycsf:auth:guard === null`, `ApiSecurity`-metadata ОТСУТСТВУЕТ.
4. **Given** project-local wrapper (`export const Public = () => RequireAuth('public', null)`), **When** wrapper применён к методу, **Then** metadata идентична прямому применению декоратора.

---

### User Story 2 — Runtime: глобальный guard применяет заявленный guard через DI (Priority: P1)

При HTTP-вызове глобальный guard connector-а читает metadata обработчика с precedence **method > controller**; если guard заявлен — делегирует решение ему, инстанцируя/резолвя guard-класс через Nest DI (в guard доступны его собственные зависимости); если guard `null` — проверка пропускается. Никакого вывода guard из scheme: scheme — только OpenAPI/Gateway-контракт, guard — только runtime.

**Why this priority**: metadata без принудительности не даёт безопасности; заявлено в IDEA §2 («применять guard из `@RequireAuth` через global guard с делегированием») и §11 (gap №16).

**Independent Test**: интеграционный тест на Nest testing module: запрос к защищённому маршруту проходит через заявленный guard (в т.ч. guard с DI-зависимостью); запрос к `('public', null)` маршруту guard не блокирует; method-level metadata перекрывает controller-level.

**Acceptance Scenarios**:

1. **Given** controller `@RequireAuth('user', UserAuthGuard)`, method без своего декоратора, **When** выполняется запрос, **Then** вызывается именно `UserAuthGuard` (через DI), его `canActivate` определяет результат.
2. **Given** controller-level guard и method `@RequireAuth('admin', AdminGuard)`, **When** выполняется запрос к этому методу, **Then** применяется `AdminGuard`, а не controller-ный.
3. **Given** `@RequireAuth('public', null)`, **When** выполняется запрос, **Then** никакой guard не вызывается, запрос пропускается.
4. **Given** заявленный guard с собственной DI-зависимостью (сервис приложения), **When** guard резолвится, **Then** зависимость инжектится (guard не конструируется через `new` в обход DI).
5. **Given** ни method, ни controller не несут auth-metadata, **When** выполняется запрос, **Then** применяется project-default guard, заданный bootstrap-опцией connector-а; если опция не задана — проверка пропускается; guard НЕ выводится из scheme (clarify 2026-09-04, FR-006).

---

### User Story 3 — Точечный импорт контрактов через subpath exports (Priority: P2)

Приложение импортирует auth-контракты через `@ycforge/nestjs-connector/auth`, queue-контракты (`@QueueHandler`, `@QueueMessage`) через `.../queue`, `@YandexContext` через `.../context` — не поднимая весь connector. Каждый subpath экспортирует только свой срез публичного API; корневой barrel при этом сохраняется.

**Why this priority**: заявлено в IDEA §11 (gap №17); влияет на tree-shaking/явность зависимостей приложения, но не блокирует US1–US2.

**Independent Test**: type/compile-тест: пакет, импортирующий только `@ycforge/nestjs-connector/auth` (и отдельно `/queue`, `/context`), компилируется; guard-тест сканирует исходники subpath-модулей и отклоняет любой импорт корневого barrel (`./index.js`) (FR-008, clarify 2026-09-04).

**Acceptance Scenarios**:

1. **Given** приложение с `import { RequireAuth } from '@ycforge/nestjs-connector/auth'`, **When** пакет компилируется, **Then** компиляция успешна без импорта корня пакета.
2. **Given** `import { QueueHandler, QueueMessage } from '@ycforge/nestjs-connector/queue'` и `import { YandexContext } from '@ycforge/nestjs-connector/context'`, **When** пакет компилируется, **Then** оба импорта резолвятся через exports-мапу.
3. **Given** корневой импорт (`@ycforge/nestjs-connector`), **When** приложение мигрирует на subpath-ы, **Then** корневой barrel продолжает работать (обратная совместимость существующих приложений).

---

### Edge Cases

- Оба уровня metadata: method декорирован, controller декорирован — method выигрывает (US2/AC2); конфликт НЕ error.
- Controller `@RequireAuth('public', null)` + method с конкретным guard — method guard применяется.
- Схема ≠ `public` с `guard === null`: намеренная публикация маршрута без Nest-guard при gateway-проверке схемы — допустимо (guard и scheme независимы), но визуально неочевидно; семантика фиксируется документацией декоратора.
- Дублирующее применение `@RequireAuth` на одном уровне (два декоратора): побеждает применённый последним (стандартная семантика `SetMetadata`) — не error.
- Guard-класс не зарегистрирован в DI-контейнере приложения: резолв через DI должен завершиться понятной ошибкой Nest (не молчаливым пропуском).
- MQ/queue handlers и `@RequireAuth`: не применяется — scope декоратора HTTP-only (clarify 2026-09-04): в OpenAPI/API Gateway MQ фигурирует только как исходящая интеграция (HTTP/WS → MQ), а Project A обслуживает только входящую доставку сообщений; security schemes API Gateway на входящий MQ не действуют. Входящая MQ-auth — предмет отдельного spec при необходимости.
- B читает только `ApiSecurity` из OpenAPI: A не должен импортировать B и не должен писать auth.yaml (Constitution I) — scheme validation относится к B (spec 007).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: THE CONNECTOR SHALL предоставлять декоратор `RequireAuth(scheme: string, guard: Type<CanActivate> | null)`, записывающий metadata `ycsf:auth:scheme` = scheme и `ycsf:auth:guard` = guard (IDEA §11).
- **FR-002**: WHEN scheme !== `'public'`, THE DECORATOR SHALL дополнительно применять `ApiSecurity(scheme)`; для `'public'` `ApiSecurity` SHALL NOT применяться (IDEA §11).
- **FR-003**: THE CONNECTOR SHALL регистрировать глобальный guard как часть bootstrap (`createYandexHandler`/эквивалент), читающий metadata с precedence **method > controller** (IDEA §11, gap №16).
- **FR-004**: WHEN metadata содержит guard !== null, THE GLOBAL GUARD SHALL делегировать решение этому guard-классу, резолвя его через Nest DI; guard SHALL NOT конструироваться в обход DI (US2/AC4).
- **FR-005**: WHEN metadata содержит guard === null, THE GLOBAL GUARD SHALL пропускать проверку (явный public) (IDEA §11).
- **FR-006**: THE CONNECTOR SHALL NOT выводить guard из scheme или project default scheme; при отсутствии metadata на обоих уровнях THE GLOBAL GUARD SHALL применять project-default guard из bootstrap-опции connector-а, а при незаданной опции — пропускать проверку (IDEA §11: «Нельзя выводить Guard из default scheme»; clarify 2026-09-04).
- **FR-007**: THE PACKAGE SHALL экспортировать публичный API через subpath exports `./auth`, `./queue`, `./context` наряду с корневым barrel; `./auth` SHALL экспортировать минимум `RequireAuth` (IDEA §11, gap №17).
- **FR-008**: THE SUBPATH MODULES (`/auth`, `/queue`, `/context`) SHALL NOT импортировать корневой barrel пакета (`./index.js`) — только относительные пути к конкретным внутренним модулям; запрет SHALL проверяться статическим guard-тестом (clarify 2026-09-04).
- **FR-009**: THE CONNECTOR SHALL поддерживать project-local wrappers (декоратор — обычная higher-order функция; `SetMetadata` комбинируемо) (IDEA §11).
- **FR-010**: THE CONNECTOR SHALL NOT импортировать Project B/composer и SHALL NOT генерировать/валидировать `auth.yaml`; scheme-валидация — зона B (Constitution I, IDEA §11).
- **FR-011**: THE SCOPE of `@RequireAuth` SHALL быть HTTP-only в 003: декоратор не применяется к `@QueueHandler()`-методам (clarify 2026-09-04; MQ в API Gateway — исходящая интеграция, входящая MQ-доставка в A вне действия security schemes).

### Key Entities

- **AuthMetadata**: пара metadata-ключей `ycsf:auth:scheme` (строка схемы из `auth.yaml`) + `ycsf:auth:guard` (класс guard-а или `null`); единственный канал передачи auth-контракта из приложения в runtime и в OpenAPI.
- **GlobalAuthGuard**: глобальный guard connector-а; читает AuthMetadata (method > controller), делегирует через DI либо пропускает.
- **Subpath entry points**: `/auth`, `/queue`, `/context` — точечные публичные срезы API пакета.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Каждый acceptance scenario US1–US3 покрыт минимум одним выполняемым тестом; выполнение `pnpm --filter @ycforge/nestjs-connector test` зелёное (traceability, Constitution II).
- **SC-002**: Precedence method > controller подтверждён тестом с обоими уровнями metadata; отсутствие вывода guard из scheme подтверждено тестом (FR-006).
- **SC-003**: Три отдельных compile-теста (пакета-фикстуры) импортируют `/auth`, `/queue`, `/context` без импорта корневого entry point; корневой barrel при этом сохраняет работоспособность (FR-007, FR-008).
- **SC-004**: Делегирование через DI подтверждено тестом, в котором заявленный guard имеет собственную инжектируемую зависимость (FR-004).

## Assumptions

- Целевой пакет — `packages/nest-bridge` (`@ycforge/nestjs-connector`), код мигрирует из `ycsf-nestjs-connector@0.0.3`; если миграция не завершена к фазе plan, план SHALL включать миграционные задачи (перенос кода + существующих тестов) как блокирующий preamble.
- Существующие декораторы `@QueueHandler`/`@QueueMessage`/`@YandexContext` и вся MQ/HTTP-функциональность spec 001 в данный spec не входят — 003 добавляет только auth и packaging; изменений в их поведении нет.
- NestJS-версия — та, что использует существующий connector (предположительно ^10); точная версия фиксируется на плане.
- Глобальный guard регистрируется автоматически bootstrap-ом connector-а (без ручного `APP_GUARD` в приложении) — чтение IDEA §11 («A регистрирует глобальный guard»).
- Семантика дублирующего применения декоратора — стандартная для `SetMetadata` (последний побеждает), ошибкой не считается.

## Точки неоднозначности IDEA.md (для clarify)

| # | Место | Проблема | Влияние на 003 |
|---|-------|----------|----------------|
| 1 | §11 | Precedence «method > controller > project default», но «нельзя выводить Guard из default scheme»: поведение при отсутствии metadata на обоих уровнях не определено | РЕШЕНО 2026-09-04: project-default guard из bootstrap-опции; не задан — пропуск (FR-006) |
| 2 | §11 | Допустима ли транзитивная зависимость subpath-модулей от корневого barrel внутри пакета | РЕШЕНО 2026-09-04: запрет + guard-тест (FR-008) |
| 3 | §11 vs §2 | `@RequireAuth` описан только для HTTP; распространяется ли он на `@QueueHandler()`-методы | РЕШЕНО 2026-09-04: HTTP-only; обоснование направлением MQ (FR-011) |
