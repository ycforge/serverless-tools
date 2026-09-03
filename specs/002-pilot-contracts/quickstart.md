# Quickstart: проверка contracts-модуля end-to-end

Валидационный гид для spec 002. Предполагает, что реализация выполнена по `tasks.md`.

## Предусловия

- Node ≥ 22, pnpm 11 (через corepack: `corepack enable`).
- Зависимости установлены: `pnpm install` из корня репозитория.

## Сценарии проверки

### 1. Типовые и runtime-тесты пакета (SC-002, SC-004, SC-005)

```bash
pnpm --filter @ycforge/pilot test
```

Ожидаемый результат: все тесты зелёные; включая type-тесты `.test-d.ts` (vitest typecheck). Покрыто: сигнатуры FR-001…FR-010, FR-016 (type-тесты ломаются при изменении сигнатуры), round-trip парсера на канонических примерах `functions.user_service.id`, `containers.analytics.id`, `queues.events.qurl`, `buckets.frontend.name`, отказ невалидных входов с `ContractError`, `CONTRACT_VERSION === major(package.json)`.

### 2. Gate самодостаточности example-пакета (SC-003)

```bash
pnpm --filter @ycforge-example/contracts-plugin test
```

Ожидаемый результат: `pretest` собирает `@ycforge/pilot` (tsup), затем `tsc --noEmit` компилирует reference builder + reference materializer, импортирующие **только** `@ycforge/pilot/contracts`; никаких импортов из `packages/pilot/src` или других пакетов монорепы. Guard-тест `test/unit/example-imports.test.ts` проверяет источник импортов статически.

### 3. Gate zero-dependency (SC-001)

Входит в `pnpm --filter @ycforge/pilot test`: тест импорт-графа проверяет, что `src/contracts/**` не содержит non-relative импортов, а `package.json` пакета не объявляет runtime-зависимостей.

### 4. Сборка пакета

```bash
pnpm --filter @ycforge/pilot build
```

Ожидаемый результат: `dist/` содержит ESM + CJS + `.d.ts` для entry points `.` и `./contracts`; subpath `./contracts` резолвится из внешнего пакета (проверяется сценарием 2 через `workspace:`). Сценарий самодостаточен: сценарий 2 уже выполняет эту сборку через `pretest`.

## Проверка traceability

Каждый acceptance criterion spec 002 имеет минимум один тест: карта «FR/US → тест-файл» ведётся в `tasks.md` и проверяется на ревью.

## Релизная проверка (процесс, не код)

- Любая ломка plugin API → major пакета + `MIGRATION.md` в корне `packages/pilot` (SC-005; на v1 тест тривиально истинен, правило фиксируется для ≥ 2).
- Ломка `.ycsf/*.yaml`-формата (без ломки API) поднимает только `version` поля файлов — major пакета не требуется (clarify 2026-09-03).
