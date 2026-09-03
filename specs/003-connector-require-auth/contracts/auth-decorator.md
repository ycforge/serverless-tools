# Contract: `@RequireAuth` decorator + GlobalAuthGuard (public API `@ycforge/nestjs-connector/auth`)

Версия контракта: вводится в `@ycforge/nestjs-connector@0.1.0`. Semver вместе с пакетом; breaking change = major (post-1.0) / minor (пока 0.x) + migration note.

## `RequireAuth(scheme, guard)`

```ts
function RequireAuth(
  scheme: string,
  guard: Type<CanActivate> | null,
): MethodDecorator & ClassDecorator
```

- Записывает `SetMetadata('ycsf:auth:scheme', scheme)` и `SetMetadata('ycsf:auth:guard', guard)`.
- `scheme !== 'public'` → дополнительно `ApiSecurity(scheme)`; `scheme === 'public'` → `ApiSecurity` НЕ применяется.
- `scheme` пустой/не строка → `TypeError` при применении декоратора (fail-fast).
- Применим к class (controller) и method; комбинируем в project-local wrappers (обычная higher-order функция, FR-009).
- HTTP-only: на `@QueueHandler()`-методах не имеет эффекта (FR-011) — MQ dispatch не проходит guard pipeline.

## Metadata keys (стабильные строки, часть контракта)

- `ycsf:auth:scheme: string`
- `ycsf:auth:guard: Type<CanActivate> | null`

## `GlobalAuthGuard` (поведенческий контракт)

```ts
class GlobalAuthGuard implements CanActivate
```

1. Читает metadata `ycsf:auth:guard` с precedence **method > controller**.
2. Guard заявлен → резолв через Nest DI (`ModuleRef`, `strict: false`), `canActivate` заявленного guard определяет результат. Guard не конструируется через `new`.
3. `guard === null` → пропуск (явный public).
4. Metadata нет → `defaultAuthGuard` из bootstrap-опций, если задан (тоже через DI); иначе пропуск.
5. Guard НЕ выводится из scheme.

Регистрация: автоматически `createYandexHandler` (программный global guard, эквивалент `APP_GUARD`); приложение НЕ регистрирует его вручную.

## `createYandexHandler` — расширение сигнатуры

```ts
createYandexHandler(
  appModule: Type<unknown>,
  options?: ConnectorBootstrapOptions & { /* существующие опции v0.0.3 без изменений */ },
): Promise<YandexFunctionHandler>

interface ConnectorBootstrapOptions {
  defaultAuthGuard?: Type<CanActivate> | null;
}
```

## Негативные гарантии (Constitution I)

- Пакет НЕ импортирует `@ycforge/composer` и не читает/не пишет `auth.yaml`.
- Валидация существования scheme — зона B (spec 007), не A.

## Тест-кейсы контракта (traceability к spec)

| Тест | Покрывает |
|------|-----------|
| metadata на class/method, `ApiSecurity` присутствует/отсутствует | US1 AC1–AC3, FR-001, FR-002 |
| project-local wrapper даёт идентичную metadata | US1 AC4, FR-009 |
| интеграция: controller guard, method override, public-пропуск | US2 AC1–AC3 |
| guard с DI-зависимостью резолвится контейнером | US2 AC4, FR-004 |
| без metadata: defaultAuthGuard применяется / не задан → пропуск; guard не выводится из scheme | US2 AC5, FR-006, SC-002 |
| guard не в DI → понятная ошибка Nest | Edge Case |
| `@RequireAuth` на queue handler не влияет на MQ dispatch | FR-011 |
