# Contract: package exports `@ycforge/nestjs-connector` (FR-007, FR-008)

Версия контракта: вводится в `@ycforge/nestjs-connector@0.1.0`.

## Exports map

```jsonc
{
  "name": "@ycforge/nestjs-connector",
  "type": "module",
  "exports": {
    ".":        { "types": "./dist/index.d.ts",   "import": "./dist/index.js",   "require": "./dist/index.cjs" },
    "./auth":    { "types": "./dist/auth/index.d.ts",   "import": "./dist/auth/index.js",   "require": "./dist/auth/index.cjs" },
    "./queue":   { "types": "./dist/queue/index.d.ts",  "import": "./dist/queue/index.js",  "require": "./dist/queue/index.cjs" },
    "./context": { "types": "./dist/context/index.d.ts","import": "./dist/context/index.js","require": "./dist/context/index.cjs" }
  }
}
```

(точная раскладка `dist/` определяется tsup-конфигом; контракт — сами subpath-ы и их содержимое.)

## Содержимое subpath-ов

| Subpath | Минимальный публичный срез |
|---------|----------------------------|
| `./auth` | `RequireAuth`, `GlobalAuthGuard`, типы AuthMetadata, `ConnectorBootstrapOptions` |
| `./queue` | `QueueHandler`, `QueueMessage` |
| `./context` | `YandexContext` |
| `.` | весь прежний публичный API v0.0.3 + всё из `./auth` (обратная совместимость) |

## Инварианты

- FR-008: `src/auth`, `src/queue`, `src/context` НЕ импортируют `src/index.ts` (корневой barrel). Проверяется статическим guard-тестом (research R7).
- Корневой barrel продолжает работать для существующих приложений (US3 AC3).
- `./queue` и `./context` — ре-экспорты существующих модулей; поведение декораторов не меняется (Assumption spec).

## Тест-кейсы (traceability)

| Тест | Покрывает |
|------|-----------|
| compile-фикстура: импорт только `/auth` | US3 AC1, SC-003 |
| compile-фикстура: импорт `/queue` + `/context` | US3 AC2, SC-003 |
| compile-фикстура: корневой barrel | US3 AC3 |
| guard-тест: запрет импорта корневого barrel из subpath-модулей | FR-008 |
