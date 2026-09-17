# Data Model: 003-connector-require-auth

Домен — библиотечные контракты Project A; персистентного состояния нет.

## AuthMetadata

Metadata-ключи, записываемые `@RequireAuth` на target (method или controller class):

| Ключ | Тип значения | Описание |
|------|--------------|----------|
| `ycsf:auth:scheme` | `string` | имя схемы из `auth.yaml` (зона B; A не валидирует). Всегда записывается. |
| `ycsf:auth:guard` | `Type<CanActivate> \| null` | runtime guard-класс; `null` — явный public. Всегда записывается. |

Дополнительно при `scheme !== 'public'` декоратор применяет `ApiSecurity(scheme)` (metadata `@nestjs/swagger`, ключ `swagger/apiSecurity`) — читается B из сгенерированного OpenAPI; A сам её не потребляет.

**Validation rules**:
- scheme — непустая строка; пустая строка/не-строка — `TypeError` на этапе применения декоратора (fail-fast, Constitution V).
- precedence чтения: method > controller (`Reflector.getAllAndOverride`).
- повторное применение на одном уровне: побеждает последнее (`SetMetadata`-семантика), не error.

## GlobalAuthGuard

Глобальный guard, регистрируемый bootstrap-ом (`createYandexHandler`).

**Поля (DI)**: `Reflector`, `ModuleRef`, `options` (token с `defaultAuthGuard`).

**State machine на один HTTP-запрос**:

```text
read metadata (method > controller)
  ├─ guard-класс заявлен (≠ undefined, ≠ null) → resolve через ModuleRef → canActivate → вернуть его результат
  ├─ guard === null (явный public)             → true (пропуск)
  └─ metadata отсутствует на обоих уровнях
        ├─ options.defaultAuthGuard задан → resolve через DI → canActivate
        └─ не задан                       → true (пропуск)
```

Guard НИКОГДА не выводится из `ycsf:auth:scheme` (FR-006). Ошибка резолва guard в DI — не перехватывается (понятная ошибка Nest).

**Scope**: HTTP transport only. MQ dispatch path не проходит через этот guard (FR-011).

## ConnectorBootstrapOptions

Расширение опций `createYandexHandler`:

| Поле | Тип | Default | Описание |
|------|-----|---------|----------|
| `defaultAuthGuard` | `Type<CanActivate> \| null \| undefined` | `undefined` | project-default guard для маршрутов без auth-metadata (FR-006). |

Остальные существующие опции v0.0.3 не изменяются.

## Subpath entry points

| Subpath | Экспортирует | Источник |
|---------|--------------|----------|
| `.` (корень) | весь публичный API v0.0.3 + `RequireAuth`, `GlobalAuthGuard`, типы | `src/index.ts` |
| `./auth` | `RequireAuth`, ключи/типы AuthMetadata, `GlobalAuthGuard`, `ConnectorBootstrapOptions` | `src/auth/index.ts` |
| `./queue` | `QueueHandler`, `QueueMessage` (+ связанные типы из mq/) | `src/queue/index.ts` (ре-экспорт) |
| `./context` | `YandexContext` (+ типы контекста) | `src/context/index.ts` (ре-экспорт) |

**Инвариант FR-008**: модули `src/auth`, `src/queue`, `src/context` импортируют только конкретные внутренние модули, никогда `src/index.ts`.

## Relationships

- `RequireAuth` → пишет `AuthMetadata`; читается `GlobalAuthGuard` (runtime) и B через OpenAPI/`ApiSecurity` (compile-time, вне этого пакета).
- `GlobalAuthGuard` ← регистрируется `createYandexHandler` (core), конфигурируется `ConnectorBootstrapOptions`.
- `./queue`, `./context` — чистые ре-экспорты существующих декораторов; их логика не перемещается и не меняется.
