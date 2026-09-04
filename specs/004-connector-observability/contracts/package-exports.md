# Contract: Package exports (004)

Изменения exports-карты и сборки `@ycforge/nestjs-connector` по spec 004. Существующая структура (spec 003/FR-007) не ломается — добавляется один subpath и root-экспорт.

## package.json `exports` (после)

```jsonc
{
  "exports": {
    ".":       { "types": "./dist/index.d.ts",      "import": "./dist/index.js",      "require": "./dist/index.cjs" },
    "./auth":  { "types": "./dist/auth/index.d.ts", "import": "./dist/auth/index.js", "require": "./dist/auth/index.cjs" },
    "./queue": { "types": "./dist/queue/index.d.ts","import": "./dist/queue/index.js","require": "./dist/queue/index.cjs" },
    "./context": { "types": "./dist/context/index.d.ts","import": "./dist/context/index.js","require": "./dist/context/index.cjs" },
    "./logger":  { "types": "./dist/logger/index.d.ts","import": "./dist/logger/index.js","require": "./dist/logger/index.cjs" }
  }
}
```

## Root barrel `src/index.ts`

Добавляются:

```ts
// Observability (spec 004): application logger provider and log record types.
export { YandexLogger } from "./logger/yandex-logger";
export type { YandexLogLevel } from "./logger/record"; // или эквивалент type-контракта
```

## tsup.config.ts

```ts
entry: {
  index: "src/index.ts",
  "auth/index": "src/auth/index.ts",
  "queue/index": "src/queue/index.ts",
  "context/index": "src/context/index.ts",
  "logger/index": "src/logger/index.ts",   // NEW
}
```

## Guard (FR-008, spec 003 test)

`test/packaging/no-root-barrel-import.spec.ts`: `GUARDED_DIRS = ["auth", "queue", "context", "logger"]`.

## Инвариант

- Subpath-модули импортируют только относительные внутренние модули, никогда корневой barrel (FR-008).
- Добавление `./logger` — аддитивно; существующие импорты `.` `/auth` `/queue` `/context` не меняются (spec 003 обратная совместимость).